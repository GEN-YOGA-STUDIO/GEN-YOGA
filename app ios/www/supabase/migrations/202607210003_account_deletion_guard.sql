begin;

alter table public.profiles
  add column if not exists account_deletion_pending boolean not null default false,
  add column if not exists account_deletion_requested_at timestamptz,
  add column if not exists account_deletion_request_id uuid;

-- Authenticated purchases are retained as financial history. Their profile FK
-- uses ON DELETE SET NULL, so the ownership shape must permit that post-delete
-- state while the private fulfillment RPC still requires a user on insertion.
alter table public.stripe_purchases
  drop constraint if exists stripe_purchases_check;
alter table public.stripe_purchases
  drop constraint if exists stripe_purchases_owner_shape_check;
alter table public.stripe_purchases
  add constraint stripe_purchases_owner_shape_check check (
    (is_guest and user_id is null and purchase_type = 'clase_suelta')
    or not is_guest
  );

alter table public.profiles
  drop constraint if exists profiles_account_deletion_state_check;

alter table public.profiles
  add constraint profiles_account_deletion_state_check check (
    (
      account_deletion_pending
      and account_deletion_requested_at is not null
      and account_deletion_request_id is not null
    )
    or (
      not account_deletion_pending
      and account_deletion_requested_at is null
      and account_deletion_request_id is null
    )
  );

create index if not exists profiles_account_deletion_pending_idx
  on public.profiles (account_deletion_requested_at)
  where account_deletion_pending;

create or replace function public.protect_account_deletion_state()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(auth.role(), '') <> 'service_role'
      and (
        new.account_deletion_pending
        or new.account_deletion_requested_at is not null
        or new.account_deletion_request_id is not null
      ) then
      raise exception 'account deletion state is server managed' using errcode = '42501';
    end if;
    return new;
  end if;

  if coalesce(auth.role(), '') <> 'service_role'
    and (
      new.account_deletion_pending is distinct from old.account_deletion_pending
      or new.account_deletion_requested_at is distinct from old.account_deletion_requested_at
      or new.account_deletion_request_id is distinct from old.account_deletion_request_id
    ) then
    raise exception 'account deletion state is server managed' using errcode = '42501';
  end if;

  if old.account_deletion_pending and (
    coalesce(new.bonos, 0) > coalesce(old.bonos, 0)
    or coalesce(new.saldo_psicologia, 0) > coalesce(old.saldo_psicologia, 0)
    or coalesce(new.saldo_nutricion, 0) > coalesce(old.saldo_nutricion, 0)
    or (
      coalesce(new.bono_mensual_activo, false)
      and (
        not coalesce(old.bono_mensual_activo, false)
        or new.bono_mensual_fin is distinct from old.bono_mensual_fin
        or new.stripe_subscription_id is distinct from old.stripe_subscription_id
        or new.stripe_subscription_event_created is distinct from old.stripe_subscription_event_created
      )
    )
  ) then
    raise exception 'account deletion pending; entitlement update rejected' using errcode = '55000';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_protect_account_deletion_state on public.profiles;
create trigger profiles_protect_account_deletion_state
before insert or update on public.profiles
for each row execute function public.protect_account_deletion_state();

create or replace function public.claim_account_deletion(
  p_user_id uuid,
  p_request_id uuid
)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_requested_at timestamptz;
  v_target_role text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_user_id is null or p_request_id is null then
    raise exception 'missing account deletion identifiers' using errcode = '22023';
  end if;

  -- Serialise administrator deletions. Counting admins in the Edge Function
  -- alone is racy: two requests could otherwise both observe the other admin
  -- and then delete both accounts.
  perform pg_advisory_xact_lock(hashtextextended('gen_yoga_account_deletion_admin_guard', 0));

  select rol
    into v_target_role
    from public.profiles
   where id = p_user_id
   for update;

  if not found then
    return null;
  end if;

  if lower(trim(coalesce(v_target_role, ''))) = 'admin'
    and not exists (
      select 1
        from public.profiles
       where id <> p_user_id
         and lower(trim(coalesce(rol, ''))) = 'admin'
         and not account_deletion_pending
    ) then
    raise exception 'last administrator cannot be deleted' using errcode = '55000';
  end if;

  update public.profiles
  set account_deletion_pending = true,
      account_deletion_requested_at = clock_timestamp(),
      account_deletion_request_id = p_request_id
  where id = p_user_id
    and (
      not account_deletion_pending
      or account_deletion_requested_at < clock_timestamp() - interval '30 minutes'
    )
  returning account_deletion_requested_at into v_requested_at;

  if not found and exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'account deletion already in progress' using errcode = '55000';
  end if;

  return v_requested_at;
end;
$$;

create or replace function public.release_account_deletion(
  p_user_id uuid,
  p_request_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_user_id is null or p_request_id is null then
    raise exception 'missing account deletion identifiers' using errcode = '22023';
  end if;

  update public.profiles
  set account_deletion_pending = false,
      account_deletion_requested_at = null,
      account_deletion_request_id = null
  where id = p_user_id
    and account_deletion_pending
    and account_deletion_request_id = p_request_id;

  return found;
end;
$$;

create or replace function public.finalize_account_deletion(
  p_user_id uuid,
  p_request_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_email text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_user_id is null or p_request_id is null then
    raise exception 'missing account deletion identifiers' using errcode = '22023';
  end if;

  select lower(nullif(trim(email), ''))
    into v_profile_email
  from public.profiles
  where id = p_user_id
    and account_deletion_pending
    and account_deletion_request_id = p_request_id
  for update;

  if not found then
    raise exception 'account deletion claim is no longer owned' using errcode = '55000';
  end if;

  delete from public.reservas_yoga where user_id = p_user_id;
  delete from public.reservas_psicologia where user_id = p_user_id;
  delete from public.reservas_nutricion where user_id = p_user_id;
  delete from public.grupos_profesionales where alumno_id = p_user_id;

  if v_profile_email is not null then
    delete from public.grupos_profesionales
    where profesional_id in (
      select id
      from public.profesionales
      where lower(nullif(trim(email), '')) = v_profile_email
    );

    -- A professional card may still be referenced by historical classes. Hide
    -- and anonymize it transactionally instead of leaving personal data public
    -- or cascading away attendance history.
    update public.profesionales
    set nombre = 'Profesional retirado',
        apellidos = '',
        email = 'retirado+' || md5(id::text || p_request_id::text) || '@genyoga.invalid',
        foto_url = null,
        descripcion = '',
        especialidad = '',
        visible_publico = false
    where lower(nullif(trim(email), '')) = v_profile_email;
  end if;

  delete from public.stripe_subscriptions where user_id = p_user_id;
  delete from public.stripe_customers where user_id = p_user_id;
  delete from public.profiles
  where id = p_user_id
    and account_deletion_pending
    and account_deletion_request_id = p_request_id;

  if not found then
    raise exception 'profile was not deleted' using errcode = 'P0002';
  end if;

  return true;
end;
$$;

revoke all on function public.claim_account_deletion(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_account_deletion(uuid, uuid) from public, anon, authenticated;
revoke all on function public.finalize_account_deletion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_account_deletion(uuid, uuid) to service_role;
grant execute on function public.release_account_deletion(uuid, uuid) to service_role;
grant execute on function public.finalize_account_deletion(uuid, uuid) to service_role;

comment on column public.profiles.account_deletion_pending is
  'Server-managed tombstone that blocks new Checkout sessions and entitlement grants while account deletion is in progress.';

commit;

begin;

alter table public.profiles
  add column if not exists saldo_yoga_compania integer not null default 0;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table if not exists private.welcome_companion_bonuses (
  profile_id uuid primary key
    references public.profiles(id) on delete cascade,
  companion_modality text not null default 'colegas',
  credits_remaining smallint not null default 1,
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint welcome_companion_bonuses_modality_check
    check (companion_modality in ('colegas', 'pareja', 'hijo', 'abuela')),
  constraint welcome_companion_bonuses_credit_check
    check (credits_remaining between 0 and 1)
);

alter table private.welcome_companion_bonuses enable row level security;
revoke all on table private.welcome_companion_bonuses
  from public, anon, authenticated;
grant select, insert, update, delete on table private.welcome_companion_bonuses
  to service_role;

with inserted as (
  insert into private.welcome_companion_bonuses (
    profile_id, companion_modality, credits_remaining
  )
  select
    profile.id,
    'colegas',
    1
  from public.profiles as profile
  where lower(trim(coalesce(profile.rol, ''))) not in (
      'admin', 'profesor', 'trabajador', 'profesional'
    )
    and coalesce(profile.activo, true)
    and not coalesce(profile.account_deletion_pending, false)
    and not exists (
      select 1
        from private.welcome_companion_bonuses as existing_bonus
       where existing_bonus.profile_id = profile.id
    )
  on conflict (profile_id) do nothing
  returning profile_id
)
update public.profiles as profile
   set saldo_yoga_compania = 1
  from inserted
 where inserted.profile_id = profile.id;

create or replace function public.ajustar_saldo_usuario(
  p_user_id uuid,
  p_tipo text,
  p_delta integer
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_new_balance integer := 0;
  v_tipo_norm text;
begin
  if v_actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_user_id is null or p_tipo is null then
    raise exception 'invalid parameters' using errcode = '22023';
  end if;

  if p_delta is null or p_delta = 0 or p_delta < -1000 or p_delta > 1000 then
    raise exception 'invalid balance delta' using errcode = '22023';
  end if;

  select lower(coalesce(profile.rol, ''))
    into v_actor_role
    from public.profiles as profile
   where profile.id = v_actor_id;
  if not found or v_actor_role <> 'admin' then
    raise exception 'only administrators may adjust balances' using errcode = '42501';
  end if;

  perform 1
    from public.profiles as profile
   where profile.id = p_user_id
   for update;
  if not found then
    raise exception 'client profile not found' using errcode = 'P0002';
  end if;

  v_tipo_norm := lower(trim(p_tipo));

  if v_tipo_norm in ('yoga', 'bonos', 'clases_sueltas', 'clase', 'clases') then
    update public.profiles
       set bonos = greatest(0, coalesce(bonos, 0) + p_delta)
     where id = p_user_id
     returning bonos into v_new_balance;

  elsif v_tipo_norm in ('clases_gratis', 'clase_gratis', 'gratis') then
    update public.profiles
       set saldo_clases_gratis = greatest(0, coalesce(saldo_clases_gratis, 0) + p_delta)
     where id = p_user_id
     returning saldo_clases_gratis into v_new_balance;

  elsif v_tipo_norm in ('consultas_gratis', 'consulta_gratis') then
    update public.profiles
       set saldo_consultas_gratis = greatest(0, coalesce(saldo_consultas_gratis, 0) + p_delta)
     where id = p_user_id
     returning saldo_consultas_gratis into v_new_balance;

  elsif v_tipo_norm in ('yoga_compania', 'compania', 'yoga_en_compania') then
    update public.profiles
       set saldo_yoga_compania = greatest(0, coalesce(saldo_yoga_compania, 0) + p_delta)
     where id = p_user_id
     returning saldo_yoga_compania into v_new_balance;

    update private.welcome_companion_bonuses
       set credits_remaining = greatest(0, least(1, coalesce(credits_remaining, 0) + p_delta)),
           updated_at = now()
     where profile_id = p_user_id;

  elsif v_tipo_norm in ('psicologia', 'psico') then
    update public.profiles
       set saldo_psicologia = greatest(0, coalesce(saldo_psicologia, 0) + p_delta)
     where id = p_user_id
     returning saldo_psicologia into v_new_balance;

  elsif v_tipo_norm in ('nutricion', 'nutri') then
    update public.profiles
       set saldo_nutricion = greatest(0, coalesce(saldo_nutricion, 0) + p_delta)
     where id = p_user_id
     returning saldo_nutricion into v_new_balance;

  else
    raise exception 'invalid balance adjustment: %', p_tipo using errcode = '22023';
  end if;

  return coalesce(v_new_balance, 0);
end;
$function$;

revoke all on function public.ajustar_saldo_usuario(uuid, text, integer) from public, anon;
grant execute on function public.ajustar_saldo_usuario(uuid, text, integer) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
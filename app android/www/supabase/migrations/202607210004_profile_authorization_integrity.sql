begin;

-- Browser sessions cannot write profiles directly. Self-service and admin
-- changes go through audited functions that bind the target to auth.uid/role.
revoke insert, update, delete on table public.profiles from public, anon, authenticated;

-- Account creation can happen without an authenticated browser session when
-- email confirmation is enabled. Create the matching profile inside the same
-- database transaction as auth.users instead of trusting a client-side upsert.
create or replace function public.crear_perfil_nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_nombre text;
  v_apellidos text;
begin
  v_nombre := regexp_replace(
    trim(coalesce(new.raw_user_meta_data ->> 'nombre', '')),
    '\s+',
    ' ',
    'g'
  );
  v_apellidos := regexp_replace(
    trim(coalesce(new.raw_user_meta_data ->> 'apellidos', '')),
    '\s+',
    ' ',
    'g'
  );

  if length(v_nombre) < 1
    or length(v_nombre) > 80
    or v_nombre ~ '[[:cntrl:]<>&]' then
    v_nombre := 'Alumno';
  end if;
  if length(v_apellidos) > 120
    or v_apellidos ~ '[[:cntrl:]<>&]' then
    v_apellidos := '';
  end if;

  insert into public.profiles (id, nombre, apellidos, email, rol)
  values (
    new.id,
    v_nombre,
    v_apellidos,
    lower(trim(coalesce(new.email, ''))),
    'alumno'
  )
  on conflict (id) do update
  set nombre = case
        when nullif(trim(coalesce(profiles.nombre, '')), '') is null
          then excluded.nombre
        else profiles.nombre
      end,
      apellidos = case
        when nullif(trim(coalesce(profiles.apellidos, '')), '') is null
          then excluded.apellidos
        else profiles.apellidos
      end,
      email = excluded.email;

  return new;
end;
$$;

drop trigger if exists zz_gen_yoga_profile_after_signup on auth.users;
create trigger zz_gen_yoga_profile_after_signup
after insert on auth.users
for each row execute function public.crear_perfil_nuevo_usuario();

create or replace function public.actualizar_mi_perfil(
  p_nombre text,
  p_apellidos text default ''
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_nombre text;
  v_apellidos text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  v_nombre := regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_apellidos := regexp_replace(trim(coalesce(p_apellidos, '')), '\s+', ' ', 'g');
  if length(v_nombre) < 1 or length(v_nombre) > 80 or v_nombre ~ '[[:cntrl:]<>&]' then
    raise exception 'invalid first name' using errcode = '22023';
  end if;
  if length(v_apellidos) > 120 or v_apellidos ~ '[[:cntrl:]<>&]' then
    raise exception 'invalid last name' using errcode = '22023';
  end if;

  update public.profiles
  set nombre = v_nombre,
      apellidos = v_apellidos
  where id = auth.uid()
    and not coalesce(account_deletion_pending, false);

  if not found then
    raise exception 'profile not found or deletion pending' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.admin_configurar_bono_mensual(
  p_user_id uuid,
  p_activo boolean,
  p_inicio timestamptz default null,
  p_fin timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_role text;
  v_actor_deletion_pending boolean;
  v_target_role text;
  v_target_deletion_pending boolean;
  v_target_subscription_id text;
  v_target_subscription_status text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select lower(trim(coalesce(rol, ''))), coalesce(account_deletion_pending, false)
    into v_actor_role, v_actor_deletion_pending
  from public.profiles
  where id = auth.uid();

  if not found or v_actor_role is distinct from 'admin' or v_actor_deletion_pending then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  if p_user_id is null or p_activo is null then
    raise exception 'invalid monthly pass request' using errcode = '22023';
  end if;
  if p_activo and (p_inicio is null or p_fin is null or p_fin <= p_inicio) then
    raise exception 'invalid monthly pass dates' using errcode = '22023';
  end if;

  select lower(trim(coalesce(rol, ''))), coalesce(account_deletion_pending, false),
         stripe_subscription_id, lower(trim(coalesce(stripe_subscription_status, '')))
    into v_target_role, v_target_deletion_pending,
         v_target_subscription_id, v_target_subscription_status
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'target profile not found' using errcode = 'P0002';
  end if;
  if v_target_role in ('admin', 'profesor', 'trabajador', 'profesional') then
    raise exception 'monthly passes can only be assigned to clients' using errcode = '22023';
  end if;
  if v_target_deletion_pending then
    raise exception 'target account deletion is pending' using errcode = '55000';
  end if;
  if (
    nullif(trim(coalesce(v_target_subscription_id, '')), '') is not null
    and v_target_subscription_status not in ('canceled', 'incomplete_expired')
  ) or v_target_subscription_status in (
    'active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'
  ) then
    raise exception 'active Stripe subscription must be managed in Customer Portal'
      using errcode = '55000';
  end if;

  update public.profiles
  set bono_mensual_activo = p_activo,
      bono_mensual_inicio = case when p_activo then p_inicio else null end,
      bono_mensual_fin = case when p_activo then p_fin else null end
  where id = p_user_id;
end;
$$;

create or replace function public.admin_promover_usuario_profesor(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_role text;
  v_actor_deletion_pending boolean;
  v_profile record;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select lower(trim(coalesce(rol, ''))), coalesce(account_deletion_pending, false)
    into v_actor_role, v_actor_deletion_pending
  from public.profiles
  where id = auth.uid();

  if not found or v_actor_role is distinct from 'admin' or v_actor_deletion_pending then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'invalid target profile' using errcode = '22023';
  end if;

  select id, nombre, apellidos, email, avatar_url,
         lower(trim(coalesce(rol, ''))) as rol,
         coalesce(account_deletion_pending, false) as account_deletion_pending
    into v_profile
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'target profile not found' using errcode = 'P0002';
  end if;
  if v_profile.rol in ('admin', 'profesor', 'trabajador', 'profesional') then
    raise exception 'existing staff roles cannot be changed here' using errcode = '22023';
  end if;
  if v_profile.account_deletion_pending then
    raise exception 'target account deletion is pending' using errcode = '55000';
  end if;
  if coalesce(trim(v_profile.email), '') = '' then
    raise exception 'target profile has no email' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.profesionales
    where lower(trim(email)) = lower(trim(v_profile.email))
  ) then
    insert into public.profesionales (
      nombre,
      apellidos,
      email,
      foto_url,
      especialidad
    ) values (
      coalesce(nullif(trim(v_profile.nombre), ''), 'Profesional'),
      coalesce(v_profile.apellidos, ''),
      trim(v_profile.email),
      v_profile.avatar_url,
      'General'
    );
  end if;

  update public.profiles
  set rol = 'profesor'
  where id = p_user_id;
end;
$$;

revoke all on function public.actualizar_mi_perfil(text, text)
  from public, anon;
revoke all on function public.admin_configurar_bono_mensual(uuid, boolean, timestamptz, timestamptz)
  from public, anon;
revoke all on function public.admin_promover_usuario_profesor(uuid)
  from public, anon;
revoke all on function public.crear_perfil_nuevo_usuario()
  from public, anon, authenticated;
grant execute on function public.actualizar_mi_perfil(text, text)
  to authenticated;
grant execute on function public.admin_configurar_bono_mensual(uuid, boolean, timestamptz, timestamptz)
  to authenticated;
grant execute on function public.admin_promover_usuario_profesor(uuid)
  to authenticated;

-- Edge Functions use the service role for server-owned profile lifecycle
-- operations. Make the dependency explicit instead of relying on old grants.
grant select, insert, update, delete on table public.profiles to service_role;

comment on function public.actualizar_mi_perfil(text, text)
  is 'Authenticated self-service update limited to validated display names.';
comment on function public.crear_perfil_nuevo_usuario()
  is 'Creates a validated client profile transactionally after a Supabase Auth signup.';
comment on function public.admin_configurar_bono_mensual(uuid, boolean, timestamptz, timestamptz)
  is 'Admin-only atomic configuration of a client monthly pass.';
comment on function public.admin_promover_usuario_profesor(uuid)
  is 'Admin-only atomic promotion of a profile and creation of its professional card.';

commit;

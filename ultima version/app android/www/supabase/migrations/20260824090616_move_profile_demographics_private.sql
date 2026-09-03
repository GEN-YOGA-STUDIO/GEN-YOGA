begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

-- Birth date and sex are operational demographics. They must not be part of
-- the Data API profile row consumed by the public web or mobile clients.
create table private.profile_demographics (
  profile_id uuid primary key
    references public.profiles(id) on delete cascade,
  fecha_nacimiento date,
  sexo text,
  updated_at timestamptz not null default now()
);

comment on table private.profile_demographics is
  'Internal profile demographics. Not exposed through the Data API.';

alter table private.profile_demographics enable row level security;
revoke all on table private.profile_demographics
  from public, anon, authenticated;
grant select, insert, update, delete on table private.profile_demographics
  to service_role;

with identity_birth_dates as (
  select
    identity.user_id,
    min(identity.identity_data ->> 'fecha_nacimiento') filter (
      where pg_catalog.pg_input_is_valid(
        nullif(trim(identity.identity_data ->> 'fecha_nacimiento'), ''),
        'date'
      )
    ) as identity_birth_date
  from auth.identities as identity
  group by identity.user_id
),
profile_sources as (
  select
    profile.id as profile_id,
    profile.fecha_nacimiento,
    profile.sexo,
    nullif(trim(auth_user.raw_user_meta_data ->> 'fecha_nacimiento'), '')
      as auth_birth_date,
    identity_birth_dates.identity_birth_date
  from public.profiles as profile
  left join auth.users as auth_user
    on auth_user.id = profile.id
  left join identity_birth_dates
    on identity_birth_dates.user_id = profile.id
),
normalized_demographics as (
  select
    profile_id,
    coalesce(
      fecha_nacimiento,
      case
        when pg_catalog.pg_input_is_valid(auth_birth_date, 'date')
          then auth_birth_date::date
      end,
      case
        when pg_catalog.pg_input_is_valid(identity_birth_date, 'date')
          then identity_birth_date::date
      end
    ) as fecha_nacimiento,
    sexo
  from profile_sources
)
insert into private.profile_demographics (
  profile_id,
  fecha_nacimiento,
  sexo
)
select
  profile_id,
  fecha_nacimiento,
  sexo
from normalized_demographics
where fecha_nacimiento is not null
   or sexo is not null;

-- Legacy sign-ups also copied the birth date into user-editable auth metadata,
-- which is returned to the signed-in browser. Keep the value only internally.
update auth.users
   set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
     - 'fecha_nacimiento'
 where coalesce(raw_user_meta_data, '{}'::jsonb) ? 'fecha_nacimiento';

update auth.identities
   set identity_data = coalesce(identity_data, '{}'::jsonb)
     - 'fecha_nacimiento'
 where coalesce(identity_data, '{}'::jsonb) ? 'fecha_nacimiento';

-- The legacy ranking view copied the full profile row, including demographic
-- columns. Rebuild it with the non-demographic projection only.
drop view if exists public.view_profile_ranking;

-- Preserve the existing internal write entry point while redirecting storage
-- to the private table. The function validates the authenticated staff actor.
create or replace function public.admin_actualizar_fecha_nacimiento_usuario(
  p_user_id uuid,
  p_fecha_nacimiento date
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_staff_role text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select lower(trim(coalesce(profile.rol, '')))
    into v_staff_role
    from public.profiles as profile
   where profile.id = auth.uid();

  if v_staff_role not in ('admin', 'profesor', 'trabajador', 'profesional') then
    raise exception 'Solo el personal administrativo puede actualizar la fecha de nacimiento de otros usuarios.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
      from public.profiles as profile
     where profile.id = p_user_id
  ) then
    raise exception 'Usuario no encontrado' using errcode = 'P0002';
  end if;

  insert into private.profile_demographics (
    profile_id,
    fecha_nacimiento,
    updated_at
  )
  values (
    p_user_id,
    p_fecha_nacimiento,
    now()
  )
  on conflict (profile_id) do update
    set fecha_nacimiento = excluded.fecha_nacimiento,
        updated_at = excluded.updated_at;
end;
$function$;

revoke all on function public.admin_actualizar_fecha_nacimiento_usuario(uuid, date)
  from public, anon, authenticated;
grant execute on function public.admin_actualizar_fecha_nacimiento_usuario(uuid, date)
  to authenticated, service_role;

alter table public.profiles
  drop column fecha_nacimiento,
  drop column sexo;

create view public.view_profile_ranking
with (security_barrier = true, security_invoker = true)
as
select
  profile.id,
  profile.email,
  profile.rol,
  profile.created_at,
  profile.bonos,
  profile.nombre,
  profile.apellidos,
  profile.telefono,
  profile.activo,
  profile.notas,
  profile.updated_at,
  profile.clases_completadas,
  profile.clases_completadas_mes,
  (
    select count(*)
      from public.reservas_yoga as booking
      join public.clases as yoga_class
        on yoga_class.id = booking.clase_id
     where booking.user_id = profile.id
       and yoga_class.fecha_inicio >= date_trunc('month', current_date - interval '1 month')
       and yoga_class.fecha_inicio < date_trunc('month', current_date)
  ) as clases_mes_pasado
from public.profiles as profile;

revoke all on table public.view_profile_ranking
  from public, anon, authenticated, service_role;
grant select on table public.view_profile_ranking
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

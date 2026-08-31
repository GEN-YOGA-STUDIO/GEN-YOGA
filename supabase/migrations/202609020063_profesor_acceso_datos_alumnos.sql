-- ============================================================================
-- Migración 202609020063: Acceso Completo a Datos de Alumnos para Profesores
-- ============================================================================

-- 1. Permitir a profesores y staff leer perfiles en Supabase para ver alumnos
drop policy if exists "profiles_select_staff" on public.profiles;
create policy "profiles_select_staff"
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or exists (
    select 1 from public.profiles self
    where self.id = auth.uid()
      and lower(coalesce(self.rol, '')) in ('admin', 'profesor', 'trabajador', 'profesional')
  )
);

-- 2. Función RPC para que cualquier profesor obtenga los perfiles de sus alumnos
create or replace function public.profesor_obtener_perfiles_alumnos(
  p_user_ids uuid[]
)
returns table (
  id uuid,
  nombre text,
  apellidos text,
  email text,
  telefono text,
  auth_method text,
  fecha_nacimiento date,
  rol text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $func$
begin
  return query
  select
    p.id,
    coalesce(nullif(trim(p.nombre), ''), nullif(trim(u.raw_user_meta_data->>'nombre'), ''), 'Alumno') as nombre,
    coalesce(nullif(trim(p.apellidos), ''), nullif(trim(u.raw_user_meta_data->>'apellidos'), ''), '') as apellidos,
    coalesce(nullif(trim(p.email), ''), nullif(trim(u.email), ''), '') as email,
    coalesce(nullif(trim(p.telefono), ''), nullif(trim(u.raw_user_meta_data->>'telefono'), ''), nullif(trim(u.phone), ''), '') as telefono,
    coalesce(p.auth_method, u.raw_user_meta_data->>'auth_method', '') as auth_method,
    p.fecha_nacimiento,
    coalesce(p.rol, 'alumno') as rol
  from public.profiles p
  left join auth.users u on u.id = p.id
  where p.id = any(p_user_ids);
end;
$func$;

revoke all on function public.profesor_obtener_perfiles_alumnos(uuid[]) from public, anon;
grant execute on function public.profesor_obtener_perfiles_alumnos(uuid[]) to authenticated, service_role;


-- 3. Función RPC para obtener asistencias completas con nombres, teléfonos y emails
create or replace function public.admin_obtener_asistencias_completas(
  p_clase_ids bigint[] default null
)
returns table (
  reserva_id bigint,
  clase_id bigint,
  user_id uuid,
  tipo_clase text,
  estado text,
  nombre text,
  apellidos text,
  email text,
  telefono text,
  auth_method text,
  fecha_nacimiento date,
  rol text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $func$
begin
  return query
  -- 1. Reservas de Yoga
  select
    r.id as reserva_id,
    r.clase_id,
    r.user_id,
    'yoga'::text as tipo_clase,
    r.estado::text,
    coalesce(nullif(trim(p.nombre), ''), nullif(trim(u.raw_user_meta_data->>'nombre'), ''), 'Alumno') as nombre,
    coalesce(nullif(trim(p.apellidos), ''), nullif(trim(u.raw_user_meta_data->>'apellidos'), ''), '') as apellidos,
    coalesce(nullif(trim(p.email), ''), nullif(trim(u.email), ''), '') as email,
    coalesce(nullif(trim(p.telefono), ''), nullif(trim(u.raw_user_meta_data->>'telefono'), ''), nullif(trim(u.phone), ''), '') as telefono,
    coalesce(p.auth_method, u.raw_user_meta_data->>'auth_method', '') as auth_method,
    p.fecha_nacimiento,
    coalesce(p.rol, 'alumno') as rol
  from public.reservas_yoga r
  left join public.profiles p on p.id = r.user_id
  left join auth.users u on u.id = r.user_id
  where (p_clase_ids is null or r.clase_id = any(p_clase_ids))
    and r.estado = 'confirmada'

  union all

  -- 2. Reservas de Psicología
  select
    r.id as reserva_id,
    r.clase_id,
    r.user_id,
    'psicologia'::text as tipo_clase,
    r.estado::text,
    coalesce(nullif(trim(p.nombre), ''), nullif(trim(u.raw_user_meta_data->>'nombre'), ''), 'Alumno') as nombre,
    coalesce(nullif(trim(p.apellidos), ''), nullif(trim(u.raw_user_meta_data->>'apellidos'), ''), '') as apellidos,
    coalesce(nullif(trim(p.email), ''), nullif(trim(u.email), ''), '') as email,
    coalesce(nullif(trim(p.telefono), ''), nullif(trim(u.raw_user_meta_data->>'telefono'), ''), nullif(trim(u.phone), ''), '') as telefono,
    coalesce(p.auth_method, u.raw_user_meta_data->>'auth_method', '') as auth_method,
    p.fecha_nacimiento,
    coalesce(p.rol, 'alumno') as rol
  from public.reservas_psicologia r
  left join public.profiles p on p.id = r.user_id
  left join auth.users u on u.id = r.user_id
  where (p_clase_ids is null or r.clase_id = any(p_clase_ids))
    and r.estado = 'confirmada'

  union all

  -- 3. Reservas de Nutrición
  select
    r.id as reserva_id,
    r.clase_id,
    r.user_id,
    'nutricion'::text as tipo_clase,
    r.estado::text,
    coalesce(nullif(trim(p.nombre), ''), nullif(trim(u.raw_user_meta_data->>'nombre'), ''), 'Alumno') as nombre,
    coalesce(nullif(trim(p.apellidos), ''), nullif(trim(u.raw_user_meta_data->>'apellidos'), ''), '') as apellidos,
    coalesce(nullif(trim(p.email), ''), nullif(trim(u.email), ''), '') as email,
    coalesce(nullif(trim(p.telefono), ''), nullif(trim(u.raw_user_meta_data->>'telefono'), ''), nullif(trim(u.phone), ''), '') as telefono,
    coalesce(p.auth_method, u.raw_user_meta_data->>'auth_method', '') as auth_method,
    p.fecha_nacimiento,
    coalesce(p.rol, 'alumno') as rol
  from public.reservas_nutricion r
  left join public.profiles p on p.id = r.user_id
  left join auth.users u on u.id = r.user_id
  where (p_clase_ids is null or r.clase_id = any(p_clase_ids))
    and r.estado = 'confirmada';

end;
$func$;

revoke all on function public.admin_obtener_asistencias_completas(bigint[]) from public, anon;
grant execute on function public.admin_obtener_asistencias_completas(bigint[]) to authenticated, service_role;

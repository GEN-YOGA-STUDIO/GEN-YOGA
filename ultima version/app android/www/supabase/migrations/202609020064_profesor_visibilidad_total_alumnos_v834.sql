-- ============================================================================
-- Migración 202609020064: Fix Visibilidad Total de Datos de Alumnos para Profesores
-- Corrige la recursión infinita en la policy profiles_select_staff
-- y elimina el join a auth.users que causa errores de permisos
-- ============================================================================

-- 1. Función auxiliar SECURITY DEFINER para verificar rol staff/admin SIN RECURSIÓN RLS
create or replace function public.es_staff_o_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles
    where id = coalesce(p_user_id, auth.uid())
      and lower(coalesce(rol, '')) in ('admin', 'profesor', 'trabajador', 'profesional')
  );
$$;

revoke all on function public.es_staff_o_admin(uuid) from public, anon;
grant execute on function public.es_staff_o_admin(uuid) to authenticated, anon, service_role;

-- 2. CORREGIR Política RLS: usar la función SECURITY DEFINER en vez de subquery directa
--    La subquery anterior causaba recursión infinita (42P17)
drop policy if exists "profiles_select_staff" on public.profiles;
create policy "profiles_select_staff"
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.es_staff_o_admin(auth.uid())
);

-- 3. Función RPC para obtener perfiles de alumnos (SIN join a auth.users)
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
    coalesce(nullif(trim(p.nombre), ''), 'Alumno') as nombre,
    coalesce(nullif(trim(p.apellidos), ''), '') as apellidos,
    coalesce(nullif(trim(p.email), ''), '') as email,
    coalesce(nullif(trim(p.telefono), ''), '') as telefono,
    coalesce(p.auth_method, '') as auth_method,
    p.fecha_nacimiento,
    coalesce(p.rol, 'alumno') as rol
  from public.profiles p
  where p.id = any(p_user_ids);
end;
$func$;

revoke all on function public.profesor_obtener_perfiles_alumnos(uuid[]) from public, anon;
grant execute on function public.profesor_obtener_perfiles_alumnos(uuid[]) to authenticated, anon, service_role;

-- 4. Función RPC para asistencias completas (SIN join a auth.users)
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
  select
    r.id as reserva_id,
    r.clase_id,
    r.user_id,
    'yoga'::text as tipo_clase,
    r.estado::text,
    coalesce(nullif(trim(p.nombre), ''), 'Alumno') as nombre,
    coalesce(nullif(trim(p.apellidos), ''), '') as apellidos,
    coalesce(nullif(trim(p.email), ''), '') as email,
    coalesce(nullif(trim(p.telefono), ''), '') as telefono,
    coalesce(p.auth_method, '') as auth_method,
    p.fecha_nacimiento,
    coalesce(p.rol, 'alumno') as rol
  from public.reservas_yoga r
  left join public.profiles p on p.id = r.user_id
  where (p_clase_ids is null or r.clase_id = any(p_clase_ids))
    and r.estado = 'confirmada'

  union all

  select
    r.id as reserva_id,
    r.clase_id,
    r.user_id,
    'psicologia'::text as tipo_clase,
    r.estado::text,
    coalesce(nullif(trim(p.nombre), ''), 'Alumno') as nombre,
    coalesce(nullif(trim(p.apellidos), ''), '') as apellidos,
    coalesce(nullif(trim(p.email), ''), '') as email,
    coalesce(nullif(trim(p.telefono), ''), '') as telefono,
    coalesce(p.auth_method, '') as auth_method,
    p.fecha_nacimiento,
    coalesce(p.rol, 'alumno') as rol
  from public.reservas_psicologia r
  left join public.profiles p on p.id = r.user_id
  where (p_clase_ids is null or r.clase_id = any(p_clase_ids))
    and r.estado = 'confirmada'

  union all

  select
    r.id as reserva_id,
    r.clase_id,
    r.user_id,
    'nutricion'::text as tipo_clase,
    r.estado::text,
    coalesce(nullif(trim(p.nombre), ''), 'Alumno') as nombre,
    coalesce(nullif(trim(p.apellidos), ''), '') as apellidos,
    coalesce(nullif(trim(p.email), ''), '') as email,
    coalesce(nullif(trim(p.telefono), ''), '') as telefono,
    coalesce(p.auth_method, '') as auth_method,
    p.fecha_nacimiento,
    coalesce(p.rol, 'alumno') as rol
  from public.reservas_nutricion r
  left join public.profiles p on p.id = r.user_id
  where (p_clase_ids is null or r.clase_id = any(p_clase_ids))
    and r.estado = 'confirmada';

end;
$func$;

revoke all on function public.admin_obtener_asistencias_completas(bigint[]) from public, anon;
grant execute on function public.admin_obtener_asistencias_completas(bigint[]) to authenticated, anon, service_role;

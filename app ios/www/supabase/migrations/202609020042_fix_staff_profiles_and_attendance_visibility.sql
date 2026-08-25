-- ============================================================================
-- Migration 202609020042: Fix Staff and Admin Profiles Visibility for Attendances
-- ============================================================================
-- 1. Asegura que el esquema 'private' y sus funciones sean ejecutables por usuarios autenticados.
-- 2. Permite que usuarios con rol de admin, profesor, profesional o trabajador
--    puedan ver el listado de perfiles (nombres, apellidos, email) para la lista de asistencias.
-- 3. Actualiza la política RLS en public.profiles y la vista public.directorio_perfiles_staff.
-- ============================================================================

begin;

-- 1. Permisos en esquema private
create schema if not exists private;
grant usage on schema private to authenticated, service_role, anon;

-- 2. Función robusta para listar directorio de perfiles para el personal
create or replace function private.listar_directorio_perfiles_staff()
returns table (
  id uuid,
  email text,
  rol text,
  nombre text,
  apellidos text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select
    profile.id,
    profile.email,
    profile.rol,
    profile.nombre,
    profile.apellidos
  from public.profiles as profile
  where coalesce(profile.activo, true)
    and not coalesce(profile.account_deletion_pending, false);
$function$;

revoke all on function private.listar_directorio_perfiles_staff() from public, anon;
grant execute on function private.listar_directorio_perfiles_staff() to authenticated, service_role;

-- 3. Recrear la vista pública directorio_perfiles_staff
drop view if exists public.directorio_perfiles_staff;
drop function if exists public.listar_directorio_perfiles_staff();

create view public.directorio_perfiles_staff
as
select *
from private.listar_directorio_perfiles_staff();

grant select on table public.directorio_perfiles_staff to authenticated, service_role, anon;

-- 4. Actualizar política de lectura RLS en public.profiles para incluir a staff y admin
drop policy if exists profiles_select_self_or_admin on public.profiles;
drop policy if exists profiles_select_self_or_staff on public.profiles;
drop policy if exists pol_profiles_select on public.profiles;

create policy profiles_select_self_or_staff
  on public.profiles
  for select
  to authenticated
  using (
    id = (select auth.uid())
    or (select public.es_staff_actual())
    or (select public.es_admin_actual())
  );

notify pgrst, 'reload schema';

commit;

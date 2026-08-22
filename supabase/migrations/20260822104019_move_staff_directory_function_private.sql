-- Ocultar la función privilegiada del Data API manteniendo la vista pública
-- como interfaz de solo lectura y con columnas mínimas.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

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
  where public.es_staff_actual()
    and coalesce(profile.activo, true)
    and not coalesce(profile.account_deletion_pending, false);
$function$;

revoke all on function private.listar_directorio_perfiles_staff()
  from public, anon, authenticated;
grant execute on function private.listar_directorio_perfiles_staff()
  to authenticated, service_role;

drop view if exists public.directorio_perfiles_staff;
drop function if exists public.listar_directorio_perfiles_staff();

create view public.directorio_perfiles_staff
with (security_barrier = true, security_invoker = true)
as
select *
from private.listar_directorio_perfiles_staff();

revoke all on table public.directorio_perfiles_staff
  from public, anon, authenticated;
grant select on table public.directorio_perfiles_staff
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

-- Ensure the admin profile editor can update a user's birth date.

create or replace function public.admin_actualizar_fecha_nacimiento_usuario(
  p_user_id uuid,
  p_fecha_nacimiento date
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $func$
declare
  v_admin_role text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select lower(trim(coalesce(rol, ''))) into v_admin_role
  from public.profiles
  where id = auth.uid();

  if v_admin_role not in ('admin', 'profesor', 'trabajador', 'profesional') then
    raise exception 'Solo el personal administrativo puede actualizar la fecha de nacimiento de otros usuarios.' using errcode = '42501';
  end if;

  update public.profiles
  set fecha_nacimiento = p_fecha_nacimiento
  where id = p_user_id;

  if not found then
    raise exception 'Usuario no encontrado' using errcode = 'P0002';
  end if;
end;
$func$;

revoke all on function public.admin_actualizar_fecha_nacimiento_usuario(uuid, date) from public, anon;
grant execute on function public.admin_actualizar_fecha_nacimiento_usuario(uuid, date) to authenticated;
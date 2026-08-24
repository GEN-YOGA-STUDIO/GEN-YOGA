-- Migration 202609020028: Funciones RPC para actualizar fecha de nacimiento por usuario y administrador

create or replace function public.actualizar_mi_perfil(
  p_nombre text,
  p_apellidos text default '',
  p_fecha_nacimiento date default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $func$
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
      apellidos = v_apellidos,
      fecha_nacimiento = coalesce(p_fecha_nacimiento, fecha_nacimiento)
  where id = auth.uid()
    and not coalesce(account_deletion_pending, false);

  if not found then
    raise exception 'profile not found or deletion pending' using errcode = 'P0002';
  end if;
end;
$func$;

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

revoke all on function public.actualizar_mi_perfil(text, text, date) from public, anon;
grant execute on function public.actualizar_mi_perfil(text, text, date) to authenticated;

revoke all on function public.admin_actualizar_fecha_nacimiento_usuario(uuid, date) from public, anon;
grant execute on function public.admin_actualizar_fecha_nacimiento_usuario(uuid, date) to authenticated;

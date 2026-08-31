-- Migration 202609020043: Reparar actualizar_mi_perfil y anadir admin_actualizar_perfil_usuario

-- 1. Eliminar firmas anteriores ambiguas o desfasadas de actualizar_mi_perfil
drop function if exists public.actualizar_mi_perfil(text, text);
drop function if exists public.actualizar_mi_perfil(text, text, date);
drop function if exists public.actualizar_mi_perfil(text, text, date, text);
drop function if exists public.actualizar_mi_perfil(text, text, text, date);

-- 2. Crear firma canonica y limpia con SECURITY DEFINER para actualizar_mi_perfil
create or replace function public.actualizar_mi_perfil(
  p_nombre text,
  p_apellidos text default '',
  p_fecha_nacimiento date default null,
  p_telefono text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $func$
declare
  v_uid uuid := auth.uid();
  v_nombre text;
  v_apellidos text;
  v_telefono text;
  v_updated public.profiles%rowtype;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para actualizar tu perfil.' using errcode = '42501';
  end if;

  v_nombre := regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_apellidos := regexp_replace(trim(coalesce(p_apellidos, '')), '\s+', ' ', 'g');
  v_telefono := regexp_replace(trim(coalesce(p_telefono, '')), '[^0-9+]', '', 'g');

  if length(v_nombre) < 1 or length(v_nombre) > 100 then
    raise exception 'El nombre es obligatorio (1 a 100 caracteres).' using errcode = '22023';
  end if;

  update public.profiles
  set nombre = v_nombre,
      apellidos = v_apellidos,
      fecha_nacimiento = coalesce(p_fecha_nacimiento, fecha_nacimiento),
      telefono = case when length(v_telefono) > 0 then v_telefono else telefono end
  where id = v_uid
  returning * into v_updated;

  if not found then
    raise exception 'Perfil de usuario no encontrado.' using errcode = 'P0002';
  end if;

  return to_jsonb(v_updated);
end;
$func$;

-- 3. Crear funcion para que el Administrador / Staff pueda editar cualquier usuario
create or replace function public.admin_actualizar_perfil_usuario(
  p_user_id uuid,
  p_nombre text default null,
  p_apellidos text default null,
  p_telefono text default null,
  p_fecha_nacimiento date default null,
  p_rol text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $func$
declare
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_nombre text;
  v_apellidos text;
  v_telefono text;
  v_rol text;
  v_updated public.profiles%rowtype;
begin
  if v_caller_id is null then
    raise exception 'Debes iniciar sesión.' using errcode = '42501';
  end if;

  select lower(trim(coalesce(rol, ''))) into v_caller_role
  from public.profiles where id = v_caller_id;

  if v_caller_role not in ('admin', 'trabajador', 'profesor', 'profesional') then
    raise exception 'No tienes permisos de administración.' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'Identificador de usuario no válido.' using errcode = '22023';
  end if;

  v_nombre := regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_apellidos := regexp_replace(trim(coalesce(p_apellidos, '')), '\s+', ' ', 'g');
  v_telefono := regexp_replace(trim(coalesce(p_telefono, '')), '[^0-9+]', '', 'g');
  v_rol := lower(trim(coalesce(p_rol, '')));

  update public.profiles
  set nombre = case when length(v_nombre) > 0 then v_nombre else nombre end,
      apellidos = v_apellidos,
      telefono = case when length(v_telefono) > 0 then v_telefono else telefono end,
      fecha_nacimiento = coalesce(p_fecha_nacimiento, fecha_nacimiento),
      rol = case when v_caller_role = 'admin' and length(v_rol) > 0 then v_rol else rol end
  where id = p_user_id
  returning * into v_updated;

  if not found then
    raise exception 'Usuario no encontrado.' using errcode = 'P0002';
  end if;

  return to_jsonb(v_updated);
end;
$func$;

-- 4. Permisos
revoke all on function public.actualizar_mi_perfil(text, text, date, text) from public, anon;
grant execute on function public.actualizar_mi_perfil(text, text, date, text) to authenticated;

revoke all on function public.admin_actualizar_perfil_usuario(uuid, text, text, text, date, text) from public, anon;
grant execute on function public.admin_actualizar_perfil_usuario(uuid, text, text, text, date, text) to authenticated;

-- Asegurar permisos de update en profiles
grant update (nombre, apellidos, telefono, fecha_nacimiento) on table public.profiles to authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

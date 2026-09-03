-- ==============================================================================
-- Migración 202609020081: Reparar y asegurar admin_actualizar_perfil_usuario
-- Versión: 9.22
-- Descripción:
--   1. Registra la función public.admin_actualizar_perfil_usuario con 8 argumentos
--      (p_user_id, p_nombre, p_apellidos, p_telefono, p_fecha_nacimiento, p_rol, p_email, p_notas).
--   2. Registra la sobrecarga de 6 argumentos para retrocompatibilidad total.
--   3. Concede permisos de ejecución a anon, authenticated y service_role para que
--      PostgREST refresque su schema cache y reconozca la función inmediatamente.
--   4. Asegura permisos de UPDATE en columnas de public.profiles y política RLS
--      para permitir a admins y staff la edición de perfiles.
-- ==============================================================================

-- 1. Función principal con 8 argumentos
create or replace function public.admin_actualizar_perfil_usuario(
  p_user_id uuid,
  p_nombre text default null,
  p_apellidos text default null,
  p_telefono text default null,
  p_fecha_nacimiento date default null,
  p_rol text default null,
  p_email text default null,
  p_notas text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_nombre text;
  v_apellidos text;
  v_telefono text;
  v_email text;
  v_notas text;
  v_rol text;
  v_updated public.profiles%rowtype;
begin
  if v_caller_id is null then
    raise exception 'Debes iniciar sesión.' using errcode = '42501';
  end if;

  select lower(trim(coalesce(rol, ''))) into v_caller_role
    from public.profiles
   where id = v_caller_id;

  if v_caller_role not in ('admin', 'trabajador', 'profesor', 'recepcion', 'profesional') then
    raise exception 'No tienes permisos de administración.' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'Identificador de usuario no válido.' using errcode = '22023';
  end if;

  v_nombre := regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_apellidos := regexp_replace(trim(coalesce(p_apellidos, '')), '\s+', ' ', 'g');
  v_telefono := regexp_replace(trim(coalesce(p_telefono, '')), '[^0-9+]', '', 'g');
  v_email := lower(trim(coalesce(p_email, '')));
  v_notas := trim(coalesce(p_notas, ''));
  v_rol := lower(trim(coalesce(p_rol, '')));

  update public.profiles
     set nombre = case when length(v_nombre) > 0 then v_nombre else nombre end,
         apellidos = case when p_apellidos is not null then v_apellidos else apellidos end,
         telefono = case when p_telefono is not null then nullif(v_telefono, '') else telefono end,
         fecha_nacimiento = case when p_fecha_nacimiento is not null then p_fecha_nacimiento else fecha_nacimiento end,
         email = case when length(v_email) >= 3 and v_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then v_email else email end,
         notas = case when p_notas is not null then v_notas else notas end,
         rol = case when v_caller_role = 'admin' and length(v_rol) > 0 then v_rol else rol end,
         updated_at = timezone('utc', now())
   where id = p_user_id
   returning * into v_updated;

  if not found then
    raise exception 'Usuario no encontrado.' using errcode = 'P0002';
  end if;

  return to_jsonb(v_updated);
end;
$$;

-- 2. Sobrecarga retrocompatible con 6 argumentos
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
as $$
begin
  return public.admin_actualizar_perfil_usuario(
    p_user_id,
    p_nombre,
    p_apellidos,
    p_telefono,
    p_fecha_nacimiento,
    p_rol,
    null,
    null
  );
end;
$$;

-- 3. Concesión de ejecución para PostgREST (anon, authenticated, service_role)
grant execute on function public.admin_actualizar_perfil_usuario(uuid, text, text, text, date, text, text, text)
  to anon, authenticated, service_role;

grant execute on function public.admin_actualizar_perfil_usuario(uuid, text, text, text, date, text)
  to anon, authenticated, service_role;

-- 4. Permisos de columna y RLS en public.profiles para updates directos por staff
grant update (nombre, apellidos, telefono, fecha_nacimiento, email, notas, rol)
  on table public.profiles
  to authenticated, service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where tablename = 'profiles'
       and policyname = 'staff_can_update_profiles'
  ) then
    create policy staff_can_update_profiles
      on public.profiles
      for update
      to authenticated
      using (
        exists (
          select 1 from public.profiles p
           where p.id = auth.uid()
             and lower(trim(coalesce(p.rol, ''))) in ('admin', 'trabajador', 'profesor', 'recepcion')
        )
      )
      with check (
        exists (
          select 1 from public.profiles p
           where p.id = auth.uid()
             and lower(trim(coalesce(p.rol, ''))) in ('admin', 'trabajador', 'profesor', 'recepcion')
        )
      );
  end if;
end $$;

-- 5. Recargar esquema en PostgREST
notify pgrst, 'reload schema';
notify pgrst, 'reload config';

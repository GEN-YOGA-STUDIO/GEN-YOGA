-- ==============================================================================
-- Migración 202609020071: Campos completos de cliente y ficha de mostrador / perfiles
-- GEN YOGA v9.13
-- Permite registrar y editar en todos los clientes:
-- Nombre, Apellidos, Fecha de Nacimiento, Teléfono, Email y Notas.
-- ==============================================================================

BEGIN;

-- 1. Asegurar todas las columnas bien definidas en public.profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS nombre text,
  ADD COLUMN IF NOT EXISTS apellidos text DEFAULT '',
  ADD COLUMN IF NOT EXISTS fecha_nacimiento date,
  ADD COLUMN IF NOT EXISTS telefono text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS notas text DEFAULT '';

-- 2. Actualizar función RPC para creación de cliente desde mostrador con todos los campos
CREATE OR REPLACE FUNCTION public.admin_crear_cliente_mostrador(
  p_nombre text,
  p_apellidos text DEFAULT '',
  p_fecha_nacimiento date DEFAULT null,
  p_telefono text DEFAULT null,
  p_email text DEFAULT null,
  p_notas text DEFAULT null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_nombre text;
  v_apellidos text;
  v_telefono text;
  v_email text;
  v_notas text;
  v_profile_id uuid := gen_random_uuid();
  v_created public.profiles%ROWTYPE;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))) INTO v_caller_role
    FROM public.profiles
   WHERE id = v_caller_id;

  IF v_caller_role NOT IN ('admin', 'trabajador', 'profesor', 'profesional') THEN
    RAISE EXCEPTION 'Permisos insuficientes para crear clientes.' USING errcode = '42501';
  END IF;

  v_nombre := regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_apellidos := regexp_replace(trim(coalesce(p_apellidos, '')), '\s+', ' ', 'g');
  v_telefono := regexp_replace(trim(coalesce(p_telefono, '')), '[^0-9+]', '', 'g');
  v_notas := trim(coalesce(p_notas, ''));
  v_email := lower(trim(coalesce(p_email, '')));

  IF length(v_nombre) < 1 THEN
    RAISE EXCEPTION 'El nombre es obligatorio.' USING errcode = '22023';
  END IF;

  -- Si no se proporciona un correo o no es válido, generar el correo interno de mostrador
  IF length(v_email) < 3 OR v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    v_email := 'mostrador+' || substr(md5(v_profile_id::text || clock_timestamp()::text), 1, 16) || '@genyoga.studio';
  END IF;

  INSERT INTO public.profiles (
    id,
    email,
    nombre,
    apellidos,
    fecha_nacimiento,
    telefono,
    notas,
    rol,
    bonos,
    saldo_clases_gratis,
    saldo_consultas_gratis,
    saldo_yoga_compania
  ) VALUES (
    v_profile_id,
    v_email,
    v_nombre,
    v_apellidos,
    p_fecha_nacimiento,
    nullif(v_telefono, ''),
    v_notas,
    'cliente',
    0, -- Los bonos normales se asignan posteriormente según decida el centro
    1, -- Bono de Bienvenida por defecto
    1, -- Consulta inicial gratuita
    1  -- Bono Yoga en Compañía por defecto
  )
  RETURNING * INTO v_created;

  RETURN to_jsonb(v_created);
END;
$$;

-- Sobrecargas para compatibilidad retroactiva
CREATE OR REPLACE FUNCTION public.admin_crear_cliente_mostrador(
  p_nombre text,
  p_apellidos text DEFAULT '',
  p_bonos int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN public.admin_crear_cliente_mostrador(
    p_nombre,
    p_apellidos,
    null,
    null,
    null,
    null
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_crear_cliente_mostrador(text, text, date, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_crear_cliente_mostrador(text, text, date, text, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_crear_cliente_mostrador(text, text, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_crear_cliente_mostrador(text, text, int) TO authenticated, service_role;


-- 3. Actualizar función RPC para edición completa de cualquier perfil por Administrador / Staff
CREATE OR REPLACE FUNCTION public.admin_actualizar_perfil_usuario(
  p_user_id uuid,
  p_nombre text DEFAULT null,
  p_apellidos text DEFAULT null,
  p_telefono text DEFAULT null,
  p_fecha_nacimiento date DEFAULT null,
  p_rol text DEFAULT null,
  p_email text DEFAULT null,
  p_notas text DEFAULT null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_nombre text;
  v_apellidos text;
  v_telefono text;
  v_email text;
  v_notas text;
  v_rol text;
  v_updated public.profiles%ROWTYPE;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))) INTO v_caller_role
    FROM public.profiles
   WHERE id = v_caller_id;

  IF v_caller_role NOT IN ('admin', 'trabajador', 'profesor', 'profesional') THEN
    RAISE EXCEPTION 'No tienes permisos de administración.' USING errcode = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Identificador de usuario no válido.' USING errcode = '22023';
  END IF;

  v_nombre := regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_apellidos := regexp_replace(trim(coalesce(p_apellidos, '')), '\s+', ' ', 'g');
  v_telefono := regexp_replace(trim(coalesce(p_telefono, '')), '[^0-9+]', '', 'g');
  v_email := lower(trim(coalesce(p_email, '')));
  v_notas := trim(coalesce(p_notas, ''));
  v_rol := lower(trim(coalesce(p_rol, '')));

  UPDATE public.profiles
     SET nombre = CASE WHEN length(v_nombre) > 0 THEN v_nombre ELSE nombre END,
         apellidos = CASE WHEN p_apellidos IS NOT NULL THEN v_apellidos ELSE apellidos END,
         telefono = CASE WHEN p_telefono IS NOT NULL THEN nullif(v_telefono, '') ELSE telefono END,
         fecha_nacimiento = CASE WHEN p_fecha_nacimiento IS NOT NULL THEN p_fecha_nacimiento ELSE fecha_nacimiento END,
         email = CASE WHEN length(v_email) >= 3 AND v_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN v_email ELSE email END,
         notas = CASE WHEN p_notas IS NOT NULL THEN v_notas ELSE notas END,
         rol = CASE WHEN v_caller_role = 'admin' AND length(v_rol) > 0 THEN v_rol ELSE rol END,
         updated_at = timezone('utc', now())
   WHERE id = p_user_id
   RETURNING * INTO v_updated;

  IF NOT found THEN
    RAISE EXCEPTION 'Usuario no encontrado.' USING errcode = 'P0002';
  END IF;

  RETURN to_jsonb(v_updated);
END;
$$;

-- Sobrecarga para compatibilidad con llamadas previas de 6 argumentos
CREATE OR REPLACE FUNCTION public.admin_actualizar_perfil_usuario(
  p_user_id uuid,
  p_nombre text DEFAULT null,
  p_apellidos text DEFAULT null,
  p_telefono text DEFAULT null,
  p_fecha_nacimiento date DEFAULT null,
  p_rol text DEFAULT null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN public.admin_actualizar_perfil_usuario(
    p_user_id,
    p_nombre,
    p_apellidos,
    p_telefono,
    p_fecha_nacimiento,
    p_rol,
    null,
    null
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_actualizar_perfil_usuario(uuid, text, text, text, date, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_actualizar_perfil_usuario(uuid, text, text, text, date, text, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_actualizar_perfil_usuario(uuid, text, text, text, date, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_actualizar_perfil_usuario(uuid, text, text, text, date, text) TO authenticated, service_role;

-- 4. Asegurar permisos de update
GRANT UPDATE (nombre, apellidos, telefono, fecha_nacimiento, email, notas) ON TABLE public.profiles TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

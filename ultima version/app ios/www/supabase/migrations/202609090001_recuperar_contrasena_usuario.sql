-- ==============================================================================
-- MIGRACIÓN v13.0: Sistema de Recuperación y Restablecimiento de Contraseña
-- Permite a cualquier alumno/cliente recuperar su contraseña de forma segura
-- introduciendo su correo electrónico o su teléfono móvil registrado exacto.
-- ==============================================================================

BEGIN;

-- 1. Asegurar extensión pgcrypto para hashing bcrypt estándar de contraseñas
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
EXCEPTION
  WHEN OTHERS THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
    EXCEPTION
      WHEN OTHERS THEN NULL;
    END;
END $$;

-- 2. Función RPC para verificar si existe una cuenta asociada al email o teléfono
CREATE OR REPLACE FUNCTION public.verificar_usuario_recuperacion(
  p_identificador text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
DECLARE
  v_clean text;
  v_digits text;
  v_phone_9 text;
  v_user_id uuid;
  v_user_email text;
  v_user_nombre text;
  v_tipo text;
BEGIN
  v_clean := lower(trim(coalesce(p_identificador, '')));
  v_digits := regexp_replace(v_clean, '[^0-9]', '', 'g');

  IF v_clean = '' THEN
    RAISE EXCEPTION 'Debes introducir tu correo electrónico o tu número de teléfono móvil registrado.' USING errcode = '22023';
  END IF;

  -- A) Si es teléfono (no tiene @ y tiene 9 o más dígitos)
  IF NOT v_clean LIKE '%@%' AND length(v_digits) >= 9 THEN
    v_phone_9 := right(v_digits, 9);
    v_tipo := 'telefono';

    -- 1. Buscar en profiles por teléfono exacto o email virtual generado para móviles
    SELECT p.id, p.email, coalesce(nullif(trim(p.nombre), ''), 'Usuario')
      INTO v_user_id, v_user_email, v_user_nombre
      FROM public.profiles p
     WHERE right(regexp_replace(coalesce(p.telefono, ''), '[^0-9]', '', 'g'), 9) = v_phone_9
        OR p.email IN ('movil.' || v_phone_9 || '@genyoga.studio', 'telefono.' || v_phone_9 || '@genyoga.studio')
     ORDER BY p.created_at DESC NULLS LAST
     LIMIT 1;

    -- 2. Si no se encontró en profiles, buscar en auth.users
    IF v_user_id IS NULL THEN
      SELECT u.id, u.email, coalesce(nullif(trim(u.raw_user_meta_data->>'nombre'), ''), 'Usuario')
        INTO v_user_id, v_user_email, v_user_nombre
        FROM auth.users u
       WHERE u.email IN ('movil.' || v_phone_9 || '@genyoga.studio', 'telefono.' || v_phone_9 || '@genyoga.studio')
          OR right(regexp_replace(coalesce(u.phone, u.raw_user_meta_data->>'telefono', ''), '[^0-9]', '', 'g'), 9) = v_phone_9
       ORDER BY u.created_at DESC NULLS LAST
       LIMIT 1;
    END IF;

  ELSE
    -- B) Si es correo electrónico
    v_tipo := 'email';

    -- 1. Buscar en profiles por email exacto
    SELECT p.id, p.email, coalesce(nullif(trim(p.nombre), ''), 'Usuario')
      INTO v_user_id, v_user_email, v_user_nombre
      FROM public.profiles p
     WHERE lower(trim(p.email)) = v_clean
     ORDER BY p.created_at DESC NULLS LAST
     LIMIT 1;

    -- 2. Si no se encontró en profiles, buscar en auth.users
    IF v_user_id IS NULL THEN
      SELECT u.id, u.email, coalesce(nullif(trim(u.raw_user_meta_data->>'nombre'), ''), 'Usuario')
        INTO v_user_id, v_user_email, v_user_nombre
        FROM auth.users u
       WHERE lower(trim(u.email)) = v_clean
       ORDER BY u.created_at DESC NULLS LAST
       LIMIT 1;
    END IF;
  END IF;

  -- 3. Si no existe ninguna cuenta registrada con esos datos exactos
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No se ha encontrado ninguna cuenta registrada con este % exacto. Verifica los dígitos o caracteres e inténtalo de nuevo.',
      CASE WHEN v_tipo = 'telefono' THEN 'número de teléfono móvil' ELSE 'correo electrónico' END
      USING errcode = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'encontrado', true,
    'user_id', v_user_id,
    'nombre', v_user_nombre,
    'tipo', v_tipo,
    'identificador_normalizado', CASE WHEN v_tipo = 'telefono' THEN v_phone_9 ELSE v_clean END
  );
END;
$$;

-- 3. Función RPC para restablecer la contraseña en la base de datos
CREATE OR REPLACE FUNCTION public.restablecer_contrasena_usuario(
  p_identificador text,
  p_nueva_contrasena text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
DECLARE
  v_clean text;
  v_digits text;
  v_phone_9 text;
  v_user_id uuid;
  v_user_email text;
  v_user_nombre text;
  v_tipo text;
  v_encrypted text;
BEGIN
  -- Validar longitud mínima de contraseña
  IF p_nueva_contrasena IS NULL OR length(p_nueva_contrasena) < 6 THEN
    RAISE EXCEPTION 'La nueva contraseña debe contener al menos 6 caracteres.' USING errcode = '22023';
  END IF;

  v_clean := lower(trim(coalesce(p_identificador, '')));
  v_digits := regexp_replace(v_clean, '[^0-9]', '', 'g');

  IF v_clean = '' THEN
    RAISE EXCEPTION 'Debes proporcionar tu correo o teléfono registrado.' USING errcode = '22023';
  END IF;

  -- A) Si es teléfono
  IF NOT v_clean LIKE '%@%' AND length(v_digits) >= 9 THEN
    v_phone_9 := right(v_digits, 9);
    v_tipo := 'telefono';

    -- Buscar en profiles
    SELECT p.id, p.email, coalesce(nullif(trim(p.nombre), ''), 'Usuario')
      INTO v_user_id, v_user_email, v_user_nombre
      FROM public.profiles p
     WHERE right(regexp_replace(coalesce(p.telefono, ''), '[^0-9]', '', 'g'), 9) = v_phone_9
        OR p.email IN ('movil.' || v_phone_9 || '@genyoga.studio', 'telefono.' || v_phone_9 || '@genyoga.studio')
     ORDER BY p.created_at DESC NULLS LAST
     LIMIT 1;

    -- Buscar en auth.users si no estaba en profiles
    IF v_user_id IS NULL THEN
      SELECT u.id, u.email, coalesce(nullif(trim(u.raw_user_meta_data->>'nombre'), ''), 'Usuario')
        INTO v_user_id, v_user_email, v_user_nombre
        FROM auth.users u
       WHERE u.email IN ('movil.' || v_phone_9 || '@genyoga.studio', 'telefono.' || v_phone_9 || '@genyoga.studio')
          OR right(regexp_replace(coalesce(u.phone, u.raw_user_meta_data->>'telefono', ''), '[^0-9]', '', 'g'), 9) = v_phone_9
       ORDER BY u.created_at DESC NULLS LAST
       LIMIT 1;
    END IF;

    -- Garantizar que el email de login exista
    IF v_user_email IS NULL OR v_user_email = '' THEN
      v_user_email := 'movil.' || v_phone_9 || '@genyoga.studio';
    END IF;

  ELSE
    -- B) Si es correo electrónico
    v_tipo := 'email';

    SELECT p.id, p.email, coalesce(nullif(trim(p.nombre), ''), 'Usuario')
      INTO v_user_id, v_user_email, v_user_nombre
      FROM public.profiles p
     WHERE lower(trim(p.email)) = v_clean
     ORDER BY p.created_at DESC NULLS LAST
     LIMIT 1;

    IF v_user_id IS NULL THEN
      SELECT u.id, u.email, coalesce(nullif(trim(u.raw_user_meta_data->>'nombre'), ''), 'Usuario')
        INTO v_user_id, v_user_email, v_user_nombre
        FROM auth.users u
       WHERE lower(trim(u.email)) = v_clean
       ORDER BY u.created_at DESC NULLS LAST
       LIMIT 1;
    END IF;
  END IF;

  -- Comprobación de existencia obligatoria
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No se ha encontrado ninguna cuenta con estos datos registrados.' USING errcode = 'P0002';
  END IF;

  -- Generar el hash bcrypt con coste 10 (compatible con Supabase GoTrue)
  BEGIN
    v_encrypted := extensions.crypt(p_nueva_contrasena, extensions.gen_salt('bf', 10));
  EXCEPTION
    WHEN OTHERS THEN
      v_encrypted := crypt(p_nueva_contrasena, gen_salt('bf', 10));
  END;

  -- Actualizar de forma atómica la contraseña en auth.users
  UPDATE auth.users
     SET encrypted_password = v_encrypted,
         updated_at = now()
   WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'email_login', v_user_email,
    'nombre', v_user_nombre,
    'tipo', v_tipo,
    'message', 'Contraseña restablecida correctamente. Ya puedes acceder con tus nuevas credenciales.'
  );
END;
$$;

-- 4. Asignar permisos de ejecución para anon y authenticated
REVOKE ALL ON FUNCTION public.verificar_usuario_recuperacion(text) FROM public;
GRANT EXECUTE ON FUNCTION public.verificar_usuario_recuperacion(text) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.restablecer_contrasena_usuario(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.restablecer_contrasena_usuario(text, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

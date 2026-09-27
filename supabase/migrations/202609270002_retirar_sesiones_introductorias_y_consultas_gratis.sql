-- ==============================================================================
-- Migración: 202609270002_retirar_sesiones_introductorias_y_consultas_gratis.sql
-- Descripción:
--   1. Resetear saldo_consultas_gratis = 0 en todos los perfiles de usuario.
--   2. Fijar DEFAULT = 0 en la columna saldo_consultas_gratis.
--   3. Actualizar función crear_perfil_nuevo_usuario() para asignar 0 consultas gratis.
--   4. Actualizar funciones admin_crear_cliente_mostrador() para asignar 0 consultas gratis.
--   5. Inactivar canje de consultas en canjear_oferta_promocional().
-- ==============================================================================

BEGIN;

-- 1. Resetear saldo_consultas_gratis a 0 en todos los perfiles de usuario
UPDATE public.profiles
   SET saldo_consultas_gratis = 0
 WHERE coalesce(saldo_consultas_gratis, 0) > 0;

-- 2. Fijar el valor por defecto de saldo_consultas_gratis en 0
ALTER TABLE public.profiles
  ALTER COLUMN saldo_consultas_gratis SET DEFAULT 0;

-- 3. Actualizar función de alta para nuevos usuarios: saldo_consultas_gratis en 0
CREATE OR REPLACE FUNCTION public.crear_perfil_nuevo_usuario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_nombre text := trim(coalesce(v_meta->>'nombre', ''));
  v_apellidos text := trim(coalesce(v_meta->>'apellidos', ''));
  v_telefono text := trim(coalesce(v_meta->>'telefono', coalesce(new.phone, '')));
  v_fecha_nacimiento date := null;
  v_notas text := trim(coalesce(v_meta->>'notas', ''));
  v_auth_method text := trim(coalesce(v_meta->>'auth_method', 'email'));
  v_raw_fn text := trim(coalesce(v_meta->>'fecha_nacimiento', ''));
BEGIN
  IF v_raw_fn ~ '^\d{4}-\d{2}-\d{2}$' THEN
    BEGIN
      v_fecha_nacimiento := v_raw_fn::date;
    EXCEPTION WHEN others THEN
      v_fecha_nacimiento := null;
    END;
  END IF;

  IF v_nombre = '' THEN
    v_nombre := split_part(coalesce(new.email, 'Usuario'), '@', 1);
  END IF;

  INSERT INTO public.profiles (
    id,
    nombre,
    apellidos,
    email,
    telefono,
    fecha_nacimiento,
    notas,
    auth_method,
    rol,
    bonos,
    saldo_psicologia,
    saldo_nutricion,
    saldo_clases_gratis,
    saldo_consultas_gratis,
    saldo_yoga_compania
  )
  VALUES (
    new.id,
    v_nombre,
    v_apellidos,
    lower(trim(coalesce(new.email, ''))),
    nullif(v_telefono, ''),
    v_fecha_nacimiento,
    v_notas,
    v_auth_method,
    'cliente',
    0,
    0,
    0,
    1, -- 1 Bono de Bienvenida (válido para 1 clase regular de yoga)
    0, -- 0 Consulta Gratuita (sesiones introductorias retiradas)
    0  -- 0 Yoga en Compañía (inactivado)
  )
  ON CONFLICT (id) DO UPDATE
  SET nombre = CASE
        WHEN nullif(trim(coalesce(profiles.nombre, '')), '') IS NULL THEN excluded.nombre
        ELSE profiles.nombre
      END,
      apellidos = CASE
        WHEN nullif(trim(coalesce(profiles.apellidos, '')), '') IS NULL THEN excluded.apellidos
        ELSE profiles.apellidos
      END,
      email = excluded.email,
      telefono = coalesce(nullif(excluded.telefono, ''), profiles.telefono),
      fecha_nacimiento = coalesce(excluded.fecha_nacimiento, profiles.fecha_nacimiento),
      notas = CASE WHEN length(coalesce(excluded.notas, '')) > 0 THEN excluded.notas ELSE profiles.notas END,
      auth_method = coalesce(nullif(excluded.auth_method, ''), profiles.auth_method);

  RETURN new;
END;
$$;

-- 4. Actualizar las funciones de alta de cliente en mostrador para asignar 0 consultas gratis
CREATE OR REPLACE FUNCTION public.admin_crear_cliente_mostrador(p_nombre text, p_apellidos text DEFAULT ''::text, p_bonos integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_nombre text;
  v_apellidos text;
  v_bonos int := coalesce(p_bonos, 0);
  v_profile_id uuid := gen_random_uuid();
  v_email text;
  v_created public.profiles%rowtype;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))) INTO v_caller_role
  FROM public.profiles WHERE id = v_caller_id;

  IF v_caller_role NOT IN ('admin', 'trabajador', 'profesor', 'profesional') THEN
    RAISE EXCEPTION 'Permisos insuficientes para crear clientes.' USING errcode = '42501';
  END IF;

  v_nombre := regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_apellidos := regexp_replace(trim(coalesce(p_apellidos, '')), '\s+', ' ', 'g');

  IF length(v_nombre) < 1 THEN
    RAISE EXCEPTION 'El nombre es obligatorio.' USING errcode = '22023';
  END IF;

  IF v_bonos < 0 or v_bonos > 10000 THEN
    RAISE EXCEPTION 'Los bonos deben estar entre 0 y 10000.' USING errcode = '22023';
  END IF;

  v_email := 'mostrador+' || substr(md5(v_profile_id::text || clock_timestamp()::text), 1, 16) || '@genyoga.studio';

  INSERT INTO public.profiles (
    id,
    email,
    nombre,
    apellidos,
    rol,
    bonos,
    saldo_clases_gratis,
    saldo_consultas_gratis,
    saldo_yoga_compania
  )
  VALUES (
    v_profile_id,
    v_email,
    v_nombre,
    v_apellidos,
    'cliente',
    v_bonos,
    1,
    0,
    0
  )
  RETURNING * INTO v_created;

  RETURN to_jsonb(v_created);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_crear_cliente_mostrador(p_nombre text, p_apellidos text DEFAULT ''::text, p_bonos integer DEFAULT 0, p_email text DEFAULT NULL::text, p_telefono text DEFAULT NULL::text, p_notas text DEFAULT NULL::text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id uuid;
    v_email text;
    v_kiosk_id text;
BEGIN
    IF NOT (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND rol = 'admin')
        OR EXISTS (SELECT 1 FROM public.profesionales WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
    ) THEN
        RAISE EXCEPTION 'No tienes permisos para crear clientes desde el mostrador.';
    END IF;

    v_email := NULLIF(btrim(p_email), '');
    IF v_email IS NULL THEN
        v_kiosk_id := encode(gen_random_bytes(8), 'hex');
        v_email := 'mostrador+' || v_kiosk_id || '@genyoga.studio';
    END IF;

    INSERT INTO auth.users (
        instance_id,
        id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at
    )
    VALUES (
        '00000000-0000-0000-0000-000000000000',
        gen_random_uuid(),
        'authenticated',
        'authenticated',
        v_email,
        crypt(encode(gen_random_bytes(16), 'hex'), gen_salt('bf')),
        now(),
        '{"provider":"email","providers":["email"]}',
        json_build_object('nombre', p_nombre, 'apellidos', p_apellidos, 'auth_method', 'kiosk'),
        now(),
        now()
    )
    RETURNING id INTO v_user_id;

    INSERT INTO public.profiles (
        id,
        email,
        nombre,
        apellidos,
        telefono,
        bonos,
        rol,
        notas,
        saldo_clases_gratis,
        saldo_yoga_compania,
        saldo_consultas_gratis
    )
    VALUES (
        v_user_id,
        v_email,
        p_nombre,
        p_apellidos,
        NULLIF(btrim(p_telefono), ''),
        p_bonos,
        'cliente',
        NULLIF(btrim(p_notas), ''),
        1,
        0,
        0
    )
    ON CONFLICT (id) DO UPDATE
    SET 
        nombre = EXCLUDED.nombre,
        apellidos = EXCLUDED.apellidos,
        telefono = COALESCE(EXCLUDED.telefono, public.profiles.telefono),
        bonos = public.profiles.bonos + p_bonos,
        notas = COALESCE(EXCLUDED.notas, public.profiles.notas);

    RETURN json_build_object(
        'success', true,
        'created', true,
        'profile', json_build_object(
            'id', v_user_id,
            'email', v_email,
            'nombre', p_nombre,
            'apellidos', p_apellidos,
            'telefono', p_telefono,
            'bonos', p_bonos,
            'notas', p_notas
        )
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_crear_cliente_mostrador(p_nombre text, p_apellidos text DEFAULT ''::text, p_fecha_nacimiento date DEFAULT NULL::date, p_telefono text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_notas text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_profile_id uuid;
  v_email text;
  v_nombre text := trim(coalesce(p_nombre, ''));
  v_apellidos text := trim(coalesce(p_apellidos, ''));
  v_notas text := trim(coalesce(p_notas, ''));
  v_created public.profiles%ROWTYPE;
BEGIN
  IF v_actor_id IS NOT NULL THEN
    SELECT lower(trim(coalesce(rol, ''))) INTO v_actor_role
      FROM public.profiles WHERE id = v_actor_id;
    IF v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
      RAISE EXCEPTION 'No tienes permiso para registrar clientes desde el mostrador.' USING errcode = '42501';
    END IF;
  END IF;

  IF v_nombre = '' THEN
    RAISE EXCEPTION 'El nombre del cliente es obligatorio.' USING errcode = '22023';
  END IF;

  v_profile_id := gen_random_uuid();
  v_email := lower(trim(coalesce(p_email, '')));
  IF v_email = '' THEN
    v_email := 'kiosk.' || replace(v_profile_id::text, '-', '') || '@cliente.genyoga.studio';
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
    0,
    1, -- 1 Bono de Bienvenida
    0, -- 0 Consulta inicial gratuita
    0  -- 0 Yoga en Compañía (inactivado)
  )
  RETURNING * INTO v_created;

  RETURN to_jsonb(v_created);
END;
$$;

-- 5. Canjear oferta promocional: inactivar canje de consultas
CREATE OR REPLACE FUNCTION public.canjear_oferta_promocional(p_oferta text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_tipo text := lower(trim(coalesce(p_oferta, '')));
  v_titulo_oferta text;
  v_ya_canjeada boolean;
  v_nuevo_saldo integer;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'NOT_AUTHENTICATED',
      'message', 'Debes iniciar sesión para canjear esta oferta.'
    );
  END IF;

  IF v_tipo IN ('bienvenida', 'yoga_bienvenida', 'clase_gratis') THEN
    v_tipo := 'bienvenida';
    v_titulo_oferta := 'Bono de Yoga de Bienvenida (1 Clase Gratuita)';
  ELSIF v_tipo IN ('compania', 'yoga_compania', 'colegas', 'pareja', 'abuela', 'madre', 'madre_hija') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'OFFER_INACTIVE',
      'message', 'El sistema de Yoga en Compañía está temporalmente inactivado.'
    );
  ELSIF v_tipo IN ('consultas', 'consultas_gratis', 'pni', 'psicologia') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'OFFER_INACTIVE',
      'message', 'Las sesiones introductorias y consultas gratuitas han finalizado.'
    );
  ELSE
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_OFFER',
      'message', 'El tipo de oferta indicado no es válido.'
    );
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.ofertas_canjeadas
     WHERE user_id = v_user_id AND tipo_oferta = v_tipo
  ) INTO v_ya_canjeada;

  IF v_ya_canjeada THEN
    RETURN jsonb_build_object(
      'success', false,
      'already_claimed', true,
      'tipo', v_tipo,
      'message', 'Ya has canjeado esta oferta anteriormente. Cada promoción solo puede canjearse 1 vez por cuenta.'
    );
  END IF;

  BEGIN
    INSERT INTO public.ofertas_canjeadas (user_id, tipo_oferta)
    VALUES (v_user_id, v_tipo);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'success', false,
      'already_claimed', true,
      'tipo', v_tipo,
      'message', 'Esta oferta ya ha sido canjeada anteriormente en tu cuenta.'
    );
  END;

  IF v_tipo = 'bienvenida' THEN
    UPDATE public.profiles
       SET saldo_clases_gratis = coalesce(saldo_clases_gratis, 0) + 1,
           oferta_bienvenida_canjeada = true
     WHERE id = v_user_id
 RETURNING saldo_clases_gratis INTO v_nuevo_saldo;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'tipo', v_tipo,
    'titulo', v_titulo_oferta,
    'nuevo_saldo', v_nuevo_saldo,
    'message', '¡Oferta canjeada con éxito! Ya puedes disfrutar de tu sesión.'
  );
END;
$$;

-- Recargar caché de PostgREST
NOTIFY pgrst, 'reload schema';

COMMIT;

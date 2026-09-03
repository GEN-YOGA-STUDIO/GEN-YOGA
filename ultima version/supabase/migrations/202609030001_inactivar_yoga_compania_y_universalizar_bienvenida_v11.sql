-- ==============================================================================
-- Migración: 202609030001_inactivar_yoga_compania_y_universalizar_bienvenida_v11.sql
-- Versión: v11.0
-- Descripción:
--   1. Resetear saldo_clases_gratis = 0 y saldo_yoga_compania = 0 en todos los usuarios existentes.
--   2. Garantizar que únicamente los NUEVOS usuarios reciben al registrarse:
--        - 1 clase de yoga de bienvenida (para cualquier clase regular).
--        - 1 consulta introductoria (Psicología o PNI).
--        - 0 bonos de Yoga en Compañía (sistema inactivado).
--   3. Universalizar reservar_con_bono: cualquier clase regular de yoga puede reservarse
--      con el saldo_clases_gratis (excluyendo talleres y clases especiales).
--   4. Inactivar Yoga en Compañía en canjear_oferta_promocional.
-- ==============================================================================

BEGIN;

-- 1. Resetear bonos de bienvenida y yoga en compañía en todos los usuarios existentes
UPDATE public.profiles
   SET saldo_clases_gratis = 0,
       saldo_yoga_compania = 0;

-- 2. Actualizar función de alta para nuevos usuarios
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
    1, -- 1 Bono de Bienvenida (válido para cualquier clase regular de yoga)
    1, -- 1 Consulta Gratuita (Psicología o PNI)
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

DROP TRIGGER IF EXISTS zz_gen_yoga_profile_after_signup ON auth.users;
CREATE TRIGGER zz_gen_yoga_profile_after_signup
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.crear_perfil_nuevo_usuario();

-- 3. Actualizar función asegurar_saldos_bienvenida_usuario
--    Ya no inyecta bonos artificialmente a usuarios existentes cuyo saldo sea 0
CREATE OR REPLACE FUNCTION public.asegurar_saldos_bienvenida_usuario()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_p public.profiles%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No autenticado');
  END IF;

  SELECT * INTO v_p FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Perfil no encontrado');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'saldo_yoga_compania', coalesce(v_p.saldo_yoga_compania, 0),
    'saldo_clases_gratis', coalesce(v_p.saldo_clases_gratis, 0),
    'saldo_consultas_gratis', coalesce(v_p.saldo_consultas_gratis, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.asegurar_saldos_bienvenida_usuario() FROM public;
GRANT EXECUTE ON FUNCTION public.asegurar_saldos_bienvenida_usuario() TO authenticated, service_role;

-- 4. Actualizar admin_crear_cliente_mostrador
CREATE OR REPLACE FUNCTION public.admin_crear_cliente_mostrador(
  p_nombre text,
  p_apellidos text DEFAULT '',
  p_fecha_nacimiento date DEFAULT NULL,
  p_telefono text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_notas text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
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
    1, -- 1 Consulta inicial gratuita
    0  -- 0 Yoga en Compañía (inactivado)
  )
  RETURNING * INTO v_created;

  RETURN to_jsonb(v_created);
END;
$$;

-- 5. Universalizar reservar_con_bono: cualquier clase regular de yoga es reservable con saldo_clases_gratis
CREATE OR REPLACE FUNCTION public.reservar_con_bono(
  p_clase_id bigint,
  p_user_id uuid,
  p_forzar_regular boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_target_role text;
  v_starts_at timestamptz;
  v_capacity integer;
  v_occupied integer;
  v_free_credits integer := 0;
  v_class_name text;
  v_class_type text;
  v_class_active boolean;
  v_marked_free boolean;
  v_is_special boolean;
  v_companion_modality text;
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_unlimited boolean := false;
  v_special_count integer := 0;
  v_pack_id bigint;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para reservar.' USING errcode = '42501';
  END IF;
  IF p_clase_id IS NULL OR p_clase_id <= 0 OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'La solicitud de reserva no es válida.' USING errcode = '22023';
  END IF;
  SELECT lower(trim(coalesce(rol, ''))) INTO v_actor_role
    FROM public.profiles WHERE id = v_actor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el perfil que realiza la reserva.'; END IF;
  IF p_user_id <> v_actor_id
     AND v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'No puedes reservar una clase para otra persona.' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))), coalesce(saldo_clases_gratis, 0)
    INTO v_target_role, v_free_credits
    FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el perfil del alumno.'; END IF;
  IF v_target_role IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'Solo los alumnos pueden reservar clases.' USING errcode = '42501';
  END IF;

  SELECT coalesce(capacidad_max, 10), fecha_inicio, nombre,
         lower(trim(coalesce(nullif(tipo_clase, ''), 'yoga'))),
         coalesce(activa, true), coalesce(es_gratuita, false),
         coalesce(es_especial, false),
         companion_modality
    INTO v_capacity, v_starts_at, v_class_name, v_class_type,
         v_class_active, v_marked_free, v_is_special, v_companion_modality
    FROM public.clases WHERE id = p_clase_id FOR UPDATE;
  IF NOT FOUND OR NOT v_class_active OR v_class_type NOT IN ('yoga', 'taller') THEN
    RAISE EXCEPTION 'La clase especificada no está disponible.' USING errcode = 'P0002';
  END IF;

  IF v_starts_at IS NULL OR v_starts_at <= now() THEN
    RAISE EXCEPTION 'La clase ya no está disponible para reserva.' USING errcode = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.reservas_yoga
     WHERE clase_id = p_clase_id AND user_id = p_user_id AND estado = 'confirmada'
  ) THEN
    RAISE EXCEPTION 'Ya tienes una reserva confirmada para esta clase.' USING errcode = '23505';
  END IF;

  SELECT coalesce(sum(greatest(coalesce(num_plazas_reservadas, 1), coalesce(num_plazas, 1), 1)), 0)::integer
    INTO v_occupied
    FROM public.reservas_yoga
   WHERE clase_id = p_clase_id AND estado = 'confirmada';
  IF v_occupied >= v_capacity THEN
    RAISE EXCEPTION 'La clase está completa.' USING errcode = 'P0001';
  END IF;

  -- NUEVA REGLA v11.0: El bono de bienvenida permite reservar CUALQUIER clase regular de yoga
  -- (se excluyen únicamente talleres y clases especiales).
  IF v_free_credits > 0
     AND NOT coalesce(p_forzar_regular, false)
     AND v_class_type = 'yoga'
     AND NOT v_is_special
     AND NOT (v_class_name ~* '(taller|masterclass)') THEN

    UPDATE public.profiles
       SET saldo_clases_gratis = saldo_clases_gratis - 1
     WHERE id = p_user_id AND saldo_clases_gratis > 0;
    IF FOUND THEN
      INSERT INTO public.reservas_yoga
        (clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
         class_pack_id, saldo_gratis_descontado)
      VALUES (p_clase_id, p_user_id, 'confirmada', false, false, null, true);
      RETURN;
    END IF;
  END IF;

  -- Comprobar cobertura real del Bono Ilimitado para la fecha de la clase.
  SELECT starts_at, ends_at INTO v_month_start, v_month_end
    FROM public.unlimited_membership_periods
   WHERE user_id = p_user_id AND starts_at <= v_starts_at AND ends_at > v_starts_at
   ORDER BY starts_at DESC LIMIT 1 FOR SHARE;
  IF FOUND AND v_class_type <> 'taller' AND NOT v_is_special THEN
    v_unlimited := true;
  ELSIF FOUND AND (v_class_type = 'taller' OR v_is_special) THEN
    SELECT count(*)::integer INTO v_special_count
      FROM public.reservas_yoga r
      JOIN public.clases c ON c.id = r.clase_id
     WHERE r.user_id = p_user_id
       AND r.estado = 'confirmada'
       AND r.usado_bono_mensual = true
       AND (c.tipo_clase = 'taller' OR c.es_especial = true)
       AND c.fecha_inicio >= v_month_start
       AND c.fecha_inicio < v_month_end;
    IF v_special_count < 1 THEN
      v_unlimited := true;
    END IF;
  END IF;

  IF v_unlimited THEN
    INSERT INTO public.reservas_yoga
      (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id)
    VALUES (p_clase_id, p_user_id, 'confirmada', true, false, null);
    RETURN;
  END IF;

  -- Deducción desde packs de clases regulares
  SELECT id INTO v_pack_id
    FROM public.class_credit_packs
   WHERE user_id = p_user_id
     AND starts_at <= v_starts_at
     AND expires_at > v_starts_at
     AND credits_remaining > 0
   ORDER BY expires_at ASC, id ASC
   LIMIT 1 FOR UPDATE;

  IF v_pack_id IS NOT NULL THEN
    UPDATE public.class_credit_packs
       SET credits_remaining = credits_remaining - 1
     WHERE id = v_pack_id AND credits_remaining > 0;
    IF FOUND THEN
      UPDATE public.profiles
         SET bonos = (
           SELECT coalesce(sum(credits_remaining), 0)::integer
             FROM public.class_credit_packs
            WHERE user_id = p_user_id AND expires_at > now()
         )
       WHERE id = p_user_id;

      INSERT INTO public.reservas_yoga
        (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id)
      VALUES (p_clase_id, p_user_id, 'confirmada', false, true, v_pack_id);
      RETURN;
    END IF;
  END IF;

  -- Fallback para saldo bonos en profiles
  UPDATE public.profiles
     SET bonos = bonos - 1
   WHERE id = p_user_id AND bonos > 0;
  IF FOUND THEN
    INSERT INTO public.reservas_yoga
      (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id)
    VALUES (p_clase_id, p_user_id, 'confirmada', false, true, null);
    RETURN;
  END IF;

  RAISE EXCEPTION 'No tienes bonos disponibles ni suscripción activa para reservar esta clase.' USING errcode = 'P0001';
END;
$$;

REVOKE ALL ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reservar_con_bono(bigint, uuid) TO authenticated, service_role;

-- 6. Inactivar Yoga en Compañía en canjear_oferta_promocional
CREATE OR REPLACE FUNCTION public.canjear_oferta_promocional(p_oferta text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
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
    v_tipo := 'consultas';
    v_titulo_oferta := 'Consulta Gratuita (PNI o Psicología)';
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
  ELSIF v_tipo = 'consultas' THEN
    UPDATE public.profiles
       SET saldo_consultas_gratis = coalesce(saldo_consultas_gratis, 0) + 1,
           oferta_consultas_canjeada = true
     WHERE id = v_user_id
 RETURNING saldo_consultas_gratis INTO v_nuevo_saldo;
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

REVOKE ALL ON FUNCTION public.canjear_oferta_promocional(text) FROM public;
GRANT EXECUTE ON FUNCTION public.canjear_oferta_promocional(text) TO authenticated, service_role;

COMMIT;

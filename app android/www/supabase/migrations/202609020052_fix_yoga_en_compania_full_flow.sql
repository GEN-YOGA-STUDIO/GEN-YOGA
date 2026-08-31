-- ==============================================================================
-- Migración 202609020052: Flujo completo e integral de reservas de Yoga en Compañía
-- ==============================================================================

BEGIN;

-- 1. Asegurar columnas de acompañantes en public.reservas_yoga
ALTER TABLE public.reservas_yoga
  ADD COLUMN IF NOT EXISTS num_plazas integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS num_plazas_reservadas integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS tipo_reserva text NOT NULL DEFAULT 'individual',
  ADD COLUMN IF NOT EXISTS nombre_acompanante text,
  ADD COLUMN IF NOT EXISTS acompanantes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS welcome_companion_modality text,
  ADD COLUMN IF NOT EXISTS saldo_gratis_descontado boolean NOT NULL DEFAULT false;

-- 2. Asegurar saldo_yoga_compania en public.profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS saldo_yoga_compania integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS saldo_clases_gratis integer NOT NULL DEFAULT 1;

-- 3. Limpiar funciones anteriores para evitar ambigüedades en PostgREST RPC
DROP FUNCTION IF EXISTS public.reservar_con_bono(bigint, uuid, boolean, text, integer, text, jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.reservar_con_bono(bigint, uuid, boolean) CASCADE;
DROP FUNCTION IF EXISTS public.reservar_con_bono(bigint, uuid, integer, text, jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.reservar_con_bono(bigint, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.cancelar_con_bono(bigint) CASCADE;
DROP FUNCTION IF EXISTS public.admin_obtener_asistencias_completas(bigint[]) CASCADE;

-- 4. Función canónica reservar_con_bono
CREATE OR REPLACE FUNCTION public.reservar_con_bono(
  p_clase_id bigint,
  p_user_id uuid,
  p_use_welcome_companion boolean DEFAULT false,
  p_nombre_acompanante text DEFAULT NULL,
  p_num_plazas integer DEFAULT 1,
  p_tipo_reserva text DEFAULT 'individual',
  p_acompanantes jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_actor_email text;
  v_actor_is_staff boolean;
  v_target_role text;
  v_target_id uuid := p_user_id;
  v_legacy_credits integer;
  v_free_credits integer;
  v_companion_credits integer;
  v_unlimited_active boolean;
  v_membership_start timestamptz;
  v_membership_end timestamptz;
  v_capacity integer;
  v_starts_at timestamptz;
  v_class_name text;
  v_class_type text;
  v_class_active boolean;
  v_is_special boolean;
  v_is_free boolean;
  v_is_companion boolean;
  v_companion_modality text;
  v_marked_free boolean;
  v_professor_id public.clases.profesor_id%TYPE;
  v_professional_identity text := '';
  v_occupied integer;
  v_booking_limit_hours integer := 12;
  v_use_unlimited boolean := false;
  v_pack_id bigint;
  v_special_count integer := 0;
  v_required_spots integer := 1;
  v_acompanante_final text := trim(coalesce(p_nombre_acompanante, ''));
  v_acompanantes_json jsonb := coalesce(p_acompanantes, '[]'::jsonb);
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para reservar.' USING errcode = '42501';
  END IF;
  IF p_clase_id IS NULL OR p_clase_id <= 0 OR v_target_id IS NULL THEN
    RAISE EXCEPTION 'La solicitud de reserva no es válida.' USING errcode = '22023';
  END IF;

  -- Perfil del actor
  SELECT lower(trim(coalesce(rol, ''))), lower(nullif(trim(email), ''))
    INTO v_actor_role, v_actor_email
    FROM public.profiles
   WHERE id = v_actor_id;
  IF NOT found THEN
    RAISE EXCEPTION 'No se encontró el perfil que realiza la reserva.' USING errcode = 'P0002';
  END IF;

  v_actor_is_staff := v_actor_role IN ('admin', 'profesor', 'trabajador', 'profesional');
  IF v_target_id <> v_actor_id AND NOT v_actor_is_staff THEN
    RAISE EXCEPTION 'No puedes reservar una clase para otra persona.' USING errcode = '42501';
  END IF;

  -- Datos de la clase
  SELECT coalesce(capacidad_max, 0), fecha_inicio, nombre,
         lower(trim(coalesce(tipo_clase, ''))), coalesce(activa, true),
         profesor_id, coalesce(es_gratuita, false),
         companion_modality
    INTO v_capacity, v_starts_at, v_class_name, v_class_type, v_class_active,
         v_professor_id, v_marked_free,
         v_companion_modality
    FROM public.clases
   WHERE id = p_clase_id
   FOR UPDATE;

  IF NOT found OR v_class_type NOT IN ('yoga', 'taller') OR NOT v_class_active THEN
    RAISE EXCEPTION 'La clase especificada no está disponible.' USING errcode = 'P0002';
  END IF;

  IF v_professor_id IS NOT NULL THEN
    SELECT lower(concat_ws(' ', coalesce(nombre, ''), coalesce(apellidos, ''), coalesce(email, '')))
      INTO v_professional_identity
      FROM public.profesionales
     WHERE id = v_professor_id;
    v_professional_identity := coalesce(v_professional_identity, '');
  END IF;

  v_is_special := v_class_type = 'taller';
  v_is_companion := v_companion_modality IS NOT NULL 
                    OR v_class_name ~* 'compañ|compan|pareja|colegas|abuela|hijo'
                    OR p_use_welcome_companion IS TRUE
                    OR v_acompanante_final <> ''
                    OR coalesce(p_num_plazas, 1) >= 2;

  IF v_is_companion THEN
    v_required_spots := 2;
  ELSE
    v_required_spots := greatest(1, least(coalesce(p_num_plazas, 1), 10));
  END IF;

  IF v_starts_at IS NULL THEN
    RAISE EXCEPTION 'La clase no tiene una hora de inicio válida.' USING errcode = '22023';
  END IF;
  IF v_capacity <= 0 THEN
    RAISE EXCEPTION 'La clase no tiene plazas disponibles.' USING errcode = 'P0001';
  END IF;

  IF v_target_id <> v_actor_id AND v_actor_role <> 'admin'
    AND NOT EXISTS (
      SELECT 1
        FROM public.profesionales
       WHERE id = v_professor_id
         AND lower(nullif(trim(email), '')) = v_actor_email
    ) THEN
    RAISE EXCEPTION 'Solo puedes gestionar reservas de tus propias clases.' USING errcode = '42501';
  END IF;

  -- Antelación mínima
  BEGIN
    SELECT CASE
      WHEN trim(coalesce(valor, '')) ~ '^[0-9]{1,3}$'
        THEN least(168, greatest(0, trim(valor)::integer))
      ELSE 12
    END
      INTO v_booking_limit_hours
      FROM public.configuracion
     WHERE clave = 'horas_limite_reserva'
     LIMIT 1;
  EXCEPTION
    WHEN others THEN
      v_booking_limit_hours := 12;
  END;
  v_booking_limit_hours := coalesce(v_booking_limit_hours, 12);

  IF NOT v_actor_is_staff
    AND v_starts_at <= now() + make_interval(hours => v_booking_limit_hours) THEN
    RAISE EXCEPTION 'Las reservas cierran % h antes del inicio. Para esta clase ya ha pasado el plazo.',
      v_booking_limit_hours USING errcode = 'P0001';
  END IF;

  -- Comprobar reserva previa
  IF EXISTS (
    SELECT 1
      FROM public.reservas_yoga
     WHERE clase_id = p_clase_id
       AND user_id = v_target_id
       AND estado = 'confirmada'
  ) THEN
    RAISE EXCEPTION 'Ya tienes una reserva confirmada para esta clase.' USING errcode = '23505';
  END IF;

  -- Comprobar aforo real calculando todas las plazas reservadas
  SELECT coalesce(sum(
           CASE
             WHEN jsonb_typeof(coalesce(r.acompanantes, '[]'::jsonb)) = 'array'
                  AND jsonb_array_length(coalesce(r.acompanantes, '[]'::jsonb)) > 0
               THEN greatest(coalesce(r.num_plazas_reservadas, 1), coalesce(r.num_plazas, 1),
                             jsonb_array_length(r.acompanantes) + 1)
             ELSE greatest(coalesce(r.num_plazas_reservadas, 1), coalesce(r.num_plazas, 1), 1)
           END
         ), 0)::integer
    INTO v_occupied
    FROM public.reservas_yoga r
   WHERE r.clase_id = p_clase_id
     AND r.estado = 'confirmada';

  IF v_occupied + v_required_spots > v_capacity THEN
    IF v_is_companion AND (v_capacity - v_occupied) = 1 THEN
      RAISE EXCEPTION 'Yoga en Compañía requiere 2 plazas libres y actualmente solo queda 1 plaza disponible.' USING errcode = 'P0001';
    ELSE
      RAISE EXCEPTION 'La clase no dispone de suficientes plazas libres.' USING errcode = 'P0001';
    END IF;
  END IF;

  -- Perfil del alumno
  SELECT lower(trim(coalesce(rol, ''))), coalesce(bonos, 0),
         coalesce(saldo_clases_gratis, 0), coalesce(saldo_yoga_compania, 0),
         coalesce(bono_mensual_activo, false),
         bono_mensual_inicio, bono_mensual_fin
    INTO v_target_role, v_legacy_credits,
         v_free_credits, v_companion_credits,
         v_unlimited_active,
         v_membership_start, v_membership_end
    FROM public.profiles
   WHERE id = v_target_id
   FOR UPDATE;

  IF NOT found THEN
    RAISE EXCEPTION 'No se encontró el perfil del alumno.' USING errcode = 'P0002';
  END IF;
  IF v_target_role IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'Solo los alumnos pueden reservar clases.' USING errcode = '42501';
  END IF;

  -- Determinar elegibilidad
  v_is_free := public.es_clase_elegible_bono_gratis(
    v_class_name,
    v_starts_at,
    v_professional_identity,
    v_marked_free
  ) OR v_is_companion;

  -- Preparar json de acompañantes
  IF v_acompanante_final <> '' THEN
    v_acompanantes_json := jsonb_build_array(jsonb_build_object('nombre', v_acompanante_final));
  END IF;

  -- 1. Si la clase es 100% gratuita por configuración del estudio
  IF v_marked_free THEN
    INSERT INTO public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado, num_plazas, num_plazas_reservadas,
      tipo_reserva, nombre_acompanante, acompanantes, welcome_companion_modality
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', false, false,
      null, false, v_required_spots, v_required_spots,
      CASE WHEN v_is_companion THEN 'compania' ELSE 'individual' END,
      nullif(v_acompanante_final, ''), v_acompanantes_json, v_companion_modality
    );
    RETURN;
  END IF;

  -- 2. Si es clase de Yoga en Compañía (Descuenta 1 Bono de Compañía que cubre 2 plazas)
  IF v_is_companion THEN
    IF v_companion_credits >= 1 THEN
      UPDATE public.profiles
         SET saldo_yoga_compania = saldo_yoga_compania - 1
       WHERE id = v_target_id;
      
      INSERT INTO public.reservas_yoga (
        clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
        class_pack_id, saldo_gratis_descontado, num_plazas, num_plazas_reservadas,
        tipo_reserva, nombre_acompanante, acompanantes, welcome_companion_modality
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, false,
        null, true, 2, 2,
        'compania', nullif(v_acompanante_final, ''), v_acompanantes_json,
        coalesce(v_companion_modality, 'pareja')
      );
      RETURN;
    ELSIF v_free_credits >= 1 THEN
      UPDATE public.profiles
         SET saldo_clases_gratis = saldo_clases_gratis - 1
       WHERE id = v_target_id;
      
      INSERT INTO public.reservas_yoga (
        clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
        class_pack_id, saldo_gratis_descontado, num_plazas, num_plazas_reservadas,
        tipo_reserva, nombre_acompanante, acompanantes, welcome_companion_modality
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, false,
        null, true, 2, 2,
        'compania', nullif(v_acompanante_final, ''), v_acompanantes_json,
        coalesce(v_companion_modality, 'pareja')
      );
      RETURN;
    ELSIF v_actor_is_staff AND v_target_id <> v_actor_id THEN
      -- Asignación manual por Staff
      INSERT INTO public.reservas_yoga (
        clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
        class_pack_id, saldo_gratis_descontado, num_plazas, num_plazas_reservadas,
        tipo_reserva, nombre_acompanante, acompanantes, welcome_companion_modality
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, false,
        null, false, 2, 2,
        'compania', nullif(v_acompanante_final, ''), v_acompanantes_json,
        coalesce(v_companion_modality, 'pareja')
      );
      RETURN;
    ELSE
      RAISE EXCEPTION 'No dispones de un bono de Yoga en Compañía activo (0 €). Consulta tus bonos disponibles.' USING errcode = 'P0001';
    END IF;
  END IF;

  -- 3. Si es sesión gratuita/introductoria regular (1 plaza)
  IF v_is_free THEN
    IF v_free_credits >= 1 THEN
      UPDATE public.profiles
         SET saldo_clases_gratis = saldo_clases_gratis - 1
       WHERE id = v_target_id;
      
      INSERT INTO public.reservas_yoga (
        clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
        class_pack_id, saldo_gratis_descontado, num_plazas, num_plazas_reservadas,
        tipo_reserva, nombre_acompanante, acompanantes
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, false,
        null, true, 1, 1, 'individual', null, '[]'::jsonb
      );
      RETURN;
    ELSIF v_companion_credits >= 1 THEN
      UPDATE public.profiles
         SET saldo_yoga_compania = saldo_yoga_compania - 1
       WHERE id = v_target_id;
      
      INSERT INTO public.reservas_yoga (
        clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
        class_pack_id, saldo_gratis_descontado, num_plazas, num_plazas_reservadas,
        tipo_reserva, nombre_acompanante, acompanantes
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, false,
        null, true, 1, 1, 'individual', null, '[]'::jsonb
      );
      RETURN;
    ELSIF v_actor_is_staff AND v_target_id <> v_actor_id THEN
      INSERT INTO public.reservas_yoga (
        clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
        class_pack_id, saldo_gratis_descontado, num_plazas, num_plazas_reservadas,
        tipo_reserva, nombre_acompanante, acompanantes
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, false,
        null, false, 1, 1, 'individual', null, '[]'::jsonb
      );
      RETURN;
    END IF;
  END IF;

  -- 4. Bono Mensual Ilimitado
  IF v_unlimited_active
    AND v_membership_start IS NOT NULL
    AND v_membership_end IS NOT NULL
    AND v_starts_at >= v_membership_start
    AND v_starts_at < v_membership_end THEN

    IF v_is_special THEN
      SELECT count(*)::integer
        INTO v_special_count
        FROM public.reservas_yoga AS booking
        JOIN public.clases AS class ON class.id = booking.clase_id
       WHERE booking.user_id = v_target_id
         AND booking.estado = 'confirmada'
         AND coalesce(booking.usado_bono_mensual, false)
         AND lower(trim(coalesce(class.tipo_clase, ''))) = 'taller'
         AND class.fecha_inicio >= v_membership_start
         AND class.fecha_inicio < v_membership_end;
      IF v_special_count >= 1 THEN
        RAISE EXCEPTION 'Ya has utilizado la clase especial incluida en este mes natural.'
          USING errcode = 'P0001';
      END IF;
    END IF;

    v_use_unlimited := true;
  END IF;

  -- 5. Bonos Normales: Packs de Clases o Saldo de Bonos
  IF NOT v_use_unlimited THEN
    IF v_is_special THEN
      RAISE EXCEPTION 'Las clases especiales requieren un Bono Ilimitado activo y disponibilidad mensual.'
        USING errcode = 'P0001';
    END IF;

    SELECT id
      INTO v_pack_id
      FROM public.class_credit_packs
     WHERE user_id = v_target_id
       AND credits_remaining > 0
       AND expires_at > now()
       AND expires_at >= v_starts_at
     ORDER BY expires_at, purchased_at, id
     LIMIT 1
     FOR UPDATE;

    IF v_pack_id IS NOT NULL THEN
      UPDATE public.class_credit_packs
         SET credits_remaining = credits_remaining - 1,
             updated_at = now()
        WHERE id = v_pack_id
          AND credits_remaining > 0;
      IF NOT found THEN
        RAISE EXCEPTION 'El pack seleccionado ya no tiene clases disponibles.' USING errcode = 'P0001';
      END IF;
    ELSE
      UPDATE public.profiles
         SET bonos = coalesce(bonos, 0) - 1
       WHERE id = v_target_id
         AND coalesce(bonos, 0) >= 1;
      IF NOT found THEN
        IF v_is_companion THEN
          RAISE EXCEPTION 'No dispones de un bono de Yoga en Compañía activo (0 €). Revisa tus bonos disponibles.' USING errcode = 'P0001';
        ELSIF v_is_free THEN
          RAISE EXCEPTION 'No dispones de un bono gratuito ni de clases disponibles para esta sesión. Adquiere un pack de clases o bono ilimitado para reservar.' USING errcode = 'P0001';
        ELSE
          RAISE EXCEPTION 'Esta clase regular requiere un bono o pack de clases activo. Adquiere un pack de clases para reservar.' USING errcode = 'P0001';
        END IF;
      END IF;
    END IF;
  END IF;

  -- Insertar reserva individual estándar
  INSERT INTO public.reservas_yoga (
    clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
    class_pack_id, saldo_gratis_descontado, num_plazas, num_plazas_reservadas,
    tipo_reserva, nombre_acompanante, acompanantes, welcome_companion_modality
  ) VALUES (
    p_clase_id, v_target_id, 'confirmada', v_use_unlimited,
    NOT v_use_unlimited, v_pack_id, false, 1, 1,
    'individual', null, '[]'::jsonb, v_companion_modality
  );
END;
$$;

-- 5. Recrear cancelar_con_bono reintegrando exactamente el saldo correspondiente
CREATE OR REPLACE FUNCTION public.cancelar_con_bono(
  p_reserva_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_actor_email text;
  v_actor_is_staff boolean;
  v_actor_is_admin boolean;
  v_target_id uuid;
  v_class_id bigint;
  v_credit_debited boolean;
  v_free_credit_debited boolean;
  v_used_unlimited boolean;
  v_companion_modality text;
  v_tipo_reserva text;
  v_pack_id bigint;
  v_starts_at timestamptz;
  v_class_type text;
  v_professor_id public.clases.profesor_id%TYPE;
  v_cancel_limit_hours integer := 24;
  v_allow_admin_override boolean := false;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para cancelar.' USING errcode = '42501';
  END IF;
  IF p_reserva_id IS NULL OR p_reserva_id <= 0 THEN
    RAISE EXCEPTION 'La solicitud de cancelación no es válida.' USING errcode = '22023';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))), lower(nullif(trim(email), ''))
    INTO v_actor_role, v_actor_email
    FROM public.profiles
   WHERE id = v_actor_id;
  IF NOT found THEN
    RAISE EXCEPTION 'No se encontró el perfil que realiza la cancelación.' USING errcode = 'P0002';
  END IF;
  v_actor_is_staff := v_actor_role IN ('admin', 'profesor', 'trabajador', 'profesional');
  v_actor_is_admin := v_actor_role = 'admin';

  SELECT user_id, clase_id, coalesce(bono_descontado, false),
         coalesce(saldo_gratis_descontado, false),
         coalesce(usado_bono_mensual, false),
         welcome_companion_modality, tipo_reserva, class_pack_id
    INTO v_target_id, v_class_id, v_credit_debited,
         v_free_credit_debited, v_used_unlimited,
         v_companion_modality, v_tipo_reserva, v_pack_id
    FROM public.reservas_yoga
   WHERE id = p_reserva_id
     AND estado = 'confirmada'
   FOR UPDATE;
  IF NOT found THEN
    RAISE EXCEPTION 'La reserva especificada no existe.' USING errcode = 'P0002';
  END IF;
  IF v_target_id <> v_actor_id AND NOT v_actor_is_staff THEN
    RAISE EXCEPTION 'No puedes cancelar la reserva de otra persona.' USING errcode = '42501';
  END IF;

  SELECT fecha_inicio, lower(trim(coalesce(tipo_clase, ''))), profesor_id
    INTO v_starts_at, v_class_type, v_professor_id
    FROM public.clases
   WHERE id = v_class_id
   FOR UPDATE;
  IF NOT found OR v_class_type NOT IN ('yoga', 'taller') THEN
    RAISE EXCEPTION 'La clase especificada no está disponible.' USING errcode = 'P0002';
  END IF;

  BEGIN
    SELECT CASE
      WHEN trim(coalesce(valor, '')) ~ '^[0-9]{1,3}$'
        THEN least(168, greatest(0, trim(valor)::integer))
      ELSE 24
    END
      INTO v_cancel_limit_hours
      FROM public.configuracion
     WHERE clave = 'horas_limite_cancelacion'
     LIMIT 1;
  EXCEPTION
    WHEN others THEN
      v_cancel_limit_hours := 24;
  END;
  v_cancel_limit_hours := coalesce(v_cancel_limit_hours, 24);

  IF v_actor_is_admin THEN
    SELECT lower(trim(coalesce(valor, ''))) IN ('true', '1', 'yes', 'on')
      INTO v_allow_admin_override
      FROM public.configuracion
     WHERE clave = 'permitir_cancelacion_admin_siempre'
     LIMIT 1;
    v_allow_admin_override := coalesce(v_allow_admin_override, false);
  END IF;

  IF NOT (v_actor_is_admin AND v_allow_admin_override)
    AND (v_starts_at IS NULL
      OR v_starts_at <= now() + make_interval(hours => v_cancel_limit_hours)) THEN
    RAISE EXCEPTION 'Ya no puedes cancelar: faltan % h o menos para la clase. El bono reservado no se devuelve.',
      v_cancel_limit_hours USING errcode = 'P0001';
  END IF;

  DELETE FROM public.reservas_yoga WHERE id = p_reserva_id;

  IF v_free_credit_debited THEN
    IF v_companion_modality IS NOT NULL OR v_tipo_reserva = 'compania' THEN
      UPDATE public.profiles
         SET saldo_yoga_compania = coalesce(saldo_yoga_compania, 0) + 1
       WHERE id = v_target_id;
    ELSE
      UPDATE public.profiles
         SET saldo_clases_gratis = coalesce(saldo_clases_gratis, 0) + 1
       WHERE id = v_target_id;
    END IF;
  ELSIF v_credit_debited AND v_pack_id IS NOT NULL THEN
    UPDATE public.class_credit_packs
       SET credits_remaining = least(credits_total, credits_remaining + 1),
           updated_at = now()
     WHERE id = v_pack_id
       AND user_id = v_target_id;
  ELSIF v_credit_debited THEN
    UPDATE public.profiles
       SET bonos = coalesce(bonos, 0) + 1
     WHERE id = v_target_id;
  END IF;
END;
$$;

-- 6. RPC admin_obtener_asistencias_completas incluyendo acompañantes
CREATE OR REPLACE FUNCTION public.admin_obtener_asistencias_completas(
  p_clase_ids bigint[] DEFAULT NULL
)
RETURNS TABLE (
  reserva_id bigint,
  clase_id bigint,
  user_id uuid,
  tipo_clase text,
  estado text,
  nombre text,
  apellidos text,
  email text,
  telefono text,
  auth_method text,
  fecha_nacimiento date,
  rol text,
  num_plazas integer,
  tipo_reserva text,
  nombre_acompanante text,
  acompanantes jsonb,
  welcome_companion_modality text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  SELECT lower(coalesce(rol, '')) INTO v_actor_role
    FROM public.profiles
   WHERE id = v_actor_id;

  IF NOT found OR v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'unauthorized: staff or admin role required';
  END IF;

  RETURN QUERY
  -- 1. Reservas de Yoga
  SELECT
    r.id AS reserva_id,
    r.clase_id,
    r.user_id,
    'yoga'::text AS tipo_clase,
    r.estado::text,
    p.nombre,
    p.apellidos,
    p.email,
    p.telefono,
    p.auth_method,
    p.fecha_nacimiento,
    p.rol,
    coalesce(r.num_plazas, 1) AS num_plazas,
    coalesce(r.tipo_reserva, 'individual')::text AS tipo_reserva,
    r.nombre_acompanante,
    coalesce(r.acompanantes, '[]'::jsonb) AS acompanantes,
    r.welcome_companion_modality
  FROM public.reservas_yoga r
  LEFT JOIN public.profiles p ON p.id = r.user_id
  WHERE r.estado = 'confirmada'
    AND (p_clase_ids IS NULL OR r.clase_id = ANY(p_clase_ids))

  UNION ALL

  -- 2. Reservas de Psicología
  SELECT
    rp.id AS reserva_id,
    rp.clase_id,
    rp.user_id,
    'psicologia'::text AS tipo_clase,
    rp.estado::text,
    p.nombre,
    p.apellidos,
    p.email,
    p.telefono,
    p.auth_method,
    p.fecha_nacimiento,
    p.rol,
    1 AS num_plazas,
    'individual'::text AS tipo_reserva,
    NULL::text AS nombre_acompanante,
    '[]'::jsonb AS acompanantes,
    NULL::text AS welcome_companion_modality
  FROM public.reservas_psicologia rp
  LEFT JOIN public.profiles p ON p.id = rp.user_id
  WHERE rp.estado = 'confirmada'
    AND (p_clase_ids IS NULL OR rp.clase_id = ANY(p_clase_ids))

  UNION ALL

  -- 3. Reservas de Nutrición
  SELECT
    rn.id AS reserva_id,
    rn.clase_id,
    rn.user_id,
    'nutricion'::text AS tipo_clase,
    rn.estado::text,
    p.nombre,
    p.apellidos,
    p.email,
    p.telefono,
    p.auth_method,
    p.fecha_nacimiento,
    p.rol,
    1 AS num_plazas,
    'individual'::text AS tipo_reserva,
    NULL::text AS nombre_acompanante,
    '[]'::jsonb AS acompanantes,
    NULL::text AS welcome_companion_modality
  FROM public.reservas_nutricion rn
  LEFT JOIN public.profiles p ON p.id = rn.user_id
  WHERE rn.estado = 'confirmada'
    AND (p_clase_ids IS NULL OR rn.clase_id = ANY(p_clase_ids));
END;
$$;

-- Permisos
REVOKE ALL ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean, text, integer, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean, text, integer, text, jsonb) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.cancelar_con_bono(bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.cancelar_con_bono(bigint) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_obtener_asistencias_completas(bigint[]) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_obtener_asistencias_completas(bigint[]) TO anon, authenticated, service_role;

COMMIT;

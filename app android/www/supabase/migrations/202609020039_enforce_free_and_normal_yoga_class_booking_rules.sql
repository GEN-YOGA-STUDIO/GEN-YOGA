-- ==============================================================================
-- Migración 202609020039: Reglas Canónicas de Reserva para Clases de Yoga
-- Incluye DROP FUNCTION explícito para evitar error 42P13 al cambiar nombres de parámetros.
-- ==============================================================================

BEGIN;

-- 1. Eliminar versiones previas de las funciones para evitar conflictos de firmas o parámetros
DROP FUNCTION IF EXISTS public.es_clase_elegible_bono_gratis(text, timestamptz, text, boolean) CASCADE;
DROP FUNCTION IF EXISTS public.es_clase_elegible_bono_gratis(text, text, timestamptz, boolean) CASCADE;
DROP FUNCTION IF EXISTS public.es_clase_elegible_bono_gratis(text, timestamptz, text) CASCADE;
DROP FUNCTION IF EXISTS public.es_clase_elegible_bono_gratis(text) CASCADE;
DROP FUNCTION IF EXISTS public.es_clase_elegible_bono_gratis CASCADE;

DROP FUNCTION IF EXISTS public.reservar_con_bono(bigint, uuid, boolean) CASCADE;
DROP FUNCTION IF EXISTS public.reservar_con_bono(bigint, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.reservar_con_bono(numeric, uuid, boolean) CASCADE;
DROP FUNCTION IF EXISTS public.reservar_con_bono CASCADE;

-- 2. Crear función clasificadora de clases gratuitas/introductorias
CREATE OR REPLACE FUNCTION public.es_clase_elegible_bono_gratis(
  p_nombre text,
  p_fecha_inicio timestamptz DEFAULT null,
  p_identidad_profesional text DEFAULT '',
  p_es_gratuita boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_nom text := lower(coalesce(p_nombre, ''));
BEGIN
  -- Si está marcada como gratuita explícitamente en la base de datos
  IF p_es_gratuita IS TRUE THEN
    RETURN true;
  END IF;

  -- Si el nombre contiene palabras clave de sesión gratuita, introductoria o abierta
  IF v_nom ~* 'introductor|bienvenida|abierta|gratis|prueba|madre|hija' THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- 3. Crear función de reserva con bono
CREATE OR REPLACE FUNCTION public.reservar_con_bono(
  p_clase_id bigint,
  p_user_id uuid,
  p_use_welcome_companion boolean DEFAULT false
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
  v_unlimited_active boolean;
  v_membership_start timestamptz;
  v_membership_end timestamptz;
  v_natural_membership_start timestamptz;
  v_natural_membership_end timestamptz;
  v_capacity integer;
  v_starts_at timestamptz;
  v_class_name text;
  v_class_type text;
  v_class_active boolean;
  v_is_special boolean;
  v_is_free boolean;
  v_marked_free boolean;
  v_professor_id public.clases.profesor_id%TYPE;
  v_professional_identity text := '';
  v_occupied integer;
  v_booking_limit_hours integer := 12;
  v_use_unlimited boolean := false;
  v_pack_id bigint;
  v_special_count integer := 0;
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
         profesor_id, coalesce(es_gratuita, false)
    INTO v_capacity, v_starts_at, v_class_name, v_class_type, v_class_active,
         v_professor_id, v_marked_free
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

  -- Comprobar aforo
  SELECT count(*)::integer
    INTO v_occupied
    FROM public.reservas_yoga
   WHERE clase_id = p_clase_id
     AND estado = 'confirmada';
  IF v_occupied >= v_capacity THEN
    RAISE EXCEPTION 'La clase está completa.' USING errcode = 'P0001';
  END IF;

  -- Perfil del alumno
  SELECT lower(trim(coalesce(rol, ''))), coalesce(bonos, 0),
         coalesce(saldo_clases_gratis, 0), coalesce(bono_mensual_activo, false),
         bono_mensual_inicio, bono_mensual_fin
    INTO v_target_role, v_legacy_credits, v_free_credits, v_unlimited_active,
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

  -- Determinar si la clase es una sesión gratuita / introductoria / abierta
  v_is_free := public.es_clase_elegible_bono_gratis(
    v_class_name,
    v_starts_at,
    v_professional_identity,
    v_marked_free
  );

  -- 1. Si la clase es 100% gratuita por configuración del estudio
  IF v_marked_free THEN
    INSERT INTO public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', false, false, null, false
    );
    RETURN;
  END IF;

  -- 2. Si es sesión gratuita/introductoria Y el alumno tiene saldo de bono gratis
  IF v_is_free AND v_free_credits >= 1 THEN
    UPDATE public.profiles
       SET saldo_clases_gratis = saldo_clases_gratis - 1
     WHERE id = v_target_id
       AND saldo_clases_gratis >= 1;
    IF found THEN
      INSERT INTO public.reservas_yoga (
        clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
        class_pack_id, saldo_gratis_descontado
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, false, null, true
      );
      RETURN;
    END IF;
  END IF;

  -- 3. Si es sesión introductoria y el ADMIN / PERSONAL está asignando al alumno
  IF v_is_free AND v_actor_is_staff AND v_target_id <> v_actor_id THEN
    INSERT INTO public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', false, false, null, false
    );
    RETURN;
  END IF;

  -- 4. Bonos Normales: Caso Bono Ilimitado
  SELECT starts_at, ends_at
    INTO v_natural_membership_start, v_natural_membership_end
    FROM public.unlimited_membership_periods
   WHERE user_id = v_target_id
     AND starts_at <= v_starts_at
     AND ends_at > v_starts_at
   ORDER BY starts_at DESC
   LIMIT 1
   FOR SHARE;

  IF found THEN
    v_unlimited_active := true;
    v_membership_start := v_natural_membership_start;
    v_membership_end := v_natural_membership_end;
  ELSIF v_unlimited_active THEN
    IF v_membership_start IS NULL THEN
      v_membership_start := date_trunc('month', v_starts_at AT TIME ZONE 'Europe/Madrid') AT TIME ZONE 'Europe/Madrid';
    END IF;
    IF v_membership_end IS NULL THEN
      v_membership_end := (date_trunc('month', v_starts_at AT TIME ZONE 'Europe/Madrid') + interval '1 month') AT TIME ZONE 'Europe/Madrid';
    END IF;
  END IF;

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
        IF v_is_free THEN
          RAISE EXCEPTION 'No dispones de un bono gratuito ni de clases disponibles para esta sesión. Adquiere un pack de clases o bono ilimitado para reservar.' USING errcode = 'P0001';
        ELSE
          RAISE EXCEPTION 'Esta clase regular requiere un bono o pack de clases activo. Adquiere un pack de clases para reservar.' USING errcode = 'P0001';
        END IF;
      END IF;
    END IF;
  END IF;

  -- Insertar reserva
  INSERT INTO public.reservas_yoga (
    clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
    class_pack_id, saldo_gratis_descontado
  ) VALUES (
    p_clase_id, v_target_id, 'confirmada', v_use_unlimited,
    NOT v_use_unlimited, v_pack_id, false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean) TO anon, authenticated, service_role;

COMMIT;

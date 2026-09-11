-- ==============================================================================
-- MIGRACIÓN: Soporte atómico para Consulta Doble (2 turnos simultáneos con 1 saldo)
-- y prevención de doble reembolso en cancelaciones simétricas
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.reservar_consulta_atomica(
  p_tipo text,
  p_clase_id bigint,
  p_user_id uuid DEFAULT NULL::uuid,
  p_cobrar_saldo boolean DEFAULT true
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_actor_email text;
  v_actor_is_staff boolean;
  v_target_id uuid := coalesce(p_user_id, auth.uid());
  v_target_role text;
  v_class_type text;
  v_class_active boolean;
  v_capacity integer;
  v_starts_at timestamptz;
  v_professor_id public.clases.profesor_id%type;
  v_is_free boolean;
  v_occupied integer;
  v_reservation_id bigint;
  v_no_charge boolean := false;
  v_charge_credit boolean := true;
  v_booking_limit_hours integer := 12;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING errcode = '42501';
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('psicologia', 'nutricion') THEN
    RAISE EXCEPTION 'invalid consultation type' USING errcode = '22023';
  END IF;
  IF p_clase_id IS NULL OR p_clase_id <= 0 OR v_target_id IS NULL THEN
    RAISE EXCEPTION 'invalid booking request' USING errcode = '22023';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))), lower(nullif(trim(email), ''))
    INTO v_actor_role, v_actor_email
    FROM public.profiles
   WHERE id = v_actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'actor profile not found' USING errcode = 'P0002';
  END IF;
  v_actor_is_staff := v_actor_role IN ('admin', 'profesor', 'trabajador', 'profesional');

  IF v_target_id <> v_actor_id AND NOT v_actor_is_staff THEN
    RAISE EXCEPTION 'not allowed to book for another user' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(tipo_clase, ''))), coalesce(activa, true),
         coalesce(capacidad_max, 0), fecha_inicio, profesor_id,
         coalesce(es_gratuita, false)
    INTO v_class_type, v_class_active, v_capacity, v_starts_at,
         v_professor_id, v_is_free
    FROM public.clases
   WHERE id = p_clase_id
   FOR UPDATE;

  IF NOT FOUND OR v_class_type <> p_tipo OR NOT v_class_active
    OR v_capacity <= 0 OR v_starts_at IS NULL OR v_starts_at <= now() THEN
    RAISE EXCEPTION 'consultation slot not found or invalid' USING errcode = 'P0002';
  END IF;

  IF v_target_id <> v_actor_id AND v_actor_role <> 'admin'
    AND NOT EXISTS (
      SELECT 1
        FROM public.profesionales
       WHERE id = v_professor_id
         AND lower(nullif(trim(email), '')) = v_actor_email
    ) THEN
    RAISE EXCEPTION 'staff may only manage consultation slots linked to their professional profile'
      USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, '')))
    INTO v_target_role
    FROM public.profiles
   WHERE id = v_target_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'target profile not found' USING errcode = 'P0002';
  END IF;
  IF v_target_role IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'staff users cannot book consultations' USING errcode = '42501';
  END IF;

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
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      v_booking_limit_hours := 12;
  END;
  v_booking_limit_hours := coalesce(v_booking_limit_hours, 12);

  IF NOT v_actor_is_staff
    AND v_starts_at <= now() + make_interval(hours => v_booking_limit_hours) THEN
    RAISE EXCEPTION 'consultation slot is no longer bookable' USING errcode = 'P0001';
  END IF;

  IF p_tipo = 'psicologia' THEN
    IF EXISTS (
      SELECT 1 FROM public.reservas_psicologia
       WHERE clase_id = p_clase_id
         AND user_id = v_target_id
         AND estado = 'confirmada'
    ) THEN
      RAISE EXCEPTION 'consultation already booked' USING errcode = '23505';
    END IF;
    SELECT count(*)::integer
      INTO v_occupied
      FROM public.reservas_psicologia
     WHERE clase_id = p_clase_id
       AND estado = 'confirmada';
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.reservas_nutricion
       WHERE clase_id = p_clase_id
         AND user_id = v_target_id
         AND estado = 'confirmada'
    ) THEN
      RAISE EXCEPTION 'consultation already booked' USING errcode = '23505';
    END IF;
    SELECT count(*)::integer
      INTO v_occupied
      FROM public.reservas_nutricion
     WHERE clase_id = p_clase_id
       AND estado = 'confirmada';
  END IF;

  IF v_occupied >= v_capacity THEN
    RAISE EXCEPTION 'consultation is full' USING errcode = 'P0001';
  END IF;

  -- Determinar si esta reserva no debe descontar saldo (ej: 2º turno de Consulta Doble o reserva manual por staff)
  v_no_charge := NOT coalesce(p_cobrar_saldo, true);

  IF v_is_free AND NOT v_no_charge THEN
    UPDATE public.profiles
       SET saldo_consultas_gratis = saldo_consultas_gratis - 1
     WHERE id = v_target_id
       AND saldo_consultas_gratis >= 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ya has utilizado tu bono de consulta gratuita o no dispones de saldo gratis suficiente.'
        USING errcode = 'P0001';
    END IF;

    IF p_tipo = 'psicologia' THEN
      INSERT INTO public.reservas_psicologia (
        clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, true
      ) RETURNING id INTO v_reservation_id;
    ELSE
      INSERT INTO public.reservas_nutricion (
        clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, true
      ) RETURNING id INTO v_reservation_id;
    END IF;
    RETURN v_reservation_id;
  ELSIF v_is_free AND v_no_charge THEN
    -- Turno 2 gratuito / cubierto
    IF p_tipo = 'psicologia' THEN
      INSERT INTO public.reservas_psicologia (
        clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, false
      ) RETURNING id INTO v_reservation_id;
    ELSE
      INSERT INTO public.reservas_nutricion (
        clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, false
      ) RETURNING id INTO v_reservation_id;
    END IF;
    RETURN v_reservation_id;
  END IF;

  v_charge_credit := NOT v_no_charge;

  IF v_charge_credit AND p_tipo = 'psicologia' THEN
    UPDATE public.profiles
       SET saldo_psicologia = saldo_psicologia - 1
     WHERE id = v_target_id
       AND saldo_psicologia >= 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'insufficient psychology credit' USING errcode = 'P0001';
    END IF;
  ELSIF v_charge_credit AND p_tipo = 'nutricion' THEN
    UPDATE public.profiles
       SET saldo_nutricion = saldo_nutricion - 1
     WHERE id = v_target_id
       AND saldo_nutricion >= 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'insufficient nutrition credit' USING errcode = 'P0001';
    END IF;
  END IF;

  IF p_tipo = 'psicologia' THEN
    INSERT INTO public.reservas_psicologia (
      clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', v_charge_credit, false
    ) RETURNING id INTO v_reservation_id;
  ELSE
    INSERT INTO public.reservas_nutricion (
      clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', v_charge_credit, false
    ) RETURNING id INTO v_reservation_id;
  END IF;

  RETURN v_reservation_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancelar_consulta_atomica(
  p_tipo text,
  p_reserva_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_actor_is_staff boolean;
  v_target_id uuid;
  v_class_id bigint;
  v_starts_at timestamptz;
  v_class_month date;
  v_cancel_limit_hours integer := 24;
  v_refund_paid boolean;
  v_refund_free boolean;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING errcode = '42501';
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('psicologia', 'nutricion')
    OR p_reserva_id IS NULL OR p_reserva_id <= 0 THEN
    RAISE EXCEPTION 'invalid cancellation request' USING errcode = '22023';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))) INTO v_actor_role
    FROM public.profiles WHERE id = v_actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'actor profile not found' USING errcode = 'P0002';
  END IF;
  v_actor_is_staff := v_actor_role IN ('admin', 'profesor', 'trabajador', 'profesional');

  IF p_tipo = 'psicologia' THEN
    SELECT user_id, clase_id, coalesce(saldo_descontado, false),
           coalesce(saldo_gratis_descontado, false)
      INTO v_target_id, v_class_id, v_refund_paid, v_refund_free
      FROM public.reservas_psicologia
     WHERE id = p_reserva_id AND estado = 'confirmada'
     FOR UPDATE;
  ELSE
    SELECT user_id, clase_id, coalesce(saldo_descontado, false),
           coalesce(saldo_gratis_descontado, false)
      INTO v_target_id, v_class_id, v_refund_paid, v_refund_free
      FROM public.reservas_nutricion
     WHERE id = p_reserva_id AND estado = 'confirmada'
     FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'consultation booking not found' USING errcode = 'P0002';
  END IF;
  IF v_target_id <> v_actor_id AND NOT v_actor_is_staff THEN
    RAISE EXCEPTION 'not allowed to cancel this booking' USING errcode = '42501';
  END IF;

  SELECT fecha_inicio INTO v_starts_at
    FROM public.clases WHERE id = v_class_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'consultation slot not found' USING errcode = 'P0002';
  END IF;

  IF NOT v_actor_is_staff THEN
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
      WHEN OTHERS THEN
        v_cancel_limit_hours := 24;
    END;
    v_cancel_limit_hours := coalesce(v_cancel_limit_hours, 24);

    IF v_starts_at IS NULL
      OR v_starts_at <= now() + make_interval(hours => v_cancel_limit_hours) THEN
      RAISE EXCEPTION 'Ya no puedes cancelar la consulta: faltan menos de % horas.',
        v_cancel_limit_hours USING errcode = 'P0001';
    END IF;
  END IF;

  v_class_month := date_trunc('month', v_starts_at AT TIME ZONE 'Europe/Madrid')::date;

  IF p_tipo = 'psicologia' THEN
    DELETE FROM public.reservas_psicologia WHERE id = p_reserva_id;
  ELSE
    DELETE FROM public.reservas_nutricion WHERE id = p_reserva_id;
  END IF;

  -- Si era sesión gratuita de valoración, reintegrar saldo_consultas_gratis
  IF v_refund_free THEN
    UPDATE public.profiles
       SET saldo_consultas_gratis = coalesce(saldo_consultas_gratis, 0) + 1
     WHERE id = v_target_id;
  -- Si era consulta de pago o saldo que descontó crédito, reintegrar o generar crédito de reprogramación
  ELSIF v_refund_paid THEN
    INSERT INTO public.creditos_reprogramacion
      (user_id, tipo, subtipo, mes, clase_id_origen, reserva_id_origen, estado)
    VALUES
      (v_target_id, 'consulta', p_tipo, v_class_month, v_class_id, p_reserva_id, 'disponible');

    -- Mantener compatibilidad reintegrando al saldo de la especialidad
    IF p_tipo = 'psicologia' THEN
      UPDATE public.profiles
         SET saldo_psicologia = coalesce(saldo_psicologia, 0) + 1
       WHERE id = v_target_id;
    ELSE
      UPDATE public.profiles
         SET saldo_nutricion = coalesce(saldo_nutricion, 0) + 1
       WHERE id = v_target_id;
    END IF;
  END IF;

  RETURN true;
END;
$function$;

COMMIT;

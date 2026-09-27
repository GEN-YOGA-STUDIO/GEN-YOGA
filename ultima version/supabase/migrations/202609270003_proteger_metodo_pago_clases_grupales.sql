-- Migration: Proteger metodo_pago y stripe_lookup_key en clases grupales durante reservas atomicas
-- Evita sobreescribir la configuracion de la clase cuando un usuario reserva una sesion grupal

CREATE OR REPLACE FUNCTION public.reservar_consulta_atomica(
  p_tipo text,
  p_clase_id bigint,
  p_user_id uuid DEFAULT NULL::uuid,
  p_cobrar_saldo boolean DEFAULT true,
  p_producto_contratado text DEFAULT NULL::text,
  p_stripe_lookup_key text DEFAULT NULL::text,
  p_origen_pago text DEFAULT 'local'::text,
  p_notas text DEFAULT NULL::text
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
  v_name text;
  v_is_group boolean := false;
  v_occupied integer;
  v_reservation_id bigint;
  v_no_charge boolean := false;
  v_charge_credit boolean := true;
  v_booking_limit_hours integer := 12;
  v_effective_producto text := trim(coalesce(p_producto_contratado, ''));
  v_effective_lookup text := trim(coalesce(p_stripe_lookup_key, ''));
  v_effective_origen text := trim(coalesce(p_origen_pago, 'local'));
  v_effective_notas text := trim(coalesce(p_notas, ''));
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
         coalesce(es_gratuita, false), lower(trim(coalesce(nombre, '')))
    INTO v_class_type, v_class_active, v_capacity, v_starts_at,
         v_professor_id, v_is_free, v_name
    FROM public.clases
   WHERE id = p_clase_id
   FOR UPDATE;

  IF NOT FOUND OR v_class_type <> p_tipo OR NOT v_class_active
    OR v_capacity <= 0 OR v_starts_at IS NULL THEN
    RAISE EXCEPTION 'consultation slot not found or invalid' USING errcode = 'P0002';
  END IF;

  -- Determinar si es sesión grupal
  v_is_group := (v_capacity > 1 OR v_name LIKE '%autoayuda%' OR v_name LIKE '%terap%' OR v_name LIKE '%grupo%' OR v_class_type = 'consulta_grupal');

  -- Para personal de recepción/admin/profesional del turno se permite gestionar turnos del día
  IF v_target_id <> v_actor_id AND v_actor_role NOT IN ('admin', 'trabajador')
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

  IF NOT v_actor_is_staff AND v_target_role IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'staff users cannot book consultations' USING errcode = '42501';
  END IF;

  -- Restricción temporal solo para reservas autoservicio de clientes
  IF NOT v_actor_is_staff THEN
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

    IF v_starts_at <= now() THEN
      RAISE EXCEPTION 'consultation slot has already passed' USING errcode = 'P0001';
    END IF;
    IF v_starts_at <= now() + make_interval(hours => v_booking_limit_hours) THEN
      RAISE EXCEPTION 'consultation slot is no longer bookable' USING errcode = 'P0001';
    END IF;
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

  v_no_charge := NOT coalesce(p_cobrar_saldo, true);

  -- Regla: Bono de Bienvenida cubre sesiones introductorias o marcadas como gratuitas
  IF (v_is_free OR v_name LIKE '%introduct%') THEN
    v_is_free := true;
  END IF;

  -- Determinar producto por defecto si no viene especificado
  IF v_effective_producto = '' THEN
    IF v_is_free THEN
      v_effective_producto := 'Consulta Gratuita de Bienvenida (0 €)';
    ELSIF v_is_group THEN
      v_effective_producto := 'Sesión Grupal (30 €)';
    ELSE
      SELECT coalesce(metodo_pago, 'Consulta ' || initcap(p_tipo)) INTO v_effective_producto
        FROM public.clases WHERE id = p_clase_id;
      IF v_effective_producto IS NULL OR v_effective_producto = '' THEN
        v_effective_producto := 'Consulta ' || initcap(p_tipo);
      END IF;
    END IF;
  END IF;

  -- Actualizar clase con producto/lookup si viene especificado y NO es sesión grupal
  IF NOT v_is_group THEN
    UPDATE public.clases
       SET metodo_pago = COALESCE(NULLIF(v_effective_producto, ''), metodo_pago),
           stripe_lookup_key = COALESCE(NULLIF(v_effective_lookup, ''), stripe_lookup_key)
     WHERE id = p_clase_id;
  END IF;

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
        clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado,
        producto_contratado, stripe_lookup_key, origen_pago, notas
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, true,
        v_effective_producto, v_effective_lookup, v_effective_origen, v_effective_notas
      ) RETURNING id INTO v_reservation_id;
    ELSE
      INSERT INTO public.reservas_nutricion (
        clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado,
        producto_contratado, stripe_lookup_key, origen_pago, notas
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, true,
        v_effective_producto, v_effective_lookup, v_effective_origen, v_effective_notas
      ) RETURNING id INTO v_reservation_id;
    END IF;
    RETURN v_reservation_id;
  ELSIF v_is_free AND v_no_charge THEN
    IF p_tipo = 'psicologia' THEN
      INSERT INTO public.reservas_psicologia (
        clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado,
        producto_contratado, stripe_lookup_key, origen_pago, notas
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, false,
        v_effective_producto, v_effective_lookup, v_effective_origen, v_effective_notas
      ) RETURNING id INTO v_reservation_id;
    ELSE
      INSERT INTO public.reservas_nutricion (
        clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado,
        producto_contratado, stripe_lookup_key, origen_pago, notas
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, false,
        v_effective_producto, v_effective_lookup, v_effective_origen, v_effective_notas
      ) RETURNING id INTO v_reservation_id;
    END IF;
    RETURN v_reservation_id;
  END IF;

  v_charge_credit := NOT v_no_charge;

  IF v_charge_credit THEN
    IF v_is_group THEN
      UPDATE public.profiles
         SET saldo_grupal = saldo_grupal - 1
       WHERE id = v_target_id
         AND saldo_grupal >= 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'insufficient group session credit' USING errcode = 'P0001';
      END IF;
    ELSIF p_tipo = 'psicologia' THEN
      UPDATE public.profiles
         SET saldo_psicologia = saldo_psicologia - 1
       WHERE id = v_target_id
         AND saldo_psicologia >= 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'insufficient psychology credit' USING errcode = 'P0001';
      END IF;
    ELSIF p_tipo = 'nutricion' THEN
      UPDATE public.profiles
         SET saldo_nutricion = saldo_nutricion - 1
       WHERE id = v_target_id
         AND saldo_nutricion >= 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'insufficient nutrition credit' USING errcode = 'P0001';
      END IF;
    END IF;
  END IF;

  IF p_tipo = 'psicologia' THEN
    INSERT INTO public.reservas_psicologia (
      clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado,
      producto_contratado, stripe_lookup_key, origen_pago, notas
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', v_charge_credit, false,
      v_effective_producto, v_effective_lookup, v_effective_origen, v_effective_notas
    ) RETURNING id INTO v_reservation_id;
  ELSE
    INSERT INTO public.reservas_nutricion (
      clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado,
      producto_contratado, stripe_lookup_key, origen_pago, notas
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', v_charge_credit, false,
      v_effective_producto, v_effective_lookup, v_effective_origen, v_effective_notas
    ) RETURNING id INTO v_reservation_id;
  END IF;

  RETURN v_reservation_id;
END;
$function$;

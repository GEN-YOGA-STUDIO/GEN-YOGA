-- ============================================================================
-- MIGRACIÓN 202609150001: PERMITIR INSCRIPCIÓN MANUAL ADMIN/STAFF
-- EN CLASES EN CURSO, PASADAS O INMEDIATAS
-- ============================================================================
-- Resuelve el error 'La clase o evento ya no está disponible para reserva'
-- cuando un administrador o profesor (como Yanira) inscribe presencialmente
-- a un cliente que vino al estudio pero no se apuntó previamente en la web.
--
-- Exime al rol staff/admin de restricciones temporales y de aforo en la RPC,
-- permitiendo además registrar la asistencia como 'manual_admin' si el alumno
-- no dispusiera de saldo o bono cargado en ese instante.
-- ============================================================================

-- 1. Actualizar la función central reservar_con_bono
CREATE OR REPLACE FUNCTION public.reservar_con_bono(
  p_clase_id bigint,
  p_user_id uuid DEFAULT NULL::uuid,
  p_forzar_regular boolean DEFAULT false,
  p_force_regular boolean DEFAULT false,
  p_use_unlimited_guest boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_is_staff boolean := false;
  v_target_role text;
  v_starts_at timestamptz;
  v_capacity integer;
  v_occupied integer;
  v_free_credits integer := 0;
  v_class_name text;
  v_class_type text;
  v_class_active boolean;
  v_is_special boolean;
  v_is_free boolean := false;
  v_class_month date;
  v_special_bonus_id bigint;
  v_pack_id bigint;
  v_effective_force_regular boolean;
  v_unlimited_covers boolean := false;
  v_reprog_credit_id bigint;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para reservar.' USING errcode = '42501';
  END IF;
  IF p_clase_id IS NULL OR p_clase_id <= 0 OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'La solicitud de reserva no es válida.' USING errcode = '22023';
  END IF;

  v_effective_force_regular := coalesce(p_forzar_regular, false) OR coalesce(p_force_regular, false);

  SELECT lower(trim(coalesce(rol, ''))) INTO v_actor_role
    FROM public.profiles WHERE id = v_actor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el perfil que realiza la reserva.'; END IF;

  v_is_staff := v_actor_role IN ('admin', 'profesor', 'trabajador', 'profesional');

  IF p_user_id <> v_actor_id AND NOT v_is_staff THEN
    RAISE EXCEPTION 'No puedes reservar una clase para otra persona.' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))), coalesce(saldo_clases_gratis, 0)
    INTO v_target_role, v_free_credits
    FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el perfil del alumno.'; END IF;

  IF NOT v_is_staff AND v_target_role IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'Solo los alumnos pueden reservar clases.' USING errcode = '42501';
  END IF;

  SELECT coalesce(capacidad_max, 10), fecha_inicio, nombre,
         lower(trim(coalesce(nullif(tipo_clase, ''), 'yoga'))),
         coalesce(activa, true),
         coalesce(es_especial, false),
         coalesce(es_gratuita, false)
    INTO v_capacity, v_starts_at, v_class_name, v_class_type,
         v_class_active, v_is_special, v_is_free
    FROM public.clases WHERE id = p_clase_id FOR UPDATE;
  IF NOT FOUND OR NOT v_class_active THEN
    RAISE EXCEPTION 'La clase o evento especificado no está disponible.' USING errcode = 'P0002';
  END IF;

  IF v_starts_at IS NULL THEN
    RAISE EXCEPTION 'La clase o evento especificado no tiene una fecha válida.' USING errcode = 'P0002';
  END IF;

  -- ── RESTRICCIÓN TEMPORAL ──
  -- Para clientes/alumnos (reservas web/app autoservicio), la clase debe ser futura y no haber comenzado.
  -- Para el staff/administración (inscripción presencial/mostrador/gestión), se permite añadir al cliente
  -- incluso si la clase ya ha comenzado, está en curso o es de hoy/reciente.
  IF NOT v_is_staff THEN
    IF v_starts_at <= now() THEN
      RAISE EXCEPTION 'La clase o evento ya no está disponible para reserva.' USING errcode = 'P0001';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.reservas_yoga
     WHERE clase_id = p_clase_id AND user_id = p_user_id AND estado = 'confirmada'
  ) THEN
    RAISE EXCEPTION 'Ya tienes una reserva confirmada para este horario.' USING errcode = '23505';
  END IF;

  SELECT coalesce(sum(greatest(coalesce(num_plazas_reservadas, 1), coalesce(num_plazas, 1), 1)), 0)::integer
    INTO v_occupied
    FROM public.reservas_yoga
   WHERE clase_id = p_clase_id AND estado = 'confirmada';
  IF NOT v_is_staff AND v_occupied >= v_capacity THEN
    RAISE EXCEPTION 'No quedan plazas disponibles para esta actividad.' USING errcode = 'P0001';
  END IF;

  v_class_month := date_trunc('month', v_starts_at AT TIME ZONE 'Europe/Madrid')::date;

  -- ============================================================================
  -- CASO A: EVENTO TALLER (120 min, plaza individual o reprogramación universal)
  -- ============================================================================
  IF v_class_type = 'taller' OR lower(v_class_name) LIKE '%taller%' THEN
    SELECT id INTO v_reprog_credit_id
      FROM public.creditos_reprogramacion
     WHERE user_id = p_user_id
       AND tipo = 'taller'
       AND estado = 'disponible'
     ORDER BY created_at ASC, id ASC
     LIMIT 1 FOR UPDATE;

    IF v_reprog_credit_id IS NOT NULL THEN
      UPDATE public.creditos_reprogramacion
         SET estado = 'utilizado',
             clase_id_destino = p_clase_id,
             utilizado_at = now()
       WHERE id = v_reprog_credit_id;

      INSERT INTO public.reservas_yoga
        (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, tipo_reserva)
      VALUES (p_clase_id, p_user_id, 'confirmada', false, false, 'reprogramacion_taller');
      RETURN;
    END IF;

    IF v_is_staff THEN
      INSERT INTO public.reservas_yoga
        (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, tipo_reserva)
      VALUES (p_clase_id, p_user_id, 'confirmada', false, false, 'manual_admin');
      RETURN;
    END IF;

    RAISE EXCEPTION 'Los talleres se reservan mediante plaza individual (o crédito de reprogramación disponible).'
      USING errcode = 'P0001';
  END IF;

  -- ============================================================================
  -- CASO B: EVENTO CLASE ESPECIAL (Se reserva con Bono Especial del mes)
  -- ============================================================================
  IF v_class_type = 'clase_especial' OR (v_is_special AND v_class_type <> 'yoga') THEN
    SELECT id INTO v_special_bonus_id
      FROM public.bonos_clases_especiales
     WHERE user_id = p_user_id
       AND mes = v_class_month
       AND saldo > 0
     ORDER BY id ASC
     LIMIT 1 FOR UPDATE;

    IF v_special_bonus_id IS NOT NULL THEN
      UPDATE public.bonos_clases_especiales
         SET saldo = saldo - 1,
             updated_at = now()
       WHERE id = v_special_bonus_id AND saldo > 0;

      INSERT INTO public.reservas_yoga
        (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, tipo_reserva)
      VALUES (p_clase_id, p_user_id, 'confirmada', false, true, 'clase_especial');
      RETURN;
    END IF;

    IF v_is_staff THEN
      INSERT INTO public.reservas_yoga
        (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, tipo_reserva)
      VALUES (p_clase_id, p_user_id, 'confirmada', false, false, 'manual_admin');
      RETURN;
    END IF;

    RAISE EXCEPTION 'Esta clase especial requiere un Bono de Clase Especial de % (20 € o incluido con Bono Ilimitado).',
      to_char(v_class_month, 'TMMonth YYYY') USING errcode = 'P0001';
  END IF;

  -- ============================================================================
  -- CASO 0: CLASE GRATUITA / INTRODUCTORIA (0 € para cualquier alumno registrado)
  -- ============================================================================
  IF (v_is_free OR v_class_name ~* 'introductor')
     AND NOT v_is_special
     AND NOT (v_class_name ~* '(taller|masterclass|especial)') THEN

    IF v_free_credits > 0 THEN
      UPDATE public.profiles
         SET saldo_clases_gratis = saldo_clases_gratis - 1
       WHERE id = p_user_id AND saldo_clases_gratis > 0;
      IF FOUND THEN
        INSERT INTO public.reservas_yoga
          (clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
           class_pack_id, saldo_gratis_descontado, tipo_reserva)
        VALUES (p_clase_id, p_user_id, 'confirmada', false, false, null, true, 'bienvenida');
        RETURN;
      END IF;
    END IF;

    -- Si el alumno no tiene saldo de bienvenida, se reserva directamente a 0 €
    INSERT INTO public.reservas_yoga
      (clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
       class_pack_id, saldo_gratis_descontado, tipo_reserva)
    VALUES (p_clase_id, p_user_id, 'confirmada', false, false, null, false, 'gratuita');
    RETURN;
  END IF;

  -- ============================================================================
  -- CASO C: CLASES NORMALES DE YOGA (Bono Ilimitado / Bienvenida / Packs)
  -- ============================================================================

  -- 1. Bono de Bienvenida (1 clase regular gratis)
  IF v_free_credits > 0
     AND NOT v_effective_force_regular
     AND v_class_type = 'yoga'
     AND NOT v_is_special
     AND NOT (v_class_name ~* '(taller|masterclass|especial)') THEN

    UPDATE public.profiles
       SET saldo_clases_gratis = saldo_clases_gratis - 1
     WHERE id = p_user_id AND saldo_clases_gratis > 0;
    IF FOUND THEN
      INSERT INTO public.reservas_yoga
        (clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
         class_pack_id, saldo_gratis_descontado, tipo_reserva)
      VALUES (p_clase_id, p_user_id, 'confirmada', false, false, null, true, 'bienvenida');
      RETURN;
    END IF;
  END IF;

  -- 2. Bono Ilimitado (tarifa plana de clases normales)
  IF EXISTS (
    SELECT 1 FROM public.unlimited_membership_periods
     WHERE user_id = p_user_id AND starts_at <= v_starts_at AND ends_at > v_starts_at
  ) THEN
    v_unlimited_covers := true;
  END IF;

  IF v_unlimited_covers THEN
    INSERT INTO public.reservas_yoga
      (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, tipo_reserva)
    VALUES (p_clase_id, p_user_id, 'confirmada', true, false, 'ilimitado');
    RETURN;
  END IF;

  -- 3. Packs de Clases Normales
  SELECT id INTO v_pack_id
    FROM public.class_credit_packs
   WHERE user_id = p_user_id
     AND coalesce(starts_at, purchased_at) <= v_starts_at
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
        (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id, tipo_reserva)
      VALUES (p_clase_id, p_user_id, 'confirmada', false, true, v_pack_id, 'pack_normal');
      RETURN;
    END IF;
  END IF;

  -- 4. Saldo residual en profiles.bonos
  UPDATE public.profiles
     SET bonos = bonos - 1
   WHERE id = p_user_id AND bonos > 0;
  IF FOUND THEN
    INSERT INTO public.reservas_yoga
      (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id, tipo_reserva)
    VALUES (p_clase_id, p_user_id, 'confirmada', false, true, null, 'pack_normal');
    RETURN;
  END IF;

  -- 5. Si quien reserva es Administrador o Staff (profesor/trabajador), permitir inscripción manual directa
  IF v_is_staff THEN
    INSERT INTO public.reservas_yoga
      (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id, tipo_reserva)
    VALUES (p_clase_id, p_user_id, 'confirmada', false, false, null, 'manual_admin');
    RETURN;
  END IF;

  RAISE EXCEPTION 'No tienes bonos de clases normales disponibles ni Bono Ilimitado activo.' USING errcode = 'P0001';
END;
$function$;

REVOKE ALL ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean, boolean, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean, boolean, boolean) TO authenticated, service_role;


-- 2. Actualizar función reservar_consulta_atomica para eximir a staff de restricción temporal
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
    OR v_capacity <= 0 OR v_starts_at IS NULL THEN
    RAISE EXCEPTION 'consultation slot not found or invalid' USING errcode = 'P0002';
  END IF;

  IF NOT v_actor_is_staff AND v_starts_at <= now() THEN
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
  IF NOT v_actor_is_staff AND v_target_role IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
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

  IF NOT v_actor_is_staff AND v_occupied >= v_capacity THEN
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
      IF v_actor_is_staff THEN
        -- Asignación manual de cortesía por staff
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
      ELSE
        RAISE EXCEPTION 'Ya has utilizado tu bono de consulta gratuita o no dispones de saldo gratis suficiente.'
          USING errcode = 'P0001';
      END IF;
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
      IF v_actor_is_staff THEN
        v_charge_credit := false;
      ELSE
        RAISE EXCEPTION 'insufficient psychology credit' USING errcode = 'P0001';
      END IF;
    END IF;
  ELSIF v_charge_credit AND p_tipo = 'nutricion' THEN
    UPDATE public.profiles
       SET saldo_nutricion = saldo_nutricion - 1
     WHERE id = v_target_id
       AND saldo_nutricion >= 1;
    IF NOT FOUND THEN
      IF v_actor_is_staff THEN
        v_charge_credit := false;
      ELSE
        RAISE EXCEPTION 'insufficient nutrition credit' USING errcode = 'P0001';
      END IF;
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

REVOKE ALL ON FUNCTION public.reservar_consulta_atomica(text, bigint, uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.reservar_consulta_atomica(text, bigint, uuid, boolean) TO authenticated, service_role;

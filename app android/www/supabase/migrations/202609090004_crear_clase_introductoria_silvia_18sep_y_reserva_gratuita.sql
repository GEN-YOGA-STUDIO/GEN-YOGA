-- ==============================================================================
-- MIGRACIÓN: Creación de Sesión Introductoria de Silvia Jaén (18 Sep 2026 11:00h)
-- y Garantía de Reserva 100% Gratuita para Usuarios Registrados
-- ==============================================================================

BEGIN;

-- 1. Insertar el tipo de clase 'Sesión Introductoria al Yoga y Ayurveda' en tipos_clases si no existe
INSERT INTO public.tipos_clases (nombre, categoria, especialidad, duracion_predeterminada, capacidad_predeterminada, activo, orden)
SELECT 'Sesión Introductoria al Yoga y Ayurveda', 'yoga', 'yoga', 75, 10, true, 10
WHERE NOT EXISTS (
  SELECT 1 FROM public.tipos_clases WHERE nombre = 'Sesión Introductoria al Yoga y Ayurveda'
);

-- 2. Insertar la clase introductoria de Silvia el viernes 18 de septiembre de 2026 (11:00 a 12:15 CEST -> 09:00 a 10:15 UTC)
INSERT INTO public.clases (
  nombre,
  fecha_inicio,
  fecha_fin,
  duracion_minutos,
  capacidad_max,
  profesor_id,
  tipo_clase,
  tipo_clase_id,
  es_gratuita,
  activa,
  es_especial,
  nivel,
  descripcion
)
SELECT
  'Sesión Introductoria al Yoga y Ayurveda',
  '2026-09-18 09:00:00+00'::timestamptz,
  '2026-09-18 10:15:00+00'::timestamptz,
  75,
  10,
  1,
  'yoga',
  (SELECT id FROM public.tipos_clases WHERE nombre = 'Sesión Introductoria al Yoga y Ayurveda' LIMIT 1),
  true,
  true,
  false,
  'principiante',
  'Sesión introductoria y gratuita de Yoga y Ayurveda con Silvia'
WHERE NOT EXISTS (
  SELECT 1 FROM public.clases
   WHERE profesor_id = 1
     AND fecha_inicio = '2026-09-18 09:00:00+00'::timestamptz
);

-- 3. Actualizar función pública reservar_con_bono para permitir reservas gratuitas
CREATE OR REPLACE FUNCTION public.reservar_con_bono(
  p_clase_id bigint,
  p_user_id uuid DEFAULT NULL,
  p_forzar_regular boolean DEFAULT false,
  p_force_regular boolean DEFAULT false,
  p_use_unlimited_guest boolean DEFAULT false
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
         coalesce(activa, true),
         coalesce(es_especial, false),
         coalesce(es_gratuita, false)
    INTO v_capacity, v_starts_at, v_class_name, v_class_type,
         v_class_active, v_is_special, v_is_free
    FROM public.clases WHERE id = p_clase_id FOR UPDATE;
  IF NOT FOUND OR NOT v_class_active THEN
    RAISE EXCEPTION 'La clase o evento especificado no está disponible.' USING errcode = 'P0002';
  END IF;

  IF v_starts_at IS NULL OR v_starts_at <= now() THEN
    RAISE EXCEPTION 'La clase o evento ya no está disponible para reserva.' USING errcode = 'P0001';
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
  IF v_occupied >= v_capacity THEN
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

    IF v_special_bonus_id IS NULL THEN
      RAISE EXCEPTION 'Esta clase especial requiere un Bono de Clase Especial de % (20 € o incluido con Bono Ilimitado).',
        to_char(v_class_month, 'TMMonth YYYY') USING errcode = 'P0001';
    END IF;

    UPDATE public.bonos_clases_especiales
       SET saldo = saldo - 1,
           updated_at = now()
     WHERE id = v_special_bonus_id AND saldo > 0;

    INSERT INTO public.reservas_yoga
      (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, tipo_reserva)
    VALUES (p_clase_id, p_user_id, 'confirmada', false, true, 'clase_especial');
    RETURN;
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

  RAISE EXCEPTION 'No tienes bonos de clases normales disponibles ni Bono Ilimitado activo.' USING errcode = 'P0001';
END;
$$;

REVOKE ALL ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean, boolean, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean, boolean, boolean) TO authenticated, service_role;

COMMIT;

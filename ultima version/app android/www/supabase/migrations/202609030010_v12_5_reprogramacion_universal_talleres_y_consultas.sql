-- ==============================================================================
-- Migración: Versión 12.5 - Reprogramación universal de talleres y consultas
-- Fecha: 2026-09-03
-- ==============================================================================

-- 1. Eliminar sobrecarga antigua de 2 argumentos para evitar conflictos
DROP FUNCTION IF EXISTS public.reservar_con_bono(bigint, uuid);

-- 2. Actualizar función canónica reservar_con_bono (5 argumentos con defaults):
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
         coalesce(es_especial, false)
    INTO v_capacity, v_starts_at, v_class_name, v_class_type,
         v_class_active, v_is_special
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
    -- Comprobar si el usuario tiene un crédito de reprogramación disponible (cualquier mes)
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

    -- Los talleres no se reservan con bonos regulares ni especiales
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

-- 3. Actualizar public.admin_eliminar_clase para reembolsar talleres y clases especiales:
CREATE OR REPLACE FUNCTION public.admin_eliminar_clase(
  p_clase_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_booking record;
  v_refunded_count integer := 0;
  v_class_name text;
  v_class_type text;
  v_starts_at timestamptz;
  v_class_month date;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))) INTO v_actor_role
    FROM public.profiles WHERE id = v_actor_id;

  IF v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'Solo los administradores o profesores pueden eliminar clases.' USING errcode = '42501';
  END IF;

  SELECT nombre, lower(trim(coalesce(tipo_clase, ''))), fecha_inicio
    INTO v_class_name, v_class_type, v_starts_at
    FROM public.clases
   WHERE id = p_clase_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La clase no existe o ya fue eliminada.' USING errcode = 'P0002';
  END IF;

  v_class_month := date_trunc('month', v_starts_at AT TIME ZONE 'Europe/Madrid')::date;

  -- 1. Procesar todas las reservas confirmadas de Yoga/Eventos y devolver el bono o crédito
  FOR v_booking IN (
    SELECT id, user_id, class_pack_id, coalesce(bono_descontado, false) as bono_descontado,
           coalesce(saldo_gratis_descontado, false) as saldo_gratis_descontado,
           coalesce(tipo_reserva, '') as tipo_reserva
      FROM public.reservas_yoga
     WHERE clase_id = p_clase_id
       AND estado = 'confirmada'
  ) LOOP
    -- Si es un taller: generar crédito de reprogramación
    IF v_class_type = 'taller' OR v_booking.tipo_reserva = 'reprogramacion_taller' THEN
      INSERT INTO public.creditos_reprogramacion
        (user_id, tipo, subtipo, mes, clase_id_origen, reserva_id_origen, estado)
      VALUES
        (v_booking.user_id, 'taller', 'taller_120', v_class_month, p_clase_id, v_booking.id, 'disponible');

    -- Si es clase especial: devolver bono especial del mes
    ELSIF v_class_type = 'clase_especial' OR v_booking.tipo_reserva = 'clase_especial' THEN
      INSERT INTO public.bonos_clases_especiales (user_id, mes, saldo, origen)
      VALUES (v_booking.user_id, v_class_month, 1, 'reintegro_admin_cancelacion');

    -- Si era bono de bienvenida
    ELSIF v_booking.saldo_gratis_descontado OR v_booking.tipo_reserva = 'bienvenida' THEN
      UPDATE public.profiles
         SET saldo_clases_gratis = coalesce(saldo_clases_gratis, 0) + 1
       WHERE id = v_booking.user_id;

    -- Si consumió un pack de clases
    ELSIF v_booking.class_pack_id IS NOT NULL THEN
      UPDATE public.class_credit_packs
         SET credits_remaining = credits_remaining + 1,
             updated_at = now()
       WHERE id = v_booking.class_pack_id;

    -- Si consumió saldo general
    ELSIF v_booking.bono_descontado THEN
      UPDATE public.profiles
         SET bonos = coalesce(bonos, 0) + 1
       WHERE id = v_booking.user_id;
    END IF;

    v_refunded_count := v_refunded_count + 1;
  END LOOP;

  -- 2. Procesar reservas de psicología / nutrición si la clase fuera una consulta
  FOR v_booking IN (
    SELECT id, user_id FROM public.reservas_psicologia WHERE clase_id = p_clase_id AND estado = 'confirmada'
  ) LOOP
    UPDATE public.profiles SET saldo_psicologia = coalesce(saldo_psicologia, 0) + 1 WHERE id = v_booking.user_id;
    v_refunded_count := v_refunded_count + 1;
  END LOOP;

  FOR v_booking IN (
    SELECT id, user_id FROM public.reservas_nutricion WHERE clase_id = p_clase_id AND estado = 'confirmada'
  ) LOOP
    UPDATE public.profiles SET saldo_nutricion = coalesce(saldo_nutricion, 0) + 1 WHERE id = v_booking.user_id;
    v_refunded_count := v_refunded_count + 1;
  END LOOP;

  -- 3. Eliminar todas las reservas asociadas a esta clase
  DELETE FROM public.reservas_yoga WHERE clase_id = p_clase_id;
  DELETE FROM public.reservas_psicologia WHERE clase_id = p_clase_id;
  DELETE FROM public.reservas_nutricion WHERE clase_id = p_clase_id;

  -- 4. Eliminar la clase definitivamente
  DELETE FROM public.clases WHERE id = p_clase_id;

  RETURN jsonb_build_object(
    'success', true,
    'clase_id', p_clase_id,
    'alumnos_reembolsados', v_refunded_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_eliminar_clase(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_eliminar_clase(bigint) TO authenticated, service_role;

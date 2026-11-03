-- Migration: 202611030001_bonos_mensuales_cupo_mensual_8_y_4.sql
-- Descripción:
--   Sustituye la restricción semanal de los bonos mensuales por cupos acumulativos
--   a nivel de mes natural completo (Europe/Madrid):
--     * Bono Mensual: 8 clases regulares al mes (sin límite por semana, se pueden gastar a voluntad).
--     * Bono Inicial: 4 clases regulares al mes (sin límite por semana, se pueden gastar a voluntad).
--     * Bono Ilimitado: sin cambios (acceso ilimitado a clases regulares del mes).
--     * Si el alumno contrata ambos en el mismo mes, los cupos se suman (8 + 4 = 12 clases).
--   Actualiza la función canónica pública public.reservar_con_bono(...)

BEGIN;

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
  v_has_monthly_membership boolean := false;
  v_mensual_max integer := 0;
  v_inicial_max integer := 0;
  v_total_monthly_max integer := 0;
  v_monthly_mensual_used integer := 0;
  v_monthly_inicial_used integer := 0;
  v_monthly_unclassified_used integer := 0;
  v_month_start date;
  v_month_end_date date;
  v_month_start_tz timestamptz;
  v_month_end_tz timestamptz;
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

  IF NOT v_is_staff AND v_starts_at <= now() THEN
    RAISE EXCEPTION 'La clase o evento ya no está disponible para reserva.' USING errcode = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.reservas_yoga
     WHERE clase_id = p_clase_id AND user_id = p_user_id AND estado = 'confirmada'
  ) OR EXISTS (
    SELECT 1 FROM public.reservas_psicologia
     WHERE clase_id = p_clase_id AND user_id = p_user_id AND estado = 'confirmada'
  ) THEN
    RAISE EXCEPTION 'Ya tienes una reserva confirmada para este horario.' USING errcode = '23505';
  END IF;

  SELECT (
    coalesce((SELECT sum(greatest(coalesce(num_plazas_reservadas, 1), coalesce(num_plazas, 1), 1))
                FROM public.reservas_yoga
               WHERE clase_id = p_clase_id AND estado = 'confirmada'), 0)
    +
    coalesce((SELECT count(*)
                FROM public.reservas_psicologia
               WHERE clase_id = p_clase_id AND estado = 'confirmada'), 0)
  )::integer INTO v_occupied;

  IF NOT v_is_staff AND v_occupied >= v_capacity THEN
    RAISE EXCEPTION 'No quedan plazas disponibles para esta actividad.' USING errcode = 'P0001';
  END IF;

  v_class_month := date_trunc('month', v_starts_at AT TIME ZONE 'Europe/Madrid')::date;

  -- Talleres
  IF v_class_type = 'taller' OR lower(v_class_name) LIKE '%taller%' THEN
    IF v_is_staff THEN
      INSERT INTO public.reservas_yoga
        (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id, tipo_reserva)
      VALUES (p_clase_id, p_user_id, 'confirmada', false, false, null, 'manual_admin');
      RETURN;
    END IF;
    RAISE EXCEPTION 'Los talleres monográficos no se pueden reservar con bonos de clases regulares.' USING errcode = 'P0001';
  END IF;

  -- Clases especiales
  IF v_is_special OR v_class_type = 'clase_especial'
     OR (v_class_name ~* '(masterclass|especial)' AND NOT (v_class_name ~* '(taller)')) THEN
    IF v_effective_force_regular THEN
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

      UPDATE public.profiles SET bonos = bonos - 1
       WHERE id = p_user_id AND bonos > 0;
      IF FOUND THEN
        INSERT INTO public.reservas_yoga
          (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id, tipo_reserva)
        VALUES (p_clase_id, p_user_id, 'confirmada', false, true, null, 'pack_normal');
        RETURN;
      END IF;
    END IF;

    SELECT id INTO v_special_bonus_id
      FROM public.bonos_clases_especiales
     WHERE user_id = p_user_id
       AND mes = v_class_month
       AND saldo > 0
     ORDER BY id ASC
     LIMIT 1 FOR UPDATE;

    IF v_special_bonus_id IS NOT NULL THEN
      UPDATE public.bonos_clases_especiales
         SET saldo = saldo - 1, updated_at = now()
       WHERE id = v_special_bonus_id AND saldo > 0;
      IF FOUND THEN
        INSERT INTO public.reservas_yoga
          (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, tipo_reserva)
        VALUES (p_clase_id, p_user_id, 'confirmada', false, true, 'clase_especial');
        RETURN;
      END IF;
    END IF;

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

    UPDATE public.profiles SET bonos = bonos - 1
     WHERE id = p_user_id AND bonos > 0;
    IF FOUND THEN
      INSERT INTO public.reservas_yoga
        (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id, tipo_reserva)
      VALUES (p_clase_id, p_user_id, 'confirmada', false, true, null, 'pack_normal');
      RETURN;
    END IF;

    IF v_is_staff THEN
      INSERT INTO public.reservas_yoga
        (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id, tipo_reserva)
      VALUES (p_clase_id, p_user_id, 'confirmada', false, false, null, 'manual_admin');
      RETURN;
    END IF;

    RAISE EXCEPTION 'Esta es una clase especial. Requiere un Bono de Clase Especial del mes o saldo de clases.' USING errcode = 'P0001';
  END IF;

  -- Clase gratuita/introductoria
  IF v_is_free OR lower(v_class_name) LIKE '%introductor%' THEN
    INSERT INTO public.reservas_yoga
      (clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
       class_pack_id, saldo_gratis_descontado, tipo_reserva)
    VALUES (p_clase_id, p_user_id, 'confirmada', false, false, null, false, 'gratuita');
    RETURN;
  END IF;

  -- 1. Bono de Bienvenida
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

  -- 2. Bono Ilimitado
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

  -- 3. Bonos mensuales (Bono Mensual: 8 clases/mes natural; Bono Inicial: 4 clases/mes natural).
  --    Los cupos se acumulan a nivel de mes natural completo (Europe/Madrid) sin límite semanal.
  --    El usuario puede gastar las clases cuando desee en ese mes (incluso todas la misma semana).
  v_month_start := date_trunc('month', v_starts_at AT TIME ZONE 'Europe/Madrid')::date;
  v_month_end_date := (v_month_start + interval '1 month')::date;
  v_month_start_tz := v_month_start::timestamp AT TIME ZONE 'Europe/Madrid';
  v_month_end_tz := v_month_end_date::timestamp AT TIME ZONE 'Europe/Madrid';

  SELECT
    coalesce(sum(CASE WHEN plan_type = 'bono_mensual' THEN 8 WHEN max_classes_per_week = 2 THEN 8 ELSE 0 END), 0)::integer,
    coalesce(sum(CASE WHEN plan_type = 'bono_inicial' THEN 4 WHEN max_classes_per_week = 1 THEN 4 ELSE 0 END), 0)::integer
  INTO v_mensual_max, v_inicial_max
  FROM public.monthly_membership_periods
  WHERE user_id = p_user_id
    AND starts_at <= v_starts_at
    AND ends_at > v_starts_at;

  v_total_monthly_max := coalesce(v_mensual_max, 0) + coalesce(v_inicial_max, 0);

  IF v_total_monthly_max > 0 THEN
    v_has_monthly_membership := true;

    SELECT
      count(*) FILTER (WHERE ry.tipo_reserva = 'bono_mensual')::integer,
      count(*) FILTER (WHERE ry.tipo_reserva = 'bono_inicial')::integer,
      count(*) FILTER (
        WHERE (ry.tipo_reserva IS NULL OR ry.tipo_reserva NOT IN ('bono_mensual', 'bono_inicial', 'ilimitado', 'clase_especial', 'bienvenida', 'gratuita', 'pack_normal', 'manual_admin'))
          AND coalesce(ry.usado_bono_mensual, false) = true
      )::integer
    INTO v_monthly_mensual_used, v_monthly_inicial_used, v_monthly_unclassified_used
    FROM public.reservas_yoga ry
    JOIN public.clases c ON c.id = ry.clase_id
    WHERE ry.user_id = p_user_id
      AND ry.estado = 'confirmada'
      AND c.fecha_inicio >= v_month_start_tz
      AND c.fecha_inicio < v_month_end_tz;

    IF coalesce(v_monthly_unclassified_used, 0) > 0 THEN
      IF coalesce(v_monthly_mensual_used, 0) < v_mensual_max THEN
        v_monthly_mensual_used := v_monthly_mensual_used + least(v_monthly_unclassified_used, v_mensual_max - coalesce(v_monthly_mensual_used, 0));
        v_monthly_unclassified_used := v_monthly_unclassified_used - least(v_monthly_unclassified_used, v_mensual_max - coalesce(v_monthly_mensual_used, 0));
      END IF;
      IF v_monthly_unclassified_used > 0 AND coalesce(v_monthly_inicial_used, 0) < v_inicial_max THEN
        v_monthly_inicial_used := v_monthly_inicial_used + least(v_monthly_unclassified_used, v_inicial_max - coalesce(v_monthly_inicial_used, 0));
      END IF;
    END IF;

    -- Consumir prioritariamente del cupo de Bono Mensual (8 clases), luego Bono Inicial (4 clases)
    IF v_mensual_max > 0 AND coalesce(v_monthly_mensual_used, 0) < v_mensual_max THEN
      INSERT INTO public.reservas_yoga
        (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, tipo_reserva)
      VALUES (p_clase_id, p_user_id, 'confirmada', false, false, 'bono_mensual');
      RETURN;
    ELSIF v_inicial_max > 0 AND coalesce(v_monthly_inicial_used, 0) < v_inicial_max THEN
      INSERT INTO public.reservas_yoga
        (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, tipo_reserva)
      VALUES (p_clase_id, p_user_id, 'confirmada', false, false, 'bono_inicial');
      RETURN;
    END IF;
  END IF;

  -- 4. Packs de clases (FEFO)
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

  -- 5. Saldo residual histórico en profiles.bonos
  UPDATE public.profiles SET bonos = bonos - 1
   WHERE id = p_user_id AND bonos > 0;
  IF FOUND THEN
    INSERT INTO public.reservas_yoga
      (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id, tipo_reserva)
    VALUES (p_clase_id, p_user_id, 'confirmada', false, true, null, 'pack_normal');
    RETURN;
  END IF;

  -- 6. Staff / Administrador
  IF v_is_staff THEN
    INSERT INTO public.reservas_yoga
      (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id, tipo_reserva)
    VALUES (p_clase_id, p_user_id, 'confirmada', false, false, null, 'manual_admin');
    RETURN;
  END IF;

  -- Si tenía bono mensual pero agotó el cupo de clases de este mes
  IF v_has_monthly_membership THEN
    IF v_mensual_max > 0 AND v_inicial_max > 0 THEN
      RAISE EXCEPTION 'Has alcanzado el límite combinado de tus bonos mensuales (% clases al mes) para este mes. Adquiere una clase suelta o pack para reservar más clases.', v_total_monthly_max
        USING errcode = 'P0001';
    ELSIF v_mensual_max > 0 THEN
      RAISE EXCEPTION 'Has alcanzado el límite de % clases al mes de tu Bono Mensual para este mes. Adquiere una clase suelta o pack para reservar más clases.', v_mensual_max
        USING errcode = 'P0001';
    ELSE
      RAISE EXCEPTION 'Has alcanzado el límite de % clases al mes de tu Bono Inicial para este mes. Adquiere una clase suelta o pack para reservar más clases.', v_inicial_max
        USING errcode = 'P0001';
    END IF;
  END IF;

  RAISE EXCEPTION 'No tienes bonos de clases normales disponibles ni Bono Ilimitado, Mensual o Inicial activo.' USING errcode = 'P0001';
END;
$function$;

REVOKE ALL ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean, boolean, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean, boolean, boolean) TO authenticated, service_role;

COMMIT;

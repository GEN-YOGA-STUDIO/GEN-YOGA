-- Migration: 202611160001_bonos_30_dias_desde_compra.sql
-- Descripción:
--   Actualiza la validez de los bonos principales (Bono Inicial, Bono Mensual y Bono Ilimitado)
--   para que su vigencia sea de 30 días naturales a partir de la fecha de compra,
--   en lugar de quedar restringidos a un mes calendario.
--   Ajusta public.reservar_con_bono(...) para computar el cupo de clases dentro de la
--   ventana temporal activa del periodo (starts_at .. ends_at).

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
  v_period_start_tz timestamptz;
  v_period_end_tz timestamptz;
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

    SELECT b.id INTO v_special_bonus_id
      FROM public.bonos_clases_especiales b
     WHERE b.user_id = p_user_id
       AND b.saldo > 0
       AND (
         b.mes = v_class_month
         OR (
           b.origen = 'bono_ilimitado'
           AND EXISTS (
             SELECT 1 FROM public.unlimited_membership_periods u
              WHERE u.user_id = p_user_id
                AND u.starts_at <= v_starts_at
                AND u.ends_at > v_starts_at
           )
         )
       )
     ORDER BY b.id ASC
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

  -- 2. Bono Ilimitado (acceso ilimitado durante el periodo activo starts_at .. ends_at)
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

  -- 3. Bonos mensuales / 30 días (Bono Mensual: 8 clases / 30 días; Bono Inicial: 4 clases / 30 días).
  --    Los cupos se acumulan a nivel de la ventana temporal activa del periodo (starts_at .. ends_at)
  --    sin límite semanal. El usuario puede gastar las clases a su ritmo durante sus 30 días de vigencia.
  v_month_start := date_trunc('month', v_starts_at AT TIME ZONE 'Europe/Madrid')::date;
  v_month_end_date := (v_month_start + interval '1 month')::date;
  v_month_start_tz := v_month_start::timestamp AT TIME ZONE 'Europe/Madrid';
  v_month_end_tz := v_month_end_date::timestamp AT TIME ZONE 'Europe/Madrid';

  SELECT
    coalesce(sum(CASE WHEN plan_type = 'bono_mensual' THEN 8 WHEN max_classes_per_week = 2 THEN 8 ELSE 0 END), 0)::integer,
    coalesce(sum(CASE WHEN plan_type = 'bono_inicial' THEN 4 WHEN max_classes_per_week = 1 THEN 4 ELSE 0 END), 0)::integer,
    min(starts_at),
    max(ends_at)
  INTO v_mensual_max, v_inicial_max, v_period_start_tz, v_period_end_tz
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
      AND c.fecha_inicio >= coalesce(v_period_start_tz, v_month_start_tz)
      AND c.fecha_inicio < coalesce(v_period_end_tz, v_month_end_tz);

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

  -- Si tenía bono mensual pero agotó el cupo de clases de este periodo
  IF v_has_monthly_membership THEN
    IF v_mensual_max > 0 AND v_inicial_max > 0 THEN
      RAISE EXCEPTION 'Has alcanzado el límite combinado de tus bonos (% clases) para este periodo de 30 días. Adquiere una clase suelta o pack para reservar más clases.', v_total_monthly_max
        USING errcode = 'P0001';
    ELSIF v_mensual_max > 0 THEN
      RAISE EXCEPTION 'Has alcanzado el límite de % clases de tu Bono Mensual para este periodo de 30 días. Adquiere una clase suelta o pack para reservar más clases.', v_mensual_max
        USING errcode = 'P0001';
    ELSE
      RAISE EXCEPTION 'Has alcanzado el límite de % clases de tu Bono Inicial para este periodo de 30 días. Adquiere una clase suelta o pack para reservar más clases.', v_inicial_max
        USING errcode = 'P0001';
    END IF;
  END IF;

  RAISE EXCEPTION 'No tienes bonos de clases normales disponibles ni Bono Ilimitado, Mensual o Inicial activo.' USING errcode = 'P0001';
END;
$function$;

REVOKE ALL ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean, boolean, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean, boolean, boolean) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Fulfillment de Stripe: los bonos principales se activan al momento de compra
-- con una vigencia exacta de 30 días naturales (v_purchased_at .. v_purchased_at + 30 días).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stripe_fulfill_checkout(
  p_event_id text,
  p_event_type text,
  p_event_created bigint,
  p_checkout_session_id text,
  p_user_id uuid,
  p_is_guest boolean,
  p_purchase_type text,
  p_price_id text,
  p_payment_intent_id text,
  p_subscription_id text,
  p_customer_id text,
  p_amount_total bigint,
  p_currency text,
  p_payment_status text,
  p_membership_month text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_subscription_status text,
  p_cancel_at_period_end boolean,
  p_livemode boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_type text;
  v_effective_type text;
  v_effective_event_id text;
  v_credits integer;
  v_pack_type text;
  v_purchased_at timestamptz;
  v_expires_at timestamptz;
  v_membership_month date;
  v_membership_start timestamptz;
  v_membership_end timestamptz;
  v_inserted integer := 0;
  v_pack_inserted integer := 0;
  v_period_inserted integer := 0;
  v_bonus_inserted integer := 0;
  v_ledger_inserted integer := 0;
  v_existing public.stripe_purchases%ROWTYPE;
  v_account_deletion_pending boolean;
  v_consultation_type text;
  v_consultation_quantity integer := 1;
  v_target_month date;
  v_is_consultation boolean := false;
  v_is_group boolean := false;
  v_is_nutrition boolean := false;
  v_is_workshop boolean := false;
  v_is_dynamic boolean := false;
BEGIN
  IF p_livemode IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Only LIVE Stripe events are accepted' USING errcode = '22023';
  END IF;
  IF p_event_type IS DISTINCT FROM 'checkout.session.completed' THEN
    RAISE EXCEPTION 'Unsupported Stripe event type' USING errcode = '22023';
  END IF;
  IF nullif(trim(p_checkout_session_id), '') IS NULL
     OR nullif(trim(p_price_id), '') IS NULL THEN
    RAISE EXCEPTION 'Missing Stripe identifiers' USING errcode = '22023';
  END IF;
  IF p_payment_status IS DISTINCT FROM 'paid'
     OR lower(coalesce(p_currency, '')) IS DISTINCT FROM 'eur' THEN
    RAISE EXCEPTION 'Checkout is not a paid EUR session' USING errcode = '22023';
  END IF;

  v_effective_event_id := coalesce(nullif(trim(p_event_id), ''), 'evt_' || p_checkout_session_id);

  v_type := lower(trim(coalesce(p_purchase_type, '')));
  IF v_type IN ('promo_50', 'promo') THEN
    v_type := 'promo_50_clase';
  ELSIF v_type = 'prod_vvkt3c71eaujmt' THEN
    v_type := 'bono_mensual';
  ELSIF v_type = 'prod_vvku2penya08qe' THEN
    v_type := 'bono_inicial';
  ELSIF v_type = 'prod_vdmmlmsggmebt' THEN
    v_type := 'bono_grupal';
  END IF;

  v_credits := CASE
    WHEN v_type IN ('clase_suelta', 'promo_50_clase') THEN 1
    WHEN v_type = 'pack_4' THEN 4
    WHEN v_type = 'pack_6' THEN 6
    WHEN v_type = 'pack_10' THEN 10
    ELSE null
  END;

  v_pack_type := CASE
    WHEN v_type = 'promo_50_clase' THEN 'clase_suelta'
    ELSE v_type
  END;

  v_is_consultation := v_type IN (
    'miriam_psico_individual_1a', 'miriam_psico_individual_sig',
    'miriam_psico_pareja_1a', 'miriam_psico_pareja_sig',
    'silvia_ayurveda_1a', 'silvia_ayurveda_sig',
    'silvia_ayurveda_bono3', 'silvia_ayurveda_bono6',
    'isabel_pni_1a', 'isabel_pni_sig'
  );
  v_is_group := v_type IN (
    'miriam_psico_grupal', 'miriam_grupo_terapeutico', 'miriam_grupo_autoayuda',
    'bono_grupal', 'bonos_grupos'
  );
  v_is_nutrition := v_type LIKE 'silvia_ayurveda%';
  v_is_workshop := v_type IN ('taller_intro_power_vinyasa', 'taller_35', 'taller_25', 'taller')
    OR v_type LIKE '%taller%';
  v_is_dynamic := v_type LIKE 'prod_%' OR v_type LIKE 'price_%';

  IF NOT (
    v_type IN (
      'clase_suelta', 'pack_4', 'pack_6', 'pack_10', 'promo_50_clase',
      'bono_ilimitado', 'bono_mensual', 'bono_inicial', 'clase_especial',
      'miriam_psico_individual_1a', 'miriam_psico_individual_sig',
      'miriam_psico_pareja_1a', 'miriam_psico_pareja_sig',
      'silvia_ayurveda_1a', 'silvia_ayurveda_sig',
      'silvia_ayurveda_bono3', 'silvia_ayurveda_bono6',
      'isabel_pni_1a', 'isabel_pni_sig'
    )
    OR v_is_group
    OR v_is_workshop
    OR v_is_dynamic
  ) THEN
    RAISE EXCEPTION 'Unsupported purchase type: %', v_type USING errcode = '22023';
  END IF;

  IF v_type = 'clase_suelta' AND p_amount_total IS DISTINCT FROM 1500 THEN
    RAISE EXCEPTION 'Invalid single-class amount' USING errcode = '22023';
  ELSIF v_type = 'promo_50_clase' AND p_amount_total IS DISTINCT FROM 750 THEN
    RAISE EXCEPTION 'Invalid promo single-class amount' USING errcode = '22023';
  ELSIF v_type = 'pack_4' AND p_amount_total IS DISTINCT FROM 5000 THEN
    RAISE EXCEPTION 'Invalid four-class pack amount' USING errcode = '22023';
  ELSIF v_type = 'pack_6' AND p_amount_total IS DISTINCT FROM 6500 THEN
    RAISE EXCEPTION 'Invalid six-class pack amount' USING errcode = '22023';
  ELSIF v_type = 'pack_10' AND p_amount_total IS DISTINCT FROM 9500 THEN
    RAISE EXCEPTION 'Invalid ten-class pack amount' USING errcode = '22023';
  ELSIF v_type = 'bono_ilimitado' AND p_amount_total IS DISTINCT FROM 9000 THEN
    RAISE EXCEPTION 'Invalid unlimited-membership amount' USING errcode = '22023';
  ELSIF v_type = 'bono_mensual' AND p_amount_total NOT IN (6500, 9000) THEN
    RAISE EXCEPTION 'Invalid monthly-membership amount: expected 65.00 or 90.00 EUR' USING errcode = '22023';
  ELSIF v_type = 'bono_inicial' AND p_amount_total IS DISTINCT FROM 4000 THEN
    RAISE EXCEPTION 'Invalid initial-membership amount: expected 40.00 EUR' USING errcode = '22023';
  ELSIF v_type = 'clase_especial' AND p_amount_total IS DISTINCT FROM 2000 THEN
    RAISE EXCEPTION 'Invalid special class amount: expected 20.00 EUR' USING errcode = '22023';
  ELSIF (v_is_consultation OR v_is_group OR v_is_workshop OR v_is_dynamic)
        AND (p_amount_total IS NULL OR p_amount_total <= 0) THEN
    RAISE EXCEPTION 'Invalid purchase amount' USING errcode = '22023';
  END IF;

  IF p_is_guest THEN
    IF p_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'Guest purchases must not reference a user ID' USING errcode = '22023';
    END IF;
    IF NOT (
      v_type IN ('clase_suelta', 'promo_50_clase', 'clase_especial')
      OR v_is_consultation
      OR v_is_group
      OR v_is_workshop
      OR v_is_dynamic
    ) THEN
      RAISE EXCEPTION 'Guest purchases cannot receive membership balances' USING errcode = '22023';
    END IF;
  ELSE
    IF p_user_id IS NULL THEN
      RAISE EXCEPTION 'Non-guest purchases require a user ID' USING errcode = '22023';
    END IF;

    SELECT coalesce(account_deletion_requested_at IS NOT NULL, false)
      INTO v_account_deletion_pending
      FROM public.profiles
     WHERE id = p_user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Profile not found' USING errcode = 'P0002';
    END IF;
    IF v_account_deletion_pending THEN
      RAISE EXCEPTION 'Cannot fulfill purchases for accounts pending deletion' USING errcode = '22023';
    END IF;
  END IF;

  IF p_event_created IS NOT NULL AND p_event_created > 0 THEN
    v_purchased_at := to_timestamp(p_event_created);
  ELSE
    v_purchased_at := timezone('utc', now());
  END IF;

  -- 30 días naturales desde la compra para los 3 bonos principales (Bono Inicial, Bono Mensual, Bono Ilimitado)
  IF v_type IN ('bono_ilimitado', 'bono_mensual', 'bono_inicial') THEN
    v_membership_month := date_trunc('month', v_purchased_at AT TIME ZONE 'Europe/Madrid')::date;
    v_membership_start := v_purchased_at;
    v_membership_end := v_purchased_at + interval '30 days';
  ELSIF v_type = 'clase_especial' THEN
    IF nullif(trim(coalesce(p_membership_month, '')), '') IS NOT NULL
       AND trim(p_membership_month) ~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
      v_membership_month := (trim(p_membership_month) || '-01')::date;
    ELSE
      v_membership_month := date_trunc('month', timezone('Europe/Madrid', now()))::date;
    END IF;

    v_membership_start := (v_membership_month::text || ' 00:00:00 Europe/Madrid')::timestamptz;
    v_membership_end := ((v_membership_month + interval '1 month')::date::text || ' 00:00:00 Europe/Madrid')::timestamptz;
  END IF;

  -- Evento primero: stripe_purchases.stripe_event_id tiene FK a esta tabla.
  INSERT INTO public.stripe_webhook_events (
    event_id, event_type, livemode, checkout_session_id, object_id
  ) VALUES (
    v_effective_event_id, p_event_type, true, p_checkout_session_id,
    coalesce(p_subscription_id, p_payment_intent_id, p_checkout_session_id)
  )
  ON CONFLICT (event_id) DO NOTHING;

  INSERT INTO public.stripe_purchases (
    checkout_session_id, stripe_event_id, user_id, is_guest, purchase_type,
    price_id, payment_intent_id, subscription_id, customer_id,
    amount_total, currency, payment_status, membership_month,
    fulfilled_at, created_at, updated_at
  ) VALUES (
    p_checkout_session_id, v_effective_event_id, p_user_id, p_is_guest, v_type,
    p_price_id, p_payment_intent_id, p_subscription_id, p_customer_id,
    p_amount_total, lower(p_currency), p_payment_status, v_membership_month,
    timezone('utc', now()), timezone('utc', now()), timezone('utc', now())
  )
  ON CONFLICT (checkout_session_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 THEN
    SELECT * INTO v_existing
      FROM public.stripe_purchases
     WHERE checkout_session_id = p_checkout_session_id;

    IF v_existing.checkout_session_id IS NULL THEN
      RAISE EXCEPTION 'Could not load existing purchase' USING errcode = 'P0001';
    END IF;

    v_purchased_at := coalesce(v_existing.fulfilled_at, v_existing.created_at, v_purchased_at);
  END IF;

  IF p_is_guest THEN
    NULL;
  ELSE
    -- 1. Packs de clases
    IF v_credits IS NOT NULL THEN
      v_expires_at := v_purchased_at + interval '60 days';

      INSERT INTO public.class_credit_packs (
        user_id, checkout_session_id, pack_type, credits_total,
        credits_remaining, purchased_at, starts_at, expires_at
      ) VALUES (
        p_user_id, p_checkout_session_id, v_pack_type, v_credits,
        v_credits, v_purchased_at, v_purchased_at, v_expires_at
      )
      ON CONFLICT (checkout_session_id) DO NOTHING;

      GET DIAGNOSTICS v_pack_inserted = ROW_COUNT;

      IF v_pack_inserted > 0 THEN
        UPDATE public.profiles
           SET bonos = (
                 SELECT coalesce(sum(credits_remaining), 0)::integer
                   FROM public.class_credit_packs
                  WHERE user_id = p_user_id
                    AND expires_at > timezone('utc', now())
               ),
               stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
               updated_at = timezone('utc', now())
         WHERE id = p_user_id;
      ELSE
        UPDATE public.profiles
           SET stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
               updated_at = timezone('utc', now())
         WHERE id = p_user_id;
      END IF;

    -- 2. Bono Ilimitado (30 días naturales)
    ELSIF v_type = 'bono_ilimitado' THEN
      INSERT INTO public.unlimited_membership_periods (
        user_id, checkout_session_id, membership_month,
        starts_at, ends_at, purchased_at
      ) VALUES (
        p_user_id, p_checkout_session_id, v_membership_month,
        v_membership_start, v_membership_end, v_purchased_at
      )
      ON CONFLICT DO NOTHING;

      GET DIAGNOSTICS v_period_inserted = ROW_COUNT;

      IF v_period_inserted > 0 THEN
        UPDATE public.profiles
           SET bono_mensual_activo = true,
               bono_mensual_inicio = v_membership_start,
               bono_mensual_fin = v_membership_end,
               stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
               updated_at = timezone('utc', now())
         WHERE id = p_user_id
           AND (bono_mensual_fin IS NULL OR bono_mensual_fin < v_membership_end);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.bonos_clases_especiales
         WHERE checkout_session_id = p_checkout_session_id
      ) THEN
        INSERT INTO public.bonos_clases_especiales (
          user_id, mes, saldo, origen, checkout_session_id
        ) VALUES (
          p_user_id, v_membership_month, 1, 'bono_ilimitado', p_checkout_session_id
        );
      END IF;

      UPDATE public.profiles
         SET stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;

    -- 3. Bono Mensual y Bono Inicial (30 días naturales)
    ELSIF v_type IN ('bono_mensual', 'bono_inicial') THEN
      INSERT INTO public.monthly_membership_periods (
        user_id, checkout_session_id, membership_month, starts_at, ends_at,
        max_classes_per_week, plan_type, purchased_at
      ) VALUES (
        p_user_id, p_checkout_session_id, v_membership_month,
        v_membership_start, v_membership_end,
        CASE WHEN v_type = 'bono_inicial' THEN 1 ELSE 2 END,
        v_type, v_purchased_at
      )
      ON CONFLICT (checkout_session_id) DO NOTHING;

      GET DIAGNOSTICS v_period_inserted = ROW_COUNT;

      UPDATE public.profiles
         SET stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;

    -- 4. Clase Especial
    ELSIF v_type = 'clase_especial' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.bonos_clases_especiales
         WHERE checkout_session_id = p_checkout_session_id
      ) THEN
        INSERT INTO public.bonos_clases_especiales (
          user_id, mes, saldo, origen, checkout_session_id
        ) VALUES (
          p_user_id,
          coalesce(v_membership_month, date_trunc('month', timezone('Europe/Madrid', now()))::date),
          1, 'compra_stripe', p_checkout_session_id
        );
      END IF;

      UPDATE public.profiles
         SET stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;

    -- 5. Consultas, grupos y bonos de nutrición
    ELSIF v_is_consultation OR v_is_group THEN
      v_consultation_type := CASE
        WHEN v_is_group THEN 'grupal'
        WHEN v_is_nutrition THEN 'nutricion'
        ELSE 'psicologia'
      END;
      v_consultation_quantity := CASE
        WHEN v_type = 'silvia_ayurveda_bono3' THEN 3
        WHEN v_type = 'silvia_ayurveda_bono6' THEN 6
        ELSE 1
      END;

      INSERT INTO public.consultation_purchases (
        checkout_session_id, user_id, consultation_type, quantity,
        price_id, amount_total, currency, purchased_at, created_at
      ) VALUES (
        p_checkout_session_id, p_user_id, v_consultation_type,
        v_consultation_quantity, p_price_id, p_amount_total, lower(p_currency),
        v_purchased_at, timezone('utc', now())
      )
      ON CONFLICT (checkout_session_id) DO NOTHING;

      GET DIAGNOSTICS v_ledger_inserted = ROW_COUNT;

      IF v_ledger_inserted > 0 THEN
        IF v_is_group THEN
          UPDATE public.profiles
             SET saldo_grupal = coalesce(saldo_grupal, 0) + v_consultation_quantity,
                 stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
                 updated_at = timezone('utc', now())
           WHERE id = p_user_id;
        ELSIF v_is_nutrition THEN
          UPDATE public.profiles
             SET saldo_nutricion = coalesce(saldo_nutricion, 0) + v_consultation_quantity,
                 stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
                 updated_at = timezone('utc', now())
           WHERE id = p_user_id;
        ELSE
          UPDATE public.profiles
             SET saldo_psicologia = coalesce(saldo_psicologia, 0) + v_consultation_quantity,
                 stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
                 updated_at = timezone('utc', now())
           WHERE id = p_user_id;
        END IF;
      ELSE
        UPDATE public.profiles
           SET stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
               updated_at = timezone('utc', now())
         WHERE id = p_user_id;
      END IF;

    -- 6. Talleres y productos dinámicos
    ELSIF v_is_workshop OR v_is_dynamic THEN
      UPDATE public.profiles
         SET stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;
    END IF;

  END IF;

  RETURN jsonb_build_object(
    'status', CASE WHEN v_inserted = 0 THEN 'already_processed' ELSE 'fulfilled' END,
    'purchase_id', p_checkout_session_id,
    'user_id', p_user_id,
    'is_guest', p_is_guest,
    'purchase_type', v_type
  );
END;
$$;

REVOKE ALL ON FUNCTION public.stripe_fulfill_checkout(
  text, text, bigint, text, uuid, boolean, text, text, text, text, text,
  bigint, text, text, text, timestamptz, timestamptz, text, boolean, boolean
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stripe_fulfill_checkout(
  text, text, bigint, text, uuid, boolean, text, text, text, text, text,
  bigint, text, text, text, timestamptz, timestamptz, text, boolean, boolean
) TO service_role;

-- Actualizar limpiar_meses_caducados para respetar la validez de 30 días naturales
CREATE OR REPLACE FUNCTION public.limpiar_meses_caducados()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now timestamptz := now();
  v_current_month_madrid date := date_trunc('month', v_now AT TIME ZONE 'Europe/Madrid')::date;
  v_deleted_unlimited integer := 0;
  v_deleted_monthly integer := 0;
  v_deleted_special integer := 0;
  v_updated_profiles integer := 0;
BEGIN
  -- A. Eliminar periodos de bono ilimitado pasados (ends_at <= now O ends_at NULL y mes anterior)
  WITH del_unlim AS (
    DELETE FROM public.unlimited_membership_periods
     WHERE ends_at <= v_now
        OR (ends_at IS NULL AND membership_month < v_current_month_madrid)
     RETURNING id
  )
  SELECT count(*) INTO v_deleted_unlimited FROM del_unlim;

  -- B. Eliminar periodos de bono mensual / inicial pasados
  WITH del_month AS (
    DELETE FROM public.monthly_membership_periods
     WHERE ends_at <= v_now
        OR (ends_at IS NULL AND membership_month < v_current_month_madrid)
     RETURNING id
  )
  SELECT count(*) INTO v_deleted_monthly FROM del_month;

  -- C. Eliminar bonos de clases especiales de meses pasados (excepto si provienen de bono ilimitado vigente)
  WITH del_spec AS (
    DELETE FROM public.bonos_clases_especiales b
     WHERE b.mes < v_current_month_madrid
       AND NOT (
         b.origen = 'bono_ilimitado'
         AND EXISTS (
           SELECT 1 FROM public.unlimited_membership_periods u
            WHERE u.user_id = b.user_id
              AND u.ends_at > v_now
         )
       )
     RETURNING id
  )
  SELECT count(*) INTO v_deleted_special FROM del_spec;

  -- D. Sincronizar perfiles: desactivar bono_mensual_activo si no tienen periodo vigente
  WITH upd_profiles_off AS (
    UPDATE public.profiles p
       SET bono_mensual_activo = false,
           bono_mensual_inicio = NULL,
           bono_mensual_fin = NULL,
           updated_at = timezone('utc', now())
     WHERE p.bono_mensual_activo = true
       AND NOT EXISTS (
         SELECT 1 FROM public.unlimited_membership_periods u
          WHERE u.user_id = p.id
            AND u.ends_at > v_now
       )
     RETURNING p.id
  )
  SELECT count(*) INTO v_updated_profiles FROM upd_profiles_off;

  -- E. Sincronizar perfiles que sí tienen periodos vigentes para asegurar fechas exactas
  UPDATE public.profiles p
     SET bono_mensual_activo = true,
         bono_mensual_inicio = sub.min_start,
         bono_mensual_fin = sub.max_end,
         updated_at = timezone('utc', now())
    FROM (
      SELECT user_id, min(starts_at) AS min_start, max(ends_at) AS max_end
        FROM public.unlimited_membership_periods
       WHERE ends_at > v_now
       GROUP BY user_id
    ) sub
   WHERE p.id = sub.user_id
     AND (
       p.bono_mensual_activo IS NOT TRUE
       OR p.bono_mensual_inicio IS DISTINCT FROM sub.min_start
       OR p.bono_mensual_fin IS DISTINCT FROM sub.max_end
     );

  RETURN jsonb_build_object(
    'success', true,
    'deleted_unlimited', v_deleted_unlimited,
    'deleted_monthly', v_deleted_monthly,
    'deleted_special', v_deleted_special,
    'updated_profiles', v_updated_profiles,
    'executed_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.limpiar_meses_caducados() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.limpiar_meses_caducados() TO authenticated, service_role;

-- Actualizar admin_asignar_mes_ilimitado para soportar 30 días naturales si es el periodo actual
CREATE OR REPLACE FUNCTION public.admin_asignar_mes_ilimitado(
  p_user_id uuid,
  p_membership_month date,
  p_activo boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_month date;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_is_current boolean := false;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, '')))
    INTO v_actor_role
    FROM public.profiles
   WHERE id = v_actor_id;

  IF NOT FOUND OR v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'Permisos insuficientes para gestionar bonos mensuales.' USING errcode = '42501';
  END IF;

  IF p_user_id IS NULL OR p_activo IS NULL THEN
    RAISE EXCEPTION 'Parámetros no válidos.' USING errcode = '22023';
  END IF;

  PERFORM public.limpiar_meses_caducados();

  v_month := date_trunc('month', coalesce(p_membership_month, (timezone('Europe/Madrid', now()))::date))::date;
  v_is_current := (v_month = date_trunc('month', timezone('Europe/Madrid', now()))::date);

  IF v_is_current THEN
    v_starts_at := timezone('utc', now());
    v_ends_at := timezone('utc', now()) + interval '30 days';
  ELSE
    v_starts_at := (v_month::text || ' 00:00:00 Europe/Madrid')::timestamptz;
    v_ends_at := ((v_month + interval '1 month')::date::text || ' 00:00:00 Europe/Madrid')::timestamptz;
  END IF;

  IF p_activo THEN
    INSERT INTO public.unlimited_membership_periods (
      user_id, membership_month, starts_at, ends_at, purchased_at
    ) VALUES (
      p_user_id, v_month, v_starts_at, v_ends_at, timezone('utc', now())
    )
    ON CONFLICT (user_id, membership_month)
    DO UPDATE SET
      starts_at = EXCLUDED.starts_at,
      ends_at = EXCLUDED.ends_at,
      purchased_at = coalesce(public.unlimited_membership_periods.purchased_at, EXCLUDED.purchased_at);

    UPDATE public.profiles
       SET bono_mensual_activo = true,
           bono_mensual_inicio = (
             SELECT min(starts_at) FROM public.unlimited_membership_periods
              WHERE user_id = p_user_id AND ends_at > timezone('utc', now())
           ),
           bono_mensual_fin = (
             SELECT max(ends_at) FROM public.unlimited_membership_periods
              WHERE user_id = p_user_id AND ends_at > timezone('utc', now())
           ),
           updated_at = timezone('utc', now())
     WHERE id = p_user_id;

    INSERT INTO public.bonos_clases_especiales (
      user_id, mes, saldo, origen
    ) VALUES (
      p_user_id, v_month, 1, 'bono_ilimitado'
    )
    ON CONFLICT (user_id, mes)
    DO UPDATE SET
      saldo = greatest(public.bonos_clases_especiales.saldo, 1),
      updated_at = timezone('utc', now());
  ELSE
    DELETE FROM public.unlimited_membership_periods
     WHERE user_id = p_user_id
       AND (membership_month = v_month OR (ends_at > v_starts_at AND starts_at < v_ends_at));

    UPDATE public.profiles
       SET bono_mensual_activo = (
             EXISTS (
               SELECT 1 FROM public.unlimited_membership_periods
                WHERE user_id = p_user_id AND ends_at > timezone('utc', now())
             )
           ),
           bono_mensual_inicio = (
             SELECT min(starts_at) FROM public.unlimited_membership_periods
              WHERE user_id = p_user_id AND ends_at > timezone('utc', now())
           ),
           bono_mensual_fin = (
             SELECT max(ends_at) FROM public.unlimited_membership_periods
              WHERE user_id = p_user_id AND ends_at > timezone('utc', now())
           ),
           updated_at = timezone('utc', now())
     WHERE id = p_user_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_asignar_mes_ilimitado(uuid, date, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_asignar_mes_ilimitado(uuid, date, boolean) TO authenticated, service_role;

-- Actualizar admin_asignar_mes_bono_inicial para soportar 30 días naturales si es el periodo actual
CREATE OR REPLACE FUNCTION public.admin_asignar_mes_bono_inicial(
  p_user_id uuid,
  p_membership_month date,
  p_activo boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_month date;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_is_current boolean := false;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, '')))
    INTO v_actor_role
    FROM public.profiles
   WHERE id = v_actor_id;

  IF NOT FOUND OR v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'Permisos insuficientes para gestionar bonos mensuales.' USING errcode = '42501';
  END IF;

  IF p_user_id IS NULL OR p_activo IS NULL THEN
    RAISE EXCEPTION 'Parámetros no válidos.' USING errcode = '22023';
  END IF;

  PERFORM public.limpiar_meses_caducados();

  v_month := date_trunc('month', coalesce(p_membership_month, (timezone('Europe/Madrid', now()))::date))::date;
  v_is_current := (v_month = date_trunc('month', timezone('Europe/Madrid', now()))::date);

  IF v_is_current THEN
    v_starts_at := timezone('utc', now());
    v_ends_at := timezone('utc', now()) + interval '30 days';
  ELSE
    v_starts_at := (v_month::text || ' 00:00:00 Europe/Madrid')::timestamptz;
    v_ends_at := ((v_month + interval '1 month')::date::text || ' 00:00:00 Europe/Madrid')::timestamptz;
  END IF;

  IF p_activo THEN
    INSERT INTO public.monthly_membership_periods (
      user_id, membership_month, starts_at, ends_at, max_classes_per_week, plan_type, purchased_at
    ) VALUES (
      p_user_id, v_month, v_starts_at, v_ends_at, 1, 'bono_inicial', timezone('utc', now())
    );
  ELSE
    DELETE FROM public.monthly_membership_periods
     WHERE user_id = p_user_id
       AND plan_type = 'bono_inicial'
       AND (membership_month = v_month OR (ends_at > v_starts_at AND starts_at < v_ends_at));
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_asignar_mes_bono_inicial(uuid, date, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_asignar_mes_bono_inicial(uuid, date, boolean) TO authenticated, service_role;

-- Actualizar admin_asignar_mes_bono_mensual para soportar 30 días naturales si es el periodo actual
CREATE OR REPLACE FUNCTION public.admin_asignar_mes_bono_mensual(
  p_user_id uuid,
  p_membership_month date,
  p_activo boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_month date;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_is_current boolean := false;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, '')))
    INTO v_actor_role
    FROM public.profiles
   WHERE id = v_actor_id;

  IF NOT FOUND OR v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'Permisos insuficientes para gestionar bonos mensuales.' USING errcode = '42501';
  END IF;

  IF p_user_id IS NULL OR p_activo IS NULL THEN
    RAISE EXCEPTION 'Parámetros no válidos.' USING errcode = '22023';
  END IF;

  PERFORM public.limpiar_meses_caducados();

  v_month := date_trunc('month', coalesce(p_membership_month, (timezone('Europe/Madrid', now()))::date))::date;
  v_is_current := (v_month = date_trunc('month', timezone('Europe/Madrid', now()))::date);

  IF v_is_current THEN
    v_starts_at := timezone('utc', now());
    v_ends_at := timezone('utc', now()) + interval '30 days';
  ELSE
    v_starts_at := (v_month::text || ' 00:00:00 Europe/Madrid')::timestamptz;
    v_ends_at := ((v_month + interval '1 month')::date::text || ' 00:00:00 Europe/Madrid')::timestamptz;
  END IF;

  IF p_activo THEN
    INSERT INTO public.monthly_membership_periods (
      user_id, membership_month, starts_at, ends_at, max_classes_per_week, plan_type, purchased_at
    ) VALUES (
      p_user_id, v_month, v_starts_at, v_ends_at, 2, 'bono_mensual', timezone('utc', now())
    );
  ELSE
    DELETE FROM public.monthly_membership_periods
     WHERE user_id = p_user_id
       AND plan_type = 'bono_mensual'
       AND (membership_month = v_month OR (ends_at > v_starts_at AND starts_at < v_ends_at));
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_asignar_mes_bono_mensual(uuid, date, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_asignar_mes_bono_mensual(uuid, date, boolean) TO authenticated, service_role;

COMMIT;

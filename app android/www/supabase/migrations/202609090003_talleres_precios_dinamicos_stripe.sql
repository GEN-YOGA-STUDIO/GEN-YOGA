-- ============================================================================
-- MIGRACIÓN: Soporte de Precios Dinámicos de Stripe para Talleres
-- FECHA: 2026-09-09
-- ============================================================================

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
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted integer := 0;
  v_existing public.stripe_purchases%ROWTYPE;
  v_pack_credits integer := null;
  v_pack_record_type text := null;
  v_purchased_at timestamptz;
  v_account_deletion_pending boolean;
  v_membership_month date := null;
  v_membership_start timestamptz := null;
  v_membership_end timestamptz := null;
  v_normalized_purchase_type text := p_purchase_type;
  v_effective_event_id text;
  v_target_month date;
BEGIN
  -- Validaciones básicas de entorno y parámetros requeridos
  IF p_livemode IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Only LIVE Stripe events are accepted' USING errcode = '22023';
  END IF;
  IF nullif(trim(p_checkout_session_id), '') IS NULL
    OR nullif(trim(p_price_id), '') IS NULL
    OR p_event_type IS DISTINCT FROM 'checkout.session.completed' THEN
    RAISE EXCEPTION 'Missing Stripe identifiers' USING errcode = '22023';
  END IF;
  IF p_payment_status IS DISTINCT FROM 'paid' OR lower(p_currency) IS DISTINCT FROM 'eur' THEN
    RAISE EXCEPTION 'Checkout is not a paid EUR session' USING errcode = '22023';
  END IF;

  v_effective_event_id := coalesce(nullif(trim(p_event_id), ''), 'evt_' || p_checkout_session_id);

  -- Normalización de tipo de compra si viene como alias promocional
  IF p_purchase_type IN ('promo_50', 'promo') THEN
    v_normalized_purchase_type := 'promo_50_clase';
  END IF;

  -- Mapeo de créditos de clases para packs
  v_pack_credits := CASE v_normalized_purchase_type
    WHEN 'clase_suelta' THEN 1
    WHEN 'promo_50_clase' THEN 1
    WHEN 'pack_4' THEN 4
    WHEN 'pack_6' THEN 6
    WHEN 'pack_10' THEN 10
    ELSE null
  END;

  v_pack_record_type := CASE
    WHEN v_normalized_purchase_type = 'promo_50_clase' THEN 'clase_suelta'
    ELSE v_normalized_purchase_type
  END;

  -- Manejo de mes de membresía para bonos ilimitados y clases especiales
  IF v_normalized_purchase_type IN ('bono_ilimitado', 'clase_especial') THEN
    IF nullif(trim(coalesce(p_membership_month, '')), '') IS NOT NULL
       AND trim(p_membership_month) ~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
      v_membership_month := (trim(p_membership_month) || '-01')::date;
    ELSE
      v_membership_month := date_trunc('month', timezone('Europe/Madrid', now()))::date;
    END IF;

    v_membership_start := (v_membership_month::text || ' 00:00:00 Europe/Madrid')::timestamptz;
    v_membership_end := ((v_membership_month + interval '1 month')::date::text || ' 00:00:00 Europe/Madrid')::timestamptz;
  END IF;

  -- Validación de importes exactos en céntimos (evita discrepancias)
  IF v_normalized_purchase_type = 'clase_suelta' AND p_amount_total IS DISTINCT FROM 1500 THEN
    RAISE EXCEPTION 'Invalid single-class amount' USING errcode = '22023';
  ELSIF v_normalized_purchase_type = 'promo_50_clase' AND p_amount_total IS DISTINCT FROM 750 THEN
    RAISE EXCEPTION 'Invalid promo single-class amount' USING errcode = '22023';
  ELSIF v_normalized_purchase_type = 'pack_4' AND p_amount_total IS DISTINCT FROM 5000 THEN
    RAISE EXCEPTION 'Invalid four-class pack amount' USING errcode = '22023';
  ELSIF v_normalized_purchase_type = 'pack_6' AND p_amount_total IS DISTINCT FROM 6500 THEN
    RAISE EXCEPTION 'Invalid six-class pack amount' USING errcode = '22023';
  ELSIF v_normalized_purchase_type = 'pack_10' AND p_amount_total IS DISTINCT FROM 9500 THEN
    RAISE EXCEPTION 'Invalid ten-class pack amount' USING errcode = '22023';
  ELSIF v_normalized_purchase_type IN ('bono_ilimitado', 'bono_mensual') AND p_amount_total IS DISTINCT FROM 9000 THEN
    RAISE EXCEPTION 'Invalid unlimited-membership amount' USING errcode = '22023';
  ELSIF v_normalized_purchase_type = 'clase_especial' AND p_amount_total IS DISTINCT FROM 2000 THEN
    RAISE EXCEPTION 'Invalid special class amount: expected 20.00 EUR' USING errcode = '22023';
  ELSIF v_normalized_purchase_type IN ('taller_intro_power_vinyasa', 'taller_35', 'taller_25', 'taller')
        OR v_normalized_purchase_type LIKE '%taller%' THEN
    -- Validación dinámica y tolerante para talleres: admite cualquier importe oficial positivo configurado en Stripe (ej. 2500 o 3500)
    IF p_amount_total IS NULL OR p_amount_total <= 0 THEN
      RAISE EXCEPTION 'Invalid workshop amount' USING errcode = '22023';
    END IF;
  END IF;

  -- Comprobación de usuario / invitado
  IF p_is_guest THEN
    IF p_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'Guest purchases must not reference a user ID' USING errcode = '22023';
    END IF;
  ELSE
    IF p_user_id IS NULL THEN
      RAISE EXCEPTION 'Non-guest purchases require a user ID' USING errcode = '22023';
    END IF;

    SELECT account_deletion_requested_at IS NOT NULL
      INTO v_account_deletion_pending
      FROM public.profiles
     WHERE id = p_user_id;

    IF v_account_deletion_pending IS TRUE THEN
      RAISE EXCEPTION 'Cannot fulfill purchases for accounts pending deletion' USING errcode = '22023';
    END IF;
  END IF;

  -- Fecha de compra
  IF p_event_created IS NOT NULL AND p_event_created > 0 THEN
    v_purchased_at := to_timestamp(p_event_created);
  ELSE
    v_purchased_at := timezone('utc', now());
  END IF;

  -- CRÍTICO: Registrar primero el evento en stripe_webhook_events para satisfacer la FK
  INSERT INTO public.stripe_webhook_events (
    event_id, event_type, livemode, checkout_session_id, object_id
  ) VALUES (
    v_effective_event_id, p_event_type, true, p_checkout_session_id,
    coalesce(p_subscription_id, p_payment_intent_id, p_checkout_session_id)
  )
  ON CONFLICT (event_id) DO NOTHING;

  -- Registrar la compra en stripe_purchases con sus columnas canónicas exactas
  INSERT INTO public.stripe_purchases (
    checkout_session_id, stripe_event_id, user_id, is_guest, purchase_type,
    price_id, payment_intent_id, subscription_id, customer_id,
    amount_total, currency, payment_status, membership_month,
    fulfilled_at, created_at, updated_at
  ) VALUES (
    p_checkout_session_id, v_effective_event_id, p_user_id, p_is_guest,
    v_normalized_purchase_type, p_price_id, p_payment_intent_id,
    p_subscription_id, p_customer_id, p_amount_total, lower(p_currency),
    p_payment_status, v_membership_month, timezone('utc', now()),
    timezone('utc', now()), timezone('utc', now())
  )
  ON CONFLICT (checkout_session_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Si la sesión ya existía en stripe_purchases, asegurar que sus créditos se asignaron (autorreparación)
  IF v_inserted = 0 THEN
    SELECT * INTO v_existing
      FROM public.stripe_purchases
     WHERE checkout_session_id = p_checkout_session_id;

    IF NOT p_is_guest AND p_user_id IS NOT NULL AND v_pack_credits IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.class_credit_packs WHERE checkout_session_id = p_checkout_session_id) THEN
        INSERT INTO public.class_credit_packs (
          user_id, checkout_session_id, pack_type, credits_total,
          credits_remaining, purchased_at, expires_at
        ) VALUES (
          p_user_id, p_checkout_session_id, v_pack_record_type,
          v_pack_credits, v_pack_credits, v_purchased_at, v_purchased_at + interval '60 days'
        )
        ON CONFLICT (checkout_session_id) DO NOTHING;

        UPDATE public.profiles
           SET bonos = coalesce(bonos, 0) + v_pack_credits,
               stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
               updated_at = timezone('utc', now())
         WHERE id = p_user_id;
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'status', 'already_processed',
      'purchase_id', v_existing.checkout_session_id,
      'user_id', v_existing.user_id,
      'is_guest', v_existing.is_guest,
      'purchase_type', v_existing.purchase_type
    );
  END IF;

  -- Si la compra es nueva y para un alumno registrado, consolidar según el tipo
  IF NOT p_is_guest AND p_user_id IS NOT NULL THEN

    -- 1. Clases regulares (Packs y Sueltas)
    IF v_pack_credits IS NOT NULL THEN
      -- Aumentar saldo directo en profiles.bonos
      UPDATE public.profiles
         SET bonos = coalesce(bonos, 0) + v_pack_credits,
             stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             descuento_promo_50_activo = CASE WHEN v_normalized_purchase_type = 'promo_50_clase' THEN false ELSE descuento_promo_50_activo END,
             codigo_promo_usado = CASE WHEN v_normalized_purchase_type = 'promo_50_clase' THEN true ELSE codigo_promo_usado END,
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;

      -- Crear pack en class_credit_packs
      INSERT INTO public.class_credit_packs (
        user_id, checkout_session_id, pack_type, credits_total,
        credits_remaining, purchased_at, expires_at
      ) VALUES (
        p_user_id, p_checkout_session_id, v_pack_record_type,
        v_pack_credits, v_pack_credits, v_purchased_at, v_purchased_at + interval '60 days'
      )
      ON CONFLICT (checkout_session_id) DO NOTHING;

    -- 2. Bono Ilimitado (mes natural)
    ELSIF v_normalized_purchase_type = 'bono_ilimitado' THEN
      INSERT INTO public.unlimited_membership_periods (
        user_id, checkout_session_id, membership_month,
        starts_at, ends_at, purchased_at
      ) VALUES (
        p_user_id, p_checkout_session_id, v_membership_month,
        v_membership_start, v_membership_end, v_purchased_at
      )
      ON CONFLICT (checkout_session_id) DO NOTHING;

      UPDATE public.profiles
         SET bono_mensual_activo = true,
             bono_mensual_inicio = v_membership_start,
             bono_mensual_fin = v_membership_end,
             stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id
         AND (bono_mensual_fin IS NULL OR bono_mensual_fin < v_membership_end);

      INSERT INTO public.bonos_clases_especiales (
        user_id, mes, saldo, origen, checkout_session_id
      ) VALUES (
        p_user_id, v_membership_month, 1, 'bono_ilimitado', p_checkout_session_id
      )
      ON CONFLICT DO NOTHING;

    -- 3. Clase Especial
    ELSIF v_normalized_purchase_type = 'clase_especial' THEN
      v_target_month := coalesce(v_membership_month, date_trunc('month', timezone('Europe/Madrid', now()))::date);
      INSERT INTO public.bonos_clases_especiales (
        user_id, mes, saldo, origen, checkout_session_id
      ) VALUES (
        p_user_id, v_target_month, 1, 'compra_stripe', p_checkout_session_id
      )
      ON CONFLICT DO NOTHING;

      UPDATE public.profiles
         SET stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;

    -- 4. Consultas Psicología (Miriam)
    ELSIF v_normalized_purchase_type IN (
      'miriam_psico_individual_1a', 'miriam_psico_individual_sig',
      'miriam_psico_pareja_1a', 'miriam_psico_pareja_sig',
      'isabel_pni_1a', 'isabel_pni_sig',
      'prod_VDmmlmsGGhMebt'
    ) OR v_normalized_purchase_type LIKE '%psico%' OR v_normalized_purchase_type LIKE '%miriam%' THEN
      UPDATE public.profiles
         SET saldo_psicologia = coalesce(saldo_psicologia, 0) + 1,
             stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;

    -- 5. Consultas Nutrición / Ayurveda (Silvia)
    ELSIF v_normalized_purchase_type IN ('silvia_ayurveda_1a', 'silvia_ayurveda_sig') THEN
      UPDATE public.profiles
         SET saldo_nutricion = coalesce(saldo_nutricion, 0) + 1,
             stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;
    ELSIF v_normalized_purchase_type = 'silvia_ayurveda_bono3' THEN
      UPDATE public.profiles
         SET saldo_nutricion = coalesce(saldo_nutricion, 0) + 3,
             stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;
    ELSIF v_normalized_purchase_type = 'silvia_ayurveda_bono6' THEN
      UPDATE public.profiles
         SET saldo_nutricion = coalesce(saldo_nutricion, 0) + 6,
             stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;

    -- 6. Talleres
    ELSIF v_normalized_purchase_type IN ('taller_intro_power_vinyasa', 'taller_35', 'taller_25', 'taller')
          OR v_normalized_purchase_type LIKE '%taller%' THEN
      UPDATE public.profiles
         SET stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;

    -- 7. Productos dinámicos basados en Stripe prod_*
    ELSIF v_normalized_purchase_type LIKE 'prod_%' THEN
      UPDATE public.profiles
         SET stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;
    END IF;

  END IF;

  RETURN jsonb_build_object(
    'status', 'fulfilled',
    'purchase_id', p_checkout_session_id,
    'user_id', p_user_id,
    'is_guest', p_is_guest,
    'purchase_type', v_normalized_purchase_type,
    'pack_credits', v_pack_credits
  );
END;
$$;

REVOKE ALL ON FUNCTION public.stripe_fulfill_checkout(text, text, bigint, text, uuid, boolean, text, text, text, text, text, bigint, text, text, text, timestamptz, timestamptz, text, boolean, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.stripe_fulfill_checkout(text, text, bigint, text, uuid, boolean, text, text, text, text, text, bigint, text, text, text, timestamptz, timestamptz, text, boolean, boolean) TO service_role, anon, authenticated;

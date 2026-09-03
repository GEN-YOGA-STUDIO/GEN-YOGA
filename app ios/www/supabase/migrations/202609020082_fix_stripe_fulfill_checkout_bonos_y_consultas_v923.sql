-- ==============================================================================
-- Migración 202609020082: Reparar fulfillment de Stripe para todas las compras
-- Versión: 9.23
-- Descripción:
--   1. Corrige los nombres de columna en public.stripe_purchases (checkout_session_id,
--      price_id, etc.) y public.class_credit_packs (checkout_session_id).
--   2. Asigna automáticamente los créditos correspondientes en profiles.bonos
--      al comprar cualquier pack de clases (pack 4, pack 6, pack 10, clase suelta,
--      promo 50%), permitiendo visibilidad y gestión inmediata tanto en el perfil
--      del usuario como en el panel de administración.
--   3. Restaura el fulfillment automático para todas las consultas:
--      - Psicoterapia Miriam e Isabel PNI -> profiles.saldo_psicologia
--      - Nutrición / Ayurveda Silvia (individual, bono 3 y bono 6) -> profiles.saldo_nutricion
--   4. Soporta talleres y clases especiales -> profiles.bonos
--   5. Garantiza permisos de ejecución en PostgREST (anon, authenticated, service_role)
--      y recarga el schema cache.
-- ==============================================================================

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
  v_profile_updated integer := 0;
  v_existing public.stripe_purchases%ROWTYPE;
  v_pack_credits integer := null;
  v_purchased_at timestamptz;
  v_account_deletion_pending boolean;
  v_membership_month date := null;
  v_membership_start timestamptz := null;
  v_membership_end timestamptz := null;
  v_current_month date;
  v_normalized_purchase_type text := p_purchase_type;
BEGIN
  IF p_livemode IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Only LIVE Stripe events are accepted' USING errcode = '22023';
  END IF;
  IF nullif(trim(p_event_id), '') IS NULL
    OR nullif(trim(p_checkout_session_id), '') IS NULL
    OR nullif(trim(p_price_id), '') IS NULL
    OR p_event_type IS DISTINCT FROM 'checkout.session.completed'
    OR p_event_created IS NULL OR p_event_created <= 0 THEN
    RAISE EXCEPTION 'Missing Stripe identifiers' USING errcode = '22023';
  END IF;
  IF p_payment_status IS DISTINCT FROM 'paid' OR lower(p_currency) IS DISTINCT FROM 'eur' THEN
    RAISE EXCEPTION 'Checkout is not a paid EUR session' USING errcode = '22023';
  END IF;

  -- Normalización de alias promocionales
  IF p_purchase_type IN ('promo_50', 'promo') THEN
    v_normalized_purchase_type := 'promo_50_clase';
  END IF;

  -- Créditos de clases regulares de Yoga
  v_pack_credits := CASE v_normalized_purchase_type
    WHEN 'clase_suelta' THEN 1
    WHEN 'promo_50_clase' THEN 1
    WHEN 'pack_4' THEN 4
    WHEN 'pack_6' THEN 6
    WHEN 'pack_10' THEN 10
    ELSE null
  END;

  IF v_normalized_purchase_type = 'bono_ilimitado' THEN
    IF nullif(trim(coalesce(p_membership_month, '')), '') IS NULL
      OR trim(p_membership_month) !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
      RAISE EXCEPTION 'Unlimited checkout lacks a valid calendar month'
        USING errcode = '22023';
    END IF;
    v_membership_month := (trim(p_membership_month) || '-01')::date;
    v_current_month := date_trunc('month', timezone('Europe/Madrid', now()))::date;
    IF v_membership_month < v_current_month
      OR v_membership_month > (v_current_month + interval '11 months')::date THEN
      RAISE EXCEPTION 'Unlimited calendar month is outside the allowed purchase window'
        USING errcode = '22023';
    END IF;
    v_membership_start := (v_membership_month::text || ' 00:00:00 Europe/Madrid')::timestamptz;
    v_membership_end := ((v_membership_month + interval '1 month')::date::text || ' 00:00:00 Europe/Madrid')::timestamptz;
  END IF;

  IF p_is_guest THEN
    IF p_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'Guest purchases must not reference a user ID' USING errcode = '22023';
    END IF;
    IF v_normalized_purchase_type NOT IN (
      'clase_suelta',
      'miriam_psico_individual_1a',
      'miriam_psico_individual_sig',
      'miriam_psico_pareja_1a',
      'miriam_psico_pareja_sig',
      'silvia_ayurveda_1a',
      'silvia_ayurveda_sig',
      'silvia_ayurveda_bono3',
      'silvia_ayurveda_bono6',
      'isabel_pni_1a',
      'isabel_pni_sig',
      'clase_especial',
      'taller_intro_power_vinyasa'
    ) THEN
      RAISE EXCEPTION 'Purchase type is not allowed for guest checkouts' USING errcode = '22023';
    END IF;
  ELSE
    IF p_user_id IS NULL THEN
      RAISE EXCEPTION 'Authenticated purchases must reference a user ID' USING errcode = '22023';
    END IF;
    SELECT account_deletion_pending
      INTO v_account_deletion_pending
      FROM public.profiles
     WHERE id = p_user_id
     FOR UPDATE;
    IF NOT found THEN
      RAISE EXCEPTION 'User profile not found' USING errcode = '22023';
    END IF;
    IF coalesce(v_account_deletion_pending, false) THEN
      RAISE EXCEPTION 'Cannot fulfill purchases for accounts pending deletion' USING errcode = '22023';
    END IF;
  END IF;

  -- Idempotencia: comprobar si la sesión de Stripe ya fue procesada
  SELECT *
    INTO v_existing
    FROM public.stripe_purchases
   WHERE checkout_session_id = p_checkout_session_id
   LIMIT 1;

  IF found THEN
    RETURN jsonb_build_object(
      'status', 'already_processed',
      'purchase_id', v_existing.checkout_session_id,
      'user_id', v_existing.user_id,
      'is_guest', v_existing.is_guest,
      'purchase_type', v_existing.purchase_type
    );
  END IF;

  -- Registrar compra en stripe_purchases
  INSERT INTO public.stripe_purchases (
    checkout_session_id,
    stripe_event_id,
    user_id,
    is_guest,
    purchase_type,
    price_id,
    payment_intent_id,
    subscription_id,
    customer_id,
    amount_total,
    currency,
    payment_status,
    membership_month,
    fulfilled_at,
    created_at,
    updated_at
  ) VALUES (
    p_checkout_session_id,
    p_event_id,
    p_user_id,
    p_is_guest,
    v_normalized_purchase_type,
    p_price_id,
    p_payment_intent_id,
    p_subscription_id,
    p_customer_id,
    p_amount_total,
    lower(p_currency),
    p_payment_status,
    p_membership_month,
    now(),
    now(),
    now()
  );
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  v_purchased_at := to_timestamp(p_event_created);

  -- Si es un usuario autenticado, acreditar saldo en base de datos
  IF NOT p_is_guest AND p_user_id IS NOT NULL THEN

    -- 1. Clases regulares (packs de 4, 6, 10, clase suelta y promo 50%)
    IF v_pack_credits IS NOT NULL THEN
      -- Acreditar inmediatamente en profiles.bonos para visibilidad total en panel admin y app
      UPDATE public.profiles
         SET bonos = coalesce(bonos, 0) + v_pack_credits,
             stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             descuento_promo_50_activo = CASE WHEN v_normalized_purchase_type = 'promo_50_clase' THEN false ELSE descuento_promo_50_activo END,
             codigo_promo_usado = CASE WHEN v_normalized_purchase_type = 'promo_50_clase' THEN true ELSE codigo_promo_usado END,
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;
      GET DIAGNOSTICS v_profile_updated = ROW_COUNT;

      -- Registrar en class_credit_packs para control de caducidad a 60 días
      INSERT INTO public.class_credit_packs (
        user_id,
        checkout_session_id,
        pack_type,
        credits_total,
        credits_remaining,
        purchased_at,
        expires_at
      ) VALUES (
        p_user_id,
        p_checkout_session_id,
        v_normalized_purchase_type,
        v_pack_credits,
        v_pack_credits,
        v_purchased_at,
        v_purchased_at + interval '60 days'
      )
      ON CONFLICT (checkout_session_id) DO NOTHING;

    -- 2. Bono Ilimitado (mes natural)
    ELSIF v_normalized_purchase_type = 'bono_ilimitado' THEN
      INSERT INTO public.unlimited_membership_periods (
        user_id,
        checkout_session_id,
        membership_month,
        starts_at,
        ends_at,
        purchased_at
      ) VALUES (
        p_user_id,
        p_checkout_session_id,
        v_membership_month,
        v_membership_start,
        v_membership_end,
        v_purchased_at
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
      GET DIAGNOSTICS v_profile_updated = ROW_COUNT;

    -- 3. Suscripción Mensual
    ELSIF v_normalized_purchase_type = 'bono_mensual' THEN
      UPDATE public.profiles
         SET bono_mensual_activo = true,
             stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             stripe_subscription_status = coalesce(p_subscription_status, 'active'),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;
      GET DIAGNOSTICS v_profile_updated = ROW_COUNT;

    -- 4. Consultas Psicoterapia Miriam & PNI Isabel
    ELSIF v_normalized_purchase_type IN (
      'miriam_psico_individual_1a',
      'miriam_psico_individual_sig',
      'miriam_psico_pareja_1a',
      'miriam_psico_pareja_sig',
      'isabel_pni_1a',
      'isabel_pni_sig'
    ) THEN
      UPDATE public.profiles
         SET saldo_psicologia = coalesce(saldo_psicologia, 0) + 1,
             stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;
      GET DIAGNOSTICS v_profile_updated = ROW_COUNT;

    -- 5. Consultas Ayurveda Silvia (individuales)
    ELSIF v_normalized_purchase_type IN (
      'silvia_ayurveda_1a',
      'silvia_ayurveda_sig'
    ) THEN
      UPDATE public.profiles
         SET saldo_nutricion = coalesce(saldo_nutricion, 0) + 1,
             stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;
      GET DIAGNOSTICS v_profile_updated = ROW_COUNT;

    -- 6. Bono 3 Consultas Ayurveda Silvia
    ELSIF v_normalized_purchase_type = 'silvia_ayurveda_bono3' THEN
      UPDATE public.profiles
         SET saldo_nutricion = coalesce(saldo_nutricion, 0) + 3,
             stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;
      GET DIAGNOSTICS v_profile_updated = ROW_COUNT;

    -- 7. Bono 6 Consultas Ayurveda Silvia
    ELSIF v_normalized_purchase_type = 'silvia_ayurveda_bono6' THEN
      UPDATE public.profiles
         SET saldo_nutricion = coalesce(saldo_nutricion, 0) + 6,
             stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;
      GET DIAGNOSTICS v_profile_updated = ROW_COUNT;

    -- 8. Clases Especiales y Talleres
    ELSIF v_normalized_purchase_type IN ('clase_especial', 'taller_intro_power_vinyasa') THEN
      UPDATE public.profiles
         SET bonos = coalesce(bonos, 0) + 1,
             stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;
      GET DIAGNOSTICS v_profile_updated = ROW_COUNT;

    ELSE
      UPDATE public.profiles
         SET stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;
      GET DIAGNOSTICS v_profile_updated = ROW_COUNT;
    END IF;

  END IF;

  RETURN jsonb_build_object(
    'status', 'fulfilled',
    'inserted', v_inserted,
    'profile_updated', v_profile_updated,
    'user_id', p_user_id,
    'is_guest', p_is_guest,
    'purchase_type', v_normalized_purchase_type,
    'pack_credits', v_pack_credits,
    'membership_month', v_membership_month
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.stripe_fulfill_checkout(
  text, text, bigint, text, uuid, boolean, text, text, text, text, text, bigint, text, text, text, timestamptz, timestamptz, text, boolean, boolean
) TO anon, authenticated, service_role;

-- Reconciliación retroactiva: si algún usuario tiene packs activos con créditos restantes
-- pero su saldo directo en profiles.bonos estaba en 0 debido al fallo, restaurar su saldo
UPDATE public.profiles p
   SET bonos = coalesce(p.bonos, 0) + c.total_restante
  FROM (
    SELECT user_id, sum(credits_remaining) AS total_restante
      FROM public.class_credit_packs
     WHERE credits_remaining > 0
       AND expires_at > now()
     GROUP BY user_id
  ) c
 WHERE p.id = c.user_id
   AND coalesce(p.bonos, 0) = 0;

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';

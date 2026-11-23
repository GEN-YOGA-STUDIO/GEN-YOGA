-- Migration: 202611240001_fix_fulfillment_conflictos_y_taller_formacion.sql
-- Fecha: 24 nov 2026 — AUDITORÍA DE PAGOS
--
-- Corrige tres fallos que podían dejar un cobro confirmado sin entrega:
--   1) bonos_clases_especiales tiene UNIQUE (user_id, mes) y el fulfillment
--      insertaba sin ON CONFLICT: una violación 23505 revertía TODA la RPC
--      (compra, periodo y evento), con webhook 500 en bucle.
--   2) El Taller de formación (prod_VcUrMnsweZMxrl, 10 €) caía en la rama
--      "producto dinámico", que solo guarda stripe_customer_id: sin saldo.
--   3) Mantiene la salvaguarda de 202611230002 (vincula el periodo manual al
--      checkout para no duplicar el bono al reenviar eventos antiguos).
--
-- Idempotente: reemplaza la función completa; los INSERT usan ON CONFLICT.

BEGIN;

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
  v_manual_linked integer := 0;
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

  v_pack_type := CASE WHEN v_type = 'promo_50_clase' THEN 'clase_suelta' ELSE v_type END;

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
    OR v_type LIKE '%taller%'
    OR v_type = 'prod_vcurmnswezmxrl'; -- Taller de formación (10 €)
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
    OR v_is_group OR v_is_workshop OR v_is_dynamic
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
      OR v_is_consultation OR v_is_group OR v_is_workshop OR v_is_dynamic
    ) THEN
      RAISE EXCEPTION 'Guest purchases cannot receive membership balances' USING errcode = '22023';
    END IF;
  ELSE
    IF p_user_id IS NULL THEN
      RAISE EXCEPTION 'Non-guest purchases require a user ID' USING errcode = '22023';
    END IF;
    SELECT coalesce(account_deletion_requested_at IS NOT NULL, false)
      INTO v_account_deletion_pending
      FROM public.profiles WHERE id = p_user_id;
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
      FROM public.stripe_purchases WHERE checkout_session_id = p_checkout_session_id;
    IF v_existing.checkout_session_id IS NULL THEN
      RAISE EXCEPTION 'Could not load existing purchase' USING errcode = 'P0001';
    END IF;
    v_purchased_at := coalesce(v_existing.fulfilled_at, v_existing.created_at, v_purchased_at);
  END IF;

  IF p_is_guest THEN
    NULL;
  ELSE
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
                  WHERE user_id = p_user_id AND expires_at > timezone('utc', now())
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

    ELSIF v_type = 'bono_ilimitado' THEN
      INSERT INTO public.unlimited_membership_periods (
        user_id, checkout_session_id, membership_month, starts_at, ends_at, purchased_at
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
        )
        ON CONFLICT (user_id, mes) DO UPDATE
           SET saldo = GREATEST(public.bonos_clases_especiales.saldo, 1),
               checkout_session_id = coalesce(
                 public.bonos_clases_especiales.checkout_session_id, EXCLUDED.checkout_session_id
               ),
               updated_at = timezone('utc', now());
      END IF;

      UPDATE public.profiles
         SET stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;

    ELSIF v_type IN ('bono_mensual', 'bono_inicial') THEN
      -- NUEVO: si el bono ya se asignó a mano hoy para este mismo cobro, vincular
      -- ese periodo en vez de crear uno duplicado.
      UPDATE public.monthly_membership_periods mp
         SET checkout_session_id = p_checkout_session_id,
             purchased_at = v_purchased_at,
             membership_month = v_membership_month
       WHERE mp.id = (
         SELECT mp2.id
           FROM public.monthly_membership_periods mp2
          WHERE mp2.user_id = p_user_id
            AND mp2.plan_type = v_type
            AND mp2.checkout_session_id IS NULL
            AND (mp2.starts_at AT TIME ZONE 'Europe/Madrid')::date
                = (v_purchased_at AT TIME ZONE 'Europe/Madrid')::date
            AND mp2.ends_at > timezone('utc', now())
          ORDER BY mp2.id
          LIMIT 1
       );
      GET DIAGNOSTICS v_manual_linked = ROW_COUNT;

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
        )
        ON CONFLICT (user_id, mes) DO UPDATE
           SET saldo = GREATEST(public.bonos_clases_especiales.saldo, 1) + 1,
               origen = CASE
                 WHEN public.bonos_clases_especiales.origen = 'bono_ilimitado'
                   THEN public.bonos_clases_especiales.origen
                 ELSE EXCLUDED.origen
               END,
               checkout_session_id = coalesce(
                 public.bonos_clases_especiales.checkout_session_id, EXCLUDED.checkout_session_id
               ),
               updated_at = timezone('utc', now());
      END IF;
      UPDATE public.profiles
         SET stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;

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
    'purchase_type', v_type,
    'manual_period_linked', v_manual_linked > 0,
    'period_created', v_period_inserted > 0
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

COMMIT;

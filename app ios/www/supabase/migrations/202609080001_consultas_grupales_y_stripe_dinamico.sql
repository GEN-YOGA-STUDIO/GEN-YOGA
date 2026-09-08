-- ==============================================================================
-- Migración 202609080001: Consultas Grupales, Métodos de Pago y Stripe Dinámico (v12.17)
-- ==============================================================================

BEGIN;

-- 1. Actualizar check constraint en public.tipos_clases para permitir categorías de consulta
ALTER TABLE public.tipos_clases
  DROP CONSTRAINT IF EXISTS tipos_clases_categoria_check;

ALTER TABLE public.tipos_clases
  ADD CONSTRAINT tipos_clases_categoria_check
  CHECK (categoria IN ('yoga', 'taller', 'clase_especial', 'consulta', 'consulta_grupal'));

-- Añadir columnas para vinculación dinámica con productos de Stripe y capacidad predeterminada
ALTER TABLE public.tipos_clases
  ADD COLUMN IF NOT EXISTS stripe_product_id text,
  ADD COLUMN IF NOT EXISTS stripe_price_id text,
  ADD COLUMN IF NOT EXISTS metodo_pago text,
  ADD COLUMN IF NOT EXISTS capacidad_predeterminada integer DEFAULT 10;

CREATE INDEX IF NOT EXISTS idx_tipos_clases_categoria ON public.tipos_clases(categoria);
CREATE INDEX IF NOT EXISTS idx_tipos_clases_stripe_product_id ON public.tipos_clases(stripe_product_id);

-- 2. Sembrar tipos canónicos de consultas en public.tipos_clases
INSERT INTO public.tipos_clases (nombre, duracion_predeterminada, color, icono, activo, orden, categoria, stripe_product_id, metodo_pago, capacidad_predeterminada)
SELECT 'Consulta en grupo', 60, '#8B5CF6', 'ph-users-three', true, 20, 'consulta_grupal', 'prod_VDmmlmsGGhMebt', 'Sesión Grupal Miriam (Stripe)', 10
WHERE NOT EXISTS (
  SELECT 1 FROM public.tipos_clases WHERE lower(trim(nombre)) = 'consulta en grupo'
);

INSERT INTO public.tipos_clases (nombre, duracion_predeterminada, color, icono, activo, orden, categoria, stripe_product_id, metodo_pago, capacidad_predeterminada)
SELECT 'Consulta individual', 60, '#3B82F6', 'ph-user', true, 21, 'consulta', null, 'Consulta Individual', 1
WHERE NOT EXISTS (
  SELECT 1 FROM public.tipos_clases WHERE lower(trim(nombre)) in ('consulta individual', 'consulta normal')
);

INSERT INTO public.tipos_clases (nombre, duracion_predeterminada, color, icono, activo, orden, categoria, stripe_product_id, metodo_pago, capacidad_predeterminada)
SELECT 'Sesión Introductoria Grupal', 60, '#EC4899', 'ph-sparkle', true, 22, 'consulta_grupal', null, 'Sesión Introductoria Gratuita (0 €)', 10
WHERE NOT EXISTS (
  SELECT 1 FROM public.tipos_clases WHERE lower(trim(nombre)) = 'sesión introductoria grupal'
);

INSERT INTO public.tipos_clases (nombre, duracion_predeterminada, color, icono, activo, orden, categoria, stripe_product_id, metodo_pago, capacidad_predeterminada)
SELECT 'Consulta Psicología', 60, '#3B82F6', 'ph-heart-beat', true, 23, 'consulta', null, 'Acompañamiento psicoterapéutico', 1
WHERE NOT EXISTS (
  SELECT 1 FROM public.tipos_clases WHERE lower(trim(nombre)) = 'consulta psicología'
);

INSERT INTO public.tipos_clases (nombre, duracion_predeterminada, color, icono, activo, orden, categoria, stripe_product_id, metodo_pago, capacidad_predeterminada)
SELECT 'Consulta Nutrición / PNI', 60, '#10B981', 'ph-drop', true, 24, 'consulta', null, 'Consulta PNI Clínica', 1
WHERE NOT EXISTS (
  SELECT 1 FROM public.tipos_clases WHERE lower(trim(nombre)) in ('consulta nutrición / pni', 'consulta nutrición')
);

INSERT INTO public.tipos_clases (nombre, duracion_predeterminada, color, icono, activo, orden, categoria, stripe_product_id, metodo_pago, capacidad_predeterminada)
SELECT 'Consulta Ayurveda', 90, '#F59E0B', 'ph-yin-yang', true, 25, 'consulta', null, 'Consulta Ayurveda', 1
WHERE NOT EXISTS (
  SELECT 1 FROM public.tipos_clases WHERE lower(trim(nombre)) = 'consulta ayurveda'
);

-- 3. Trigger enforce_capacidad_max_rules en public.clases:
-- Ahora para consultas ('psicologia', 'nutricion'):
-- Si se especifica una capacidad_max válida (> 0), se respeta íntegramente (permitiendo consultas grupales de 2 a 50 plazas).
-- Si viene nula o <= 0:
--   - Para consultas gratuitas o de grupo: por defecto 10
--   - Para consultas normales / individuales: por defecto 1
CREATE OR REPLACE FUNCTION public.enforce_capacidad_max_rules()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF lower(btrim(coalesce(new.tipo_clase, 'yoga'))) in ('yoga', 'taller', 'especial', '')
     OR new.tipo_clase IS NULL
     OR lower(btrim(coalesce(new.tipo_clase, ''))) NOT IN ('psicologia', 'nutricion') THEN
    IF new.capacidad_max IS NULL OR new.capacidad_max <> 10 THEN
      new.capacidad_max := 10;
    END IF;
  ELSIF lower(btrim(coalesce(new.tipo_clase, ''))) in ('psicologia', 'nutricion') THEN
    -- Si el administrador / usuario asigna una capacidad explícita mayor que 0, respetarla
    IF new.capacidad_max IS NOT NULL AND new.capacidad_max > 0 THEN
      -- Mantener la capacidad elegida (consultas individuales = 1, consultas grupales = 2 a 50)
      new.capacidad_max := new.capacidad_max;
    ELSE
      -- Valores por defecto inteligentes si no se especificó capacidad
      IF new.es_gratuita IS TRUE
         OR lower(coalesce(new.nombre, '')) LIKE '%grupo%'
         OR lower(coalesce(new.nombre, '')) LIKE '%grupal%'
         OR lower(coalesce(new.nombre, '')) LIKE '%introduct%' THEN
        new.capacidad_max := 10;
      ELSE
        new.capacidad_max := 1;
      END IF;
    END IF;
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_capacidad_max ON public.clases;
CREATE TRIGGER trg_enforce_capacidad_max
  BEFORE INSERT OR UPDATE ON public.clases
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_capacidad_max_rules();

-- 4. Actualizar stripe_fulfill_checkout para procesar compras dinámicas basadas en productos Stripe (prod_*)
-- Incluye explícitamente el producto prod_VDmmlmsGGhMebt (Sesión Grupal Miriam) y cualquier producto futuro
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
  v_effective_event_id text;
  v_target_month date;
BEGIN
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

  IF p_purchase_type IN ('promo_50', 'promo') THEN
    v_normalized_purchase_type := 'promo_50_clase';
  END IF;

  v_pack_credits := CASE v_normalized_purchase_type
    WHEN 'clase_suelta' THEN 1
    WHEN 'promo_50_clase' THEN 1
    WHEN 'pack_4' THEN 4
    WHEN 'pack_6' THEN 6
    WHEN 'pack_10' THEN 10
    ELSE null
  END;

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

  -- Comprobaciones de importes solo para compras con importe rígido
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
  ELSIF v_normalized_purchase_type = 'taller_intro_power_vinyasa' AND p_amount_total IS DISTINCT FROM 3500 THEN
    RAISE EXCEPTION 'Invalid workshop amount' USING errcode = '22023';
  END IF;

  IF p_is_guest THEN
    IF p_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'Guest purchases must not reference a user ID' USING errcode = '22023';
    END IF;
  ELSE
    IF p_user_id IS NULL THEN
      RAISE EXCEPTION 'Authenticated purchases must reference a user ID' USING errcode = '22023';
    END IF;
    SELECT account_deletion_pending INTO v_account_deletion_pending
      FROM public.profiles WHERE id = p_user_id FOR UPDATE;
    IF NOT found THEN
      RAISE EXCEPTION 'User profile not found' USING errcode = '22023';
    END IF;
    IF coalesce(v_account_deletion_pending, false) THEN
      RAISE EXCEPTION 'Cannot fulfill purchases for accounts pending deletion' USING errcode = '22023';
    END IF;
  END IF;

  SELECT * INTO v_existing FROM public.stripe_purchases
   WHERE checkout_session_id = p_checkout_session_id LIMIT 1;

  IF found THEN
    RETURN jsonb_build_object(
      'status', 'already_processed',
      'purchase_id', v_existing.checkout_session_id,
      'user_id', v_existing.user_id,
      'is_guest', v_existing.is_guest,
      'purchase_type', v_existing.purchase_type
    );
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
    p_checkout_session_id, v_effective_event_id, p_user_id, p_is_guest,
    v_normalized_purchase_type, p_price_id, p_payment_intent_id,
    p_subscription_id, p_customer_id, p_amount_total, lower(p_currency),
    p_payment_status, v_membership_month, timezone('utc', now()),
    timezone('utc', now()), timezone('utc', now())
  )
  ON CONFLICT (checkout_session_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF p_event_created IS NOT NULL AND p_event_created > 0 THEN
    v_purchased_at := to_timestamp(p_event_created);
  ELSE
    v_purchased_at := timezone('utc', now());
  END IF;

  IF NOT p_is_guest AND p_user_id IS NOT NULL THEN

    -- 1. Clases regulares (Bronce)
    IF v_pack_credits IS NOT NULL THEN
      UPDATE public.profiles
         SET bonos = coalesce(bonos, 0) + v_pack_credits,
             stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             descuento_promo_50_activo = CASE WHEN v_normalized_purchase_type = 'promo_50_clase' THEN false ELSE descuento_promo_50_activo END,
             codigo_promo_usado = CASE WHEN v_normalized_purchase_type = 'promo_50_clase' THEN true ELSE codigo_promo_usado END,
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;

      INSERT INTO public.class_credit_packs (
        user_id, checkout_session_id, pack_type, credits_total,
        credits_remaining, purchased_at, expires_at
      ) VALUES (
        p_user_id, p_checkout_session_id, v_normalized_purchase_type,
        v_pack_credits, v_pack_credits, v_purchased_at, v_purchased_at + interval '60 days'
      )
      ON CONFLICT (checkout_session_id) DO NOTHING;

    -- 2. Bono Ilimitado
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
      );

    -- 3. Compra Bono Clase Especial
    ELSIF v_normalized_purchase_type = 'clase_especial' THEN
      v_target_month := coalesce(v_membership_month, date_trunc('month', timezone('Europe/Madrid', now()))::date);
      INSERT INTO public.bonos_clases_especiales (
        user_id, mes, saldo, origen, checkout_session_id
      ) VALUES (
        p_user_id, v_target_month, 1, 'compra_stripe', p_checkout_session_id
      );

      UPDATE public.profiles
         SET stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;

    -- 4. Consultas Psicología & PNI (Legacy y producto específico de Miriam grupal)
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

    -- 5. Consultas Nutrición Silvia
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

    -- 7. Productos Stripe Dinámicos Generales (Cualquier prod_*)
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
    'purchase_type', v_normalized_purchase_type
  );
END;
$$;

REVOKE ALL ON FUNCTION public.stripe_fulfill_checkout(text, text, bigint, text, uuid, boolean, text, text, text, text, text, bigint, text, text, text, timestamptz, timestamptz, text, boolean, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.stripe_fulfill_checkout(text, text, bigint, text, uuid, boolean, text, text, text, text, text, bigint, text, text, text, timestamptz, timestamptz, text, boolean, boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';

COMMIT;

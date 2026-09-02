-- ==============================================================================
-- Migración 202609020100: Reparación Stripe Checkout, Encarnación Escribano López
-- y Habilitación de Bonos Normales en Yoga en Compañía
-- Versión: 9.51
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. REPARAR stripe_fulfill_checkout
-- Causa raíz identificada: Se omitió la inserción previa en stripe_webhook_events,
-- lo que provocaba un fallo de clave foránea al insertar en stripe_purchases.
-- Al fallar, PostgreSQL ejecutaba un ROLLBACK de toda la transacción, impidiendo
-- actualizar profiles.bonos y class_credit_packs, y enviando error a la clienta.
-- ------------------------------------------------------------------------------

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

  -- CRÍTICO: Registrar primero el evento en stripe_webhook_events para cumplir la FK de stripe_purchases
  INSERT INTO public.stripe_webhook_events (
    event_id,
    event_type,
    livemode,
    checkout_session_id,
    object_id
  ) VALUES (
    v_effective_event_id,
    p_event_type,
    true,
    p_checkout_session_id,
    coalesce(p_subscription_id, p_payment_intent_id, p_checkout_session_id)
  )
  ON CONFLICT (event_id) DO NOTHING;

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
    v_effective_event_id,
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
    v_membership_month,
    timezone('utc', now()),
    timezone('utc', now()),
    timezone('utc', now())
  )
  ON CONFLICT (checkout_session_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF p_event_created IS NOT NULL AND p_event_created > 0 THEN
    v_purchased_at := to_timestamp(p_event_created);
  ELSE
    v_purchased_at := timezone('utc', now());
  END IF;

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

-- ------------------------------------------------------------------------------
-- 2. REGULARIZACIÓN URGENTE: CLIENTA ENCARNACIÓN ESCRIBANO LÓPEZ
-- Se le acreditan 10 bonos en su perfil y se registra su pack de 10 con 60 días
-- de caducidad tal y como fue pagado en Stripe.
-- ------------------------------------------------------------------------------

UPDATE public.profiles
   SET bonos = coalesce(bonos, 0) + 10,
       updated_at = timezone('utc', now())
 WHERE lower(trim(coalesce(email, ''))) = 'en-car-na-ci-on@hotmail.com';

INSERT INTO public.class_credit_packs (
  user_id,
  checkout_session_id,
  pack_type,
  credits_total,
  credits_remaining,
  purchased_at,
  expires_at
)
SELECT
  id,
  NULL,
  'pack_10',
  10,
  10,
  now(),
  now() + interval '60 days'
FROM public.profiles
WHERE lower(trim(coalesce(email, ''))) = 'en-car-na-ci-on@hotmail.com'
  AND NOT EXISTS (
    SELECT 1 FROM public.class_credit_packs p
     WHERE p.user_id = profiles.id
       AND p.pack_type = 'pack_10'
       AND p.credits_remaining >= 10
       AND p.expires_at > now()
  );

-- Reconciliación adicional para cualquier otro usuario con packs activos cuyos bonos directos estuvieran a 0
UPDATE public.profiles p
   SET bonos = greatest(coalesce(p.bonos, 0), c.total_restante),
       updated_at = timezone('utc', now())
  FROM (
    SELECT user_id, sum(credits_remaining) AS total_restante
      FROM public.class_credit_packs
     WHERE credits_remaining > 0
       AND expires_at > now()
     GROUP BY user_id
  ) c
 WHERE p.id = c.user_id
   AND coalesce(p.bonos, 0) < c.total_restante;

-- ------------------------------------------------------------------------------
-- 3. ACTUALIZAR reservar_con_bono: PERMITIR BONOS NORMALES EN YOGA EN COMPAÑÍA
-- Y SOPORTAR p_force_regular PARA ELECCIÓN POST-CLIC
-- ------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.reservar_con_bono(bigint, uuid, boolean);
DROP FUNCTION IF EXISTS public.reservar_con_bono(bigint, uuid, boolean, boolean);

CREATE OR REPLACE FUNCTION public.reservar_con_bono(
  p_clase_id bigint,
  p_user_id uuid,
  p_use_unlimited_guest boolean DEFAULT false,
  p_force_regular boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_target_role text;
  v_capacity integer;
  v_occupied integer;
  v_starts_at timestamptz;
  v_class_name text;
  v_class_type text;
  v_class_active boolean;
  v_marked_free boolean;
  v_free_credits integer;
  v_companion_modality text;
  v_unlimited boolean := false;
  v_pack_id bigint;
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_special_count integer;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para reservar.' USING errcode = '42501';
  END IF;
  IF p_clase_id IS NULL OR p_clase_id <= 0 OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'La solicitud de reserva no es válida.' USING errcode = '22023';
  END IF;

  SELECT lower(trim(coalesce(p.rol, ''))) INTO v_actor_role
    FROM public.profiles p WHERE p.id = v_actor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el perfil que realiza la reserva.'; END IF;

  IF p_user_id <> v_actor_id
     AND v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'No puedes reservar una clase para otra persona.' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(p.rol, ''))), coalesce(p.saldo_clases_gratis, 0)
    INTO v_target_role, v_free_credits
    FROM public.profiles p WHERE p.id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el perfil del alumno.'; END IF;

  IF v_target_role IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'Solo los alumnos pueden reservar clases.' USING errcode = '42501';
  END IF;

  SELECT coalesce(capacidad_max, 10), fecha_inicio, nombre,
         lower(trim(coalesce(nullif(tipo_clase, ''), 'yoga'))),
         coalesce(activa, true), coalesce(es_gratuita, false),
         companion_modality
    INTO v_capacity, v_starts_at, v_class_name, v_class_type,
         v_class_active, v_marked_free, v_companion_modality
    FROM public.clases WHERE id = p_clase_id FOR UPDATE;
  IF NOT FOUND OR NOT v_class_active OR v_class_type NOT IN ('yoga', 'taller') THEN
    RAISE EXCEPTION 'La clase especificada no está disponible.' USING errcode = 'P0002';
  END IF;

  -- NOTA IMPORTANTE: Se elimina la restricción de v_companion_modality.
  -- Todas las clases de Yoga en Compañía TAMBIÉN se pueden reservar con bonos normales.

  IF v_starts_at IS NULL OR v_starts_at <= now() THEN
    RAISE EXCEPTION 'La clase ya no está disponible para reserva.' USING errcode = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.reservas_yoga
     WHERE clase_id = p_clase_id AND user_id = p_user_id AND estado = 'confirmada'
  ) THEN
    RAISE EXCEPTION 'Ya tienes una reserva confirmada para esta clase.' USING errcode = '23505';
  END IF;

  SELECT count(*)::integer
    INTO v_occupied
    FROM public.reservas_yoga
   WHERE clase_id = p_clase_id AND estado = 'confirmada';
  IF v_occupied >= v_capacity THEN
    RAISE EXCEPTION 'La clase está completa.' USING errcode = 'P0001';
  END IF;

  -- 1. Intentar consumir Bono de Bienvenida (a menos que se fuerce bono regular mediante p_force_regular)
  IF NOT p_force_regular AND v_free_credits > 0
     AND (
       public.es_clase_elegible_bono_gratis(v_class_name, v_starts_at, '', v_marked_free)
       OR v_class_name ~* '(introductoria|gratis|gratuita|prueba|clase abierta)'
       OR v_marked_free
     ) THEN
    UPDATE public.profiles SET saldo_clases_gratis = saldo_clases_gratis - 1
     WHERE id = p_user_id AND saldo_clases_gratis > 0;
    IF FOUND THEN
      INSERT INTO public.reservas_yoga
        (clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
         class_pack_id, saldo_gratis_descontado, num_plazas, num_plazas_reservadas, tipo_reserva)
      VALUES (p_clase_id, p_user_id, 'confirmada', false, false, null, true, 1, 1, 'bienvenida');
      RETURN;
    END IF;
  END IF;

  -- 2. Comprobar cobertura del Bono Ilimitado
  SELECT starts_at, ends_at INTO v_month_start, v_month_end
    FROM public.unlimited_membership_periods
   WHERE user_id = p_user_id AND starts_at <= v_starts_at AND ends_at > v_starts_at
   ORDER BY starts_at DESC LIMIT 1 FOR SHARE;
  IF FOUND AND v_class_type <> 'taller' THEN
    v_unlimited := true;
  ELSIF FOUND AND v_class_type = 'taller' THEN
    SELECT count(*)::integer INTO v_special_count
      FROM public.reservas_yoga r
      JOIN public.clases c ON c.id = r.clase_id
     WHERE r.user_id = p_user_id AND r.estado = 'confirmada'
       AND r.usado_bono_mensual AND lower(coalesce(c.tipo_clase, '')) = 'taller'
       AND c.fecha_inicio >= v_month_start AND c.fecha_inicio < v_month_end;
    IF v_special_count = 0 THEN v_unlimited := true; END IF;
  END IF;

  IF v_unlimited THEN
    INSERT INTO public.reservas_yoga
      (clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
       class_pack_id, saldo_gratis_descontado, num_plazas, num_plazas_reservadas, tipo_reserva)
    VALUES (p_clase_id, p_user_id, 'confirmada', true, false, null, false, 1, 1, 'mensual');
    RETURN;
  END IF;

  IF v_class_type = 'taller' THEN
    RAISE EXCEPTION 'Las clases especiales requieren un Bono Ilimitado activo.' USING errcode = 'P0001';
  END IF;

  -- 3. Consumir el pack más próximo a caducar; si no existe, consumir saldo individual
  SELECT id INTO v_pack_id FROM public.class_credit_packs
   WHERE user_id = p_user_id AND credits_remaining > 0
     AND expires_at > now() AND expires_at >= v_starts_at
   ORDER BY expires_at, purchased_at, id LIMIT 1 FOR UPDATE;

  IF v_pack_id IS NOT NULL THEN
    UPDATE public.class_credit_packs
       SET credits_remaining = credits_remaining - 1,
           updated_at = now()
     WHERE id = v_pack_id AND credits_remaining > 0;
    IF NOT FOUND THEN RAISE EXCEPTION 'El pack ya no tiene clases disponibles.'; END IF;

    -- Mantener sincronizado profiles.bonos con el saldo total de clases
    UPDATE public.profiles
       SET bonos = greatest(coalesce(bonos, 0) - 1, 0),
           updated_at = timezone('utc', now())
     WHERE id = p_user_id;
  ELSE
    UPDATE public.profiles
       SET bonos = coalesce(bonos, 0) - 1,
           updated_at = timezone('utc', now())
     WHERE id = p_user_id AND coalesce(bonos, 0) > 0;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No dispones de un Bono de Bienvenida activo ni de bonos de clase suficientes para reservar esta sesión.' USING errcode = 'P0001';
    END IF;
  END IF;

  INSERT INTO public.reservas_yoga
    (clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
     class_pack_id, saldo_gratis_descontado, num_plazas, num_plazas_reservadas, tipo_reserva)
  VALUES (p_clase_id, p_user_id, 'confirmada', false, true, v_pack_id, false, 1, 1, 'individual');
END;
$function$;

GRANT EXECUTE ON FUNCTION public.stripe_fulfill_checkout(
  text, text, bigint, text, uuid, boolean, text, text, text, text, text, bigint, text, text, text, timestamptz, timestamptz, text, boolean, boolean
) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean, boolean) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

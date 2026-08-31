-- ==============================================================================
-- Migración 202609020068: Reparación integral de reservas con bonos y producto Stripe 50%
-- GEN YOGA v9.6
-- ==============================================================================

BEGIN;

-- 1. Asegurar columnas de saldos en profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS saldo_yoga_compania integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS saldo_clases_gratis integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS saldo_consultas_gratis integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS descuento_promo_50_activo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS codigo_promo_usado boolean NOT NULL DEFAULT false;

-- 2. Asegurar que el trigger de mutación directa en reservas_yoga no bloquee las RPCs
CREATE OR REPLACE FUNCTION public.reservas_yoga_proteger_mutacion_directa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF tg_op = 'DELETE' THEN RETURN old; END IF;
  RETURN new;
END;
$$;

REVOKE ALL ON FUNCTION public.reservas_yoga_proteger_mutacion_directa() FROM public, anon, authenticated;

-- 3. Recrear función principal de reserva con bono tolerante y robusta
CREATE OR REPLACE FUNCTION public.reservar_con_bono(
  p_clase_id bigint,
  p_user_id uuid,
  p_use_welcome_companion boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_actor_email text;
  v_actor_is_staff boolean;
  v_target_role text;
  v_target_id uuid := p_user_id;
  v_legacy_credits integer;
  v_free_credits integer;
  v_companion_credits integer;
  v_unlimited_active boolean;
  v_membership_start timestamptz;
  v_membership_end timestamptz;
  v_natural_membership_start timestamptz;
  v_natural_membership_end timestamptz;
  v_capacity integer;
  v_starts_at timestamptz;
  v_class_name text;
  v_class_type text;
  v_class_active boolean;
  v_is_special boolean;
  v_is_free boolean;
  v_is_companion boolean;
  v_companion_modality text;
  v_marked_free boolean;
  v_professor_id public.clases.profesor_id%TYPE;
  v_professional_identity text := '';
  v_occupied integer;
  v_booking_limit_hours integer := 12;
  v_use_unlimited boolean := false;
  v_pack_id bigint;
  v_special_count integer := 0;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para reservar.' USING errcode = '42501';
  END IF;
  IF p_clase_id IS NULL OR p_clase_id <= 0 OR v_target_id IS NULL THEN
    RAISE EXCEPTION 'La solicitud de reserva no es válida.' USING errcode = '22023';
  END IF;

  -- Perfil del usuario que ejecuta la acción
  SELECT lower(trim(coalesce(rol, ''))), lower(nullif(trim(email), ''))
    INTO v_actor_role, v_actor_email
    FROM public.profiles
   WHERE id = v_actor_id;
  IF NOT found THEN
    RAISE EXCEPTION 'No se encontró el perfil que realiza la reserva.' USING errcode = 'P0002';
  END IF;

  v_actor_is_staff := v_actor_role IN ('admin', 'profesor', 'trabajador', 'profesional');
  IF v_target_id <> v_actor_id AND NOT v_actor_is_staff THEN
    RAISE EXCEPTION 'No puedes reservar una clase para otra persona.' USING errcode = '42501';
  END IF;

  -- Datos de la clase
  SELECT coalesce(capacidad_max, 10), fecha_inicio, nombre,
         lower(trim(coalesce(nullif(tipo_clase, ''), 'yoga'))), coalesce(activa, true),
         profesor_id, coalesce(es_gratuita, false),
         companion_modality
    INTO v_capacity, v_starts_at, v_class_name, v_class_type, v_class_active,
         v_professor_id, v_marked_free,
         v_companion_modality
    FROM public.clases
   WHERE id = p_clase_id
   FOR UPDATE;

  IF NOT found OR v_class_type IN ('psicologia', 'nutricion') OR NOT v_class_active THEN
    RAISE EXCEPTION 'La clase especificada no está disponible para reserva de yoga.' USING errcode = 'P0002';
  END IF;

  IF v_professor_id IS NOT NULL THEN
    SELECT lower(concat_ws(' ', coalesce(nombre, ''), coalesce(apellidos, ''), coalesce(email, '')))
      INTO v_professional_identity
      FROM public.profesionales
     WHERE id = v_professor_id;
    v_professional_identity := coalesce(v_professional_identity, '');
  END IF;

  v_is_special := v_class_type = 'taller' OR v_class_type = 'especial';
  v_is_companion := v_companion_modality IS NOT NULL OR v_class_name ~* 'compañ|compan|pareja|colegas|abuela|hijo';

  IF v_starts_at IS NULL THEN
    RAISE EXCEPTION 'La clase no tiene una hora de inicio válida.' USING errcode = '22023';
  END IF;
  IF v_capacity <= 0 THEN
    v_capacity := 10;
  END IF;

  IF v_target_id <> v_actor_id AND v_actor_role <> 'admin'
    AND NOT EXISTS (
      SELECT 1
        FROM public.profesionales
       WHERE id = v_professor_id
         AND lower(nullif(trim(email), '')) = v_actor_email
    ) THEN
    RAISE EXCEPTION 'Solo puedes gestionar reservas de tus propias clases.' USING errcode = '42501';
  END IF;

  -- Antelación mínima (12 horas por defecto)
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
    WHEN others THEN
      v_booking_limit_hours := 12;
  END;
  v_booking_limit_hours := coalesce(v_booking_limit_hours, 12);

  IF NOT v_actor_is_staff
    AND v_starts_at <= now() + make_interval(hours => v_booking_limit_hours) THEN
    RAISE EXCEPTION 'Las reservas cierran % h antes del inicio. Para esta clase ya ha pasado el plazo.',
      v_booking_limit_hours USING errcode = 'P0001';
  END IF;

  -- Comprobar si ya existe reserva confirmada
  IF EXISTS (
    SELECT 1
      FROM public.reservas_yoga
     WHERE clase_id = p_clase_id
       AND user_id = v_target_id
       AND estado = 'confirmada'
  ) THEN
    RAISE EXCEPTION 'Ya tienes una reserva confirmada para esta clase.' USING errcode = '23505';
  END IF;

  -- Comprobar aforo máximo
  SELECT count(*)::integer
    INTO v_occupied
    FROM public.reservas_yoga
   WHERE clase_id = p_clase_id
     AND estado = 'confirmada';
  IF v_occupied >= v_capacity THEN
    RAISE EXCEPTION 'La clase está completa.' USING errcode = 'P0001';
  END IF;

  -- Perfil del alumno
  SELECT lower(trim(coalesce(rol, ''))), coalesce(bonos, 0),
         coalesce(saldo_clases_gratis, 0), coalesce(saldo_yoga_compania, 0),
         coalesce(bono_mensual_activo, false),
         bono_mensual_inicio, bono_mensual_fin
    INTO v_target_role, v_legacy_credits,
         v_free_credits, v_companion_credits,
         v_unlimited_active,
         v_membership_start, v_membership_end
    FROM public.profiles
   WHERE id = v_target_id
   FOR UPDATE;

  IF NOT found THEN
    RAISE EXCEPTION 'No se encontró el perfil del alumno.' USING errcode = 'P0002';
  END IF;
  IF v_target_role IN ('admin', 'profesor', 'trabajador', 'profesional') AND v_target_id = v_actor_id THEN
    -- Permitir al personal auto-asignarse en modo vista previa sin consumir bonos
    INSERT INTO public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado, welcome_companion_modality
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', false, false, null, false, v_companion_modality
    );
    RETURN;
  END IF;

  -- Determinar si la clase es una sesión gratuita / introductoria / abierta
  v_is_free := public.es_clase_elegible_bono_gratis(
    v_class_name,
    v_starts_at,
    v_professional_identity,
    v_marked_free
  ) OR v_is_companion;

  -- 1. Si la clase está explícitamente marcada como gratuita en base de datos
  IF v_marked_free THEN
    INSERT INTO public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', false, false, null, false
    );
    RETURN;
  END IF;

  -- 2. Si es clase de Yoga en Compañía y el usuario tiene saldo disponible
  IF v_is_companion THEN
    IF v_companion_credits >= 1 THEN
      UPDATE public.profiles
         SET saldo_yoga_compania = saldo_yoga_compania - 1
       WHERE id = v_target_id
         AND saldo_yoga_compania >= 1;
      IF found THEN
        INSERT INTO public.reservas_yoga (
          clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
          class_pack_id, saldo_gratis_descontado, welcome_companion_modality
        ) VALUES (
          p_clase_id, v_target_id, 'confirmada', false, false, null, true, coalesce(v_companion_modality, 'pareja')
        );
        RETURN;
      END IF;
    ELSIF v_free_credits >= 1 THEN
      UPDATE public.profiles
         SET saldo_clases_gratis = saldo_clases_gratis - 1
       WHERE id = v_target_id
         AND saldo_clases_gratis >= 1;
      IF found THEN
        INSERT INTO public.reservas_yoga (
          clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
          class_pack_id, saldo_gratis_descontado, welcome_companion_modality
        ) VALUES (
          p_clase_id, v_target_id, 'confirmada', false, false, null, true, coalesce(v_companion_modality, 'pareja')
        );
        RETURN;
      END IF;
    END IF;
  END IF;

  -- 3. Si es sesión gratuita/introductoria Y el alumno tiene saldo de bono gratis
  IF v_is_free THEN
    IF v_free_credits >= 1 THEN
      UPDATE public.profiles
         SET saldo_clases_gratis = saldo_clases_gratis - 1
       WHERE id = v_target_id
         AND saldo_clases_gratis >= 1;
      IF found THEN
        INSERT INTO public.reservas_yoga (
          clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
          class_pack_id, saldo_gratis_descontado
        ) VALUES (
          p_clase_id, v_target_id, 'confirmada', false, false, null, true
        );
        RETURN;
      END IF;
    ELSIF v_companion_credits >= 1 THEN
      UPDATE public.profiles
         SET saldo_yoga_compania = saldo_yoga_compania - 1
       WHERE id = v_target_id
         AND saldo_yoga_compania >= 1;
      IF found THEN
        INSERT INTO public.reservas_yoga (
          clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
          class_pack_id, saldo_gratis_descontado
        ) VALUES (
          p_clase_id, v_target_id, 'confirmada', false, false, null, true
        );
        RETURN;
      END IF;
    END IF;
  END IF;

  -- 4. Si es sesión introductoria o en compañía y el ADMIN / PERSONAL está asignando al alumno
  IF (v_is_free OR v_is_companion) AND v_actor_is_staff AND v_target_id <> v_actor_id THEN
    INSERT INTO public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado, welcome_companion_modality
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', false, false, null, false, v_companion_modality
    );
    RETURN;
  END IF;

  -- 5. Bonos Normales: Caso Bono Ilimitado (mes natural)
  SELECT starts_at, ends_at
    INTO v_natural_membership_start, v_natural_membership_end
    FROM public.unlimited_membership_periods
   WHERE user_id = v_target_id
     AND starts_at <= v_starts_at
     AND ends_at > v_starts_at
   ORDER BY starts_at DESC
   LIMIT 1
   FOR SHARE;

  IF found THEN
    v_unlimited_active := true;
    v_membership_start := v_natural_membership_start;
    v_membership_end := v_natural_membership_end;
  ELSIF v_unlimited_active THEN
    IF v_membership_start IS NULL THEN
      v_membership_start := date_trunc('month', v_starts_at AT TIME ZONE 'Europe/Madrid') AT TIME ZONE 'Europe/Madrid';
    END IF;
    IF v_membership_end IS NULL THEN
      v_membership_end := (date_trunc('month', v_starts_at AT TIME ZONE 'Europe/Madrid') + interval '1 month') AT TIME ZONE 'Europe/Madrid';
    END IF;
  END IF;

  IF v_unlimited_active
    AND v_membership_start IS NOT NULL
    AND v_membership_end IS NOT NULL
    AND v_starts_at >= v_membership_start
    AND v_starts_at < v_membership_end THEN

    IF v_is_special THEN
      SELECT count(*)::integer
        INTO v_special_count
        FROM public.reservas_yoga AS booking
        JOIN public.clases AS class ON class.id = booking.clase_id
       WHERE booking.user_id = v_target_id
         AND booking.estado = 'confirmada'
         AND coalesce(booking.usado_bono_mensual, false)
         AND (lower(trim(coalesce(class.tipo_clase, ''))) = 'taller' OR lower(trim(coalesce(class.tipo_clase, ''))) = 'especial')
         AND class.fecha_inicio >= v_membership_start
         AND class.fecha_inicio < v_membership_end;
      IF v_special_count >= 1 THEN
        RAISE EXCEPTION 'Ya has utilizado la clase especial incluida en este mes natural.'
          USING errcode = 'P0001';
      END IF;
    END IF;

    v_use_unlimited := true;
  END IF;

  -- 6. Bonos Normales: Packs de Clases o Saldo en Perfil
  IF NOT v_use_unlimited THEN
    IF v_is_special THEN
      RAISE EXCEPTION 'Las clases especiales requieren un Bono Ilimitado activo y disponibilidad mensual.'
        USING errcode = 'P0001';
    END IF;

    -- Buscar primero un pack de clases no caducado
    SELECT id
      INTO v_pack_id
      FROM public.class_credit_packs
     WHERE user_id = v_target_id
       AND credits_remaining > 0
       AND expires_at > now()
     ORDER BY expires_at, purchased_at, id
     LIMIT 1
     FOR UPDATE;

    IF v_pack_id IS NOT NULL THEN
      UPDATE public.class_credit_packs
         SET credits_remaining = credits_remaining - 1,
             updated_at = now()
        WHERE id = v_pack_id
          AND credits_remaining > 0;
      IF NOT found THEN
        RAISE EXCEPTION 'El pack seleccionado ya no tiene clases disponibles.' USING errcode = 'P0001';
      END IF;
    ELSE
      -- Si no hay pack registrado, usar el saldo directo en profiles
      UPDATE public.profiles
         SET bonos = coalesce(bonos, 0) - 1
       WHERE id = v_target_id
         AND coalesce(bonos, 0) >= 1;
      IF NOT found THEN
        IF v_is_companion THEN
          RAISE EXCEPTION 'No dispones de un bono de Yoga en Compañía activo (0 €). Revisa tus bonos disponibles.' USING errcode = 'P0001';
        ELSIF v_is_free THEN
          RAISE EXCEPTION 'No dispones de un bono gratuito ni de clases disponibles para esta sesión. Adquiere un pack de clases o bono ilimitado para reservar.' USING errcode = 'P0001';
        ELSE
          RAISE EXCEPTION 'Esta clase regular requiere un bono o pack de clases activo. Adquiere un pack de clases para reservar.' USING errcode = 'P0001';
        END IF;
      END IF;
    END IF;
  END IF;

  -- Insertar reserva confirmada
  INSERT INTO public.reservas_yoga (
    clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
    class_pack_id, saldo_gratis_descontado, welcome_companion_modality
  ) VALUES (
    p_clase_id, v_target_id, 'confirmada', v_use_unlimited,
    NOT v_use_unlimited, v_pack_id, false, v_companion_modality
  );
END;
$$;

-- 4. Sobrecargas seguras para reservar_con_bono
CREATE OR REPLACE FUNCTION public.reservar_con_bono(
  p_clase_id bigint,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.reservar_con_bono(p_clase_id, p_user_id, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.reservar_con_bono(
  p_clase_id numeric,
  p_user_id uuid,
  p_use_welcome_companion boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.reservar_con_bono(p_clase_id::bigint, p_user_id, p_use_welcome_companion);
END;
$$;

CREATE OR REPLACE FUNCTION public.reservar_con_bono(
  p_clase_id numeric,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.reservar_con_bono(p_clase_id::bigint, p_user_id, false);
END;
$$;

-- Permisos de ejecución universales
REVOKE ALL ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.reservar_con_bono(bigint, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.reservar_con_bono(bigint, uuid) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.reservar_con_bono(numeric, uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.reservar_con_bono(numeric, uuid, boolean) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.reservar_con_bono(numeric, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.reservar_con_bono(numeric, uuid) TO anon, authenticated, service_role;

-- 5. Actualizar stripe_purchases check constraint para soportar alias de promo 50%
ALTER TABLE public.stripe_purchases
  DROP CONSTRAINT IF EXISTS stripe_purchases_purchase_type_check;

ALTER TABLE public.stripe_purchases
  ADD CONSTRAINT stripe_purchases_purchase_type_check CHECK (
    purchase_type IN (
      'clase_suelta',
      'pack_4',
      'pack_6',
      'pack_10',
      'bono_ilimitado',
      'bono_mensual',
      'promo_50_clase',
      'promo_50',
      'promo',
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
    )
  );

-- 6. Actualizar stripe_fulfill_checkout con soporte de alias
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
  v_inserted integer;
  v_profile_updated integer := 0;
  v_existing public.stripe_purchases%ROWTYPE;
  v_pack_credits integer;
  v_purchased_at timestamptz;
  v_account_deletion_pending boolean;
  v_membership_month date;
  v_membership_start timestamptz;
  v_membership_end timestamptz;
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

  SELECT *
    INTO v_existing
    FROM public.stripe_purchases
   WHERE stripe_checkout_session_id = p_checkout_session_id
   LIMIT 1;

  IF found THEN
    RETURN jsonb_build_object(
      'status', 'already_processed',
      'purchase_id', v_existing.id,
      'user_id', v_existing.user_id,
      'is_guest', v_existing.is_guest,
      'purchase_type', v_existing.purchase_type
    );
  END IF;

  INSERT INTO public.stripe_purchases (
    stripe_event_id,
    stripe_event_type,
    stripe_event_created,
    stripe_checkout_session_id,
    user_id,
    is_guest,
    purchase_type,
    stripe_price_id,
    stripe_payment_intent_id,
    stripe_subscription_id,
    stripe_customer_id,
    amount_total,
    currency,
    payment_status,
    membership_month,
    period_start,
    period_end,
    subscription_status,
    cancel_at_period_end,
    livemode
  ) VALUES (
    p_event_id,
    p_event_type,
    p_event_created,
    p_checkout_session_id,
    p_user_id,
    p_is_guest,
    v_normalized_purchase_type,
    p_price_id,
    p_payment_intent_id,
    p_subscription_id,
    p_customer_id,
    p_amount_total,
    p_currency,
    p_payment_status,
    v_membership_month,
    coalesce(p_period_start, v_membership_start),
    coalesce(p_period_end, v_membership_end),
    p_subscription_status,
    coalesce(p_cancel_at_period_end, false),
    p_livemode
  );
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  v_purchased_at := to_timestamp(p_event_created);

  IF NOT p_is_guest AND p_user_id IS NOT NULL THEN
    UPDATE public.profiles
       SET stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
           stripe_subscription_status = CASE
             WHEN v_normalized_purchase_type = 'bono_mensual' THEN coalesce(p_subscription_status, stripe_subscription_status)
             ELSE stripe_subscription_status
           END,
           descuento_promo_50_activo = CASE WHEN v_normalized_purchase_type = 'promo_50_clase' THEN false ELSE descuento_promo_50_activo END,
           codigo_promo_usado = CASE WHEN v_normalized_purchase_type = 'promo_50_clase' THEN true ELSE codigo_promo_usado END,
           updated_at = timezone('utc', now())
     WHERE id = p_user_id;
    GET DIAGNOSTICS v_profile_updated = ROW_COUNT;

    IF v_pack_credits IS NOT NULL THEN
      INSERT INTO public.class_credit_packs (
        user_id,
        pack_type,
        credits_total,
        credits_remaining,
        stripe_checkout_session_id,
        purchased_at,
        expires_at
      ) VALUES (
        p_user_id,
        v_normalized_purchase_type,
        v_pack_credits,
        v_pack_credits,
        p_checkout_session_id,
        v_purchased_at,
        v_purchased_at + interval '60 days'
      );
    END IF;

    IF v_normalized_purchase_type = 'bono_ilimitado' THEN
      INSERT INTO public.unlimited_membership_periods (
        user_id,
        membership_month,
        starts_at,
        ends_at,
        stripe_checkout_session_id,
        purchased_at
      ) VALUES (
        p_user_id,
        v_membership_month,
        v_membership_start,
        v_membership_end,
        p_checkout_session_id,
        v_purchased_at
      );

      UPDATE public.profiles
         SET bono_mensual_activo = true,
             bono_mensual_inicio = v_membership_start,
             bono_mensual_fin = v_membership_end,
             updated_at = timezone('utc', now())
       WHERE id = p_user_id
         AND (bono_mensual_fin IS NULL OR bono_mensual_fin < v_membership_end);
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

NOTIFY pgrst, 'reload schema';

COMMIT;

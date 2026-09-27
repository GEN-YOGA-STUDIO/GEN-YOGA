-- ==============================================================================
-- MIGRACIÓN: Sistema unificado y simplificado de Bonos de Consulta y Grupo
-- 1. Añade saldo_grupal a profiles para sesiones grupales (autoayuda / terapéutico).
-- 2. Actualiza ajustar_saldo_usuario para permitir control total admin (+1/-1 en 'grupos').
-- 3. Actualiza reservar_consulta_atomica para consumir saldo_grupal en sesiones grupales.
-- 4. Actualiza cancelar_consulta_atomica para devolver saldo_grupal en grupales,
--    saldo_psicologia en consultas de psicología y saldo_nutricion en nutrición.
-- 5. Actualiza stripe_fulfill_checkout para acreditar saldo_grupal en compras grupales.
-- 6. Actualiza admin_fusionar_perfiles para consolidar saldo_grupal.
-- ==============================================================================

BEGIN;

-- 1. Añadir saldo_grupal a profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS saldo_grupal integer NOT NULL DEFAULT 0;

-- 2. Actualizar ajustar_saldo_usuario
CREATE OR REPLACE FUNCTION public.ajustar_saldo_usuario(p_user_id uuid, p_tipo text, p_delta integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_target_role text;
  v_new_balance integer;
begin
  if v_actor_id is null then
    raise exception 'authentication required';
  end if;
  if p_user_id is null or p_tipo is null or p_tipo not in (
    'yoga', 'psicologia', 'nutricion', 'grupos', 'grupal', 'consulta_grupal', 'clases_gratis', 'consultas_gratis', 'yoga_compania'
  ) then
    raise exception 'invalid balance adjustment';
  end if;
  if p_delta is null or p_delta = 0 or p_delta < -1000 or p_delta > 1000 then
    raise exception 'invalid balance delta';
  end if;

  select lower(coalesce(rol, '')) into v_actor_role
    from public.profiles
   where id = v_actor_id;
  if not found or v_actor_role <> 'admin' then
    raise exception 'only administrators may adjust balances';
  end if;

  select lower(coalesce(rol, '')) into v_target_role
    from public.profiles
   where id = p_user_id
   for update;
  if not found then
    raise exception 'client profile not found';
  end if;
  if v_target_role in ('admin', 'profesor', 'trabajador', 'profesional') then
    raise exception 'staff balances cannot be adjusted';
  end if;

  if p_tipo = 'yoga' then
    update public.profiles
       set bonos = greatest(coalesce(bonos, 0) + p_delta, 0)
     where id = p_user_id
     returning bonos into v_new_balance;
  elsif p_tipo = 'psicologia' then
    update public.profiles
       set saldo_psicologia = greatest(coalesce(saldo_psicologia, 0) + p_delta, 0)
     where id = p_user_id
     returning saldo_psicologia into v_new_balance;
  elsif p_tipo = 'nutricion' then
    update public.profiles
       set saldo_nutricion = greatest(coalesce(saldo_nutricion, 0) + p_delta, 0)
     where id = p_user_id
     returning saldo_nutricion into v_new_balance;
  elsif p_tipo in ('grupos', 'grupal', 'consulta_grupal') then
    update public.profiles
       set saldo_grupal = greatest(coalesce(saldo_grupal, 0) + p_delta, 0)
     where id = p_user_id
     returning saldo_grupal into v_new_balance;
  elsif p_tipo = 'clases_gratis' then
    update public.profiles
       set saldo_clases_gratis = greatest(coalesce(saldo_clases_gratis, 0) + p_delta, 0)
     where id = p_user_id
     returning saldo_clases_gratis into v_new_balance;
  elsif p_tipo = 'consultas_gratis' then
    update public.profiles
       set saldo_consultas_gratis = greatest(coalesce(saldo_consultas_gratis, 0) + p_delta, 0)
     where id = p_user_id
     returning saldo_consultas_gratis into v_new_balance;
  elsif p_tipo = 'yoga_compania' then
    update public.profiles
       set saldo_yoga_compania = greatest(coalesce(saldo_yoga_compania, 0) + p_delta, 0)
     where id = p_user_id
     returning saldo_yoga_compania into v_new_balance;
  end if;

  return v_new_balance;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.ajustar_saldo_usuario(uuid, text, integer) TO authenticated, service_role;

-- 3. Actualizar reservar_consulta_atomica
CREATE OR REPLACE FUNCTION public.reservar_consulta_atomica(
  p_tipo text,
  p_clase_id bigint,
  p_user_id uuid DEFAULT NULL::uuid,
  p_cobrar_saldo boolean DEFAULT true,
  p_producto_contratado text DEFAULT NULL::text,
  p_stripe_lookup_key text DEFAULT NULL::text,
  p_origen_pago text DEFAULT 'local'::text,
  p_notas text DEFAULT NULL::text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_actor_email text;
  v_actor_is_staff boolean;
  v_target_id uuid := coalesce(p_user_id, auth.uid());
  v_target_role text;
  v_class_type text;
  v_class_active boolean;
  v_capacity integer;
  v_starts_at timestamptz;
  v_professor_id public.clases.profesor_id%type;
  v_is_free boolean;
  v_name text;
  v_is_group boolean := false;
  v_occupied integer;
  v_reservation_id bigint;
  v_no_charge boolean := false;
  v_charge_credit boolean := true;
  v_booking_limit_hours integer := 12;
  v_effective_producto text := trim(coalesce(p_producto_contratado, ''));
  v_effective_lookup text := trim(coalesce(p_stripe_lookup_key, ''));
  v_effective_origen text := trim(coalesce(p_origen_pago, 'local'));
  v_effective_notas text := trim(coalesce(p_notas, ''));
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING errcode = '42501';
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('psicologia', 'nutricion') THEN
    RAISE EXCEPTION 'invalid consultation type' USING errcode = '22023';
  END IF;
  IF p_clase_id IS NULL OR p_clase_id <= 0 OR v_target_id IS NULL THEN
    RAISE EXCEPTION 'invalid booking request' USING errcode = '22023';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))), lower(nullif(trim(email), ''))
    INTO v_actor_role, v_actor_email
    FROM public.profiles
   WHERE id = v_actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'actor profile not found' USING errcode = 'P0002';
  END IF;
  v_actor_is_staff := v_actor_role IN ('admin', 'profesor', 'trabajador', 'profesional');

  IF v_target_id <> v_actor_id AND NOT v_actor_is_staff THEN
    RAISE EXCEPTION 'not allowed to book for another user' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(tipo_clase, ''))), coalesce(activa, true),
         coalesce(capacidad_max, 0), fecha_inicio, profesor_id,
         coalesce(es_gratuita, false), lower(trim(coalesce(nombre, '')))
    INTO v_class_type, v_class_active, v_capacity, v_starts_at,
         v_professor_id, v_is_free, v_name
    FROM public.clases
   WHERE id = p_clase_id
   FOR UPDATE;

  IF NOT FOUND OR v_class_type <> p_tipo OR NOT v_class_active
    OR v_capacity <= 0 OR v_starts_at IS NULL THEN
    RAISE EXCEPTION 'consultation slot not found or invalid' USING errcode = 'P0002';
  END IF;

  -- Determinar si es sesión grupal
  v_is_group := (v_capacity > 1 OR v_name LIKE '%autoayuda%' OR v_name LIKE '%terap%' OR v_name LIKE '%grupo%' OR v_class_type = 'consulta_grupal');

  -- Para personal de recepción/admin/profesional del turno se permite gestionar turnos del día
  IF v_target_id <> v_actor_id AND v_actor_role NOT IN ('admin', 'trabajador')
    AND NOT EXISTS (
      SELECT 1
        FROM public.profesionales
       WHERE id = v_professor_id
         AND lower(nullif(trim(email), '')) = v_actor_email
    ) THEN
    RAISE EXCEPTION 'staff may only manage consultation slots linked to their professional profile'
      USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, '')))
    INTO v_target_role
    FROM public.profiles
   WHERE id = v_target_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'target profile not found' USING errcode = 'P0002';
  END IF;

  IF NOT v_actor_is_staff AND v_target_role IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'staff users cannot book consultations' USING errcode = '42501';
  END IF;

  -- Restricción temporal solo para reservas autoservicio de clientes
  IF NOT v_actor_is_staff THEN
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
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        v_booking_limit_hours := 12;
    END;
    v_booking_limit_hours := coalesce(v_booking_limit_hours, 12);

    IF v_starts_at <= now() THEN
      RAISE EXCEPTION 'consultation slot has already passed' USING errcode = 'P0001';
    END IF;
    IF v_starts_at <= now() + make_interval(hours => v_booking_limit_hours) THEN
      RAISE EXCEPTION 'consultation slot is no longer bookable' USING errcode = 'P0001';
    END IF;
  END IF;

  IF p_tipo = 'psicologia' THEN
    IF EXISTS (
      SELECT 1 FROM public.reservas_psicologia
       WHERE clase_id = p_clase_id
         AND user_id = v_target_id
         AND estado = 'confirmada'
    ) THEN
      RAISE EXCEPTION 'consultation already booked' USING errcode = '23505';
    END IF;
    SELECT count(*)::integer
      INTO v_occupied
      FROM public.reservas_psicologia
     WHERE clase_id = p_clase_id
       AND estado = 'confirmada';
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.reservas_nutricion
       WHERE clase_id = p_clase_id
         AND user_id = v_target_id
         AND estado = 'confirmada'
    ) THEN
      RAISE EXCEPTION 'consultation already booked' USING errcode = '23505';
    END IF;
    SELECT count(*)::integer
      INTO v_occupied
      FROM public.reservas_nutricion
     WHERE clase_id = p_clase_id
       AND estado = 'confirmada';
  END IF;

  IF v_occupied >= v_capacity THEN
    RAISE EXCEPTION 'consultation is full' USING errcode = 'P0001';
  END IF;

  v_no_charge := NOT coalesce(p_cobrar_saldo, true);

  -- Regla: Bono de Bienvenida cubre sesiones introductorias o marcadas como gratuitas
  IF (v_is_free OR v_name LIKE '%introduct%') THEN
    v_is_free := true;
  END IF;

  -- Determinar producto por defecto si no viene especificado
  IF v_effective_producto = '' THEN
    IF v_is_free THEN
      v_effective_producto := 'Consulta Gratuita de Bienvenida (0 €)';
    ELSIF v_is_group THEN
      v_effective_producto := 'Sesión Grupal (30 €)';
    ELSE
      SELECT coalesce(metodo_pago, 'Consulta ' || initcap(p_tipo)) INTO v_effective_producto
        FROM public.clases WHERE id = p_clase_id;
      IF v_effective_producto IS NULL OR v_effective_producto = '' THEN
        v_effective_producto := 'Consulta ' || initcap(p_tipo);
      END IF;
    END IF;
  END IF;

  -- Actualizar clase con producto/lookup si viene especificado
  UPDATE public.clases
     SET metodo_pago = COALESCE(NULLIF(v_effective_producto, ''), metodo_pago),
         stripe_lookup_key = COALESCE(NULLIF(v_effective_lookup, ''), stripe_lookup_key)
   WHERE id = p_clase_id;

  IF v_is_free AND NOT v_no_charge THEN
    UPDATE public.profiles
       SET saldo_consultas_gratis = saldo_consultas_gratis - 1
     WHERE id = v_target_id
       AND saldo_consultas_gratis >= 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ya has utilizado tu bono de consulta gratuita o no dispones de saldo gratis suficiente.'
        USING errcode = 'P0001';
    END IF;

    IF p_tipo = 'psicologia' THEN
      INSERT INTO public.reservas_psicologia (
        clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado,
        producto_contratado, stripe_lookup_key, origen_pago, notas
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, true,
        v_effective_producto, v_effective_lookup, v_effective_origen, v_effective_notas
      ) RETURNING id INTO v_reservation_id;
    ELSE
      INSERT INTO public.reservas_nutricion (
        clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado,
        producto_contratado, stripe_lookup_key, origen_pago, notas
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, true,
        v_effective_producto, v_effective_lookup, v_effective_origen, v_effective_notas
      ) RETURNING id INTO v_reservation_id;
    END IF;
    RETURN v_reservation_id;
  ELSIF v_is_free AND v_no_charge THEN
    IF p_tipo = 'psicologia' THEN
      INSERT INTO public.reservas_psicologia (
        clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado,
        producto_contratado, stripe_lookup_key, origen_pago, notas
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, false,
        v_effective_producto, v_effective_lookup, v_effective_origen, v_effective_notas
      ) RETURNING id INTO v_reservation_id;
    ELSE
      INSERT INTO public.reservas_nutricion (
        clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado,
        producto_contratado, stripe_lookup_key, origen_pago, notas
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, false,
        v_effective_producto, v_effective_lookup, v_effective_origen, v_effective_notas
      ) RETURNING id INTO v_reservation_id;
    END IF;
    RETURN v_reservation_id;
  END IF;

  v_charge_credit := NOT v_no_charge;

  IF v_charge_credit THEN
    IF v_is_group THEN
      UPDATE public.profiles
         SET saldo_grupal = saldo_grupal - 1
       WHERE id = v_target_id
         AND saldo_grupal >= 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'insufficient group session credit' USING errcode = 'P0001';
      END IF;
    ELSIF p_tipo = 'psicologia' THEN
      UPDATE public.profiles
         SET saldo_psicologia = saldo_psicologia - 1
       WHERE id = v_target_id
         AND saldo_psicologia >= 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'insufficient psychology credit' USING errcode = 'P0001';
      END IF;
    ELSIF p_tipo = 'nutricion' THEN
      UPDATE public.profiles
         SET saldo_nutricion = saldo_nutricion - 1
       WHERE id = v_target_id
         AND saldo_nutricion >= 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'insufficient nutrition credit' USING errcode = 'P0001';
      END IF;
    END IF;
  END IF;

  IF p_tipo = 'psicologia' THEN
    INSERT INTO public.reservas_psicologia (
      clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado,
      producto_contratado, stripe_lookup_key, origen_pago, notas
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', v_charge_credit, false,
      v_effective_producto, v_effective_lookup, v_effective_origen, v_effective_notas
    ) RETURNING id INTO v_reservation_id;
  ELSE
    INSERT INTO public.reservas_nutricion (
      clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado,
      producto_contratado, stripe_lookup_key, origen_pago, notas
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', v_charge_credit, false,
      v_effective_producto, v_effective_lookup, v_effective_origen, v_effective_notas
    ) RETURNING id INTO v_reservation_id;
  END IF;

  RETURN v_reservation_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.reservar_consulta_atomica(text, bigint, uuid, boolean, text, text, text, text) TO authenticated, service_role;

-- 4. Actualizar cancelar_consulta_atomica
CREATE OR REPLACE FUNCTION public.cancelar_consulta_atomica(
  p_tipo text,
  p_reserva_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_actor_is_staff boolean;
  v_target_id uuid;
  v_class_id bigint;
  v_starts_at timestamptz;
  v_capacity integer;
  v_name text;
  v_class_type text;
  v_is_group boolean := false;
  v_cancel_limit_hours integer := 24;
  v_refund_paid boolean;
  v_refund_free boolean;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING errcode = '42501';
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('psicologia', 'nutricion')
    OR p_reserva_id IS NULL OR p_reserva_id <= 0 THEN
    RAISE EXCEPTION 'invalid cancellation request' USING errcode = '22023';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))) INTO v_actor_role
    FROM public.profiles WHERE id = v_actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'actor profile not found' USING errcode = 'P0002';
  END IF;
  v_actor_is_staff := v_actor_role IN ('admin', 'profesor', 'trabajador', 'profesional');

  IF p_tipo = 'psicologia' THEN
    SELECT user_id, clase_id, coalesce(saldo_descontado, false),
           coalesce(saldo_gratis_descontado, false)
      INTO v_target_id, v_class_id, v_refund_paid, v_refund_free
      FROM public.reservas_psicologia
     WHERE id = p_reserva_id AND estado = 'confirmada'
     FOR UPDATE;
  ELSE
    SELECT user_id, clase_id, coalesce(saldo_descontado, false),
           coalesce(saldo_gratis_descontado, false)
      INTO v_target_id, v_class_id, v_refund_paid, v_refund_free
      FROM public.reservas_nutricion
     WHERE id = p_reserva_id AND estado = 'confirmada'
     FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'consultation booking not found' USING errcode = 'P0002';
  END IF;
  IF v_target_id <> v_actor_id AND NOT v_actor_is_staff THEN
    RAISE EXCEPTION 'not allowed to cancel this booking' USING errcode = '42501';
  END IF;

  SELECT fecha_inicio, coalesce(capacidad_max, 1), lower(trim(coalesce(nombre, ''))), lower(trim(coalesce(tipo_clase, '')))
    INTO v_starts_at, v_capacity, v_name, v_class_type
    FROM public.clases WHERE id = v_class_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'consultation slot not found' USING errcode = 'P0002';
  END IF;

  -- Determinar si era sesión grupal
  v_is_group := (v_capacity > 1 OR v_name LIKE '%autoayuda%' OR v_name LIKE '%terap%' OR v_name LIKE '%grupo%' OR v_class_type = 'consulta_grupal');

  IF NOT v_actor_is_staff THEN
    BEGIN
      SELECT CASE
        WHEN trim(coalesce(valor, '')) ~ '^[0-9]{1,3}$'
          THEN least(168, greatest(0, trim(valor)::integer))
        ELSE 24
      END
        INTO v_cancel_limit_hours
        FROM public.configuracion
       WHERE clave = 'horas_limite_cancelacion'
       LIMIT 1;
    EXCEPTION
      WHEN OTHERS THEN
        v_cancel_limit_hours := 24;
    END;
    v_cancel_limit_hours := coalesce(v_cancel_limit_hours, 24);

    IF v_starts_at IS NULL
      OR v_starts_at <= now() + make_interval(hours => v_cancel_limit_hours) THEN
      RAISE EXCEPTION 'Ya no puedes cancelar la consulta: faltan menos de % horas.',
        v_cancel_limit_hours USING errcode = 'P0001';
    END IF;
  END IF;

  IF p_tipo = 'psicologia' THEN
    DELETE FROM public.reservas_psicologia WHERE id = p_reserva_id;
  ELSE
    DELETE FROM public.reservas_nutricion WHERE id = p_reserva_id;
  END IF;

  -- Si era sesión gratuita de valoración, reintegrar saldo_consultas_gratis
  IF v_refund_free THEN
    UPDATE public.profiles
       SET saldo_consultas_gratis = coalesce(saldo_consultas_gratis, 0) + 1
     WHERE id = v_target_id;
  -- Si era consulta de pago o saldo que descontó crédito, reintegrar al tipo de bono correspondiente
  ELSIF v_refund_paid THEN
    IF v_is_group THEN
      UPDATE public.profiles
         SET saldo_grupal = coalesce(saldo_grupal, 0) + 1
       WHERE id = v_target_id;
    ELSIF p_tipo = 'psicologia' THEN
      UPDATE public.profiles
         SET saldo_psicologia = coalesce(saldo_psicologia, 0) + 1
       WHERE id = v_target_id;
    ELSE
      UPDATE public.profiles
         SET saldo_nutricion = coalesce(saldo_nutricion, 0) + 1
       WHERE id = v_target_id;
    END IF;
  END IF;

  RETURN true;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.cancelar_consulta_atomica(text, bigint) TO authenticated, service_role;

-- 5. Actualizar stripe_fulfill_checkout para acreditar saldo_grupal en compras grupales
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
  p_period_start timestamp with time zone,
  p_period_end timestamp with time zone,
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

  -- Registrar evento en stripe_webhook_events
  INSERT INTO public.stripe_webhook_events (
    event_id, event_type, livemode, checkout_session_id, object_id
  ) VALUES (
    v_effective_event_id, p_event_type, true, p_checkout_session_id,
    coalesce(p_subscription_id, p_payment_intent_id, p_checkout_session_id)
  )
  ON CONFLICT (event_id) DO NOTHING;

  -- Registrar la compra en stripe_purchases
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

  -- Si la sesión ya existía en stripe_purchases, autorreparación
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

    -- 4. Sesiones Grupales (Miriam - Autoayuda / Terapéutico)
    ELSIF v_normalized_purchase_type IN (
      'miriam_grupo_autoayuda', 'miriam_grupo_terapeutico', 'bono_grupal', 'bonos_grupos', 'prod_VDmmlmsGGhMebt'
    ) OR v_normalized_purchase_type LIKE '%autoayuda%' OR v_normalized_purchase_type LIKE '%terapeut%' OR v_normalized_purchase_type LIKE '%grupo%' THEN
      UPDATE public.profiles
         SET saldo_grupal = coalesce(saldo_grupal, 0) + 1,
             stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;

    -- 5. Consultas Psicología Individuales (Miriam)
    ELSIF v_normalized_purchase_type IN (
      'miriam_psico_individual_1a', 'miriam_psico_individual_sig',
      'miriam_psico_pareja_1a', 'miriam_psico_pareja_sig',
      'isabel_pni_1a', 'isabel_pni_sig'
    ) OR v_normalized_purchase_type LIKE '%psico%' OR v_normalized_purchase_type LIKE '%miriam%' THEN
      UPDATE public.profiles
         SET saldo_psicologia = coalesce(saldo_psicologia, 0) + 1,
             stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;

    -- 6. Consultas Nutrición / Ayurveda (Silvia)
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

    -- 7. Talleres
    ELSIF v_normalized_purchase_type IN ('taller_intro_power_vinyasa', 'taller_35', 'taller_25', 'taller')
          OR v_normalized_purchase_type LIKE '%taller%' THEN
      UPDATE public.profiles
         SET stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;

    -- 8. Productos dinámicos basados en Stripe prod_*
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

REVOKE ALL ON FUNCTION public.stripe_fulfill_checkout(text, text, bigint, text, uuid, boolean, text, text, text, text, text, bigint, text, text, text, timestamp with time zone, timestamp with time zone, text, boolean, boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stripe_fulfill_checkout(text, text, bigint, text, uuid, boolean, text, text, text, text, text, bigint, text, text, text, timestamp with time zone, timestamp with time zone, text, boolean, boolean) TO service_role;

-- 6. Actualizar admin_fusionar_perfiles para consolidar saldo_grupal
CREATE OR REPLACE FUNCTION public.admin_fusionar_perfiles(
  p_perfil_conservar_id uuid,
  p_perfil_eliminar_id uuid,
  p_sumar_saldos boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_admin_role text;
  v_conservar record;
  v_eliminar record;
BEGIN
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Autenticación requerida para fusionar perfiles' USING errcode = '42501';
  END IF;
  SELECT lower(coalesce(rol, '')) INTO v_admin_role FROM public.profiles WHERE id = v_admin_id;
  IF v_admin_role <> 'admin' THEN
    RAISE EXCEPTION 'Solo un administrador puede fusionar perfiles' USING errcode = '42501';
  END IF;

  IF p_perfil_conservar_id IS NULL OR p_perfil_eliminar_id IS NULL OR p_perfil_conservar_id = p_perfil_eliminar_id THEN
    RAISE EXCEPTION 'Identificadores de perfiles inválidos para la fusión' USING errcode = '22023';
  END IF;

  SELECT * INTO v_conservar FROM public.profiles WHERE id = p_perfil_conservar_id FOR UPDATE;
  SELECT * INTO v_eliminar FROM public.profiles WHERE id = p_perfil_eliminar_id FOR UPDATE;

  IF v_conservar.id IS NULL OR v_eliminar.id IS NULL THEN
    RAISE EXCEPTION 'Uno de los perfiles especificados no existe' USING errcode = 'P0002';
  END IF;

  -- 1. Reasignar reservas de yoga y asistencias
  UPDATE public.reservas_yoga SET user_id = p_perfil_conservar_id WHERE user_id = p_perfil_eliminar_id;
  UPDATE public.asistencias_clases SET user_id = p_perfil_conservar_id WHERE user_id = p_perfil_eliminar_id;

  -- 2. Reasignar reservas de consultas
  UPDATE public.reservas_psicologia SET user_id = p_perfil_conservar_id WHERE user_id = p_perfil_eliminar_id;
  UPDATE public.reservas_nutricion SET user_id = p_perfil_conservar_id WHERE user_id = p_perfil_eliminar_id;

  -- 3. Reasignar compras y suscripciones
  UPDATE public.stripe_purchases SET user_id = p_perfil_conservar_id WHERE user_id = p_perfil_eliminar_id;
  UPDATE public.stripe_customers SET user_id = p_perfil_conservar_id WHERE user_id = p_perfil_eliminar_id;

  -- 4. Reasignar packs, bonos y periodos
  UPDATE public.class_credit_packs SET user_id = p_perfil_conservar_id WHERE user_id = p_perfil_eliminar_id;
  UPDATE public.unlimited_membership_periods SET user_id = p_perfil_conservar_id WHERE user_id = p_perfil_eliminar_id;
  UPDATE public.bonos_clases_especiales SET user_id = p_perfil_conservar_id WHERE user_id = p_perfil_eliminar_id;
  UPDATE public.creditos_reprogramacion SET user_id = p_perfil_conservar_id WHERE user_id = p_perfil_eliminar_id;

  -- 5. Consolidar saldos en el perfil a conservar
  UPDATE public.profiles
     SET bonos = coalesce(v_conservar.bonos, 0) + CASE WHEN coalesce(p_sumar_saldos, true) THEN coalesce(v_eliminar.bonos, 0) ELSE 0 END,
         saldo_clases_gratis = coalesce(v_conservar.saldo_clases_gratis, 0) + CASE WHEN coalesce(p_sumar_saldos, true) THEN coalesce(v_eliminar.saldo_clases_gratis, 0) ELSE 0 END,
         saldo_consultas_gratis = coalesce(v_conservar.saldo_consultas_gratis, 0) + CASE WHEN coalesce(p_sumar_saldos, true) THEN coalesce(v_eliminar.saldo_consultas_gratis, 0) ELSE 0 END,
         saldo_psicologia = coalesce(v_conservar.saldo_psicologia, 0) + CASE WHEN coalesce(p_sumar_saldos, true) THEN coalesce(v_eliminar.saldo_psicologia, 0) ELSE 0 END,
         saldo_nutricion = coalesce(v_conservar.saldo_nutricion, 0) + CASE WHEN coalesce(p_sumar_saldos, true) THEN coalesce(v_eliminar.saldo_nutricion, 0) ELSE 0 END,
         saldo_grupal = coalesce(v_conservar.saldo_grupal, 0) + CASE WHEN coalesce(p_sumar_saldos, true) THEN coalesce(v_eliminar.saldo_grupal, 0) ELSE 0 END,
         saldo_yoga_compania = coalesce(v_conservar.saldo_yoga_compania, 0) + CASE WHEN coalesce(p_sumar_saldos, true) THEN coalesce(v_eliminar.saldo_yoga_compania, 0) ELSE 0 END,
         bono_mensual_activo = coalesce(v_conservar.bono_mensual_activo, false) OR coalesce(v_eliminar.bono_mensual_activo, false),
         bono_mensual_inicio = least(v_conservar.bono_mensual_inicio, v_eliminar.bono_mensual_inicio),
         bono_mensual_fin = greatest(v_conservar.bono_mensual_fin, v_eliminar.bono_mensual_fin),
         stripe_customer_id = coalesce(v_conservar.stripe_customer_id, v_eliminar.stripe_customer_id),
         updated_at = timezone('utc', now())
   WHERE id = p_perfil_conservar_id;

  -- 6. Eliminar el perfil secundario
  DELETE FROM public.profiles WHERE id = p_perfil_eliminar_id;

  RETURN jsonb_build_object(
    'status', 'success',
    'perfil_conservado', p_perfil_conservar_id,
    'perfil_eliminado', p_perfil_eliminar_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_fusionar_perfiles(uuid, uuid, boolean) TO authenticated, service_role;

COMMIT;

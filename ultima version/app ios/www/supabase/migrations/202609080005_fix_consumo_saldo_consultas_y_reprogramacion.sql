-- ==============================================================================
-- MIGRACIÓN v12.20: Consumo de Créditos de Reprogramación en Consultas,
-- Corrección de Reintegros, Saneamiento de Saldos y Gestión de Tipos de Sesión
-- ==============================================================================

BEGIN;

-- 1. Asegurar columnas de metodos_pago y productos en tipos_clases
ALTER TABLE public.tipos_clases
  ADD COLUMN IF NOT EXISTS stripe_product_id text,
  ADD COLUMN IF NOT EXISTS metodo_pago text,
  ADD COLUMN IF NOT EXISTS metodos_pago text[];

-- 2. Redefinir reservar_consulta_atomica para consumir créditos de reprogramación
CREATE OR REPLACE FUNCTION public.reservar_consulta_atomica(
  p_tipo text,
  p_clase_id bigint,
  p_user_id uuid DEFAULT NULL,
  p_cobrar_saldo boolean DEFAULT true,
  p_producto_contratado text DEFAULT NULL,
  p_stripe_lookup_key text DEFAULT NULL,
  p_origen_pago text DEFAULT 'online',
  p_notas text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_target_id uuid;
  v_target_free_consultations integer := 0;
  v_capacity integer;
  v_occupied integer;
  v_starts_at timestamptz;
  v_is_free boolean := false;
  v_charge boolean := true;
  v_reservation_id bigint;
  v_name text;
  v_reprog_credit_id bigint;
  v_effective_producto text := trim(coalesce(p_producto_contratado, ''));
  v_effective_lookup text := trim(coalesce(p_stripe_lookup_key, ''));
  v_effective_origen text := trim(coalesce(p_origen_pago, 'online'));
  v_effective_notas text := trim(coalesce(p_notas, ''));
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING errcode = '42501';
  END IF;
  IF p_tipo NOT IN ('psicologia', 'nutricion') OR p_clase_id IS NULL OR p_clase_id <= 0 THEN
    RAISE EXCEPTION 'invalid input parameters' USING errcode = '22023';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))) INTO v_actor_role
    FROM public.profiles WHERE id = v_actor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'actor profile not found' USING errcode = 'P0002'; END IF;

  IF p_user_id IS NOT NULL AND p_user_id <> v_actor_id THEN
    IF v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
      RAISE EXCEPTION 'permission denied to book for another user' USING errcode = '42501';
    END IF;
    v_target_id := p_user_id;
  ELSE
    v_target_id := v_actor_id;
  END IF;

  SELECT coalesce(saldo_consultas_gratis, 0)
    INTO v_target_free_consultations
    FROM public.profiles WHERE id = v_target_id FOR UPDATE;

  SELECT coalesce(capacidad_max, 1), fecha_inicio, coalesce(es_gratuita, false),
         lower(trim(coalesce(nombre, '')))
    INTO v_capacity, v_starts_at, v_is_free, v_name
    FROM public.clases
   WHERE id = p_clase_id AND tipo_clase = p_tipo AND activa = true
     FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'consultation not found or inactive' USING errcode = 'P0002'; END IF;
  IF v_starts_at IS NULL OR v_starts_at <= now() THEN
    RAISE EXCEPTION 'consultation start time has already passed' USING errcode = 'P0001';
  END IF;

  -- Regla: El Bono de Bienvenida cubre ÚNICAMENTE sesiones introductorias o marcadas como gratuitas
  IF (v_is_free OR v_name LIKE '%introduct%') THEN
    v_is_free := true;
  ELSE
    v_is_free := false;
  END IF;

  IF p_tipo = 'psicologia' THEN
    IF EXISTS (SELECT 1 FROM public.reservas_psicologia
               WHERE clase_id = p_clase_id AND user_id = v_target_id AND estado = 'confirmada') THEN
      RAISE EXCEPTION 'consultation already booked' USING errcode = '23505';
    END IF;
    SELECT count(*)::integer INTO v_occupied
      FROM public.reservas_psicologia
     WHERE clase_id = p_clase_id AND estado = 'confirmada';
  ELSE
    IF EXISTS (SELECT 1 FROM public.reservas_nutricion
               WHERE clase_id = p_clase_id AND user_id = v_target_id AND estado = 'confirmada') THEN
      RAISE EXCEPTION 'consultation already booked' USING errcode = '23505';
    END IF;
    SELECT count(*)::integer INTO v_occupied
      FROM public.reservas_nutricion
     WHERE clase_id = p_clase_id AND estado = 'confirmada';
  END IF;
  IF v_occupied >= v_capacity THEN RAISE EXCEPTION 'consultation is full' USING errcode = 'P0001'; END IF;

  v_charge := NOT (v_actor_role IN ('admin', 'profesor', 'trabajador', 'profesional')
                   AND coalesce(p_cobrar_saldo, true) = false);

  -- 1. Canje de bono gratuito de bienvenida
  IF v_is_free AND v_charge THEN
    UPDATE public.profiles SET saldo_consultas_gratis = saldo_consultas_gratis - 1
     WHERE id = v_target_id AND coalesce(saldo_consultas_gratis, 0) >= 1;
    IF NOT FOUND THEN
      v_is_free := false;
    END IF;
  END IF;

  -- 2. Canje de saldo de consulta o crédito de reprogramación
  IF NOT v_is_free AND v_charge THEN
    -- A) Intentar consumir primero un crédito de reprogramación disponible
    SELECT id INTO v_reprog_credit_id
      FROM public.creditos_reprogramacion
     WHERE user_id = v_target_id
       AND tipo = 'consulta'
       AND (subtipo = p_tipo OR subtipo IS NULL OR subtipo = '')
       AND estado = 'disponible'
     ORDER BY created_at ASC, id ASC
     LIMIT 1
     FOR UPDATE SKIP LOCKED;

    IF v_reprog_credit_id IS NOT NULL THEN
      UPDATE public.creditos_reprogramacion
         SET estado = 'utilizado',
             clase_id_destino = p_clase_id,
             utilizado_at = now()
       WHERE id = v_reprog_credit_id;

      -- Sincronizar saldo numérico en profiles si disponía de él
      IF p_tipo = 'psicologia' THEN
        UPDATE public.profiles
           SET saldo_psicologia = greatest(coalesce(saldo_psicologia, 0) - 1, 0)
         WHERE id = v_target_id AND coalesce(saldo_psicologia, 0) >= 1;
      ELSE
        UPDATE public.profiles
           SET saldo_nutricion = greatest(coalesce(saldo_nutricion, 0) - 1, 0)
         WHERE id = v_target_id AND coalesce(saldo_nutricion, 0) >= 1;
      END IF;
    ELSE
      -- B) No hay crédito de reprogramación: descontar saldo directo de la especialidad
      IF p_tipo = 'psicologia' THEN
        UPDATE public.profiles SET saldo_psicologia = saldo_psicologia - 1
         WHERE id = v_target_id AND coalesce(saldo_psicologia, 0) >= 1;
      ELSE
        UPDATE public.profiles SET saldo_nutricion = saldo_nutricion - 1
         WHERE id = v_target_id AND coalesce(saldo_nutricion, 0) >= 1;
      END IF;
      IF NOT FOUND THEN RAISE EXCEPTION 'No dispones de saldo para esta consulta.' USING errcode = 'P0001'; END IF;
    END IF;
  END IF;

  -- Determinar producto por defecto si no viene especificado
  IF v_effective_producto = '' THEN
    IF v_is_free THEN
      v_effective_producto := 'Consulta Gratuita de Bienvenida (0 €)';
    ELSE
      SELECT coalesce(metodo_pago, 'Consulta ' || initcap(p_tipo)) INTO v_effective_producto
        FROM public.clases WHERE id = p_clase_id;
    END IF;
  END IF;

  -- Actualizar datos de producto en la clase para sincronización pública
  UPDATE public.clases
     SET metodo_pago = COALESCE(NULLIF(v_effective_producto, ''), metodo_pago),
         stripe_lookup_key = COALESCE(NULLIF(v_effective_lookup, ''), stripe_lookup_key)
   WHERE id = p_clase_id;

  IF p_tipo = 'psicologia' THEN
    INSERT INTO public.reservas_psicologia (
      clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado,
      producto_contratado, stripe_lookup_key, origen_pago, notas
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', (v_charge AND NOT v_is_free), (v_charge AND v_is_free),
      v_effective_producto, v_effective_lookup, v_effective_origen, v_effective_notas
    )
    RETURNING id INTO v_reservation_id;
  ELSE
    INSERT INTO public.reservas_nutricion (
      clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado,
      producto_contratado, stripe_lookup_key, origen_pago, notas
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', (v_charge AND NOT v_is_free), (v_charge AND v_is_free),
      v_effective_producto, v_effective_lookup, v_effective_origen, v_effective_notas
    )
    RETURNING id INTO v_reservation_id;
  END IF;

  RETURN v_reservation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reservar_consulta_atomica(text, bigint, uuid, boolean, text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reservar_consulta_atomica(text, bigint, uuid, boolean, text, text, text, text) TO authenticated, service_role;

-- 3. Redefinir cancelar_consulta_atomica con ELSIF estricto
CREATE OR REPLACE FUNCTION public.cancelar_consulta_atomica(
  p_tipo text,
  p_reserva_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_actor_is_staff boolean;
  v_target_id uuid;
  v_class_id bigint;
  v_starts_at timestamptz;
  v_class_month date;
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

  SELECT fecha_inicio INTO v_starts_at
    FROM public.clases WHERE id = v_class_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'consultation slot not found' USING errcode = 'P0002';
  END IF;

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

  v_class_month := date_trunc('month', v_starts_at AT TIME ZONE 'Europe/Madrid')::date;

  IF p_tipo = 'psicologia' THEN
    DELETE FROM public.reservas_psicologia WHERE id = p_reserva_id;
  ELSE
    DELETE FROM public.reservas_nutricion WHERE id = p_reserva_id;
  END IF;

  -- 1. Si era sesión gratuita de valoración, reintegrar saldo_consultas_gratis
  IF v_refund_free THEN
    UPDATE public.profiles
       SET saldo_consultas_gratis = coalesce(saldo_consultas_gratis, 0) + 1
     WHERE id = v_target_id;
  -- 2. Si era consulta de pago o saldo real: emitir crédito de reprogramación y mantener saldo en sincronía
  ELSIF v_refund_paid THEN
    INSERT INTO public.creditos_reprogramacion
      (user_id, tipo, subtipo, mes, clase_id_origen, reserva_id_origen, estado)
    VALUES
      (v_target_id, 'consulta', p_tipo, v_class_month, v_class_id, p_reserva_id, 'disponible');

    IF p_tipo = 'psicologia' THEN
      UPDATE public.profiles
         SET saldo_psicologia = coalesce(saldo_psicologia, 0) + 1
       WHERE id = v_target_id;
    ELSE
      UPDATE public.profiles
         SET saldo_nutricion = coalesce(saldo_nutricion, 0) + 1
       WHERE id = v_target_id;
    END IF;
  END IF;
  -- NOTA: Si no era ni gratuita ni pagada con saldo (v_refund_paid = false), NO se emite saldo.

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.cancelar_consulta_atomica(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancelar_consulta_atomica(text, bigint) TO authenticated, service_role;

-- 4. Actualizar admin_eliminar_clase para reembolsar consultas de forma estricta
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
  v_class_type text;
  v_class_name text;
  v_starts_at timestamptz;
  v_class_month date;
  v_is_special boolean;
  v_booking record;
  v_refunded_count integer := 0;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))) INTO v_actor_role
    FROM public.profiles WHERE id = v_actor_id;
  IF NOT FOUND OR v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'unauthorized' USING errcode = '42501';
  END IF;

  SELECT tipo_clase, nombre, fecha_inicio, coalesce(es_especial, false)
    INTO v_class_type, v_class_name, v_starts_at, v_is_special
    FROM public.clases WHERE id = p_clase_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'class not found' USING errcode = 'P0002';
  END IF;

  v_class_month := date_trunc('month', v_starts_at AT TIME ZONE 'Europe/Madrid')::date;

  -- 1. Yoga y Eventos
  FOR v_booking IN (
    SELECT id, user_id, class_pack_id, coalesce(bono_descontado, false) as bono_descontado,
           coalesce(saldo_gratis_descontado, false) as saldo_gratis_descontado,
           coalesce(tipo_reserva, '') as tipo_reserva
      FROM public.reservas_yoga
     WHERE clase_id = p_clase_id
       AND estado = 'confirmada'
  ) LOOP
    IF v_class_type = 'taller' OR v_booking.tipo_reserva = 'reprogramacion_taller' THEN
      INSERT INTO public.creditos_reprogramacion
        (user_id, tipo, subtipo, mes, clase_id_origen, reserva_id_origen, estado)
      VALUES
        (v_booking.user_id, 'taller', 'taller_120', v_class_month, p_clase_id, v_booking.id, 'disponible');
    ELSIF v_class_type = 'clase_especial' OR v_booking.tipo_reserva = 'clase_especial' THEN
      INSERT INTO public.bonos_clases_especiales (user_id, mes, saldo, origen)
      VALUES (v_booking.user_id, v_class_month, 1, 'reintegro_admin_cancelacion');
    ELSIF v_booking.saldo_gratis_descontado OR v_booking.tipo_reserva = 'bienvenida' THEN
      UPDATE public.profiles
         SET saldo_clases_gratis = coalesce(saldo_clases_gratis, 0) + 1
       WHERE id = v_booking.user_id;
    ELSIF v_booking.class_pack_id IS NOT NULL THEN
      UPDATE public.class_credit_packs
         SET credits_remaining = credits_remaining + 1,
             updated_at = now()
       WHERE id = v_booking.class_pack_id;
    ELSIF v_booking.bono_descontado THEN
      UPDATE public.profiles
         SET bonos = coalesce(bonos, 0) + 1
       WHERE id = v_booking.user_id;
    END IF;
    v_refunded_count := v_refunded_count + 1;
  END LOOP;

  -- 2. Consultas de Psicología
  FOR v_booking IN (
    SELECT id, user_id, coalesce(saldo_descontado, false) as saldo_descontado,
           coalesce(saldo_gratis_descontado, false) as saldo_gratis_descontado
      FROM public.reservas_psicologia
     WHERE clase_id = p_clase_id AND estado = 'confirmada'
  ) LOOP
    IF v_booking.saldo_gratis_descontado THEN
      UPDATE public.profiles SET saldo_consultas_gratis = coalesce(saldo_consultas_gratis, 0) + 1 WHERE id = v_booking.user_id;
    ELSIF v_booking.saldo_descontado THEN
      UPDATE public.profiles SET saldo_psicologia = coalesce(saldo_psicologia, 0) + 1 WHERE id = v_booking.user_id;
      INSERT INTO public.creditos_reprogramacion
        (user_id, tipo, subtipo, mes, clase_id_origen, reserva_id_origen, estado)
      VALUES
        (v_booking.user_id, 'consulta', 'psicologia', v_class_month, p_clase_id, v_booking.id, 'disponible');
    END IF;
    v_refunded_count := v_refunded_count + 1;
  END LOOP;

  -- 3. Consultas de Nutrición
  FOR v_booking IN (
    SELECT id, user_id, coalesce(saldo_descontado, false) as saldo_descontado,
           coalesce(saldo_gratis_descontado, false) as saldo_gratis_descontado
      FROM public.reservas_nutricion
     WHERE clase_id = p_clase_id AND estado = 'confirmada'
  ) LOOP
    IF v_booking.saldo_gratis_descontado THEN
      UPDATE public.profiles SET saldo_consultas_gratis = coalesce(saldo_consultas_gratis, 0) + 1 WHERE id = v_booking.user_id;
    ELSIF v_booking.saldo_descontado THEN
      UPDATE public.profiles SET saldo_nutricion = coalesce(saldo_nutricion, 0) + 1 WHERE id = v_booking.user_id;
      INSERT INTO public.creditos_reprogramacion
        (user_id, tipo, subtipo, mes, clase_id_origen, reserva_id_origen, estado)
      VALUES
        (v_booking.user_id, 'consulta', 'nutricion', v_class_month, p_clase_id, v_booking.id, 'disponible');
    END IF;
    v_refunded_count := v_refunded_count + 1;
  END LOOP;

  DELETE FROM public.reservas_yoga WHERE clase_id = p_clase_id;
  DELETE FROM public.reservas_psicologia WHERE clase_id = p_clase_id;
  DELETE FROM public.reservas_nutricion WHERE clase_id = p_clase_id;
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

-- 5. RPC Administrativa para retirar crédito de reprogramación
CREATE OR REPLACE FUNCTION public.admin_retirar_credito_reprogramacion(
  p_credito_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'not authenticated' USING errcode = '42501'; END IF;
  SELECT lower(trim(coalesce(rol, ''))) INTO v_actor_role FROM public.profiles WHERE id = v_actor_id;
  IF NOT FOUND OR v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'unauthorized' USING errcode = '42501';
  END IF;

  UPDATE public.creditos_reprogramacion
     SET estado = 'cancelado', utilizado_at = now()
   WHERE id = p_credito_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_retirar_credito_reprogramacion(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_retirar_credito_reprogramacion(bigint) TO authenticated, service_role;

-- 6. Saneamiento automático de créditos huérfanos/duplicados en consultas
WITH creditos_numerados AS (
  SELECT id, user_id, coalesce(subtipo, 'psicologia') as subtipo,
         ROW_NUMBER() OVER (
           PARTITION BY user_id, coalesce(subtipo, 'psicologia')
           ORDER BY created_at DESC, id DESC
         ) as rn
    FROM public.creditos_reprogramacion
   WHERE tipo = 'consulta' AND estado = 'disponible'
),
excesos AS (
  SELECT cn.id
    FROM creditos_numerados cn
    JOIN public.profiles p ON p.id = cn.user_id
   WHERE (cn.subtipo = 'psicologia' AND cn.rn > coalesce(p.saldo_psicologia, 0))
      OR (cn.subtipo = 'nutricion' AND cn.rn > coalesce(p.saldo_nutricion, 0))
)
UPDATE public.creditos_reprogramacion
   SET estado = 'utilizado', utilizado_at = now()
 WHERE id IN (SELECT id FROM excesos);

NOTIFY pgrst, 'reload schema';

COMMIT;

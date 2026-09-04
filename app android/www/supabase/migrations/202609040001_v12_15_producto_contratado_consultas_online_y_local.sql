-- ==============================================================================
-- MIGRACIÓN v12.15: Producto Contratado en Consultas (Stripe Online y Pago en Local)
-- ==============================================================================

BEGIN;

-- 1. Añadir columnas producto_contratado, stripe_lookup_key, origen_pago y notas
-- en reservas_psicologia y reservas_nutricion
ALTER TABLE public.reservas_psicologia
  ADD COLUMN IF NOT EXISTS producto_contratado text,
  ADD COLUMN IF NOT EXISTS stripe_lookup_key text,
  ADD COLUMN IF NOT EXISTS origen_pago text DEFAULT 'online',
  ADD COLUMN IF NOT EXISTS notas text DEFAULT '';

ALTER TABLE public.reservas_nutricion
  ADD COLUMN IF NOT EXISTS producto_contratado text,
  ADD COLUMN IF NOT EXISTS stripe_lookup_key text,
  ADD COLUMN IF NOT EXISTS origen_pago text DEFAULT 'online',
  ADD COLUMN IF NOT EXISTS notas text DEFAULT '';

-- Asegurar columnas en clases para compatibilidad directa y visibilidad sin RLS elevado
ALTER TABLE public.clases
  ADD COLUMN IF NOT EXISTS metodo_pago text,
  ADD COLUMN IF NOT EXISTS stripe_lookup_key text;

CREATE INDEX IF NOT EXISTS idx_reservas_psicologia_origen_pago ON public.reservas_psicologia(origen_pago);
CREATE INDEX IF NOT EXISTS idx_reservas_nutricion_origen_pago ON public.reservas_nutricion(origen_pago);
CREATE INDEX IF NOT EXISTS idx_clases_metodo_pago ON public.clases(metodo_pago);
CREATE INDEX IF NOT EXISTS idx_clases_stripe_lookup_key ON public.clases(stripe_lookup_key);

COMMENT ON COLUMN public.reservas_psicologia.producto_contratado IS 'Nombre del producto Stripe o tipo de consulta contratada';
COMMENT ON COLUMN public.reservas_psicologia.stripe_lookup_key IS 'Identificador o lookup_key de Stripe del producto';
COMMENT ON COLUMN public.reservas_psicologia.origen_pago IS 'Procedencia: online (Stripe directo) o local (pago presencial administrado)';

COMMENT ON COLUMN public.reservas_nutricion.producto_contratado IS 'Nombre del producto Stripe o tipo de consulta contratada';
COMMENT ON COLUMN public.reservas_nutricion.stripe_lookup_key IS 'Identificador o lookup_key de Stripe del producto';
COMMENT ON COLUMN public.reservas_nutricion.origen_pago IS 'Procedencia: online (Stripe directo) o local (pago presencial administrado)';

-- 2. Eliminar firmas anteriores para evitar ambigüedad de sobrecarga de funciones
DROP FUNCTION IF EXISTS public.reservar_consulta_atomica(text, bigint, uuid, boolean);
DROP FUNCTION IF EXISTS public.reservar_consulta_virtual(text, bigint, timestamptz, uuid, boolean);
DROP FUNCTION IF EXISTS public.admin_asignar_consulta_paciente(text, bigint, uuid, boolean, text);

-- 3. Redefinir reservar_consulta_atomica aceptando producto_contratado, stripe_lookup_key, origen_pago y notas
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

  -- Regla v11.9: El Bono de Bienvenida cubre ÚNICAMENTE sesiones introductorias o marcadas como gratuitas.
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

  IF v_is_free AND v_charge THEN
    UPDATE public.profiles SET saldo_consultas_gratis = saldo_consultas_gratis - 1
     WHERE id = v_target_id AND coalesce(saldo_consultas_gratis, 0) >= 1;
    IF NOT FOUND THEN
      v_is_free := false;
    END IF;
  END IF;

  IF NOT v_is_free AND v_charge THEN
    IF p_tipo = 'psicologia' THEN
      UPDATE public.profiles SET saldo_psicologia = saldo_psicologia - 1
       WHERE id = v_target_id AND coalesce(saldo_psicologia, 0) >= 1;
    ELSE
      UPDATE public.profiles SET saldo_nutricion = saldo_nutricion - 1
       WHERE id = v_target_id AND coalesce(saldo_nutricion, 0) >= 1;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'No dispones de saldo para esta consulta.' USING errcode = 'P0001'; END IF;
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

-- 4. Redefinir reservar_consulta_virtual aceptando producto y lookup_key
CREATE OR REPLACE FUNCTION public.reservar_consulta_virtual(
  p_tipo text,
  p_profesor_id bigint,
  p_fecha_inicio timestamptz,
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
  v_clase_id bigint;
  v_duracion integer := 60;
  v_nombre_clase text;
  v_fecha_fin timestamptz;
  v_effective_producto text := trim(coalesce(p_producto_contratado, ''));
  v_effective_lookup text := trim(coalesce(p_stripe_lookup_key, ''));
  v_effective_origen text := trim(coalesce(p_origen_pago, 'online'));
  v_effective_notas text := trim(coalesce(p_notas, ''));
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING errcode = '42501';
  END IF;

  SELECT id INTO v_clase_id
    FROM public.clases
   WHERE tipo_clase = p_tipo
     AND profesor_id = p_profesor_id
     AND fecha_inicio = p_fecha_inicio
     AND activa = true
   LIMIT 1;

  IF v_clase_id IS NULL THEN
    v_nombre_clase := CASE WHEN p_tipo = 'psicologia' THEN 'Consulta Psicología' ELSE 'Consulta Nutrición' END;
    v_fecha_fin := p_fecha_inicio + interval '60 minutes';

    INSERT INTO public.clases (
      nombre,
      fecha_inicio,
      fecha_fin,
      capacidad_max,
      profesor_id,
      tipo_clase,
      duracion_minutos,
      activa,
      metodo_pago,
      stripe_lookup_key
    ) VALUES (
      v_nombre_clase,
      p_fecha_inicio,
      v_fecha_fin,
      1,
      p_profesor_id,
      p_tipo,
      v_duracion,
      true,
      NULLIF(v_effective_producto, ''),
      NULLIF(v_effective_lookup, '')
    ) RETURNING id INTO v_clase_id;
  END IF;

  PERFORM public.reservar_consulta_atomica(
    p_tipo,
    v_clase_id,
    p_user_id,
    p_cobrar_saldo,
    v_effective_producto,
    v_effective_lookup,
    v_effective_origen,
    v_effective_notas
  );

  RETURN v_clase_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reservar_consulta_virtual(text, bigint, timestamptz, uuid, boolean, text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reservar_consulta_virtual(text, bigint, timestamptz, uuid, boolean, text, text, text, text) TO authenticated, service_role;

-- 5. Redefinir admin_asignar_consulta_paciente aceptando producto_contratado y stripe_lookup_key
CREATE OR REPLACE FUNCTION public.admin_asignar_consulta_paciente(
  p_tipo text,
  p_clase_id bigint,
  p_user_id uuid,
  p_cobrar_saldo boolean DEFAULT false,
  p_notas text DEFAULT NULL,
  p_producto_contratado text DEFAULT NULL,
  p_stripe_lookup_key text DEFAULT NULL,
  p_origen_pago text DEFAULT 'local'
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_reservation_id bigint;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  SELECT lower(coalesce(rol, ''))
    INTO v_actor_role
    FROM public.profiles
   WHERE id = v_actor_id;

  IF NOT FOUND OR v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'unauthorized: staff or admin role required';
  END IF;

  v_reservation_id := public.reservar_consulta_atomica(
    p_tipo,
    p_clase_id,
    p_user_id,
    p_cobrar_saldo,
    p_producto_contratado,
    p_stripe_lookup_key,
    COALESCE(p_origen_pago, 'local'),
    p_notas
  );

  RETURN v_reservation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_asignar_consulta_paciente(text, bigint, uuid, boolean, text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_asignar_consulta_paciente(text, bigint, uuid, boolean, text, text, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

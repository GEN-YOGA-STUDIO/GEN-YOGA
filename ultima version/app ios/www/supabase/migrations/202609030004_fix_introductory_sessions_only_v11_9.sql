-- ============================================================================
-- Migration 202609030004: Restringir Bono de Bienvenida estrictamente a
-- Sesiones Introductorias (NUNCA consultas regulares).
-- ============================================================================

BEGIN;

-- 1. Actualizar la función atómica de reserva de consultas para que el bono gratuito
-- aplique EXCLUSIVAMENTE a sesiones introductorias o marcadas como gratuitas.
CREATE OR REPLACE FUNCTION public.reservar_consulta_atomica(
  p_tipo text,
  p_clase_id bigint,
  p_user_id uuid DEFAULT NULL,
  p_cobrar_saldo boolean DEFAULT true
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
  -- NUNCA cubre consultas regulares por tener capacidad 1 o ser consultas de pago.
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

  IF p_tipo = 'psicologia' THEN
    INSERT INTO public.reservas_psicologia (clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado)
    VALUES (p_clase_id, v_target_id, 'confirmada', (v_charge AND NOT v_is_free), (v_charge AND v_is_free))
    RETURNING id INTO v_reservation_id;
  ELSE
    INSERT INTO public.reservas_nutricion (clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado)
    VALUES (p_clase_id, v_target_id, 'confirmada', (v_charge AND NOT v_is_free), (v_charge AND v_is_free))
    RETURNING id INTO v_reservation_id;
  END IF;
  RETURN v_reservation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reservar_consulta_atomica(text, bigint, uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reservar_consulta_atomica(text, bigint, uuid, boolean) TO authenticated, service_role;

-- 2. Asegurar sesiones introductorias para Miriam e Isabel en septiembre 2026 si no existen
DO $$
DECLARE
  v_miriam_id integer;
  v_isabel_id integer;
BEGIN
  SELECT id INTO v_miriam_id FROM public.profesionales WHERE lower(nombre) LIKE '%miriam%' LIMIT 1;
  SELECT id INTO v_isabel_id FROM public.profesionales WHERE lower(nombre) LIKE '%isabel%' LIMIT 1;

  IF v_miriam_id IS NOT NULL THEN
    -- Martes 15 de Septiembre a las 20:15
    IF NOT EXISTS (SELECT 1 FROM public.clases WHERE profesor_id = v_miriam_id AND fecha_inicio = '2026-09-15 20:15:00+02'::timestamptz) THEN
      INSERT INTO public.clases (nombre, fecha_inicio, fecha_fin, duracion_minutos, capacidad_max, profesor_id, tipo_clase, activa, es_gratuita, descripcion)
      VALUES ('Sesión Introductoria de Psicología', '2026-09-15 20:15:00+02'::timestamptz, '2026-09-15 21:15:00+02'::timestamptz, 60, 10, v_miriam_id, 'psicologia', true, true, 'Sesión introductoria y gratuita de Psicología con Miriam');
    END IF;

    -- Martes 22 de Septiembre a las 20:15
    IF NOT EXISTS (SELECT 1 FROM public.clases WHERE profesor_id = v_miriam_id AND fecha_inicio = '2026-09-22 20:15:00+02'::timestamptz) THEN
      INSERT INTO public.clases (nombre, fecha_inicio, fecha_fin, duracion_minutos, capacidad_max, profesor_id, tipo_clase, activa, es_gratuita, descripcion)
      VALUES ('Sesión Introductoria de Psicología', '2026-09-22 20:15:00+02'::timestamptz, '2026-09-22 21:15:00+02'::timestamptz, 60, 10, v_miriam_id, 'psicologia', true, true, 'Sesión introductoria y gratuita de Psicología con Miriam');
    END IF;

    -- Miércoles 23 de Septiembre a las 11:30
    IF NOT EXISTS (SELECT 1 FROM public.clases WHERE profesor_id = v_miriam_id AND fecha_inicio = '2026-09-23 11:30:00+02'::timestamptz) THEN
      INSERT INTO public.clases (nombre, fecha_inicio, fecha_fin, duracion_minutos, capacidad_max, profesor_id, tipo_clase, activa, es_gratuita, descripcion)
      VALUES ('Sesión Introductoria de Psicología', '2026-09-23 11:30:00+02'::timestamptz, '2026-09-23 12:30:00+02'::timestamptz, 60, 10, v_miriam_id, 'psicologia', true, true, 'Sesión introductoria y gratuita de Psicología con Miriam');
    END IF;
  END IF;

  IF v_isabel_id IS NOT NULL THEN
    -- Martes 15 de Septiembre a las 11:00
    IF NOT EXISTS (SELECT 1 FROM public.clases WHERE profesor_id = v_isabel_id AND fecha_inicio = '2026-09-15 11:00:00+02'::timestamptz) THEN
      INSERT INTO public.clases (nombre, fecha_inicio, fecha_fin, duracion_minutos, capacidad_max, profesor_id, tipo_clase, activa, es_gratuita, descripcion)
      VALUES ('Sesión Introductoria a la Psiconeuroinmunología', '2026-09-15 11:00:00+02'::timestamptz, '2026-09-15 12:00:00+02'::timestamptz, 60, 10, v_isabel_id, 'psicologia', true, true, 'Sesión introductoria y gratuita de Psiconeuroinmunología con Isabel');
    END IF;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;

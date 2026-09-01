BEGIN;

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
  v_target_id uuid := coalesce(p_user_id, auth.uid());
  v_target_role text;
  v_type text;
  v_capacity integer;
  v_occupied integer;
  v_starts_at timestamptz;
  v_is_free boolean;
  v_reservation_id bigint;
  v_charge boolean;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING errcode = '42501'; END IF;
  IF p_tipo NOT IN ('psicologia', 'nutricion') OR p_clase_id IS NULL OR v_target_id IS NULL THEN
    RAISE EXCEPTION 'invalid booking request' USING errcode = '22023';
  END IF;

  SELECT lower(coalesce(rol, '')) INTO v_actor_role
    FROM public.profiles WHERE id = v_actor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'actor profile not found'; END IF;
  IF v_target_id <> v_actor_id
     AND v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'not allowed to book for another user' USING errcode = '42501';
  END IF;

  SELECT lower(coalesce(c.tipo_clase, '')), coalesce(c.capacidad_max, 0),
         c.fecha_inicio, coalesce(c.es_gratuita, false)
    INTO v_type, v_capacity, v_starts_at, v_is_free
    FROM public.clases c WHERE c.id = p_clase_id FOR UPDATE;
  IF NOT FOUND OR v_type <> p_tipo OR v_capacity <= 0 OR v_starts_at IS NULL OR v_starts_at <= now() THEN
    RAISE EXCEPTION 'consultation slot not found or invalid' USING errcode = 'P0002';
  END IF;

  SELECT lower(coalesce(rol, '')) INTO v_target_role
    FROM public.profiles WHERE id = v_target_id FOR UPDATE;
  IF NOT FOUND OR v_target_role IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'consultations can only be booked for client profiles' USING errcode = '42501';
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

  -- El servidor determina el origen. p_cobrar_saldo=false solo es válido para personal.
  v_charge := NOT (v_actor_role IN ('admin', 'profesor', 'trabajador', 'profesional')
                   AND coalesce(p_cobrar_saldo, true) = false);
  IF v_is_free AND v_charge THEN
    UPDATE public.profiles SET saldo_consultas_gratis = saldo_consultas_gratis - 1
     WHERE id = v_target_id AND coalesce(saldo_consultas_gratis, 0) >= 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ya has utilizado tu bono de consulta gratuita.' USING errcode = 'P0001'; END IF;
  ELSIF NOT v_is_free AND v_charge THEN
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
GRANT EXECUTE ON FUNCTION public.reservar_consulta_atomica(text, bigint, uuid, boolean) TO authenticated;
NOTIFY pgrst, 'reload schema';

COMMIT;

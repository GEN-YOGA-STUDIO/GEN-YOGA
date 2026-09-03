-- Consume exactly one Yoga en Compañía credit for every companion booking.
BEGIN;

CREATE OR REPLACE FUNCTION public.reservar_con_bono_compania(
  p_clase_id bigint,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_capacity integer;
  v_occupied integer;
  v_class_active boolean;
  v_companion_modality text;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para reservar.' USING errcode = '42501';
  END IF;

  SELECT lower(coalesce(rol, ''))
    INTO v_actor_role
    FROM public.profiles
   WHERE id = v_actor_id;
  IF v_actor_role IS NULL OR (p_user_id <> v_actor_id
      AND v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional')) THEN
    RAISE EXCEPTION 'No puedes reservar una clase para otra persona.' USING errcode = '42501';
  END IF;

  SELECT coalesce(capacidad_max, 10), coalesce(activa, true), companion_modality
    INTO v_capacity, v_class_active, v_companion_modality
    FROM public.clases
   WHERE id = p_clase_id
   FOR UPDATE;
  IF NOT FOUND OR NOT v_class_active OR nullif(trim(v_companion_modality), '') IS NULL THEN
    RAISE EXCEPTION 'La clase no es una sesión de Yoga en Compañía disponible.' USING errcode = 'P0002';
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

  UPDATE public.profiles
     SET saldo_yoga_compania = coalesce(saldo_yoga_compania, 0) - 1
   WHERE id = p_user_id AND coalesce(saldo_yoga_compania, 0) >= 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No dispones de un bono de Yoga en Compañía activo.' USING errcode = 'P0001';
  END IF;

  INSERT INTO public.reservas_yoga (
    clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
    class_pack_id, saldo_gratis_descontado, num_plazas, num_plazas_reservadas,
    tipo_reserva, nombre_acompanante, acompanantes, welcome_companion_modality
  ) VALUES (
    p_clase_id, p_user_id, 'confirmada', false, false,
    null, false, 1, 1, 'compania', null, '[]'::jsonb,
    nullif(trim(v_companion_modality), '')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reservar_con_bono_compania(bigint, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reservar_con_bono_compania(bigint, uuid) TO authenticated;
COMMIT;

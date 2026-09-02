-- Require a named companion and reserve both places for companion sessions.
BEGIN;

UPDATE public.reservas_yoga
   SET tipo_reserva = 'compania',
       num_plazas = greatest(coalesce(num_plazas, 1), 2),
       num_plazas_reservadas = greatest(coalesce(num_plazas_reservadas, 1), 2)
 WHERE estado = 'confirmada'
   AND (
     lower(coalesce(tipo_reserva, '')) = 'compania'
     OR lower(trim(coalesce(welcome_companion_modality, ''))) NOT IN ('', 'bienvenida', 'gratis')
   );

CREATE OR REPLACE FUNCTION public.reservar_con_bono_compania(
  p_clase_id bigint,
  p_user_id uuid,
  p_nombre_acompanante text
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
  v_companion_name text := trim(coalesce(p_nombre_acompanante, ''));
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para reservar.' USING errcode = '42501';
  END IF;
  IF v_companion_name = '' THEN
    RAISE EXCEPTION 'Debes indicar el nombre de tu acompañante.' USING errcode = '22023';
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

  SELECT coalesce(sum(greatest(coalesce(num_plazas_reservadas, 1), coalesce(num_plazas, 1), 1)), 0)::integer
    INTO v_occupied
    FROM public.reservas_yoga
   WHERE clase_id = p_clase_id AND estado = 'confirmada';
  IF v_occupied + 2 > v_capacity THEN
    RAISE EXCEPTION 'Yoga en Compañía requiere 2 plazas libres.' USING errcode = 'P0001';
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
    null, false, 2, 2, 'compania', v_companion_name,
    jsonb_build_array(jsonb_build_object('nombre', v_companion_name)),
    nullif(trim(v_companion_modality), '')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reservar_con_bono_compania(bigint, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reservar_con_bono_compania(bigint, uuid, text) TO authenticated;
COMMIT;

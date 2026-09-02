-- ==============================================================================
-- Migración 202609020084: corregir saldo y etiqueta de Yoga en Compañía + 9.28
-- ==============================================================================

BEGIN;

-- Recreate the main booking function with explicit companion handling.
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
  v_capacity integer;
  v_starts_at timestamptz;
  v_class_name text;
  v_class_type text;
  v_class_active boolean;
  v_companion_modality text;
  v_professor_id public.clases.profesor_id%TYPE;
  v_professional_identity text := '';
  v_is_companion_class boolean := false;
  v_is_free_session boolean := false;
  v_free_credits integer := 0;
  v_companion_credits integer := 0;
  v_marked_free boolean := false;
  v_occupied integer;
  v_booking_limit_hours integer := 12;
  v_use_companion_bonus boolean := coalesce(p_use_welcome_companion, false);
  v_companion_key text;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para reservar.' USING errcode = '42501';
  END IF;

  IF p_clase_id IS NULL OR p_clase_id <= 0 OR v_target_id IS NULL THEN
    RAISE EXCEPTION 'La solicitud de reserva no es válida.' USING errcode = '22023';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))), lower(nullif(trim(email), ''))
    INTO v_actor_role, v_actor_email
    FROM public.profiles
   WHERE id = v_actor_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró el perfil que realiza la reserva.' USING errcode = 'P0002';
  END IF;

  v_actor_is_staff := v_actor_role IN ('admin', 'profesor', 'trabajador', 'profesional');
  IF v_target_id <> v_actor_id AND NOT v_actor_is_staff THEN
    RAISE EXCEPTION 'No puedes reservar una clase para otra persona.' USING errcode = '42501';
  END IF;

  SELECT coalesce(capacidad_max, 10), fecha_inicio, nombre,
         lower(trim(coalesce(nullif(tipo_clase, ''), 'yoga'))), coalesce(activa, true),
         profesor_id, coalesce(es_gratuita, false), companion_modality
    INTO v_capacity, v_starts_at, v_class_name, v_class_type, v_class_active,
         v_professor_id, v_marked_free, v_companion_modality
    FROM public.clases
   WHERE id = p_clase_id
   FOR UPDATE;

  IF NOT FOUND OR v_class_type IN ('psicologia', 'nutricion') OR NOT v_class_active THEN
    RAISE EXCEPTION 'La clase especificada no está disponible para reserva de yoga.' USING errcode = 'P0002';
  END IF;

  IF v_professor_id IS NOT NULL THEN
    SELECT lower(concat_ws(' ', coalesce(nombre, ''), coalesce(apellidos, ''), coalesce(email, '')))
      INTO v_professional_identity
      FROM public.profesionales
     WHERE id = v_professor_id;
    v_professional_identity := coalesce(v_professional_identity, '');
  END IF;

  v_companion_key := lower(trim(coalesce(v_companion_modality, 'compania')));
  v_is_companion_class := v_companion_key <> ''
    OR v_class_name ~* 'compañ|compan|pareja|colegas|abuela|hijo|madre|hija';

  v_is_free_session := public.es_clase_elegible_bono_gratis(
    v_class_name,
    v_starts_at,
    v_professional_identity,
    v_marked_free
  ) OR v_is_companion_class;

  IF v_starts_at IS NULL THEN
    RAISE EXCEPTION 'La clase no tiene una hora de inicio válida.' USING errcode = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.reservas_yoga
     WHERE clase_id = p_clase_id
       AND user_id = v_target_id
       AND estado = 'confirmada'
  ) THEN
    RAISE EXCEPTION 'Ya tienes una reserva confirmada para esta clase.' USING errcode = '23505';
  END IF;

  SELECT count(*)::integer
    INTO v_occupied
    FROM public.reservas_yoga
   WHERE clase_id = p_clase_id
     AND estado = 'confirmada';

  IF v_occupied >= v_capacity THEN
    RAISE EXCEPTION 'La clase está completa.' USING errcode = 'P0001';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))), coalesce(saldo_clases_gratis, 0), coalesce(saldo_yoga_compania, 0)
    INTO v_target_role, v_free_credits, v_companion_credits
    FROM public.profiles
   WHERE id = v_target_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró el perfil del alumno.' USING errcode = 'P0002';
  END IF;

  IF v_target_role IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'Solo los alumnos pueden reservar clases.' USING errcode = '42501';
  END IF;

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

  IF NOT v_actor_is_staff
     AND v_starts_at <= now() + make_interval(hours => v_booking_limit_hours) THEN
    RAISE EXCEPTION 'Las reservas cierran % h antes del inicio. Para esta clase ya ha pasado el plazo.',
      v_booking_limit_hours USING errcode = 'P0001';
  END IF;

  -- Si explícitamente se elige yoga en compañía, consume ese bono antes que el de bienvenida.
  IF v_use_companion_bonus AND v_is_companion_class AND v_companion_credits >= 1 THEN
    UPDATE public.profiles
       SET saldo_yoga_compania = saldo_yoga_compania - 1
     WHERE id = v_target_id
       AND saldo_yoga_compania >= 1;

    IF FOUND THEN
      INSERT INTO public.reservas_yoga (
        clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
        class_pack_id, saldo_gratis_descontado, welcome_companion_modality
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, false, null, true, v_companion_key
      );
      RETURN;
    END IF;
  END IF;

  -- Si la clase es gratuita pero el alumno usa el bono de bienvenida, descontamos ese saldo.
  IF v_is_free_session AND v_free_credits >= 1 AND NOT v_use_companion_bonus THEN
    UPDATE public.profiles
       SET saldo_clases_gratis = saldo_clases_gratis - 1
     WHERE id = v_target_id
       AND saldo_clases_gratis >= 1;

    IF FOUND THEN
      INSERT INTO public.reservas_yoga (
        clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
        class_pack_id, saldo_gratis_descontado, welcome_companion_modality
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, false, null, true,
        CASE WHEN v_is_companion_class THEN v_companion_key ELSE NULL END
      );
      RETURN;
    END IF;
  END IF;

  -- Fallback: si la clase es de compañía y el usuario tiene bono de compañia, pero no eligió explícitamente el de bienvenida.
  IF v_is_companion_class AND v_companion_credits >= 1 AND NOT v_use_companion_bonus THEN
    UPDATE public.profiles
       SET saldo_yoga_compania = saldo_yoga_compania - 1
     WHERE id = v_target_id
       AND saldo_yoga_compania >= 1;

    IF FOUND THEN
      INSERT INTO public.reservas_yoga (
        clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
        class_pack_id, saldo_gratis_descontado, welcome_companion_modality
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, false, null, true, v_companion_key
      );
      RETURN;
    END IF;
  END IF;

  IF v_marked_free THEN
    INSERT INTO public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado, welcome_companion_modality
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', false, false, null, false, NULL
    );
    RETURN;
  END IF;

  RAISE EXCEPTION 'No dispone de un bono válido para esta clase.' USING errcode = 'P0001';
END;
$$;

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

REVOKE ALL ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reservar_con_bono(bigint, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.reservar_con_bono(bigint, uuid) TO anon, authenticated, service_role;

COMMIT;

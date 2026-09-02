-- ============================================================================
-- Migration 202609020099: Obligatoriedad de Bono en Toda Reserva y Bono de Bienvenida
-- ============================================================================

BEGIN;

-- 1. Actualizar función reservar_con_bono para que TODA reserva consuma obligatoriamente un bono.
-- Las clases abiertas/introductorias/gratuitas consumen el Bono de Bienvenida (0 €).
-- Si no dispone de Bono de Bienvenida, debe consumir bono regular, pack o membresía.
-- En ningún caso se permite reservar sin consumir un bono.
CREATE OR REPLACE FUNCTION public.reservar_con_bono(
  p_clase_id bigint,
  p_user_id uuid,
  p_use_welcome_companion boolean DEFAULT false
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

  IF v_companion_modality IS NOT NULL AND trim(v_companion_modality) <> '' THEN
    RAISE EXCEPTION 'Esta sesión es de Yoga en Compañía y requiere reservar mediante su bono específico indicando los acompañantes.' USING errcode = 'P0001';
  END IF;

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

  -- 1. Intentar consumir Bono de Bienvenida (si la clase es elegible o abierta/introductoria)
  IF v_free_credits > 0
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
    UPDATE public.class_credit_packs SET credits_remaining = credits_remaining - 1, updated_at = now()
     WHERE id = v_pack_id AND credits_remaining > 0;
    IF NOT FOUND THEN RAISE EXCEPTION 'El pack ya no tiene clases disponibles.'; END IF;
  ELSE
    UPDATE public.profiles SET bonos = coalesce(bonos, 0) - 1
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

-- 2. Regularizar las 10 reservas históricas de la clase 6091 (Power Vinyasa Clase Abierta)
-- Marcar que fueron consumidas con el Bono de Bienvenida (saldo_gratis_descontado = true)
UPDATE public.reservas_yoga
   SET saldo_gratis_descontado = true,
       tipo_reserva = 'bienvenida'
 WHERE clase_id = 6091;

-- Descontar el bono de bienvenida a Ruth Tynen que aún lo conservaba intacto
UPDATE public.profiles
   SET saldo_clases_gratis = 0
 WHERE id = 'ec1bdf3f-698e-4f28-bb1e-8ee373920bcd'
   AND saldo_clases_gratis > 0;

GRANT EXECUTE ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

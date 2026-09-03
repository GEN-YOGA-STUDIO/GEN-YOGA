-- Migration 202609030003_fix_reservar_con_bono_unambiguous_universal_v11_8.sql
-- Elimina de raíz cualquier sobrecarga conflictiva de reservar_con_bono
-- y crea una única función canónica sin ambigüedades compatible con todas las llamadas.

BEGIN;

-- 1. Eliminar dinámicamente TODAS las funciones existentes llamadas 'reservar_con_bono' en public
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT p.oid::regprocedure AS func_sig
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname = 'public' AND p.proname = 'reservar_con_bono'
  ) LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_sig || ' CASCADE;';
  END LOOP;
END $$;

-- 2. Crear una ÚNICA función canónica de reservar_con_bono
CREATE OR REPLACE FUNCTION public.reservar_con_bono(
  p_clase_id bigint,
  p_user_id uuid DEFAULT NULL,
  p_forzar_regular boolean DEFAULT false,
  p_force_regular boolean DEFAULT false,
  p_use_unlimited_guest boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_target_role text;
  v_starts_at timestamptz;
  v_capacity integer;
  v_occupied integer;
  v_free_credits integer := 0;
  v_class_name text;
  v_class_type text;
  v_class_active boolean;
  v_marked_free boolean;
  v_is_special boolean;
  v_companion_modality text;
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_unlimited boolean := false;
  v_special_count integer := 0;
  v_pack_id bigint;
  v_effective_force_regular boolean;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para reservar.' USING errcode = '42501';
  END IF;
  IF p_clase_id IS NULL OR p_clase_id <= 0 OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'La solicitud de reserva no es válida.' USING errcode = '22023';
  END IF;

  v_effective_force_regular := coalesce(p_forzar_regular, false) OR coalesce(p_force_regular, false);

  SELECT lower(trim(coalesce(rol, ''))) INTO v_actor_role
    FROM public.profiles WHERE id = v_actor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el perfil que realiza la reserva.'; END IF;
  IF p_user_id <> v_actor_id
     AND v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'No puedes reservar una clase para otra persona.' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))), coalesce(saldo_clases_gratis, 0)
    INTO v_target_role, v_free_credits
    FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el perfil del alumno.'; END IF;
  IF v_target_role IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'Solo los alumnos pueden reservar clases.' USING errcode = '42501';
  END IF;

  SELECT coalesce(capacidad_max, 10), fecha_inicio, nombre,
         lower(trim(coalesce(nullif(tipo_clase, ''), 'yoga'))),
         coalesce(activa, true), coalesce(es_gratuita, false),
         coalesce(es_especial, false),
         companion_modality
    INTO v_capacity, v_starts_at, v_class_name, v_class_type,
         v_class_active, v_marked_free, v_is_special, v_companion_modality
    FROM public.clases WHERE id = p_clase_id FOR UPDATE;
  IF NOT FOUND OR NOT v_class_active OR v_class_type NOT IN ('yoga', 'taller') THEN
    RAISE EXCEPTION 'La clase especificada no está disponible.' USING errcode = 'P0002';
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

  SELECT coalesce(sum(greatest(coalesce(num_plazas_reservadas, 1), coalesce(num_plazas, 1), 1)), 0)::integer
    INTO v_occupied
    FROM public.reservas_yoga
   WHERE clase_id = p_clase_id AND estado = 'confirmada';
  IF v_occupied >= v_capacity THEN
    RAISE EXCEPTION 'La clase está completa.' USING errcode = 'P0001';
  END IF;

  -- REGLA v11.0+: El bono de bienvenida permite reservar CUALQUIER clase regular de yoga
  -- (se excluyen únicamente talleres y clases especiales).
  IF v_free_credits > 0
     AND NOT v_effective_force_regular
     AND v_class_type = 'yoga'
     AND NOT v_is_special
     AND NOT (v_class_name ~* '(taller|masterclass)') THEN

    UPDATE public.profiles
       SET saldo_clases_gratis = saldo_clases_gratis - 1
     WHERE id = p_user_id AND saldo_clases_gratis > 0;
    IF FOUND THEN
      INSERT INTO public.reservas_yoga
        (clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
         class_pack_id, saldo_gratis_descontado)
      VALUES (p_clase_id, p_user_id, 'confirmada', false, false, null, true);
      RETURN;
    END IF;
  END IF;

  -- Comprobar cobertura real del Bono Ilimitado para la fecha de la clase.
  SELECT starts_at, ends_at INTO v_month_start, v_month_end
    FROM public.unlimited_membership_periods
   WHERE user_id = p_user_id AND starts_at <= v_starts_at AND ends_at > v_starts_at
   ORDER BY starts_at DESC LIMIT 1 FOR SHARE;
  IF FOUND AND v_class_type <> 'taller' AND NOT v_is_special THEN
    v_unlimited := true;
  ELSIF FOUND AND (v_class_type = 'taller' OR v_is_special) THEN
    SELECT count(*)::integer INTO v_special_count
      FROM public.reservas_yoga r
      JOIN public.clases c ON c.id = r.clase_id
     WHERE r.user_id = p_user_id
       AND r.estado = 'confirmada'
       AND r.usado_bono_mensual = true
       AND (c.tipo_clase = 'taller' OR c.es_especial = true)
       AND c.fecha_inicio >= v_month_start
       AND c.fecha_inicio < v_month_end;
    IF v_special_count < 1 THEN
      v_unlimited := true;
    END IF;
  END IF;

  IF v_unlimited THEN
    INSERT INTO public.reservas_yoga
      (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id)
    VALUES (p_clase_id, p_user_id, 'confirmada', true, false, null);
    RETURN;
  END IF;

  -- Deducción desde packs de clases regulares
  SELECT id INTO v_pack_id
    FROM public.class_credit_packs
   WHERE user_id = p_user_id
     AND starts_at <= v_starts_at
     AND expires_at > v_starts_at
     AND credits_remaining > 0
   ORDER BY expires_at ASC, id ASC
   LIMIT 1 FOR UPDATE;

  IF v_pack_id IS NOT NULL THEN
    UPDATE public.class_credit_packs
       SET credits_remaining = credits_remaining - 1
     WHERE id = v_pack_id AND credits_remaining > 0;
    IF FOUND THEN
      UPDATE public.profiles
         SET bonos = (
           SELECT coalesce(sum(credits_remaining), 0)::integer
             FROM public.class_credit_packs
            WHERE user_id = p_user_id AND expires_at > now()
         )
        WHERE id = p_user_id;

      INSERT INTO public.reservas_yoga
        (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id)
      VALUES (p_clase_id, p_user_id, 'confirmada', false, true, v_pack_id);
      RETURN;
    END IF;
  END IF;

  -- Fallback para saldo bonos en profiles
  UPDATE public.profiles
     SET bonos = bonos - 1
   WHERE id = p_user_id AND bonos > 0;
  IF FOUND THEN
    INSERT INTO public.reservas_yoga
      (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id)
    VALUES (p_clase_id, p_user_id, 'confirmada', false, true, null);
    RETURN;
  END IF;

  RAISE EXCEPTION 'No tienes bonos disponibles ni suscripción activa para reservar esta clase.' USING errcode = 'P0001';
END;
$$;

REVOKE ALL ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean, boolean, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean, boolean, boolean) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';

COMMIT;

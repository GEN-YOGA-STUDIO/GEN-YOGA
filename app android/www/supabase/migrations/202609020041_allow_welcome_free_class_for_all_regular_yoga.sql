-- ==============================================================================
-- Migración 202609020041: Permitir reservar cualquier clase regular de yoga con el saldo de bienvenida gratuito
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.es_clase_elegible_bono_gratis(
  p_nombre text,
  p_fecha_inicio timestamptz DEFAULT null,
  p_identidad_profesional text DEFAULT '',
  p_es_gratuita boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_nom text := lower(coalesce(p_nombre, ''));
BEGIN
  -- Si está marcada como gratuita explícitamente en la base de datos
  IF p_es_gratuita IS TRUE THEN
    RETURN true;
  END IF;

  -- Todas las clases regulares de yoga son elegibles para la clase gratuita de bienvenida
  IF v_nom !~* 'taller|especial' THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

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
  v_legacy_credits integer;
  v_free_credits integer;
  v_unlimited_active boolean;
  v_membership_start timestamptz;
  v_membership_end timestamptz;
  v_natural_membership_start timestamptz;
  v_natural_membership_end timestamptz;
  v_capacity integer;
  v_starts_at timestamptz;
  v_class_name text;
  v_class_type text;
  v_class_active boolean;
  v_is_special boolean;
  v_is_free boolean;
  v_marked_free boolean;
  v_occupied integer;
  v_booking_limit_hours integer := 12;
  v_use_unlimited boolean := false;
  v_pack_id bigint;
  v_special_count integer := 0;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para reservar.' USING errcode = '42501';
  END IF;
  IF p_clase_id IS NULL OR p_clase_id <= 0 OR v_target_id IS NULL THEN
    RAISE EXCEPTION 'La solicitud de reserva no es válida.' USING errcode = '22023';
  END IF;

  -- Perfil del actor
  SELECT lower(trim(coalesce(rol, ''))), lower(nullif(trim(email), ''))
    INTO v_actor_role, v_actor_email
    FROM public.profiles
   WHERE id = v_actor_id;

  IF NOT found THEN
    RAISE EXCEPTION 'Perfil no encontrado.' USING errcode = 'P0002';
  END IF;

  v_actor_is_staff := v_actor_role IN ('admin', 'profesor', 'trabajador', 'profesional');

  IF v_target_id <> v_actor_id AND NOT v_actor_is_staff THEN
    RAISE EXCEPTION 'No tienes permiso para reservar para otro usuario.' USING errcode = '42501';
  END IF;

  -- Obtener información de la clase
  SELECT c.capacidad_max, c.fecha_inicio, c.nombre, c.tipo_clase, c.activo,
         coalesce(c.es_gratuita, false)
    INTO v_capacity, v_starts_at, v_class_name, v_class_type, v_class_active,
         v_marked_free
    FROM public.clases c
   WHERE c.id = p_clase_id
   FOR UPDATE;

  IF NOT found OR coalesce(v_class_active, true) IS FALSE THEN
    RAISE EXCEPTION 'La clase solicitada no existe o no está disponible.' USING errcode = 'P0002';
  END IF;

  v_is_special := lower(trim(coalesce(v_class_type, ''))) = 'taller' OR lower(coalesce(v_class_name, '')) ~* 'taller';
  v_capacity := coalesce(nullif(v_capacity, 0), 10);

  -- Política de anticipación
  IF NOT v_actor_is_staff THEN
    SELECT coalesce(nullif(valor, '')::integer, 12)
      INTO v_booking_limit_hours
      FROM public.configuracion
     WHERE clave = 'horas_limite_reserva';
    v_booking_limit_hours := coalesce(v_booking_limit_hours, 12);

    IF v_starts_at <= (now() + (v_booking_limit_hours || ' hours')::interval) THEN
      RAISE EXCEPTION 'Las reservas cierran % horas antes del inicio de la clase.', v_booking_limit_hours USING errcode = 'P0001';
    END IF;
  END IF;

  -- Comprobar si ya tiene reserva
  IF EXISTS (
    SELECT 1
      FROM public.reservas_yoga
     WHERE clase_id = p_clase_id
       AND user_id = v_target_id
       AND estado = 'confirmada'
  ) THEN
    RAISE EXCEPTION 'Ya tienes una reserva confirmada para esta clase.' USING errcode = '23505';
  END IF;

  -- Comprobar aforo
  SELECT count(*)::integer
    INTO v_occupied
    FROM public.reservas_yoga
   WHERE clase_id = p_clase_id
     AND estado = 'confirmada';
  IF v_occupied >= v_capacity THEN
    RAISE EXCEPTION 'La clase está completa.' USING errcode = 'P0001';
  END IF;

  -- Perfil del alumno
  SELECT lower(trim(coalesce(rol, ''))), coalesce(bonos, 0),
         coalesce(saldo_clases_gratis, 0), coalesce(bono_mensual_activo, false),
         bono_mensual_inicio, bono_mensual_fin
    INTO v_target_role, v_legacy_credits, v_free_credits, v_unlimited_active,
         v_membership_start, v_membership_end
    FROM public.profiles
   WHERE id = v_target_id
   FOR UPDATE;

  IF NOT found THEN
    RAISE EXCEPTION 'No se encontró el perfil del alumno.' USING errcode = 'P0002';
  END IF;
  IF v_target_role IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'Solo los alumnos pueden reservar clases.' USING errcode = '42501';
  END IF;

  v_is_free := public.es_clase_elegible_bono_gratis(v_class_name, v_starts_at, '', v_marked_free);

  -- 1. Si la clase es 100% gratuita por configuración del estudio
  IF v_marked_free THEN
    INSERT INTO public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', false, false, null, false
    );
    RETURN;
  END IF;

  -- 2. Si el alumno tiene saldo de clase gratuita de bienvenida y NO es taller
  IF NOT v_is_special AND v_free_credits >= 1 THEN
    UPDATE public.profiles
       SET saldo_clases_gratis = saldo_clases_gratis - 1
     WHERE id = v_target_id
       AND saldo_clases_gratis >= 1;
    IF found THEN
      INSERT INTO public.reservas_yoga (
        clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
        class_pack_id, saldo_gratis_descontado
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, false, null, true
      );
      RETURN;
    END IF;
  END IF;

  -- 3. Si es sesión introductoria y el ADMIN / PERSONAL está asignando al alumno
  IF v_is_free AND v_actor_is_staff AND v_target_id <> v_actor_id THEN
    INSERT INTO public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', false, false, null, false
    );
    RETURN;
  END IF;

  -- 4. Bonos Normales: Caso Bono Ilimitado
  SELECT starts_at, ends_at
    INTO v_natural_membership_start, v_natural_membership_end
    FROM public.unlimited_memberships
   WHERE user_id = v_target_id
     AND starts_at <= v_starts_at
     AND ends_at > v_starts_at
   ORDER BY starts_at DESC
   LIMIT 1;

  IF v_natural_membership_start IS NOT NULL THEN
    v_use_unlimited := true;
  ELSIF coalesce(v_unlimited_active, false) IS TRUE
    AND v_membership_start IS NOT NULL
    AND v_membership_end IS NOT NULL
    AND v_starts_at >= v_membership_start
    AND v_starts_at < v_membership_end THEN
    v_use_unlimited := true;
  END IF;

  IF v_use_unlimited THEN
    IF v_is_special THEN
      SELECT count(*)::integer
        INTO v_special_count
        FROM public.reservas_yoga r
        JOIN public.clases cl ON cl.id = r.clase_id
       WHERE r.user_id = v_target_id
         AND r.estado = 'confirmada'
         AND r.usado_bono_mensual = true
         AND (lower(trim(coalesce(cl.tipo_clase, ''))) = 'taller' OR lower(coalesce(cl.nombre, '')) ~* 'taller')
         AND cl.fecha_inicio >= coalesce(v_natural_membership_start, v_membership_start)
         AND cl.fecha_inicio < coalesce(v_natural_membership_end, v_membership_end);

      IF v_special_count >= 1 THEN
        RAISE EXCEPTION 'Ya has utilizado la clase especial incluida en tu Bono Ilimitado de este mes.' USING errcode = 'P0001';
      END IF;
    END IF;

    INSERT INTO public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', true, false, null, false
    );
    RETURN;
  END IF;

  -- 5. Talleres sin bono ilimitado no se pueden reservar con packs normales
  IF v_is_special THEN
    RAISE EXCEPTION 'Esta clase especial requiere un Bono Ilimitado activo.' USING errcode = 'P0001';
  END IF;

  -- 6. Descontar de Packs de Clases vigentes
  SELECT id INTO v_pack_id
    FROM public.class_packs
   WHERE user_id = v_target_id
     AND credits_remaining > 0
     AND expires_at > now()
     AND expires_at >= v_starts_at
   ORDER BY expires_at ASC, id ASC
   LIMIT 1
   FOR UPDATE;

  IF v_pack_id IS NOT NULL THEN
    UPDATE public.class_packs
       SET credits_remaining = credits_remaining - 1,
           updated_at = now()
     WHERE id = v_pack_id
       AND credits_remaining > 0;
    IF found THEN
      INSERT INTO public.reservas_yoga (
        clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
        class_pack_id, saldo_gratis_descontado
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, true, v_pack_id, false
      );
      RETURN;
    END IF;
  END IF;

  -- 7. Descontar de bonos legacy de profiles si aún tiene saldo
  IF v_legacy_credits >= 1 THEN
    UPDATE public.profiles
       SET bonos = bonos - 1
     WHERE id = v_target_id
       AND bonos >= 1;
    IF found THEN
      INSERT INTO public.reservas_yoga (
        clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
        class_pack_id, saldo_gratis_descontado
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, true, null, false
      );
      RETURN;
    END IF;
  END IF;

  RAISE EXCEPTION 'No tienes bonos disponibles para reservar esta clase.' USING errcode = 'P0001';
END;
$$;

REVOKE ALL ON FUNCTION public.es_clase_elegible_bono_gratis(text, timestamptz, text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.es_clase_elegible_bono_gratis(text, timestamptz, text, boolean) TO authenticated, service_role, anon;

REVOKE ALL ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

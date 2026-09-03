-- ==============================================================================
-- Migración 202609020070: Cobertura completa del mes natural en Bono Ilimitado (incluido el último día del mes)
-- GEN YOGA v9.12
-- ==============================================================================

BEGIN;

-- 1. Actualizar función admin_configurar_bono_mensual para asegurar cobertura completa del mes
CREATE OR REPLACE FUNCTION public.admin_configurar_bono_mensual(
  p_user_id uuid,
  p_activo boolean,
  p_inicio timestamptz DEFAULT null,
  p_fin timestamptz DEFAULT null
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_role text;
  v_actor_deletion_pending boolean;
  v_target_role text;
  v_target_deletion_pending boolean;
  v_target_subscription_id text;
  v_target_subscription_status text;
  v_membership_month date;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))), coalesce(account_deletion_pending, false)
    INTO v_actor_role, v_actor_deletion_pending
    FROM public.profiles
   WHERE id = auth.uid();

  IF NOT found OR v_actor_role IS DISTINCT FROM 'admin' OR v_actor_deletion_pending THEN
    RAISE EXCEPTION 'admin role required' USING errcode = '42501';
  END IF;
  IF p_user_id IS NULL OR p_activo IS NULL THEN
    RAISE EXCEPTION 'invalid monthly pass request' USING errcode = '22023';
  END IF;
  IF p_activo AND (p_inicio IS NULL OR p_fin IS NULL OR p_fin < p_inicio) THEN
    RAISE EXCEPTION 'invalid monthly pass dates' USING errcode = '22023';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))), coalesce(account_deletion_pending, false),
         stripe_subscription_id, lower(trim(coalesce(stripe_subscription_status, '')))
    INTO v_target_role, v_target_deletion_pending,
         v_target_subscription_id, v_target_subscription_status
    FROM public.profiles
   WHERE id = p_user_id
   FOR UPDATE;

  IF NOT found THEN
    RAISE EXCEPTION 'target profile not found' USING errcode = 'P0002';
  END IF;
  IF v_target_role IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'monthly passes can only be assigned to clients' USING errcode = '22023';
  END IF;
  IF v_target_deletion_pending THEN
    RAISE EXCEPTION 'target account deletion is pending' USING errcode = '55000';
  END IF;
  IF (
    nullif(trim(coalesce(v_target_subscription_id, '')), '') IS NOT NULL
    AND v_target_subscription_status NOT IN ('canceled', 'incomplete_expired')
  ) OR v_target_subscription_status IN (
    'active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'
  ) THEN
    RAISE EXCEPTION 'active Stripe subscription must be managed in Customer Portal'
      USING errcode = '55000';
  END IF;

  -- Manejo de activación
  IF p_activo THEN
    -- Determinar el mes natural en la zona horaria oficial del estudio (Europe/Madrid)
    v_membership_month := date_trunc('month', p_inicio AT TIME ZONE 'Europe/Madrid')::date;
    
    -- El periodo debe iniciar a las 00:00:00 del primer día del mes
    v_starts_at := (v_membership_month::text || ' 00:00:00 Europe/Madrid')::timestamptz;
    
    -- El periodo debe finalizar al inicio del mes siguiente (00:00:00 del día 1 del mes siguiente),
    -- cubriendo completamente hasta las 23:59:59 del último día del mes (ej. todo el 30 de septiembre).
    -- Si p_fin supera el mes natural, se extiende hasta el final del día especificado en p_fin.
    v_ends_at := ((v_membership_month + interval '1 month')::date::text || ' 00:00:00 Europe/Madrid')::timestamptz;
    IF p_fin IS NOT NULL AND p_fin > v_ends_at THEN
      v_ends_at := ((date_trunc('day', p_fin AT TIME ZONE 'Europe/Madrid')::date + 1)::text || ' 00:00:00 Europe/Madrid')::timestamptz;
    END IF;

    -- Insertar o actualizar periodo en unlimited_membership_periods
    INSERT INTO public.unlimited_membership_periods (
      user_id,
      checkout_session_id,
      membership_month,
      starts_at,
      ends_at,
      purchased_at
    ) VALUES (
      p_user_id,
      null, -- null para activaciones manuales del administrador
      v_membership_month,
      v_starts_at,
      v_ends_at,
      now()
    )
    ON CONFLICT (user_id, membership_month) DO UPDATE
      SET starts_at = excluded.starts_at,
          ends_at = excluded.ends_at,
          purchased_at = coalesce(public.unlimited_membership_periods.purchased_at, excluded.purchased_at);

  ELSE
    -- Desactivación: eliminar periodos ilimitados
    DELETE FROM public.unlimited_membership_periods 
     WHERE user_id = p_user_id;
  END IF;

  -- Actualizar tabla profiles
  UPDATE public.profiles
     SET bono_mensual_activo = p_activo,
         bono_mensual_inicio = CASE WHEN p_activo THEN v_starts_at ELSE null END,
         bono_mensual_fin = CASE WHEN p_activo THEN v_ends_at ELSE null END
   WHERE id = p_user_id;
END;
$$;

COMMENT ON FUNCTION public.admin_configurar_bono_mensual(uuid, boolean, timestamptz, timestamptz)
IS 'Admin-only function to configure unlimited monthly passes with full natural month coverage.';

REVOKE ALL ON FUNCTION public.admin_configurar_bono_mensual(uuid, boolean, timestamptz, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_configurar_bono_mensual(uuid, boolean, timestamptz, timestamptz) TO authenticated, service_role;


-- 2. Actualizar función principal de reserva con bono para asegurar cobertura total del mes
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
  v_companion_credits integer;
  v_unlimited_active boolean;
  v_membership_start timestamptz;
  v_membership_end timestamptz;
  v_natural_membership_start timestamptz;
  v_natural_membership_end timestamptz;
  v_class_month date;
  v_capacity integer;
  v_starts_at timestamptz;
  v_class_name text;
  v_class_type text;
  v_class_active boolean;
  v_is_special boolean;
  v_is_free boolean;
  v_is_companion boolean;
  v_companion_modality text;
  v_marked_free boolean;
  v_professor_id public.clases.profesor_id%TYPE;
  v_professional_identity text := '';
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

  -- Perfil del usuario que ejecuta la acción
  SELECT lower(trim(coalesce(rol, ''))), lower(nullif(trim(email), ''))
    INTO v_actor_role, v_actor_email
    FROM public.profiles
   WHERE id = v_actor_id;
  IF NOT found THEN
    RAISE EXCEPTION 'No se encontró el perfil que realiza la reserva.' USING errcode = 'P0002';
  END IF;

  v_actor_is_staff := v_actor_role IN ('admin', 'profesor', 'trabajador', 'profesional');
  IF v_target_id <> v_actor_id AND NOT v_actor_is_staff THEN
    RAISE EXCEPTION 'No puedes reservar una clase para otra persona.' USING errcode = '42501';
  END IF;

  -- Datos de la clase
  SELECT coalesce(capacidad_max, 10), fecha_inicio, nombre,
         lower(trim(coalesce(nullif(tipo_clase, ''), 'yoga'))), coalesce(activa, true),
         profesor_id, coalesce(es_gratuita, false),
         companion_modality
    INTO v_capacity, v_starts_at, v_class_name, v_class_type, v_class_active,
         v_professor_id, v_marked_free,
         v_companion_modality
    FROM public.clases
   WHERE id = p_clase_id
   FOR UPDATE;

  IF NOT found OR v_class_type IN ('psicologia', 'nutricion') OR NOT v_class_active THEN
    RAISE EXCEPTION 'La clase especificada no está disponible para reserva de yoga.' USING errcode = 'P0002';
  END IF;

  IF v_professor_id IS NOT NULL THEN
    SELECT lower(concat_ws(' ', coalesce(nombre, ''), coalesce(apellidos, ''), coalesce(email, '')))
      INTO v_professional_identity
      FROM public.profesionales
     WHERE id = v_professor_id;
    v_professional_identity := coalesce(v_professional_identity, '');
  END IF;

  v_is_special := v_class_type = 'taller' OR v_class_type = 'especial';
  v_is_companion := v_companion_modality IS NOT NULL OR v_class_name ~* 'compañ|compan|pareja|colegas|abuela|hijo';

  IF v_starts_at IS NULL THEN
    RAISE EXCEPTION 'La clase no tiene una hora de inicio válida.' USING errcode = '22023';
  END IF;
  IF v_capacity <= 0 THEN
    v_capacity := 10;
  END IF;

  v_class_month := date_trunc('month', v_starts_at AT TIME ZONE 'Europe/Madrid')::date;

  IF v_target_id <> v_actor_id AND v_actor_role <> 'admin'
    AND NOT EXISTS (
      SELECT 1
        FROM public.profesionales
       WHERE id = v_professor_id
         AND lower(nullif(trim(email), '')) = v_actor_email
    ) THEN
    RAISE EXCEPTION 'Solo puedes gestionar reservas de tus propias clases.' USING errcode = '42501';
  END IF;

  -- Antelación mínima (12 horas por defecto)
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
  v_booking_limit_hours := coalesce(v_booking_limit_hours, 12);

  IF NOT v_actor_is_staff
    AND v_starts_at <= now() + make_interval(hours => v_booking_limit_hours) THEN
    RAISE EXCEPTION 'Las reservas cierran % h antes del inicio. Para esta clase ya ha pasado el plazo.',
      v_booking_limit_hours USING errcode = 'P0001';
  END IF;

  -- Comprobar si ya existe reserva confirmada
  IF EXISTS (
    SELECT 1
      FROM public.reservas_yoga
     WHERE clase_id = p_clase_id
       AND user_id = v_target_id
       AND estado = 'confirmada'
  ) THEN
    RAISE EXCEPTION 'Ya tienes una reserva confirmada para esta clase.' USING errcode = '23505';
  END IF;

  -- Comprobar aforo máximo
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
         coalesce(saldo_clases_gratis, 0), coalesce(saldo_yoga_compania, 0),
         coalesce(bono_mensual_activo, false),
         bono_mensual_inicio, bono_mensual_fin
    INTO v_target_role, v_legacy_credits,
         v_free_credits, v_companion_credits,
         v_unlimited_active,
         v_membership_start, v_membership_end
    FROM public.profiles
   WHERE id = v_target_id
   FOR UPDATE;

  IF NOT found THEN
    RAISE EXCEPTION 'No se encontró el perfil del alumno.' USING errcode = 'P0002';
  END IF;
  IF v_target_role IN ('admin', 'profesor', 'trabajador', 'profesional') AND v_target_id = v_actor_id THEN
    -- Permitir al personal auto-asignarse en modo vista previa sin consumir bonos
    INSERT INTO public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado, welcome_companion_modality
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', false, false, null, false, v_companion_modality
    );
    RETURN;
  END IF;

  -- Determinar si la clase es una sesión gratuita / introductoria / abierta
  v_is_free := public.es_clase_elegible_bono_gratis(
    v_class_name,
    v_starts_at,
    v_professional_identity,
    v_marked_free
  ) OR v_is_companion;

  -- 1. Si la clase está explícitamente marcada como gratuita en base de datos
  IF v_marked_free THEN
    INSERT INTO public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', false, false, null, false
    );
    RETURN;
  END IF;

  -- 2. Si es clase de Yoga en Compañía y el usuario tiene saldo disponible
  IF v_is_companion THEN
    IF v_companion_credits >= 1 THEN
      UPDATE public.profiles
         SET saldo_yoga_compania = saldo_yoga_compania - 1
       WHERE id = v_target_id
         AND saldo_yoga_compania >= 1;
      IF found THEN
        INSERT INTO public.reservas_yoga (
          clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
          class_pack_id, saldo_gratis_descontado, welcome_companion_modality
        ) VALUES (
          p_clase_id, v_target_id, 'confirmada', false, false, null, true, coalesce(v_companion_modality, 'pareja')
        );
        RETURN;
      END IF;
    ELSIF v_free_credits >= 1 THEN
      UPDATE public.profiles
         SET saldo_clases_gratis = saldo_clases_gratis - 1
       WHERE id = v_target_id
         AND saldo_clases_gratis >= 1;
      IF found THEN
        INSERT INTO public.reservas_yoga (
          clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
          class_pack_id, saldo_gratis_descontado, welcome_companion_modality
        ) VALUES (
          p_clase_id, v_target_id, 'confirmada', false, false, null, true, coalesce(v_companion_modality, 'pareja')
        );
        RETURN;
      END IF;
    END IF;
  END IF;

  -- 3. Si es sesión gratuita/introductoria Y el alumno tiene saldo de bono gratis
  IF v_is_free THEN
    IF v_free_credits >= 1 THEN
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
    ELSIF v_companion_credits >= 1 THEN
      UPDATE public.profiles
         SET saldo_yoga_compania = saldo_yoga_compania - 1
       WHERE id = v_target_id
         AND saldo_yoga_compania >= 1;
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
  END IF;

  -- 4. Si es sesión introductoria o en compañía y el ADMIN / PERSONAL está asignando al alumno
  IF (v_is_free OR v_is_companion) AND v_actor_is_staff AND v_target_id <> v_actor_id THEN
    INSERT INTO public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado, welcome_companion_modality
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', false, false, null, false, v_companion_modality
    );
    RETURN;
  END IF;

  -- 5. Bonos Normales: Caso Bono Ilimitado (mes natural)
  -- Búsqueda exhaustiva: por mes natural (membership_month) o por rango de fechas inclusivo
  SELECT starts_at, ends_at
    INTO v_natural_membership_start, v_natural_membership_end
    FROM public.unlimited_membership_periods
   WHERE user_id = v_target_id
     AND (
       (starts_at <= v_starts_at AND ends_at > v_starts_at)
       OR (membership_month = v_class_month)
       OR (
         starts_at <= v_starts_at
         AND ((date_trunc('day', ends_at AT TIME ZONE 'Europe/Madrid')::date + 1)::text || ' 00:00:00 Europe/Madrid')::timestamptz > v_starts_at
       )
     )
   ORDER BY starts_at DESC
   LIMIT 1
   FOR SHARE;

  IF found THEN
    v_unlimited_active := true;
    v_membership_start := coalesce(v_natural_membership_start, (v_class_month::text || ' 00:00:00 Europe/Madrid')::timestamptz);
    v_membership_end := coalesce(v_natural_membership_end, ((v_class_month + interval '1 month')::date::text || ' 00:00:00 Europe/Madrid')::timestamptz);
  ELSIF v_unlimited_active THEN
    IF v_membership_start IS NULL THEN
      v_membership_start := (v_class_month::text || ' 00:00:00 Europe/Madrid')::timestamptz;
    END IF;
    IF v_membership_end IS NULL THEN
      v_membership_end := ((v_class_month + interval '1 month')::date::text || ' 00:00:00 Europe/Madrid')::timestamptz;
    END IF;
  END IF;

  -- Comprobar si la clase está cubierta por el periodo ilimitado (con día final inclusivo)
  IF v_unlimited_active
    AND v_membership_start IS NOT NULL
    AND v_membership_end IS NOT NULL
    AND (
      (v_starts_at >= v_membership_start AND v_starts_at < v_membership_end)
      OR (date_trunc('month', v_membership_start AT TIME ZONE 'Europe/Madrid')::date = v_class_month)
      OR (
        v_starts_at >= v_membership_start
        AND v_starts_at < ((date_trunc('day', v_membership_end AT TIME ZONE 'Europe/Madrid')::date + 1)::text || ' 00:00:00 Europe/Madrid')::timestamptz
      )
    ) THEN

    IF v_is_special THEN
      SELECT count(*)::integer
        INTO v_special_count
        FROM public.reservas_yoga AS booking
        JOIN public.clases AS class ON class.id = booking.clase_id
       WHERE booking.user_id = v_target_id
         AND booking.estado = 'confirmada'
         AND coalesce(booking.usado_bono_mensual, false)
         AND (lower(trim(coalesce(class.tipo_clase, ''))) = 'taller' OR lower(trim(coalesce(class.tipo_clase, ''))) = 'especial')
         AND date_trunc('month', class.fecha_inicio AT TIME ZONE 'Europe/Madrid')::date = v_class_month;
      IF v_special_count >= 1 THEN
        RAISE EXCEPTION 'Ya has utilizado la clase especial incluida en este mes natural.'
          USING errcode = 'P0001';
      END IF;
    END IF;

    v_use_unlimited := true;
  END IF;

  -- 6. Bonos Normales: Packs de Clases o Saldo en Perfil
  IF NOT v_use_unlimited THEN
    IF v_is_special THEN
      RAISE EXCEPTION 'Las clases especiales requieren un Bono Ilimitado activo y disponibilidad mensual.'
        USING errcode = 'P0001';
    END IF;

    -- Buscar primero un pack de clases no caducado
    SELECT id
      INTO v_pack_id
      FROM public.class_credit_packs
     WHERE user_id = v_target_id
       AND credits_remaining > 0
       AND expires_at > now()
     ORDER BY expires_at, purchased_at, id
     LIMIT 1
     FOR UPDATE;

    IF v_pack_id IS NOT NULL THEN
      UPDATE public.class_credit_packs
         SET credits_remaining = credits_remaining - 1,
             updated_at = now()
        WHERE id = v_pack_id
          AND credits_remaining > 0;
      IF NOT found THEN
        RAISE EXCEPTION 'El pack seleccionado ya no tiene clases disponibles.' USING errcode = 'P0001';
      END IF;
    ELSE
      -- Si no hay pack registrado, usar el saldo directo en profiles
      UPDATE public.profiles
         SET bonos = coalesce(bonos, 0) - 1
       WHERE id = v_target_id
         AND coalesce(bonos, 0) >= 1;
      IF NOT found THEN
        IF v_is_companion THEN
          RAISE EXCEPTION 'No dispones de un bono de Yoga en Compañía activo (0 €). Revisa tus bonos disponibles.' USING errcode = 'P0001';
        ELSIF v_is_free THEN
          RAISE EXCEPTION 'No dispones de un bono gratuito ni de clases disponibles para esta sesión. Adquiere un pack de clases o bono ilimitado para reservar.' USING errcode = 'P0001';
        ELSE
          RAISE EXCEPTION 'Esta clase regular requiere un bono o pack de clases activo. Adquiere un pack de clases para reservar.' USING errcode = 'P0001';
        END IF;
      END IF;
    END IF;
  END IF;

  -- Insertar reserva confirmada
  INSERT INTO public.reservas_yoga (
    clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
    class_pack_id, saldo_gratis_descontado, welcome_companion_modality
  ) VALUES (
    p_clase_id, v_target_id, 'confirmada', v_use_unlimited,
    NOT v_use_unlimited, v_pack_id, false, v_companion_modality
  );
END;
$$;

-- Sobrecargas seguras
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

CREATE OR REPLACE FUNCTION public.reservar_con_bono(
  p_clase_id numeric,
  p_user_id uuid,
  p_use_welcome_companion boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.reservar_con_bono(p_clase_id::bigint, p_user_id, p_use_welcome_companion);
END;
$$;

CREATE OR REPLACE FUNCTION public.reservar_con_bono(
  p_clase_id numeric,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.reservar_con_bono(p_clase_id::bigint, p_user_id, false);
END;
$$;

REVOKE ALL ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.reservar_con_bono(bigint, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.reservar_con_bono(bigint, uuid) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.reservar_con_bono(numeric, uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.reservar_con_bono(numeric, uuid, boolean) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.reservar_con_bono(numeric, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.reservar_con_bono(numeric, uuid) TO anon, authenticated, service_role;


-- 3. Actualizar función reservar_invitado_ilimitado para que cubra todo el mes natural
CREATE OR REPLACE FUNCTION public.reservar_invitado_ilimitado(
  p_owner_user_id uuid,
  p_guest_user_id uuid,
  p_clase_id bigint,
  p_guest_name text,
  p_guest_email text default null
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_membership_start timestamptz;
  v_membership_end timestamptz;
  v_membership_active boolean;
  v_natural_membership_start timestamptz;
  v_natural_membership_end timestamptz;
  v_owner_role text;
  v_guest_role text;
  v_class_start timestamptz;
  v_class_month date;
  v_capacity integer;
  v_occupied integer;
  v_booking_limit_hours integer := 12;
  v_reservation_id bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING errcode = '42501';
  END IF;
  IF p_owner_user_id IS NULL OR p_guest_user_id IS NULL OR p_clase_id IS NULL
    OR nullif(trim(coalesce(p_guest_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'invalid unlimited guest request' USING errcode = '22023';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))), coalesce(bono_mensual_activo, false),
         bono_mensual_inicio, bono_mensual_fin
    INTO v_owner_role, v_membership_active, v_membership_start, v_membership_end
    FROM public.profiles WHERE id = p_owner_user_id FOR UPDATE;
  IF NOT found OR v_owner_role IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'unlimited membership owner not found' USING errcode = 'P0002';
  END IF;
  SELECT lower(trim(coalesce(rol, ''))) INTO v_guest_role
    FROM public.profiles WHERE id = p_guest_user_id FOR UPDATE;
  IF NOT found OR v_guest_role <> 'cliente_temporal' THEN
    RAISE EXCEPTION 'temporary guest profile not found' USING errcode = 'P0002';
  END IF;

  SELECT fecha_inicio, coalesce(capacidad_max, 0)
    INTO v_class_start, v_capacity
    FROM public.clases
   WHERE id = p_clase_id
     AND lower(trim(coalesce(tipo_clase, ''))) = 'yoga'
     AND coalesce(activa, true)
    FOR UPDATE;
  IF NOT found THEN
    RAISE EXCEPTION 'guest benefit only applies to regular yoga classes' USING errcode = 'P0002';
  END IF;

  v_class_month := date_trunc('month', v_class_start AT TIME ZONE 'Europe/Madrid')::date;

  SELECT starts_at, ends_at
    INTO v_natural_membership_start, v_natural_membership_end
    FROM public.unlimited_membership_periods
   WHERE user_id = p_owner_user_id
     AND (
       (starts_at <= v_class_start AND ends_at > v_class_start)
       OR (membership_month = v_class_month)
       OR (
         starts_at <= v_class_start
         AND ((date_trunc('day', ends_at AT TIME ZONE 'Europe/Madrid')::date + 1)::text || ' 00:00:00 Europe/Madrid')::timestamptz > v_class_start
       )
     )
   ORDER BY starts_at DESC
   LIMIT 1
   FOR SHARE;

  IF found THEN
    v_membership_active := true;
    v_membership_start := coalesce(v_natural_membership_start, (v_class_month::text || ' 00:00:00 Europe/Madrid')::timestamptz);
    v_membership_end := coalesce(v_natural_membership_end, ((v_class_month + interval '1 month')::date::text || ' 00:00:00 Europe/Madrid')::timestamptz);
  END IF;

  IF NOT v_membership_active OR v_membership_start IS NULL OR v_membership_end IS NULL
    OR NOT (
      (v_class_start >= v_membership_start AND v_class_start < v_membership_end)
      OR (date_trunc('month', v_membership_start AT TIME ZONE 'Europe/Madrid')::date = v_class_month)
      OR (
        v_class_start >= v_membership_start
        AND v_class_start < ((date_trunc('day', v_membership_end AT TIME ZONE 'Europe/Madrid')::date + 1)::text || ' 00:00:00 Europe/Madrid')::timestamptz
      )
    ) THEN
    RAISE EXCEPTION 'unlimited membership is not active for this class'
      USING errcode = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.unlimited_guest_passes
     WHERE owner_user_id = p_owner_user_id
       AND date_trunc('month', membership_period_start AT TIME ZONE 'Europe/Madrid')::date = v_class_month
  ) THEN
    RAISE EXCEPTION 'monthly unlimited guest allowance already used' USING errcode = 'P0001';
  END IF;

  BEGIN
    SELECT CASE WHEN trim(coalesce(valor, '')) ~ '^[0-9]{1,3}$'
      THEN least(168, greatest(0, trim(valor)::integer)) ELSE 12 END
      INTO v_booking_limit_hours
      FROM public.configuracion WHERE clave = 'horas_limite_reserva' LIMIT 1;
  EXCEPTION WHEN others THEN
    v_booking_limit_hours := 12;
  END;

  IF v_class_start <= now() + make_interval(hours => coalesce(v_booking_limit_hours, 12)) THEN
    RAISE EXCEPTION 'booking deadline has passed' USING errcode = 'P0001';
  END IF;

  SELECT count(*)::integer INTO v_occupied
    FROM public.reservas_yoga WHERE clase_id = p_clase_id AND estado = 'confirmada';
  IF v_capacity <= 0 OR v_occupied >= v_capacity THEN
    RAISE EXCEPTION 'class is full' USING errcode = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.reservas_yoga
     WHERE clase_id = p_clase_id AND user_id = p_guest_user_id AND estado = 'confirmada'
  ) THEN
    RAISE EXCEPTION 'guest is already booked in this class' USING errcode = '23505';
  END IF;

  INSERT INTO public.reservas_yoga (
    clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
    beneficio_invitado_de
  ) VALUES (
    p_clase_id, p_guest_user_id, 'confirmada', true, false, p_owner_user_id
  ) RETURNING id INTO v_reservation_id;

  INSERT INTO public.unlimited_guest_passes (
    owner_user_id, guest_user_id, class_id, reservation_id,
    guest_name, guest_email, membership_period_start, membership_period_end
  ) VALUES (
    p_owner_user_id, p_guest_user_id, p_clase_id, v_reservation_id,
    trim(p_guest_name), nullif(lower(trim(coalesce(p_guest_email, ''))), ''),
    v_membership_start, v_membership_end
  );

  RETURN v_reservation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reservar_invitado_ilimitado(uuid, uuid, bigint, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.reservar_invitado_ilimitado(uuid, uuid, bigint, text, text) TO authenticated, service_role;


-- 4. CORRECCIÓN RETROACTIVA DE DATOS EXISTENTES EN SUPABASE
-- Asegurar que todos los periodos ilimitados existentes cubran hasta el inicio del mes siguiente (o fin del último día)
UPDATE public.unlimited_membership_periods
   SET starts_at = ((membership_month::text || ' 00:00:00 Europe/Madrid')::timestamptz),
       ends_at = (((membership_month + interval '1 month')::date::text || ' 00:00:00 Europe/Madrid')::timestamptz)
 WHERE membership_month IS NOT NULL;

-- Actualizar en profiles a los usuarios con bono mensual activo
UPDATE public.profiles
   SET bono_mensual_inicio = ((date_trunc('month', bono_mensual_inicio AT TIME ZONE 'Europe/Madrid')::date::text || ' 00:00:00 Europe/Madrid')::timestamptz),
       bono_mensual_fin = (((date_trunc('month', bono_mensual_inicio AT TIME ZONE 'Europe/Madrid')::date + interval '1 month')::date::text || ' 00:00:00 Europe/Madrid')::timestamptz)
 WHERE bono_mensual_activo = true
   AND bono_mensual_inicio IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;

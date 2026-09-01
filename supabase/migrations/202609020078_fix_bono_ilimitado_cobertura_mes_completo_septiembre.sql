-- ==============================================================================
-- Migración 202609020078: Cobertura total del mes natural en Bono Ilimitado
-- (incluyendo el último día del mes) y corrección de asignación manual de alumnos
-- ==============================================================================

BEGIN;

-- 1. Crear / Reemplazar función admin_asignar_mes_ilimitado con cobertura precisa del mes natural
CREATE OR REPLACE FUNCTION public.admin_asignar_mes_ilimitado(
  p_user_id uuid,
  p_membership_month date,
  p_activo boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_actor_deletion_pending boolean;
  v_target_role text;
  v_target_deletion_pending boolean;
  v_month date;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_remaining_count integer;
  v_min_start timestamptz;
  v_max_end timestamptz;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))), coalesce(account_deletion_pending, false)
    INTO v_actor_role, v_actor_deletion_pending
    FROM public.profiles
   WHERE id = v_actor_id;

  IF NOT found OR v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional') OR v_actor_deletion_pending THEN
    RAISE EXCEPTION 'Permisos insuficientes para gestionar bonos mensuales.' USING errcode = '42501';
  END IF;

  IF p_user_id IS NULL OR p_activo IS NULL THEN
    RAISE EXCEPTION 'Parámetros no válidos.' USING errcode = '22023';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))), coalesce(account_deletion_pending, false)
    INTO v_target_role, v_target_deletion_pending
    FROM public.profiles
   WHERE id = p_user_id
   FOR UPDATE;

  IF NOT found THEN
    RAISE EXCEPTION 'Perfil no encontrado.' USING errcode = 'P0002';
  END IF;

  IF v_target_role IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'Los bonos mensuales solo pueden asignarse a alumnos/clientes.' USING errcode = '22023';
  END IF;

  IF v_target_deletion_pending THEN
    RAISE EXCEPTION 'La cuenta del usuario está en proceso de eliminación.' USING errcode = '55000';
  END IF;

  v_month := date_trunc('month', coalesce(p_membership_month, now() AT TIME ZONE 'Europe/Madrid'))::date;
  v_starts_at := (v_month::text || ' 00:00:00 Europe/Madrid')::timestamptz;
  -- El fin del mes natural es a las 00:00:00 del primer día del mes siguiente (cubre hasta 23:59:59 del último día)
  v_ends_at := ((v_month + interval '1 month')::date::text || ' 00:00:00 Europe/Madrid')::timestamptz;

  IF p_activo THEN
    INSERT INTO public.unlimited_membership_periods (
      user_id,
      checkout_session_id,
      membership_month,
      starts_at,
      ends_at,
      purchased_at
    ) VALUES (
      p_user_id,
      null,
      v_month,
      v_starts_at,
      v_ends_at,
      now()
    )
    ON CONFLICT (user_id, membership_month) DO UPDATE
      SET starts_at = excluded.starts_at,
          ends_at = excluded.ends_at,
          purchased_at = coalesce(public.unlimited_membership_periods.purchased_at, excluded.purchased_at);
  ELSE
    DELETE FROM public.unlimited_membership_periods
     WHERE user_id = p_user_id
       AND membership_month = v_month;
  END IF;

  -- Sincronizar tabla profiles
  SELECT count(*), min(starts_at), max(ends_at)
    INTO v_remaining_count, v_min_start, v_max_end
    FROM public.unlimited_membership_periods
   WHERE user_id = p_user_id;

  IF v_remaining_count > 0 THEN
    UPDATE public.profiles
       SET bono_mensual_activo = true,
           bono_mensual_inicio = v_min_start,
           bono_mensual_fin = v_max_end
     WHERE id = p_user_id;
  ELSE
    UPDATE public.profiles
       SET bono_mensual_activo = false,
           bono_mensual_inicio = null,
           bono_mensual_fin = null
     WHERE id = p_user_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_asignar_mes_ilimitado(uuid, date, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_asignar_mes_ilimitado(uuid, date, boolean) TO authenticated, service_role;


-- 2. Mantener compatibilidad total con admin_configurar_bono_mensual
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
  v_membership_month date;
  v_extra_month date;
BEGIN
  IF p_activo THEN
    v_membership_month := date_trunc('month', coalesce(p_inicio, now()) AT TIME ZONE 'Europe/Madrid')::date;
    PERFORM public.admin_asignar_mes_ilimitado(p_user_id, v_membership_month, true);

    IF p_fin IS NOT NULL THEN
      v_extra_month := date_trunc('month', (p_fin - interval '1 second') AT TIME ZONE 'Europe/Madrid')::date;
      IF v_extra_month > v_membership_month THEN
        PERFORM public.admin_asignar_mes_ilimitado(p_user_id, v_extra_month, true);
      END IF;
    END IF;
  ELSE
    DELETE FROM public.unlimited_membership_periods WHERE user_id = p_user_id;
    UPDATE public.profiles
       SET bono_mensual_activo = false,
           bono_mensual_inicio = null,
           bono_mensual_fin = null
     WHERE id = p_user_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_configurar_bono_mensual(uuid, boolean, timestamptz, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_configurar_bono_mensual(uuid, boolean, timestamptz, timestamptz) TO authenticated, service_role;


-- 3. Función central reservar_con_bono: Permite reservar cualquier clase del mes con Bono Ilimitado
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
  v_unlimited_active boolean := false;
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
  v_is_companion boolean;
  v_companion_modality text;
  v_professor_id public.clases.profesor_id%TYPE;
  v_professional_identity text := '';
  v_occupied integer;
  v_booking_limit_hours integer := 12;
  v_use_unlimited boolean := false;
  v_pack_id bigint;
  v_special_count integer := 0;
  v_class_month date;
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

  IF NOT found THEN
    RAISE EXCEPTION 'No se encontró el perfil que realiza la reserva.' USING errcode = 'P0002';
  END IF;

  v_actor_is_staff := v_actor_role IN ('admin', 'profesor', 'trabajador', 'profesional');
  IF v_target_id <> v_actor_id AND NOT v_actor_is_staff THEN
    RAISE EXCEPTION 'No tienes permisos para reservar en nombre de otro usuario.' USING errcode = '42501';
  END IF;

  SELECT coalesce(capacidad_max, 0), fecha_inicio, nombre,
         lower(trim(coalesce(tipo_clase, ''))), coalesce(activa, true),
         profesor_id, coalesce(es_gratuita, false), companion_modality
    INTO v_capacity, v_starts_at, v_class_name, v_class_type, v_class_active,
         v_professor_id, v_marked_free, v_companion_modality
    FROM public.clases
   WHERE id = p_clase_id
   FOR UPDATE;

  IF NOT found OR v_class_type NOT IN ('yoga', 'taller') OR NOT v_class_active THEN
    RAISE EXCEPTION 'La clase especificada no está disponible.' USING errcode = 'P0002';
  END IF;

  IF v_professor_id IS NOT NULL THEN
    SELECT lower(concat_ws(' ', coalesce(nombre, ''), coalesce(apellidos, ''), coalesce(email, '')))
      INTO v_professional_identity
      FROM public.profesionales
     WHERE id = v_professor_id;
    v_professional_identity := coalesce(v_professional_identity, '');
  END IF;

  v_is_special := (v_class_type = 'taller' OR lower(trim(coalesce(v_class_name, ''))) LIKE '%especial%');
  v_is_companion := (v_companion_modality IS NOT NULL AND trim(v_companion_modality) <> '');

  IF v_starts_at IS NULL THEN
    RAISE EXCEPTION 'La clase no tiene una hora de inicio válida.' USING errcode = '22023';
  END IF;
  IF v_capacity <= 0 THEN
    RAISE EXCEPTION 'La clase no tiene plazas disponibles.' USING errcode = 'P0001';
  END IF;

  IF v_target_id <> v_actor_id AND v_actor_role <> 'admin'
    AND NOT EXISTS (
      SELECT 1
        FROM public.profesionales
       WHERE id = v_professor_id
         AND lower(nullif(trim(email), '')) = v_actor_email
    ) THEN
    RAISE EXCEPTION 'Solo puedes gestionar reservas de tus propias clases.' USING errcode = '42501';
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
  v_booking_limit_hours := coalesce(v_booking_limit_hours, 12);

  IF NOT v_actor_is_staff
    AND v_starts_at <= now() + make_interval(hours => v_booking_limit_hours) THEN
    RAISE EXCEPTION 'Las reservas cierran % h antes del inicio. Para esta clase ya ha pasado el plazo.',
      v_booking_limit_hours USING errcode = 'P0001';
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
  IF v_target_role IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'Solo los alumnos pueden reservar clases.' USING errcode = '42501';
  END IF;

  v_class_month := date_trunc('month', v_starts_at AT TIME ZONE 'Europe/Madrid')::date;

  v_is_free := public.es_clase_elegible_bono_gratis(
    v_class_name,
    v_starts_at,
    v_professional_identity,
    v_marked_free
  );

  -- 1. Clase 100% gratuita por configuración del estudio
  IF v_marked_free THEN
    INSERT INTO public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado, welcome_companion_modality
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', false, false, null, false, null
    );
    RETURN;
  END IF;

  -- 2. Bono de Yoga en Compañía
  IF p_use_welcome_companion = true AND v_is_companion AND NOT v_is_special THEN
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
          p_clase_id, v_target_id, 'confirmada', false, false, null, false, v_companion_modality
        );
        RETURN;
      END IF;
    END IF;
  END IF;

  -- 3. Sesión gratuita/introductoria y el alumno tiene bono gratis disponible
  IF v_is_free AND v_free_credits >= 1 AND NOT v_is_special AND NOT p_use_welcome_companion THEN
    UPDATE public.profiles
       SET saldo_clases_gratis = saldo_clases_gratis - 1
     WHERE id = v_target_id
       AND saldo_clases_gratis >= 1;
    IF found THEN
      INSERT INTO public.reservas_yoga (
        clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
        class_pack_id, saldo_gratis_descontado, welcome_companion_modality
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, false, null, true, null
      );
      RETURN;
    END IF;
  END IF;

  -- 4. Sesión introductoria o en compañía asignada por el personal a un alumno en mostrador
  IF (v_is_free OR v_is_companion) AND v_actor_is_staff AND v_target_id <> v_actor_id THEN
    INSERT INTO public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado, welcome_companion_modality
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', false, false, null, false, v_companion_modality
    );
    RETURN;
  END IF;

  -- 5. Bono Ilimitado por mes natural (cobertura íntegra del mes completo)
  SELECT starts_at, ends_at
    INTO v_natural_membership_start, v_natural_membership_end
    FROM public.unlimited_membership_periods
   WHERE user_id = v_target_id
     AND (
       membership_month = v_class_month
       OR date_trunc('month', starts_at AT TIME ZONE 'Europe/Madrid')::date = v_class_month
       OR date_trunc('month', (ends_at - interval '1 second') AT TIME ZONE 'Europe/Madrid')::date = v_class_month
       OR (starts_at <= v_starts_at AND ends_at >= v_starts_at)
       OR (
         date_trunc('month', starts_at AT TIME ZONE 'Europe/Madrid')::date <= v_class_month
         AND date_trunc('month', (ends_at - interval '1 second') AT TIME ZONE 'Europe/Madrid')::date >= v_class_month
       )
     )
   ORDER BY starts_at DESC
   LIMIT 1
   FOR SHARE;

  IF found THEN
    v_unlimited_active := true;
    v_membership_start := v_natural_membership_start;
    v_membership_end := v_natural_membership_end;
  ELSIF v_unlimited_active THEN
    IF (date_trunc('month', coalesce(v_membership_start, now()) AT TIME ZONE 'Europe/Madrid')::date = v_class_month)
       OR (date_trunc('month', (coalesce(v_membership_end, now()) - interval '1 second') AT TIME ZONE 'Europe/Madrid')::date = v_class_month)
       OR (date_trunc('month', coalesce(v_membership_start, now()) AT TIME ZONE 'Europe/Madrid')::date <= v_class_month
           AND (date_trunc('month', coalesce(v_membership_end, now()) AT TIME ZONE 'Europe/Madrid')::date >= v_class_month
                OR date_trunc('month', (coalesce(v_membership_end, now()) - interval '1 second') AT TIME ZONE 'Europe/Madrid')::date >= v_class_month))
       OR (v_starts_at >= coalesce(v_membership_start, '-infinity'::timestamptz)
           AND v_starts_at <= coalesce(v_membership_end, 'infinity'::timestamptz) + interval '1 day') THEN
      v_use_unlimited := true;
    END IF;
  END IF;

  IF v_unlimited_active AND NOT v_use_unlimited THEN
    IF (date_trunc('month', coalesce(v_membership_start, v_starts_at) AT TIME ZONE 'Europe/Madrid')::date = v_class_month)
       OR (date_trunc('month', coalesce(v_membership_end, v_starts_at) AT TIME ZONE 'Europe/Madrid')::date = v_class_month)
       OR (v_starts_at >= coalesce(v_membership_start, '-infinity'::timestamptz)
           AND v_starts_at <= coalesce(v_membership_end, 'infinity'::timestamptz) + interval '1 day') THEN
      v_use_unlimited := true;
    END IF;
  END IF;

  IF v_use_unlimited THEN
    IF v_is_special THEN
      SELECT count(*)::integer
        INTO v_special_count
        FROM public.reservas_yoga AS booking
        JOIN public.clases AS class ON class.id = booking.clase_id
       WHERE booking.user_id = v_target_id
         AND booking.estado = 'confirmada'
         AND coalesce(booking.usado_bono_mensual, false)
         AND lower(trim(coalesce(class.tipo_clase, ''))) = 'taller'
         AND date_trunc('month', class.fecha_inicio AT TIME ZONE 'Europe/Madrid')::date = v_class_month;
      IF v_special_count >= 1 THEN
        RAISE EXCEPTION 'Ya has utilizado la clase especial incluida en este mes natural.' USING errcode = 'P0001';
      END IF;
    END IF;

    -- Reserva con Bono Ilimitado confirmada sin descontar saldo individual
    INSERT INTO public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado, welcome_companion_modality
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', true, false, null, false, v_companion_modality
    );
    RETURN;
  END IF;

  -- 6. Clases especiales requieren Bono Ilimitado
  IF v_is_special THEN
    RAISE EXCEPTION 'Las clases especiales requieren un Bono Ilimitado activo y disponibilidad mensual.' USING errcode = 'P0001';
  END IF;

  -- 7. Packs de Clases
  SELECT id
    INTO v_pack_id
    FROM public.class_credit_packs
   WHERE user_id = v_target_id
     AND credits_remaining > 0
     AND expires_at > now()
     AND expires_at >= v_starts_at
   ORDER BY expires_at, purchased_at, id
   LIMIT 1
   FOR UPDATE;

  IF v_pack_id IS NOT NULL THEN
    UPDATE public.class_credit_packs
       SET credits_remaining = credits_remaining - 1,
           updated_at = now()
     WHERE id = v_pack_id
       AND credits_remaining > 0;
    IF found THEN
      INSERT INTO public.reservas_yoga (
        clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
        class_pack_id, saldo_gratis_descontado, welcome_companion_modality
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, true, v_pack_id, false, v_companion_modality
      );
      RETURN;
    END IF;
  END IF;

  -- 8. Saldo directo en profiles.bonos
  UPDATE public.profiles
     SET bonos = coalesce(bonos, 0) - 1
   WHERE id = v_target_id
     AND coalesce(bonos, 0) >= 1;

  IF found THEN
    INSERT INTO public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado, welcome_companion_modality
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', false, true, null, false, v_companion_modality
    );
    RETURN;
  END IF;

  -- Si no dispone de ningún saldo
  IF v_is_free THEN
    RAISE EXCEPTION 'No dispones de un bono gratuito ni de clases disponibles para esta sesión. Adquiere un pack de clases o bono ilimitado para reservar.' USING errcode = 'P0001';
  ELSE
    RAISE EXCEPTION 'Esta clase regular requiere un bono o pack de clases activo. Adquiere un pack de clases para reservar.' USING errcode = 'P0001';
  END IF;
END;
$$;

-- Eliminar sobrecarga ambigua reservar_con_bono(bigint, uuid) si existiera
DROP FUNCTION IF EXISTS public.reservar_con_bono(bigint, uuid);

REVOKE ALL ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean) TO anon, authenticated, service_role;



-- 4. Reparar el registro de Manuel Delgado Marín (y cualquier otro periodo truncado)
UPDATE public.unlimited_membership_periods
   SET membership_month = '2026-09-01'::date,
       starts_at = '2026-08-31 22:00:00+00'::timestamptz,
       ends_at = '2026-10-01 00:00:00 Europe/Madrid'::timestamptz
 WHERE user_id = 'c3ec938e-af26-4028-90ea-1336a02e20f7';

UPDATE public.profiles
   SET bono_mensual_activo = true,
       bono_mensual_inicio = '2026-08-31 22:00:00+00'::timestamptz,
       bono_mensual_fin = '2026-10-01 00:00:00 Europe/Madrid'::timestamptz
 WHERE id = 'c3ec938e-af26-4028-90ea-1336a02e20f7';

-- Reparación general para cualquier perfil con fin a las 00:00:00 del mismo mes
UPDATE public.profiles
   SET bono_mensual_fin = (date_trunc('month', bono_mensual_fin AT TIME ZONE 'Europe/Madrid') + interval '1 month') AT TIME ZONE 'Europe/Madrid'
 WHERE bono_mensual_activo = true
   AND bono_mensual_fin IS NOT NULL
   AND (bono_mensual_fin AT TIME ZONE 'Europe/Madrid')::time = '00:00:00'::time
   AND (date_trunc('month', bono_mensual_inicio AT TIME ZONE 'Europe/Madrid')::date = date_trunc('month', bono_mensual_fin AT TIME ZONE 'Europe/Madrid')::date);

UPDATE public.unlimited_membership_periods
   SET ends_at = (date_trunc('month', ends_at AT TIME ZONE 'Europe/Madrid') + interval '1 month') AT TIME ZONE 'Europe/Madrid'
 WHERE ends_at IS NOT NULL
   AND (ends_at AT TIME ZONE 'Europe/Madrid')::time = '00:00:00'::time
   AND (date_trunc('month', starts_at AT TIME ZONE 'Europe/Madrid')::date = date_trunc('month', ends_at AT TIME ZONE 'Europe/Madrid')::date);

COMMIT;

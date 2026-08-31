-- ==============================================================================
-- Migración 202609020073: Bonos Ilimitados por Mes Natural Definitivo
-- GEN YOGA v9.11
-- ==============================================================================

BEGIN;

-- 1. Normalizar periodos existentes en unlimited_membership_periods para garantizar cobertura total de mes natural
UPDATE public.unlimited_membership_periods
   SET starts_at = (date_trunc('month', coalesce(starts_at, membership_month::timestamptz) AT TIME ZONE 'Europe/Madrid')::date::text || ' 00:00:00 Europe/Madrid')::timestamptz,
       ends_at = ((date_trunc('month', coalesce(starts_at, membership_month::timestamptz) AT TIME ZONE 'Europe/Madrid')::date + interval '1 month')::date::text || ' 00:00:00 Europe/Madrid')::timestamptz,
       membership_month = date_trunc('month', coalesce(starts_at, membership_month::timestamptz) AT TIME ZONE 'Europe/Madrid')::date
 WHERE membership_month IS NOT NULL OR starts_at IS NOT NULL;

-- 2. Asegurar que usuarios con bono_mensual_activo en profiles tengan su registro correspondiente en unlimited_membership_periods
INSERT INTO public.unlimited_membership_periods (
  user_id,
  checkout_session_id,
  membership_month,
  starts_at,
  ends_at,
  purchased_at
)
SELECT 
  p.id,
  null,
  date_trunc('month', coalesce(p.bono_mensual_inicio, now()) AT TIME ZONE 'Europe/Madrid')::date,
  (date_trunc('month', coalesce(p.bono_mensual_inicio, now()) AT TIME ZONE 'Europe/Madrid')::date::text || ' 00:00:00 Europe/Madrid')::timestamptz,
  ((date_trunc('month', coalesce(p.bono_mensual_inicio, now()) AT TIME ZONE 'Europe/Madrid')::date + interval '1 month')::date::text || ' 00:00:00 Europe/Madrid')::timestamptz,
  now()
FROM public.profiles p
WHERE p.bono_mensual_activo = true
ON CONFLICT (user_id, membership_month) DO UPDATE
  SET starts_at = excluded.starts_at,
      ends_at = excluded.ends_at;

-- 3. Nueva función RPC de administrador: Asignar o revocar mes natural de Bono Ilimitado
CREATE OR REPLACE FUNCTION public.admin_asignar_mes_ilimitado(
  p_user_id uuid,
  p_membership_month date,
  p_activo boolean DEFAULT true
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
  v_month date;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_remaining_count integer;
  v_min_start timestamptz;
  v_max_end timestamptz;
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

  IF p_user_id IS NULL OR p_membership_month IS NULL THEN
    RAISE EXCEPTION 'invalid user or membership month' USING errcode = '22023';
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

  v_month := date_trunc('month', p_membership_month)::date;
  v_starts_at := (v_month::text || ' 00:00:00 Europe/Madrid')::timestamptz;
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

COMMENT ON FUNCTION public.admin_asignar_mes_ilimitado(uuid, date, boolean)
IS 'Admin RPC to assign or revoke a specific natural month for Unlimited Pass.';

REVOKE ALL ON FUNCTION public.admin_asignar_mes_ilimitado(uuid, date, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_asignar_mes_ilimitado(uuid, date, boolean) TO authenticated, service_role;


-- 4. Mantener retrocompatibilidad total con admin_configurar_bono_mensual
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
BEGIN
  IF p_activo THEN
    v_membership_month := date_trunc('month', coalesce(p_inicio, now()) AT TIME ZONE 'Europe/Madrid')::date;
    PERFORM public.admin_asignar_mes_ilimitado(p_user_id, v_membership_month, true);
    
    -- Si p_fin supera el mes natural inicial, asignar también los meses intermedios/finales
    IF p_fin IS NOT NULL AND date_trunc('month', p_fin AT TIME ZONE 'Europe/Madrid')::date > v_membership_month THEN
      PERFORM public.admin_asignar_mes_ilimitado(p_user_id, date_trunc('month', p_fin AT TIME ZONE 'Europe/Madrid')::date, true);
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

REVOKE ALL ON FUNCTION public.admin_configurar_bono_mensual(uuid, boolean, timestamptz, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_configurar_bono_mensual(uuid, boolean, timestamptz, timestamptz) TO authenticated, service_role;


-- 5. Actualizar la función central reservar_con_bono con verificación infalible por mes natural
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
  v_target_id uuid;
  v_target_role text;
  v_target_name text;
  v_target_apellidos text;
  v_target_deletion_pending boolean;
  v_saldo_clases_gratis integer;
  v_saldo_yoga_compania integer;
  v_unlimited_active boolean := false;
  v_membership_start timestamptz;
  v_membership_end timestamptz;
  v_natural_membership_start timestamptz;
  v_natural_membership_end timestamptz;
  v_class_title text;
  v_class_tipo text;
  v_class_style text;
  v_starts_at timestamptz;
  v_capacidad_max integer;
  v_booked_count integer;
  v_is_special boolean;
  v_is_companion boolean;
  v_is_free boolean;
  v_is_free_session_strictly boolean;
  v_companion_modality text;
  v_class_month date;
  v_use_unlimited boolean := false;
  v_pack_id uuid;
  v_special_count integer;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para reservar.' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))), email
    INTO v_actor_role, v_actor_email
    FROM public.profiles
   WHERE id = v_actor_id;

  v_target_id := coalesce(p_user_id, v_actor_id);

  IF v_target_id <> v_actor_id THEN
    IF v_actor_role NOT IN ('admin', 'profesor') THEN
      RAISE EXCEPTION 'No tienes permisos para reservar en nombre de otro usuario.' USING errcode = '42501';
    END IF;
  END IF;

  SELECT lower(trim(coalesce(rol, ''))),
         nombre,
         apellidos,
         coalesce(account_deletion_pending, false),
         coalesce(saldo_clases_gratis, 0),
         coalesce(saldo_yoga_compania, 0),
         coalesce(bono_mensual_activo, false),
         bono_mensual_inicio,
         bono_mensual_fin
    INTO v_target_role,
         v_target_name,
         v_target_apellidos,
         v_target_deletion_pending,
         v_saldo_clases_gratis,
         v_saldo_yoga_compania,
         v_unlimited_active,
         v_membership_start,
         v_membership_end
    FROM public.profiles
   WHERE id = v_target_id
   FOR UPDATE;

  IF NOT found THEN
    RAISE EXCEPTION 'Perfil de usuario no encontrado.' USING errcode = 'P0002';
  END IF;

  IF v_target_deletion_pending THEN
    RAISE EXCEPTION 'La cuenta se encuentra en proceso de eliminación.' USING errcode = '55000';
  END IF;

  SELECT titulo,
         lower(trim(coalesce(tipo_clase, ''))),
         lower(trim(coalesce(estilo, ''))),
         fecha_inicio,
         capacidad_max,
         coalesce(es_gratuita, false),
         companion_modality
    INTO v_class_title,
         v_class_tipo,
         v_class_style,
         v_starts_at,
         v_capacidad_max,
         v_is_free,
         v_companion_modality
    FROM public.clases
   WHERE id = p_clase_id
   FOR SHARE;

  IF NOT found THEN
    RAISE EXCEPTION 'Clase no encontrada.' USING errcode = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.reservas_yoga
     WHERE clase_id = p_clase_id
       AND user_id = v_target_id
       AND estado = 'confirmada'
  ) THEN
    RAISE EXCEPTION 'Ya tienes una reserva confirmada para esta clase.' USING errcode = '23505';
  END IF;

  SELECT count(*)::integer
    INTO v_booked_count
    FROM public.reservas_yoga
   WHERE clase_id = p_clase_id
     AND estado = 'confirmada';

  IF v_booked_count >= v_capacidad_max THEN
    RAISE EXCEPTION 'Esta clase ya está completa.' USING errcode = '55000';
  END IF;

  v_class_month := date_trunc('month', v_starts_at AT TIME ZONE 'Europe/Madrid')::date;
  v_is_special := (v_class_tipo = 'taller' OR v_class_tipo = 'especial');
  v_is_companion := (v_companion_modality IS NOT NULL AND trim(v_companion_modality) <> '');
  v_is_free_session_strictly := (
    v_is_free = true
    OR (v_starts_at >= '2026-08-30 00:00:00+02' AND v_starts_at < '2026-08-31 00:00:00+02')
    OR (v_starts_at >= '2026-09-01 00:00:00+02' AND v_starts_at < '2026-09-05 00:00:00+02')
    OR (v_starts_at >= '2026-09-07 00:00:00+02' AND v_starts_at < '2026-09-08 00:00:00+02')
    OR (v_starts_at >= '2026-09-18 00:00:00+02' AND v_starts_at < '2026-09-19 00:00:00+02')
  );

  -- Prioridad 1: Clase 100% libre configurada por el estudio (0 €)
  IF v_is_free THEN
    INSERT INTO public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado, welcome_companion_modality
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', false, false, null, false, null
    );
    RETURN;
  END IF;

  -- Prioridad 2: Bono de Yoga en Compañía (0 €)
  IF p_use_welcome_companion = true AND v_is_companion AND NOT v_is_special THEN
    IF v_saldo_yoga_compania < 1 THEN
      RAISE EXCEPTION 'No dispones de un bono de Yoga en Compañía activo (0 €).' USING errcode = 'P0001';
    END IF;

    UPDATE public.profiles
       SET saldo_yoga_compania = saldo_yoga_compania - 1
     WHERE id = v_target_id
       AND saldo_yoga_compania >= 1;

    INSERT INTO public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado, welcome_companion_modality
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', false, false, null, false, v_companion_modality
    );
    RETURN;
  END IF;

  -- Prioridad 3: Bono de Bienvenida / Sesión Gratuita (0 €)
  IF v_is_free_session_strictly AND v_saldo_clases_gratis >= 1 AND NOT v_is_special AND NOT p_use_welcome_companion THEN
    UPDATE public.profiles
       SET saldo_clases_gratis = saldo_clases_gratis - 1
     WHERE id = v_target_id
       AND saldo_clases_gratis >= 1;

    INSERT INTO public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado, welcome_companion_modality
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', false, false, null, true, null
    );
    RETURN;
  END IF;

  -- Prioridad 4: Bono Ilimitado por Mes Natural
  SELECT starts_at, ends_at
    INTO v_natural_membership_start, v_natural_membership_end
    FROM public.unlimited_membership_periods
   WHERE user_id = v_target_id
     AND (
       membership_month = v_class_month
       OR (starts_at <= v_starts_at AND ends_at > v_starts_at)
       OR (date_trunc('month', starts_at AT TIME ZONE 'Europe/Madrid')::date = v_class_month)
     )
   ORDER BY starts_at DESC
   LIMIT 1
   FOR SHARE;

  IF found THEN
    v_use_unlimited := true;
  ELSIF v_unlimited_active THEN
    -- Fallback perfil: si el perfil tiene bono activo y coincide el mes
    IF (date_trunc('month', coalesce(v_membership_start, now()) AT TIME ZONE 'Europe/Madrid')::date = v_class_month)
       OR (v_membership_start <= v_starts_at AND date_trunc('month', coalesce(v_membership_end, now()) AT TIME ZONE 'Europe/Madrid')::date >= v_class_month)
       OR (v_starts_at >= coalesce(v_membership_start, '-infinity'::timestamptz) AND v_starts_at <= coalesce(v_membership_end, 'infinity'::timestamptz)) THEN
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
         AND (lower(trim(coalesce(class.tipo_clase, ''))) = 'taller' OR lower(trim(coalesce(class.tipo_clase, ''))) = 'especial')
         AND date_trunc('month', class.fecha_inicio AT TIME ZONE 'Europe/Madrid')::date = v_class_month;
      IF v_special_count >= 1 THEN
        RAISE EXCEPTION 'Ya has utilizado la clase especial incluida en este mes natural.'
          USING errcode = 'P0001';
      END IF;
    END IF;

    INSERT INTO public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado, welcome_companion_modality
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', true, false, null, false, v_companion_modality
    );
    RETURN;
  END IF;

  -- Prioridad 5: Clases especiales requieren Bono Ilimitado
  IF v_is_special THEN
    RAISE EXCEPTION 'Las clases especiales requieren un Bono Ilimitado activo para el mes natural correspondiente.'
      USING errcode = 'P0001';
  END IF;

  -- Prioridad 6: Packs de clases (4, 6 o 10)
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

    INSERT INTO public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado, welcome_companion_modality
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', false, true, v_pack_id, false, v_companion_modality
    );
    RETURN;
  END IF;

  -- Prioridad 7: Saldo directo en profiles.bonos
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

  -- Si no tiene ningún tipo de saldo disponible
  IF v_is_companion THEN
    RAISE EXCEPTION 'No dispones de un bono de Yoga en Compañía activo (0 €). Revisa tus bonos disponibles.' USING errcode = 'P0001';
  ELSIF v_is_free_session_strictly THEN
    RAISE EXCEPTION 'No dispones de un bono gratuito ni de clases disponibles para esta sesión. Adquiere un pack de clases o bono ilimitado para reservar.' USING errcode = 'P0001';
  ELSE
    RAISE EXCEPTION 'Esta clase regular requiere un bono o pack de clases activo. Adquiere un pack de clases para reservar.' USING errcode = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean) TO authenticated, service_role;

COMMIT;

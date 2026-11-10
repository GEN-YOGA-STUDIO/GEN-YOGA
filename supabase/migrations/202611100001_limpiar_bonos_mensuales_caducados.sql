-- ==============================================================================
-- Migración 202611100001: Purga y Limpieza Automática de Bonos Mensuales Caducados
-- 
-- Problema:
--   Los meses pasados de bonos ilimitados (unlimited_membership_periods),
--   bonos mensuales/iniciales (monthly_membership_periods) y bonos de clases
--   especiales (bonos_clases_especiales) permanecían en la base de datos tras
--   finalizar su mes natural, dejando profiles.bono_mensual_activo en true.
--   Esto provocaba que en el mes siguiente (ej. noviembre) los administradores
--   viesen un bono fantasma "activo este mes" y al intentar quitarlo la confirmación
--   hiciese referencia al mes pasado (ej. octubre).
--
-- Solución:
--   1. Eliminar inmediatamente registros caducados de meses anteriores.
--   2. Sincronizar profiles.bono_mensual_activo a false para perfiles sin periodos vigentes.
--   3. Crear función canónica public.limpiar_meses_caducados().
--   4. Actualizar admin_asignar_mes_ilimitado, admin_retirar_mes_ilimitado y
--      cambiar_mes_bono_usuario para que evalúen estrictamente ends_at > now().
--   5. Integrar la purga automática en reservar_con_bono y en las RPCs de gestión.
-- ==============================================================================

BEGIN;

-- 1. Función canónica para limpiar meses caducados
CREATE OR REPLACE FUNCTION public.limpiar_meses_caducados()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now timestamptz := now();
  v_current_month_madrid date := date_trunc('month', v_now AT TIME ZONE 'Europe/Madrid')::date;
  v_deleted_unlimited integer := 0;
  v_deleted_monthly integer := 0;
  v_deleted_special integer := 0;
  v_updated_profiles integer := 0;
BEGIN
  -- A. Eliminar periodos de bono ilimitado pasados (ends_at <= now O membership_month < mes actual)
  WITH del_unlim AS (
    DELETE FROM public.unlimited_membership_periods
     WHERE ends_at <= v_now
        OR membership_month < v_current_month_madrid
     RETURNING id
  )
  SELECT count(*) INTO v_deleted_unlimited FROM del_unlim;

  -- B. Eliminar periodos de bono mensual / inicial pasados
  WITH del_month AS (
    DELETE FROM public.monthly_membership_periods
     WHERE ends_at <= v_now
        OR membership_month < v_current_month_madrid
     RETURNING id
  )
  SELECT count(*) INTO v_deleted_monthly FROM del_month;

  -- C. Eliminar bonos de clases especiales de meses pasados
  WITH del_spec AS (
    DELETE FROM public.bonos_clases_especiales
     WHERE mes < v_current_month_madrid
     RETURNING id
  )
  SELECT count(*) INTO v_deleted_special FROM del_spec;

  -- D. Sincronizar perfiles: desactivar bono_mensual_activo si no tienen periodo vigente
  WITH upd_profiles_off AS (
    UPDATE public.profiles p
       SET bono_mensual_activo = false,
           bono_mensual_inicio = NULL,
           bono_mensual_fin = NULL,
           updated_at = timezone('utc', now())
     WHERE p.bono_mensual_activo = true
       AND NOT EXISTS (
         SELECT 1 FROM public.unlimited_membership_periods u
          WHERE u.user_id = p.id
            AND u.ends_at > v_now
            AND u.membership_month >= v_current_month_madrid
       )
     RETURNING p.id
  )
  SELECT count(*) INTO v_updated_profiles FROM upd_profiles_off;

  -- E. Sincronizar perfiles que sí tienen periodos vigentes para asegurar fechas exactas
  UPDATE public.profiles p
     SET bono_mensual_activo = true,
         bono_mensual_inicio = sub.min_start,
         bono_mensual_fin = sub.max_end,
         updated_at = timezone('utc', now())
    FROM (
      SELECT user_id, min(starts_at) AS min_start, max(ends_at) AS max_end
        FROM public.unlimited_membership_periods
       WHERE ends_at > v_now
         AND membership_month >= v_current_month_madrid
       GROUP BY user_id
    ) sub
   WHERE p.id = sub.user_id
     AND (
       p.bono_mensual_activo IS NOT TRUE
       OR p.bono_mensual_inicio IS DISTINCT FROM sub.min_start
       OR p.bono_mensual_fin IS DISTINCT FROM sub.max_end
     );

  RETURN jsonb_build_object(
    'success', true,
    'deleted_unlimited', v_deleted_unlimited,
    'deleted_monthly', v_deleted_monthly,
    'deleted_special', v_deleted_special,
    'updated_profiles', v_updated_profiles,
    'executed_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.limpiar_meses_caducados() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.limpiar_meses_caducados() TO authenticated, service_role;

-- 2. Ejecutar limpieza inmediata sobre los datos existentes en producción
SELECT public.limpiar_meses_caducados();

-- 3. Actualizar admin_retirar_mes_ilimitado para que siempre limpie antes y evalúe solo vigentes
CREATE OR REPLACE FUNCTION public.admin_retirar_mes_ilimitado(
  p_user_id uuid,
  p_period_id bigint DEFAULT NULL,
  p_mes date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_month date;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_remaining integer;
  v_min_start timestamptz;
  v_max_end timestamptz;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))) INTO v_actor_role
    FROM public.profiles WHERE id = v_actor_id;

  IF NOT FOUND OR v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'Permisos insuficientes para retirar meses ilimitados.' USING errcode = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'ID de usuario no proporcionado.' USING errcode = '22023';
  END IF;

  -- Limpiar meses caducados previamente
  PERFORM public.limpiar_meses_caducados();

  -- 1. Eliminar por ID exacto de periodo si se proporciona
  IF p_period_id IS NOT NULL THEN
    SELECT membership_month INTO v_month
      FROM public.unlimited_membership_periods
     WHERE id = p_period_id AND user_id = p_user_id;

    DELETE FROM public.unlimited_membership_periods
     WHERE id = p_period_id AND user_id = p_user_id;

    IF v_month IS NOT NULL THEN
      DELETE FROM public.bonos_clases_especiales
       WHERE user_id = p_user_id AND mes = v_month AND origen = 'bono_ilimitado';
    END IF;
  END IF;

  -- 2. Eliminar por mes si se proporciona
  IF p_mes IS NOT NULL THEN
    v_month := date_trunc('month', p_mes)::date;
    v_starts_at := (v_month::text || ' 00:00:00 Europe/Madrid')::timestamptz;
    v_ends_at := ((v_month + interval '1 month')::date::text || ' 00:00:00 Europe/Madrid')::timestamptz;

    DELETE FROM public.unlimited_membership_periods
     WHERE user_id = p_user_id
       AND (
         membership_month = v_month
         OR (starts_at >= v_starts_at - interval '3 days' AND starts_at < v_ends_at)
       );

    DELETE FROM public.bonos_clases_especiales
     WHERE user_id = p_user_id AND mes = v_month AND origen = 'bono_ilimitado';
  END IF;

  -- 3. Si no se especificó ni ID ni mes, eliminar todos los periodos del usuario
  IF p_period_id IS NULL AND p_mes IS NULL THEN
    DELETE FROM public.unlimited_membership_periods WHERE user_id = p_user_id;
    DELETE FROM public.bonos_clases_especiales WHERE user_id = p_user_id AND origen = 'bono_ilimitado';
  END IF;

  -- 4. Recalcular saldo y estado en tabla profiles (SOLO periodos vigentes ends_at > now())
  SELECT count(*), min(starts_at), max(ends_at)
    INTO v_remaining, v_min_start, v_max_end
    FROM public.unlimited_membership_periods
   WHERE user_id = p_user_id
     AND ends_at > now()
     AND membership_month >= date_trunc('month', now() AT TIME ZONE 'Europe/Madrid')::date;

  IF coalesce(v_remaining, 0) > 0 THEN
    UPDATE public.profiles
       SET bono_mensual_activo = true,
           bono_mensual_inicio = v_min_start,
           bono_mensual_fin = v_max_end,
           updated_at = timezone('utc', now())
     WHERE id = p_user_id;
  ELSE
    UPDATE public.profiles
       SET bono_mensual_activo = false,
           bono_mensual_inicio = null,
           bono_mensual_fin = null,
           updated_at = timezone('utc', now())
     WHERE id = p_user_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'remaining_months', coalesce(v_remaining, 0),
    'bono_mensual_activo', (coalesce(v_remaining, 0) > 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_retirar_mes_ilimitado(uuid, bigint, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_retirar_mes_ilimitado(uuid, bigint, date) TO authenticated, service_role;

-- 4. Actualizar admin_asignar_mes_ilimitado para que sincronice profiles SOLO con periodos vigentes
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
  v_month date;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_remaining_count integer;
  v_min_start timestamptz;
  v_max_end timestamptz;
  v_period_id bigint;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, '')))
    INTO v_actor_role
    FROM public.profiles
   WHERE id = v_actor_id;

  IF NOT FOUND OR v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'Permisos insuficientes para gestionar bonos mensuales.' USING errcode = '42501';
  END IF;

  IF p_user_id IS NULL OR p_activo IS NULL THEN
    RAISE EXCEPTION 'Parámetros no válidos.' USING errcode = '22023';
  END IF;

  -- Purgar periodos pasados primero
  PERFORM public.limpiar_meses_caducados();

  v_month := date_trunc('month', coalesce(p_membership_month, (timezone('Europe/Madrid', now()))::date))::date;
  v_starts_at := (v_month::text || ' 00:00:00 Europe/Madrid')::timestamptz;
  v_ends_at := ((v_month + interval '1 month')::date::text || ' 00:00:00 Europe/Madrid')::timestamptz;

  IF p_activo THEN
    SELECT id INTO v_period_id
      FROM public.unlimited_membership_periods
     WHERE user_id = p_user_id
       AND membership_month = v_month
     ORDER BY id ASC
     LIMIT 1
       FOR UPDATE;

    IF v_period_id IS NOT NULL THEN
      UPDATE public.unlimited_membership_periods
         SET starts_at = v_starts_at,
             ends_at = v_ends_at
       WHERE id = v_period_id;
    ELSE
      INSERT INTO public.unlimited_membership_periods (
        user_id, checkout_session_id, membership_month, starts_at, ends_at, purchased_at
      ) VALUES (
        p_user_id, null, v_month, v_starts_at, v_ends_at, now()
      );
    END IF;

    INSERT INTO public.bonos_clases_especiales (user_id, mes, saldo, origen)
    VALUES (p_user_id, v_month, 1, 'bono_ilimitado')
    ON CONFLICT (user_id, mes) DO UPDATE
      SET saldo = GREATEST(public.bonos_clases_especiales.saldo, 1),
          origen = coalesce(public.bonos_clases_especiales.origen, 'bono_ilimitado');
  ELSE
    DELETE FROM public.unlimited_membership_periods
     WHERE user_id = p_user_id
       AND (
         membership_month = v_month
         OR (starts_at >= v_starts_at - interval '3 days' AND starts_at < v_ends_at)
       );
  END IF;

  -- Sincronizar profiles SOLO con periodos vigentes (ends_at > now())
  SELECT count(*), min(starts_at), max(ends_at)
    INTO v_remaining_count, v_min_start, v_max_end
    FROM public.unlimited_membership_periods
   WHERE user_id = p_user_id
     AND ends_at > now()
     AND membership_month >= date_trunc('month', now() AT TIME ZONE 'Europe/Madrid')::date;

  IF coalesce(v_remaining_count, 0) > 0 THEN
    UPDATE public.profiles
       SET bono_mensual_activo = true,
           bono_mensual_inicio = v_min_start,
           bono_mensual_fin = v_max_end,
           updated_at = timezone('utc', now())
     WHERE id = p_user_id;
  ELSE
    UPDATE public.profiles
       SET bono_mensual_activo = false,
           bono_mensual_inicio = null,
           bono_mensual_fin = null,
           updated_at = timezone('utc', now())
     WHERE id = p_user_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_asignar_mes_ilimitado(uuid, date, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_asignar_mes_ilimitado(uuid, date, boolean) TO authenticated, service_role;

-- 5. Actualizar cambiar_mes_bono_usuario para que evalúe estrictamente ends_at > now()
CREATE OR REPLACE FUNCTION public.cambiar_mes_bono_usuario(
  p_tipo text,
  p_period_id bigint DEFAULT NULL,
  p_mes_actual date DEFAULT NULL,
  p_nuevo_mes date DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_tipo text := lower(trim(coalesce(p_tipo, '')));
  v_actual date;
  v_nuevo date;
  v_hoy date;
  v_mes_minimo date;
  v_inicio timestamptz;
  v_fin timestamptz;
  v_nuevo_inicio timestamptz;
  v_nuevo_fin timestamptz;
  v_clases_usadas integer := 0;
  v_target_id bigint;
  v_target_user uuid;
  v_target_month date;
  v_target_plan text;
  v_requested_month date;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.' USING errcode = '42501';
  END IF;

  IF v_tipo NOT IN ('bono_ilimitado', 'bono_mensual', 'bono_inicial') THEN
    RAISE EXCEPTION 'Tipo de bono no válido: %', p_tipo USING errcode = '22023';
  END IF;

  -- Purgar periodos pasados primero
  PERFORM public.limpiar_meses_caducados();

  v_hoy := (timezone('Europe/Madrid', now()))::date;
  v_mes_minimo := date_trunc('month', v_hoy)::date;

  IF p_nuevo_mes IS NULL THEN
    RAISE EXCEPTION 'Debes especificar el nuevo mes al que deseas mover tu bono.' USING errcode = '22023';
  END IF;

  v_nuevo := date_trunc('month', p_nuevo_mes)::date;
  IF v_nuevo < v_mes_minimo THEN
    RAISE EXCEPTION 'No puedes mover un bono a un mes pasado.' USING errcode = '22023';
  END IF;

  IF p_period_id IS NOT NULL THEN
    IF v_tipo = 'bono_ilimitado' THEN
      SELECT id, user_id, membership_month, starts_at, ends_at
        INTO v_target_id, v_target_user, v_target_month, v_inicio, v_fin
        FROM public.unlimited_membership_periods
       WHERE id = p_period_id;
    ELSE
      SELECT id, user_id, membership_month, starts_at, ends_at, plan_type
        INTO v_target_id, v_target_user, v_target_month, v_inicio, v_fin, v_target_plan
        FROM public.monthly_membership_periods
       WHERE id = p_period_id;
    END IF;

    IF v_target_id IS NULL THEN
      RAISE EXCEPTION 'El periodo indicado no existe.' USING errcode = 'P0002';
    END IF;

    IF v_target_user <> v_user_id THEN
      RAISE EXCEPTION 'No tienes permiso para modificar este bono.' USING errcode = '42501';
    END IF;

    v_actual := v_target_month;
  ELSE
    IF p_mes_actual IS NULL THEN
      RAISE EXCEPTION 'Debes indicar el periodo o mes actual que deseas mover.' USING errcode = '22023';
    END IF;
    v_actual := date_trunc('month', p_mes_actual)::date;

    IF v_tipo = 'bono_ilimitado' THEN
      SELECT id, user_id, membership_month, starts_at, ends_at
        INTO v_target_id, v_target_user, v_target_month, v_inicio, v_fin
        FROM public.unlimited_membership_periods
       WHERE user_id = v_user_id AND membership_month = v_actual
       ORDER BY id ASC LIMIT 1;
    ELSE
      SELECT id, user_id, membership_month, starts_at, ends_at, plan_type
        INTO v_target_id, v_target_user, v_target_month, v_inicio, v_fin, v_target_plan
        FROM public.monthly_membership_periods
       WHERE user_id = v_user_id AND membership_month = v_actual AND plan_type = v_tipo
       ORDER BY id ASC LIMIT 1;
    END IF;

    IF v_target_id IS NULL THEN
      RAISE EXCEPTION 'No dispones de ese bono contratado para el mes indicado.' USING errcode = 'P0002';
    END IF;
  END IF;

  IF v_actual = v_nuevo THEN
    RETURN true;
  END IF;

  IF v_actual < v_mes_minimo THEN
    RAISE EXCEPTION 'No se pueden mover bonos de meses pasados.' USING errcode = '22023';
  END IF;

  IF v_tipo = 'bono_ilimitado' THEN
    IF EXISTS (
      SELECT 1 FROM public.unlimited_membership_periods
       WHERE user_id = v_user_id AND membership_month = v_nuevo AND id <> v_target_id
    ) THEN
      RAISE EXCEPTION 'Ya dispones de un Bono Ilimitado contratado para el mes de destino.' USING errcode = '23505';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.monthly_membership_periods
       WHERE user_id = v_user_id AND membership_month = v_nuevo AND plan_type = v_tipo AND id <> v_target_id
    ) THEN
      RAISE EXCEPTION 'Ya dispones de este mismo bono contratado para el mes de destino.' USING errcode = '23505';
    END IF;
  END IF;

  -- Comprobar si ha usado reservas en el mes de origen
  SELECT count(*) INTO v_clases_usadas
    FROM public.reservas_yoga ry
    JOIN public.clases c ON c.id = ry.clase_id
   WHERE ry.user_id = v_user_id
     AND ry.estado = 'confirmada'
     AND c.fecha_inicio >= v_inicio
     AND c.fecha_inicio < v_fin;

  IF v_clases_usadas > 0 THEN
    RAISE EXCEPTION 'No puedes mover este bono porque ya tienes % reserva(s) realizadas en ese mes.', v_clases_usadas
      USING errcode = '22023';
  END IF;

  v_nuevo_inicio := (v_nuevo::text || ' 00:00:00 Europe/Madrid')::timestamptz;
  v_nuevo_fin := ((v_nuevo + interval '1 month')::date::text || ' 00:00:00 Europe/Madrid')::timestamptz;

  IF v_tipo = 'bono_ilimitado' THEN
    UPDATE public.unlimited_membership_periods
       SET membership_month = v_nuevo,
           starts_at = v_nuevo_inicio,
           ends_at = v_nuevo_fin
     WHERE id = v_target_id AND user_id = v_user_id;

    -- Recalcular el rango del perfil SOLO con periodos vigentes
    UPDATE public.profiles
       SET bono_mensual_activo = (SELECT count(*) > 0 FROM public.unlimited_membership_periods WHERE user_id = v_user_id AND ends_at > now()),
           bono_mensual_inicio = (SELECT min(starts_at) FROM public.unlimited_membership_periods WHERE user_id = v_user_id AND ends_at > now()),
           bono_mensual_fin = (SELECT max(ends_at) FROM public.unlimited_membership_periods WHERE user_id = v_user_id AND ends_at > now()),
           updated_at = timezone('utc', now())
     WHERE id = v_user_id;
  ELSE
    UPDATE public.monthly_membership_periods
       SET membership_month = v_nuevo,
           starts_at = v_nuevo_inicio,
           ends_at = v_nuevo_fin
     WHERE id = v_target_id
       AND user_id = v_user_id
       AND plan_type = v_tipo;
  END IF;

  RETURN true;
END;
$$;

-- 6. Intentar registrar tarea programada en pg_cron si la extensión está instalada
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'limpiar-meses-caducados-diario';
    PERFORM cron.schedule('limpiar-meses-caducados-diario', '5 0 * * *', 'SELECT public.limpiar_meses_caducados();');
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

COMMIT;

-- Migration: 202611170001_fix_bono_ilimitado_30_dias_sin_duplicidad.sql
-- Descripción:
--   Garantiza que el Bono Ilimitado (90 €) funcione exactamente igual que el Bono Inicial y el Bono Mensual:
--   Asignación y vigencia de 30 días naturales a partir de la fecha de compra o asignación,
--   sin duplicar meses (ej. Nov + Dic) ni duplicar pases para clases especiales.
--   Elimina la llamada heredada a v_extra_month en admin_configurar_bono_mensual.

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Redefinir admin_configurar_bono_mensual eliminando la lógica obsoleta de v_extra_month
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_configurar_bono_mensual(
  p_user_id uuid,
  p_activo boolean,
  p_inicio timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_fin timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor_role text;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_membership_month date;
BEGIN
  -- Permisos: solo admin, profesor, trabajador, profesional
  SELECT lower(trim(coalesce(rol, '')))
    INTO v_actor_role
    FROM public.profiles
   WHERE id = auth.uid();

  IF v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'Solo el equipo de GEN Yoga puede gestionar el bono mensual.'
      USING errcode = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Parámetros no válidos: user_id es obligatorio.' USING errcode = '22023';
  END IF;

  IF p_activo THEN
    -- Determinar ventana exacta de 30 días naturales
    v_starts_at := coalesce(p_inicio, timezone('utc', now()));
    v_ends_at := coalesce(p_fin, v_starts_at + interval '30 days');
    v_membership_month := date_trunc('month', v_starts_at AT TIME ZONE 'Europe/Madrid')::date;

    -- Eliminar periodos ilimitados duplicados/fantasmas futuros para este usuario
    DELETE FROM public.unlimited_membership_periods
     WHERE user_id = p_user_id
       AND membership_month > v_membership_month;

    -- Insertar o actualizar el periodo único de 30 días para este bono
    INSERT INTO public.unlimited_membership_periods (
      user_id, membership_month, starts_at, ends_at, purchased_at
    ) VALUES (
      p_user_id, v_membership_month, v_starts_at, v_ends_at, timezone('utc', now())
    )
    ON CONFLICT (user_id, membership_month)
    DO UPDATE SET
      starts_at = EXCLUDED.starts_at,
      ends_at = EXCLUDED.ends_at,
      purchased_at = coalesce(public.unlimited_membership_periods.purchased_at, EXCLUDED.purchased_at);

    -- Actualizar perfil con fechas de vigencia exactas
    UPDATE public.profiles
       SET bono_mensual_activo = true,
           bono_mensual_inicio = (
             SELECT min(starts_at) FROM public.unlimited_membership_periods
              WHERE user_id = p_user_id AND ends_at > timezone('utc', now())
           ),
           bono_mensual_fin = (
             SELECT max(ends_at) FROM public.unlimited_membership_periods
              WHERE user_id = p_user_id AND ends_at > timezone('utc', now())
           ),
           updated_at = timezone('utc', now())
     WHERE id = p_user_id;

    -- Limpiar pases especiales fantasma de meses posteriores para este usuario
    DELETE FROM public.bonos_clases_especiales
     WHERE user_id = p_user_id
       AND origen = 'bono_ilimitado'
       AND mes > v_membership_month;

    -- Garantizar exactamente 1 pase especial gratis para el periodo asignado
    INSERT INTO public.bonos_clases_especiales (
      user_id, mes, saldo, origen
    ) VALUES (
      p_user_id, v_membership_month, 1, 'bono_ilimitado'
    )
    ON CONFLICT (user_id, mes)
    DO UPDATE SET
      saldo = greatest(public.bonos_clases_especiales.saldo, 1),
      updated_at = timezone('utc', now());
  ELSE
    -- Desactivación total
    DELETE FROM public.unlimited_membership_periods WHERE user_id = p_user_id;
    UPDATE public.profiles
       SET bono_mensual_activo = false,
           bono_mensual_inicio = null,
           bono_mensual_fin = null,
           updated_at = timezone('utc', now())
     WHERE id = p_user_id;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_configurar_bono_mensual(uuid, boolean, timestamptz, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_configurar_bono_mensual(uuid, boolean, timestamptz, timestamptz) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. Asegurar que admin_asignar_mes_ilimitado NO cree periodos duplicados
-- ----------------------------------------------------------------------------
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
  v_is_current boolean := false;
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

  PERFORM public.limpiar_meses_caducados();

  v_month := date_trunc('month', coalesce(p_membership_month, (timezone('Europe/Madrid', now()))::date))::date;
  v_is_current := (v_month = date_trunc('month', timezone('Europe/Madrid', now()))::date);

  IF v_is_current THEN
    v_starts_at := timezone('utc', now());
    v_ends_at := timezone('utc', now()) + interval '30 days';
  ELSE
    v_starts_at := (v_month::text || ' 00:00:00 Europe/Madrid')::timestamptz;
    v_ends_at := v_starts_at + interval '30 days';
  END IF;

  IF p_activo THEN
    -- Limpiar periodos ilimitados duplicados futuros para este usuario
    DELETE FROM public.unlimited_membership_periods
     WHERE user_id = p_user_id
       AND membership_month > v_month;

    INSERT INTO public.unlimited_membership_periods (
      user_id, membership_month, starts_at, ends_at, purchased_at
    ) VALUES (
      p_user_id, v_month, v_starts_at, v_ends_at, timezone('utc', now())
    )
    ON CONFLICT (user_id, membership_month)
    DO UPDATE SET
      starts_at = EXCLUDED.starts_at,
      ends_at = EXCLUDED.ends_at,
      purchased_at = coalesce(public.unlimited_membership_periods.purchased_at, EXCLUDED.purchased_at);

    UPDATE public.profiles
       SET bono_mensual_activo = true,
           bono_mensual_inicio = (
             SELECT min(starts_at) FROM public.unlimited_membership_periods
              WHERE user_id = p_user_id AND ends_at > timezone('utc', now())
           ),
           bono_mensual_fin = (
             SELECT max(ends_at) FROM public.unlimited_membership_periods
              WHERE user_id = p_user_id AND ends_at > timezone('utc', now())
           ),
           updated_at = timezone('utc', now())
     WHERE id = p_user_id;

    -- Limpiar clases especiales duplicadas para meses futuros de bono_ilimitado
    DELETE FROM public.bonos_clases_especiales
     WHERE user_id = p_user_id
       AND origen = 'bono_ilimitado'
       AND mes > v_month;

    INSERT INTO public.bonos_clases_especiales (
      user_id, mes, saldo, origen
    ) VALUES (
      p_user_id, v_month, 1, 'bono_ilimitado'
    )
    ON CONFLICT (user_id, mes)
    DO UPDATE SET
      saldo = greatest(public.bonos_clases_especiales.saldo, 1),
      updated_at = timezone('utc', now());
  ELSE
    DELETE FROM public.unlimited_membership_periods
     WHERE user_id = p_user_id
       AND (membership_month = v_month OR (ends_at > v_starts_at AND starts_at < v_ends_at));

    UPDATE public.profiles
       SET bono_mensual_activo = (
             EXISTS (
               SELECT 1 FROM public.unlimited_membership_periods
                WHERE user_id = p_user_id AND ends_at > timezone('utc', now())
             )
           ),
           bono_mensual_inicio = (
             SELECT min(starts_at) FROM public.unlimited_membership_periods
              WHERE user_id = p_user_id AND ends_at > timezone('utc', now())
           ),
           bono_mensual_fin = (
             SELECT max(ends_at) FROM public.unlimited_membership_periods
              WHERE user_id = p_user_id AND ends_at > timezone('utc', now())
           ),
           updated_at = timezone('utc', now())
     WHERE id = p_user_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_asignar_mes_ilimitado(uuid, date, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_asignar_mes_ilimitado(uuid, date, boolean) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Limpieza de datos fantasma en prueba@prueba.com si existieran
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_test_user_id uuid;
BEGIN
  SELECT id INTO v_test_user_id FROM public.profiles WHERE email = 'prueba@prueba.com';
  IF v_test_user_id IS NOT NULL THEN
    -- Eliminar periodos con mes posterior a noviembre 2026 creados por el bug
    DELETE FROM public.unlimited_membership_periods
     WHERE user_id = v_test_user_id
       AND membership_month > '2026-11-01'::date;

    -- Eliminar clases especiales duplicadas para meses futuros
    DELETE FROM public.bonos_clases_especiales
     WHERE user_id = v_test_user_id
       AND origen = 'bono_ilimitado'
       AND mes > '2026-11-01'::date;
  END IF;
END;
$$;

COMMIT;

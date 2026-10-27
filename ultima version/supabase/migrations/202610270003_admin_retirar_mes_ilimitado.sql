-- ==============================================================================
-- Migración 202610270003: Retirar Bono Ilimitado por Admin
-- Permite a administradores retirar meses de bono ilimitado por ID, mes o global
-- ==============================================================================

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

  -- 4. Recalcular saldo y estado en tabla profiles
  SELECT count(*), min(starts_at), max(ends_at)
    INTO v_remaining, v_min_start, v_max_end
    FROM public.unlimited_membership_periods
   WHERE user_id = p_user_id
     AND ends_at > now();

  IF v_remaining > 0 THEN
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

-- Función alternativa directa por period_id
CREATE OR REPLACE FUNCTION public.admin_retirar_periodo_ilimitado(p_period_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_user_id uuid;
  v_month date;
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
    RAISE EXCEPTION 'Permisos insuficientes para gestionar bonos ilimitados.' USING errcode = '42501';
  END IF;

  IF p_period_id IS NULL THEN
    RAISE EXCEPTION 'Periodo no válido.' USING errcode = '22023';
  END IF;

  SELECT user_id, membership_month INTO v_user_id, v_month
    FROM public.unlimited_membership_periods
   WHERE id = p_period_id;

  DELETE FROM public.unlimited_membership_periods WHERE id = p_period_id;

  IF v_user_id IS NOT NULL THEN
    IF v_month IS NOT NULL THEN
      DELETE FROM public.bonos_clases_especiales
       WHERE user_id = v_user_id AND mes = v_month AND origen = 'bono_ilimitado';
    END IF;

    SELECT count(*), min(starts_at), max(ends_at)
      INTO v_remaining, v_min_start, v_max_end
      FROM public.unlimited_membership_periods
     WHERE user_id = v_user_id
       AND ends_at > now();

    IF v_remaining > 0 THEN
      UPDATE public.profiles
         SET bono_mensual_activo = true,
             bono_mensual_inicio = v_min_start,
             bono_mensual_fin = v_max_end,
             updated_at = timezone('utc', now())
       WHERE id = v_user_id;
    ELSE
      UPDATE public.profiles
         SET bono_mensual_activo = false,
             bono_mensual_inicio = null,
             bono_mensual_fin = null,
             updated_at = timezone('utc', now())
       WHERE id = v_user_id;
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_retirar_periodo_ilimitado(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_retirar_periodo_ilimitado(bigint) TO authenticated, service_role;

-- Migración: Garantizar 1 clase especial gratuita al asignar bono ilimitado
-- Fecha: 2 oct 2026

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
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, '')))
    INTO v_actor_role
    FROM public.profiles
   WHERE id = v_actor_id;

  IF NOT found OR v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'Permisos insuficientes para gestionar bonos mensuales.' USING errcode = '42501';
  END IF;

  IF p_user_id IS NULL OR p_activo IS NULL THEN
    RAISE EXCEPTION 'Parámetros no válidos.' USING errcode = '22023';
  END IF;

  v_month := date_trunc('month', coalesce(p_membership_month, now() AT TIME ZONE 'Europe/Madrid'))::date;
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

    -- Asignar automáticamente 1 clase especial garantizada para dicho mes con origen 'bono_ilimitado'
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
         OR (starts_at >= v_starts_at - interval '3 days' AND starts_at <= v_starts_at + interval '3 days')
       );
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

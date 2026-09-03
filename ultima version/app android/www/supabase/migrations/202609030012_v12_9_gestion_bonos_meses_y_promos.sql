-- ==============================================================================
-- Migración 202609030012: Versión 12.9
-- Gestión Definitiva de Bonos, Meses Ilimitados y Consolidación de Clases Especiales
-- ==============================================================================

BEGIN;

-- 1. RPC admin_retirar_mes_ilimitado: Retira meses ilimitados específicos o desactiva bono
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
  v_remaining integer;
  v_min_start timestamptz;
  v_max_end timestamptz;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))) INTO v_actor_role
    FROM public.profiles WHERE id = v_actor_id;

  IF v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'Permisos insuficientes para retirar meses ilimitados.' USING errcode = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'ID de usuario no proporcionado.' USING errcode = '22023';
  END IF;

  -- 1. Eliminar por ID exacto de periodo si se proporciona
  IF p_period_id IS NOT NULL THEN
    DELETE FROM public.unlimited_membership_periods
     WHERE id = p_period_id AND user_id = p_user_id;
  END IF;

  -- 2. Eliminar por mes si se proporciona
  IF p_mes IS NOT NULL THEN
    v_month := date_trunc('month', p_mes)::date;
    v_starts_at := (v_month::text || ' 00:00:00 Europe/Madrid')::timestamptz;
    DELETE FROM public.unlimited_membership_periods
     WHERE user_id = p_user_id
       AND (
         membership_month = v_month
         OR (starts_at >= v_starts_at - interval '3 days' AND starts_at <= v_starts_at + interval '3 days')
       );
  END IF;

  -- 3. Si no se especificó ni ID ni mes, eliminar todos los periodos del usuario
  IF p_period_id IS NULL AND p_mes IS NULL THEN
    DELETE FROM public.unlimited_membership_periods WHERE user_id = p_user_id;
  END IF;

  -- 4. Recalcular saldo y estado en tabla profiles
  SELECT count(*), min(starts_at), max(ends_at)
    INTO v_remaining, v_min_start, v_max_end
    FROM public.unlimited_membership_periods
   WHERE user_id = p_user_id;

  IF v_remaining > 0 THEN
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

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'remaining_months', v_remaining,
    'bono_mensual_activo', (v_remaining > 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_retirar_mes_ilimitado(uuid, bigint, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_retirar_mes_ilimitado(uuid, bigint, date) TO authenticated, service_role;


-- 2. Actualizar admin_asignar_mes_ilimitado sin restricciones de rol
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

    -- Asignar automáticamente 1 clase especial para dicho mes con origen 'bono_ilimitado' si no tiene ya
    INSERT INTO public.bonos_clases_especiales (user_id, mes, saldo, origen)
    VALUES (p_user_id, v_month, 1, 'bono_ilimitado')
    ON CONFLICT (user_id, mes) DO NOTHING;
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


-- 3. Consolidación de filas duplicadas en bonos_clases_especiales
DO $$
DECLARE
  r RECORD;
  v_kept_id bigint;
  v_total_saldo integer;
BEGIN
  -- Identificar grupos duplicados por (user_id, mes)
  FOR r IN (
    SELECT user_id, mes, count(*) AS cnt
      FROM public.bonos_clases_especiales
     GROUP BY user_id, mes
    HAVING count(*) > 1
  ) LOOP
    -- Obtener la suma total de saldos
    SELECT sum(saldo), min(id)
      INTO v_total_saldo, v_kept_id
      FROM public.bonos_clases_especiales
     WHERE user_id = r.user_id AND mes = r.mes;

    -- Actualizar la fila conservada
    UPDATE public.bonos_clases_especiales
       SET saldo = coalesce(v_total_saldo, 0),
           updated_at = now()
     WHERE id = v_kept_id;

    -- Eliminar las filas redundantes
    DELETE FROM public.bonos_clases_especiales
     WHERE user_id = r.user_id
       AND mes = r.mes
       AND id <> v_kept_id;
  END LOOP;
END $$;

-- Crear constraint único en (user_id, mes) si no existe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bonos_clases_especiales_user_mes_key'
  ) THEN
    ALTER TABLE public.bonos_clases_especiales
      ADD CONSTRAINT bonos_clases_especiales_user_mes_key UNIQUE (user_id, mes);
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_bonos_clases_especiales_user_mes_unique
      ON public.bonos_clases_especiales(user_id, mes);
END $$;


-- 4. Políticas RLS para unlimited_membership_periods permitiendo gestión por admin/trabajador
DROP POLICY IF EXISTS "unlimited_membership_periods_admin_all" ON public.unlimited_membership_periods;
CREATE POLICY "unlimited_membership_periods_admin_all"
  ON public.unlimited_membership_periods
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
       WHERE id = auth.uid()
         AND lower(trim(coalesce(rol, ''))) IN ('admin', 'profesor', 'trabajador')
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.unlimited_membership_periods TO authenticated, service_role;

COMMIT;

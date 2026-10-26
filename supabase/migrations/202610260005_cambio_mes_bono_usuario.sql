-- Migration: 202610260005_cambio_mes_bono_usuario.sql
-- Permite al propio usuario reubicar/cambiar el mes natural de su bono mensual (Inicial, Mensual o Ilimitado)
-- siempre que no haya consumido ninguna clase en dicho mes. Sin necesidad de pasar por recepción.

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
  v_hoy date;
  v_mes_minimo date;
  v_inicio timestamptz;
  v_fin timestamptz;
  v_nuevo_inicio timestamptz;
  v_nuevo_fin timestamptz;
  v_clases_usadas integer := 0;
  v_target_id bigint := p_period_id;
  v_actual_month date := p_mes_actual;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.' USING errcode = '42501';
  END IF;

  IF p_nuevo_mes IS NULL THEN
    RAISE EXCEPTION 'Debes especificar el nuevo mes.';
  END IF;

  -- Normalizar al primer día de mes
  p_nuevo_mes := date_trunc('month', p_nuevo_mes)::date;

  -- No permitir meses pasados (zona horaria Europe/Madrid)
  v_hoy := (timezone('Europe/Madrid', now()))::date;
  v_mes_minimo := date_trunc('month', v_hoy)::date;

  IF p_nuevo_mes < v_mes_minimo THEN
    RAISE EXCEPTION 'No se puede transferir un bono a un mes pasado.';
  END IF;

  -- Localizar mes actual si no viene dado
  IF v_actual_month IS NULL AND v_target_id IS NOT NULL THEN
    IF p_tipo = 'bono_ilimitado' THEN
      SELECT membership_month INTO v_actual_month
        FROM public.unlimited_membership_periods
       WHERE id = v_target_id AND user_id = v_user_id;
    ELSE
      SELECT membership_month INTO v_actual_month
        FROM public.monthly_membership_periods
       WHERE id = v_target_id AND user_id = v_user_id;
    END IF;
  END IF;

  IF v_actual_month IS NULL THEN
    RAISE EXCEPTION 'No se encontró el periodo especificado para este usuario.';
  END IF;

  v_actual_month := date_trunc('month', v_actual_month)::date;

  IF p_nuevo_mes = v_actual_month THEN
    RAISE EXCEPTION 'El mes de destino debe ser diferente al mes actual.';
  END IF;

  -- Comprobar si se ha consumido alguna clase en el mes actual
  v_inicio := (v_actual_month::text || ' 00:00:00+00')::timestamptz;
  v_fin := ((v_actual_month + interval '1 month')::date::text || ' 00:00:00+00')::timestamptz;

  SELECT count(*) INTO v_clases_usadas
    FROM public.reservas_yoga r
    JOIN public.clases c ON c.id = r.clase_id
   WHERE r.user_id = v_user_id
     AND r.estado = 'confirmada'
     AND c.fecha_inicio >= v_inicio
     AND c.fecha_inicio < v_fin
     AND (
       (p_tipo = 'bono_ilimitado' AND (r.tipo_reserva = 'ilimitado' OR r.usado_bono_mensual = true))
       OR (p_tipo = 'bono_mensual' AND r.tipo_reserva = 'bono_mensual')
       OR (p_tipo = 'bono_inicial' AND r.tipo_reserva = 'bono_inicial')
     );

  IF v_clases_usadas > 0 THEN
    RAISE EXCEPTION 'Ya has consumido % clase(s) en este mes. No se puede transferir un bono ya utilizado.', v_clases_usadas;
  END IF;

  -- Calcular fechas nuevas
  v_nuevo_inicio := (p_nuevo_mes::text || ' 00:00:00+00')::timestamptz;
  v_nuevo_fin := ((p_nuevo_mes + interval '1 month')::date::text || ' 00:00:00+00')::timestamptz;

  IF p_tipo = 'bono_ilimitado' THEN
    IF EXISTS (
      SELECT 1 FROM public.unlimited_membership_periods
       WHERE user_id = v_user_id AND membership_month = p_nuevo_mes
    ) THEN
      RAISE EXCEPTION 'Ya dispones del Bono Ilimitado para ese mes.';
    END IF;

    IF v_target_id IS NOT NULL THEN
      UPDATE public.unlimited_membership_periods
         SET membership_month = p_nuevo_mes,
             starts_at = v_nuevo_inicio,
             ends_at = v_nuevo_fin
       WHERE id = v_target_id AND user_id = v_user_id;
    ELSE
      UPDATE public.unlimited_membership_periods
         SET membership_month = p_nuevo_mes,
             starts_at = v_nuevo_inicio,
             ends_at = v_nuevo_fin
       WHERE id = (
         SELECT id FROM public.unlimited_membership_periods
          WHERE user_id = v_user_id AND membership_month = v_actual_month
          LIMIT 1
       );
    END IF;

  ELSE
    -- Bono Inicial o Bono Mensual
    IF v_target_id IS NOT NULL THEN
      UPDATE public.monthly_membership_periods
         SET membership_month = p_nuevo_mes,
             starts_at = v_nuevo_inicio,
             ends_at = v_nuevo_fin
       WHERE id = v_target_id AND user_id = v_user_id;
    ELSE
      UPDATE public.monthly_membership_periods
         SET membership_month = p_nuevo_mes,
             starts_at = v_nuevo_inicio,
             ends_at = v_nuevo_fin
       WHERE id = (
         SELECT id FROM public.monthly_membership_periods
          WHERE user_id = v_user_id
            AND membership_month = v_actual_month
            AND (
              (p_tipo = 'bono_inicial' AND (plan_type = 'bono_inicial' OR max_classes_per_week = 1))
              OR (p_tipo = 'bono_mensual' AND (plan_type = 'bono_mensual' OR coalesce(max_classes_per_week, 2) >= 2))
            )
          LIMIT 1
       );
    END IF;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.cambiar_mes_bono_usuario(text, bigint, date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cambiar_mes_bono_usuario(text, bigint, date, date) TO authenticated, service_role;

-- Políticas adicionales RLS para permitir que el usuario actualice su propio periodo si no tiene clases usadas
DROP POLICY IF EXISTS "unlimited_membership_periods_update_own" ON public.unlimited_membership_periods;
CREATE POLICY "unlimited_membership_periods_update_own"
  ON public.unlimited_membership_periods
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "monthly_membership_periods_update_own" ON public.monthly_membership_periods;
CREATE POLICY "monthly_membership_periods_update_own"
  ON public.monthly_membership_periods
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

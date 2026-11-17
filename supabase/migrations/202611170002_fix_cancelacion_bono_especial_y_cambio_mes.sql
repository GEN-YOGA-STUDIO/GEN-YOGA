-- Migration: 202611170002_fix_cancelacion_bono_especial_y_cambio_mes.sql
-- Descripción:
--   1. Corrige el bug crítico en cancelar_con_bono y admin_eliminar_clase:
--      Al devolver un pase de clase especial por cancelación de reserva o borrado de clase,
--      se usa ON CONFLICT (user_id, mes) DO UPDATE SET saldo = saldo + 1 para evitar
--      el error 23505 (violación de clave única).
--   2. Corrige cambiar_mes_bono_usuario para que al trasladar un bono no usado a un mes futuro,
--      fije la vigencia de 30 días y traslade el pase de clase especial asociado si es Bono Ilimitado.

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Redefinir cancelar_con_bono con reintegro seguro de clases especiales
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancelar_con_bono(p_reserva_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_actor_is_admin boolean := false;
  v_actor_is_staff boolean := false;
  v_allow_admin_override boolean := false;
  v_parent_id bigint;
  v_titular_reserva_id bigint;
  v_target_id uuid;
  v_class_id bigint;
  v_starts_at timestamptz;
  v_class_month date;
  v_class_type text;
  v_tipo_reserva text;
  v_credit_debited boolean;
  v_free_credit_debited boolean;
  v_used_unlimited boolean;
  v_pack_id bigint;
  v_cancel_limit_hours integer := 24;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))) INTO v_actor_role
    FROM public.profiles
   WHERE id = v_actor_id;

  v_actor_is_staff := v_actor_role IN ('admin', 'profesor', 'trabajador', 'profesional');
  v_actor_is_admin := v_actor_role = 'admin';

  SELECT parent_reserva_id INTO v_parent_id
    FROM public.reservas_yoga
   WHERE id = p_reserva_id;

  IF v_parent_id IS NOT NULL THEN
    v_titular_reserva_id := v_parent_id;
  ELSE
    v_titular_reserva_id := p_reserva_id;
  END IF;

  SELECT user_id, clase_id, coalesce(bono_descontado, false),
         coalesce(saldo_gratis_descontado, false),
         coalesce(usado_bono_mensual, false),
         tipo_reserva, class_pack_id
    INTO v_target_id, v_class_id, v_credit_debited,
         v_free_credit_debited, v_used_unlimited,
         v_tipo_reserva, v_pack_id
    FROM public.reservas_yoga
   WHERE id = v_titular_reserva_id
     AND estado = 'confirmada'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La reserva especificada no existe o ya fue cancelada.' USING errcode = 'P0002';
  END IF;

  IF v_target_id <> v_actor_id AND NOT v_actor_is_staff THEN
    RAISE EXCEPTION 'No puedes cancelar la reserva de otra persona.' USING errcode = '42501';
  END IF;

  SELECT fecha_inicio, lower(trim(coalesce(tipo_clase, '')))
    INTO v_starts_at, v_class_type
    FROM public.clases
   WHERE id = v_class_id
   FOR UPDATE;

  -- Comprobación estricta de límite de cancelación (>24 horas)
  BEGIN
    SELECT CASE
      WHEN trim(coalesce(valor, '')) ~ '^[0-9]{1,3}$'
        THEN least(168, greatest(0, trim(valor)::integer))
      ELSE 24
    END
      INTO v_cancel_limit_hours
      FROM public.configuracion
     WHERE clave = 'horas_limite_cancelacion'
     LIMIT 1;
  EXCEPTION
    WHEN OTHERS THEN
      v_cancel_limit_hours := 24;
  END;
  v_cancel_limit_hours := coalesce(v_cancel_limit_hours, 24);

  IF v_actor_is_admin THEN
    SELECT lower(trim(coalesce(valor, ''))) IN ('true', '1', 'yes', 'on')
      INTO v_allow_admin_override
      FROM public.configuracion
     WHERE clave = 'permitir_cancelacion_admin_siempre'
     LIMIT 1;
    v_allow_admin_override := coalesce(v_allow_admin_override, false);
  END IF;

  IF NOT (v_actor_is_admin AND v_allow_admin_override)
    AND (v_starts_at IS NULL
      OR v_starts_at <= now() + make_interval(hours => v_cancel_limit_hours)) THEN
    RAISE EXCEPTION 'Ya no puedes cancelar: faltan menos de % horas para la actividad.',
      v_cancel_limit_hours USING errcode = 'P0001';
  END IF;

  v_class_month := date_trunc('month', v_starts_at AT TIME ZONE 'Europe/Madrid')::date;

  -- Eliminar reservas secundarias si las hubiera
  DELETE FROM public.reservas_yoga WHERE parent_reserva_id = v_titular_reserva_id;
  -- Eliminar reserva titular
  DELETE FROM public.reservas_yoga WHERE id = v_titular_reserva_id;

  -- ============================================================================
  -- REINTEGRO O CRÉDITO DE REPROGRAMACIÓN SEGÚN EL TIPO DE ACTIVIDAD
  -- ============================================================================

  -- 1. Si era un Taller: no se reembolsa dinero, se genera un crédito de reprogramación
  IF v_class_type = 'taller' OR v_tipo_reserva = 'reprogramacion_taller' THEN
    INSERT INTO public.creditos_reprogramacion
      (user_id, tipo, subtipo, mes, clase_id_origen, reserva_id_origen, estado)
    VALUES
      (v_target_id, 'taller', 'taller_120', v_class_month, v_class_id, v_titular_reserva_id, 'disponible');

  -- 2. Si era una Clase Especial: devolver el bono especial del mes correspondiente
  ELSIF v_class_type = 'clase_especial' OR v_tipo_reserva = 'clase_especial' THEN
    INSERT INTO public.bonos_clases_especiales (user_id, mes, saldo, origen)
    VALUES (v_target_id, v_class_month, 1, 'reintegro_cancelacion')
    ON CONFLICT (user_id, mes)
    DO UPDATE SET
      saldo = public.bonos_clases_especiales.saldo + 1,
      updated_at = timezone('utc', now());

  -- 3. Si era bono de bienvenida
  ELSIF v_free_credit_debited THEN
    UPDATE public.profiles
       SET saldo_clases_gratis = coalesce(saldo_clases_gratis, 0) + 1
     WHERE id = v_target_id;

  -- 4. Si consumió pack de clases normales (Bronce)
  ELSIF v_credit_debited AND v_pack_id IS NOT NULL THEN
    UPDATE public.class_credit_packs
       SET credits_remaining = least(credits_total, credits_remaining + 1),
           updated_at = timezone('utc', now())
     WHERE id = v_pack_id AND user_id = v_target_id;

    UPDATE public.profiles
       SET bonos = (
         SELECT coalesce(sum(credits_remaining), 0)::integer
           FROM public.class_credit_packs
          WHERE user_id = v_target_id AND expires_at > timezone('utc', now())
       )
     WHERE id = v_target_id;

  ELSIF v_credit_debited THEN
    UPDATE public.profiles
       SET bonos = coalesce(bonos, 0) + 1
     WHERE id = v_target_id;
  END IF;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 2. Redefinir admin_eliminar_clase con reintegro seguro de clases especiales
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_eliminar_clase(p_clase_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_booking record;
  v_refunded_count integer := 0;
  v_class_name text;
  v_class_type text;
  v_starts_at timestamptz;
  v_class_month date;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))) INTO v_actor_role
    FROM public.profiles WHERE id = v_actor_id;

  IF v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'Solo los administradores o profesores pueden eliminar clases.' USING errcode = '42501';
  END IF;

  SELECT nombre, lower(trim(coalesce(tipo_clase, ''))), fecha_inicio
    INTO v_class_name, v_class_type, v_starts_at
    FROM public.clases
   WHERE id = p_clase_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La clase no existe o ya fue eliminada.' USING errcode = 'P0002';
  END IF;

  v_class_month := date_trunc('month', v_starts_at AT TIME ZONE 'Europe/Madrid')::date;

  -- 1. Procesar todas las reservas confirmadas de Yoga/Eventos y devolver el bono o crédito
  FOR v_booking IN (
    SELECT id, user_id, class_pack_id, coalesce(bono_descontado, false) as bono_descontado,
           coalesce(saldo_gratis_descontado, false) as saldo_gratis_descontado,
           coalesce(tipo_reserva, '') as tipo_reserva
      FROM public.reservas_yoga
     WHERE clase_id = p_clase_id
       AND estado = 'confirmada'
  ) LOOP
    -- Si es un taller: generar crédito de reprogramación
    IF v_class_type = 'taller' OR v_booking.tipo_reserva = 'reprogramacion_taller' THEN
      INSERT INTO public.creditos_reprogramacion
        (user_id, tipo, subtipo, mes, clase_id_origen, reserva_id_origen, estado)
      VALUES
        (v_booking.user_id, 'taller', 'taller_120', v_class_month, p_clase_id, v_booking.id, 'disponible');

    -- Si es clase especial: devolver bono especial del mes con protección ON CONFLICT
    ELSIF v_class_type = 'clase_especial' OR v_booking.tipo_reserva = 'clase_especial' THEN
      INSERT INTO public.bonos_clases_especiales (user_id, mes, saldo, origen)
      VALUES (v_booking.user_id, v_class_month, 1, 'reintegro_admin_cancelacion')
      ON CONFLICT (user_id, mes)
      DO UPDATE SET
        saldo = public.bonos_clases_especiales.saldo + 1,
        updated_at = timezone('utc', now());

    -- Si era bono de bienvenida
    ELSIF v_booking.saldo_gratis_descontado OR v_booking.tipo_reserva = 'bienvenida' THEN
      UPDATE public.profiles
         SET saldo_clases_gratis = coalesce(saldo_clases_gratis, 0) + 1
       WHERE id = v_booking.user_id;

    -- Si consumió un pack de clases
    ELSIF v_booking.class_pack_id IS NOT NULL THEN
      UPDATE public.class_credit_packs
         SET credits_remaining = credits_remaining + 1,
             updated_at = timezone('utc', now())
       WHERE id = v_booking.class_pack_id;

    -- Si consumió saldo general
    ELSIF v_booking.bono_descontado THEN
      UPDATE public.profiles
         SET bonos = coalesce(bonos, 0) + 1
       WHERE id = v_booking.user_id;
    END IF;

    v_refunded_count := v_refunded_count + 1;
  END LOOP;

  -- 2. Procesar reservas de psicología / nutrición si la clase fuera una consulta
  FOR v_booking IN (
    SELECT id, user_id FROM public.reservas_psicologia WHERE clase_id = p_clase_id AND estado = 'confirmada'
  ) LOOP
    UPDATE public.profiles SET saldo_psicologia = coalesce(saldo_psicologia, 0) + 1 WHERE id = v_booking.user_id;
    v_refunded_count := v_refunded_count + 1;
  END LOOP;

  FOR v_booking IN (
    SELECT id, user_id FROM public.reservas_nutricion WHERE clase_id = p_clase_id AND estado = 'confirmada'
  ) LOOP
    UPDATE public.profiles SET saldo_nutricion = coalesce(saldo_nutricion, 0) + 1 WHERE id = v_booking.user_id;
    v_refunded_count := v_refunded_count + 1;
  END LOOP;

  -- 3. Eliminar todas las reservas asociadas a esta clase
  DELETE FROM public.reservas_yoga WHERE clase_id = p_clase_id;
  DELETE FROM public.reservas_psicologia WHERE clase_id = p_clase_id;
  DELETE FROM public.reservas_nutricion WHERE clase_id = p_clase_id;

  -- 4. Eliminar la clase definitivamente
  DELETE FROM public.clases WHERE id = p_clase_id;

  RETURN jsonb_build_object(
    'success', true,
    'clase_id', p_clase_id,
    'clase_nombre', v_class_name,
    'reservas_reembolsadas', v_refunded_count
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3. Redefinir cambiar_mes_bono_usuario para ventana de 30 días y traspaso de clase especial
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cambiar_mes_bono_usuario(
  p_tipo text,
  p_period_id bigint DEFAULT NULL::bigint,
  p_mes_actual date DEFAULT NULL::date,
  p_nuevo_mes date DEFAULT NULL::date
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
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
    RAISE EXCEPTION 'Tipo de bono no válido.' USING errcode = '22023';
  END IF;

  IF p_nuevo_mes IS NULL THEN
    RAISE EXCEPTION 'Debes especificar el nuevo mes.' USING errcode = '22023';
  END IF;

  -- Serializa cambios concurrentes del mismo usuario.
  PERFORM 1 FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró el perfil.' USING errcode = 'P0002';
  END IF;

  v_nuevo := date_trunc('month', p_nuevo_mes)::date;
  v_hoy := (timezone('Europe/Madrid', now()))::date;
  v_mes_minimo := date_trunc('month', v_hoy)::date;

  IF v_nuevo < v_mes_minimo THEN
    RAISE EXCEPTION 'No se puede transferir un bono a un mes pasado.' USING errcode = '22023';
  END IF;

  IF p_mes_actual IS NOT NULL THEN
    v_requested_month := date_trunc('month', p_mes_actual)::date;
  END IF;

  -- Localiza el periodo comprobando siempre propietario y tipo.
  IF p_period_id IS NOT NULL THEN
    IF v_tipo = 'bono_ilimitado' THEN
      SELECT id, user_id, membership_month, null::text
        INTO v_target_id, v_target_user, v_target_month, v_target_plan
        FROM public.unlimited_membership_periods
       WHERE id = p_period_id;
    ELSE
      SELECT id, user_id, membership_month, plan_type
        INTO v_target_id, v_target_user, v_target_month, v_target_plan
        FROM public.monthly_membership_periods
       WHERE id = p_period_id;
    END IF;
  ELSE
    IF v_requested_month IS NULL THEN
      RAISE EXCEPTION 'Debes indicar el mes actual del bono.' USING errcode = '22023';
    END IF;

    IF v_tipo = 'bono_ilimitado' THEN
      SELECT id, user_id, membership_month, null::text
        INTO v_target_id, v_target_user, v_target_month, v_target_plan
        FROM public.unlimited_membership_periods
       WHERE user_id = v_user_id
         AND membership_month = v_requested_month
       ORDER BY id ASC
       LIMIT 1;
    ELSE
      SELECT id, user_id, membership_month, plan_type
        INTO v_target_id, v_target_user, v_target_month, v_target_plan
        FROM public.monthly_membership_periods
       WHERE user_id = v_user_id
         AND membership_month = v_requested_month
         AND plan_type = v_tipo
       ORDER BY id ASC
       LIMIT 1;
    END IF;
  END IF;

  IF v_target_id IS NULL
     OR v_target_user IS DISTINCT FROM v_user_id
     OR (v_tipo <> 'bono_ilimitado' AND v_target_plan IS DISTINCT FROM v_tipo) THEN
    RAISE EXCEPTION 'No se encontró el periodo especificado para este usuario.' USING errcode = 'P0002';
  END IF;

  v_actual := date_trunc('month', v_target_month)::date;

  IF v_requested_month IS NOT NULL AND v_requested_month <> v_actual THEN
    RAISE EXCEPTION 'El mes indicado no coincide con el bono que se quiere mover.' USING errcode = '22023';
  END IF;

  IF v_actual < v_mes_minimo THEN
    RAISE EXCEPTION 'No se puede cambiar un bono de un mes pasado.' USING errcode = '22023';
  END IF;

  IF v_nuevo = v_actual THEN
    RAISE EXCEPTION 'El mes de destino debe ser diferente al mes actual.' USING errcode = '22023';
  END IF;

  -- Consumo real del mes de origen
  v_inicio := (v_actual::text || ' 00:00:00 Europe/Madrid')::timestamptz;
  v_fin := ((v_actual + interval '1 month')::date::text || ' 00:00:00 Europe/Madrid')::timestamptz;

  SELECT count(*) INTO v_clases_usadas
    FROM public.reservas_yoga r
    JOIN public.clases c ON c.id = r.clase_id
   WHERE r.user_id = v_user_id
     AND r.estado = 'confirmada'
     AND c.fecha_inicio >= v_inicio
     AND c.fecha_inicio < v_fin
     AND (
       (v_tipo = 'bono_ilimitado' AND (r.tipo_reserva = 'ilimitado' OR r.usado_bono_mensual = true))
       OR (v_tipo = 'bono_mensual' AND r.tipo_reserva = 'bono_mensual')
       OR (v_tipo = 'bono_inicial' AND r.tipo_reserva = 'bono_inicial')
     );

  IF v_clases_usadas > 0 THEN
    RAISE EXCEPTION 'Ya has consumido % clase(s) en este mes. No se puede transferir un bono ya utilizado.', v_clases_usadas
      USING errcode = 'P0001';
  END IF;

  -- No duplicar la misma modalidad en el mes de destino.
  IF v_tipo = 'bono_ilimitado' THEN
    IF EXISTS (
      SELECT 1 FROM public.unlimited_membership_periods
       WHERE user_id = v_user_id AND membership_month = v_nuevo
    ) THEN
      RAISE EXCEPTION 'Ya dispones del Bono Ilimitado para ese mes.' USING errcode = '23505';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.monthly_membership_periods
       WHERE user_id = v_user_id
         AND membership_month = v_nuevo
         AND plan_type = v_tipo
    ) THEN
      RAISE EXCEPTION 'Ya dispones de este bono para ese mes.' USING errcode = '23505';
    END IF;
  END IF;

  v_nuevo_inicio := (v_nuevo::text || ' 00:00:00 Europe/Madrid')::timestamptz;
  v_nuevo_fin := v_nuevo_inicio + interval '30 days';

  IF v_tipo = 'bono_ilimitado' THEN
    UPDATE public.unlimited_membership_periods
       SET membership_month = v_nuevo,
           starts_at = v_nuevo_inicio,
           ends_at = v_nuevo_fin
     WHERE id = v_target_id AND user_id = v_user_id;

    -- Recalcular el rango del perfil (todos los periodos activos del usuario).
    UPDATE public.profiles
       SET bono_mensual_activo = (SELECT count(*) > 0 FROM public.unlimited_membership_periods WHERE user_id = v_user_id AND ends_at > timezone('utc', now())),
           bono_mensual_inicio = (SELECT min(starts_at) FROM public.unlimited_membership_periods WHERE user_id = v_user_id AND ends_at > timezone('utc', now())),
           bono_mensual_fin = (SELECT max(ends_at) FROM public.unlimited_membership_periods WHERE user_id = v_user_id AND ends_at > timezone('utc', now())),
           updated_at = timezone('utc', now())
     WHERE id = v_user_id;

    -- Traspasar también el pase especial asociado
    IF EXISTS (SELECT 1 FROM public.bonos_clases_especiales WHERE user_id = v_user_id AND mes = v_actual) THEN
      DELETE FROM public.bonos_clases_especiales WHERE user_id = v_user_id AND mes = v_nuevo;
      UPDATE public.bonos_clases_especiales
         SET mes = v_nuevo, updated_at = timezone('utc', now())
       WHERE user_id = v_user_id AND mes = v_actual;
    ELSE
      INSERT INTO public.bonos_clases_especiales (user_id, mes, saldo, origen)
      VALUES (v_user_id, v_nuevo, 1, 'bono_ilimitado')
      ON CONFLICT (user_id, mes) DO NOTHING;
    END IF;
  ELSE
    UPDATE public.monthly_membership_periods
       SET membership_month = v_nuevo,
           starts_at = v_nuevo_inicio,
           ends_at = v_nuevo_fin
     WHERE id = v_target_id
       AND user_id = v_user_id
       AND plan_type = v_tipo;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se pudo actualizar el periodo.' USING errcode = 'P0001';
  END IF;

  RETURN true;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 4. Permisos de ejecución
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.cancelar_con_bono(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_eliminar_clase(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cambiar_mes_bono_usuario(text, bigint, date, date) TO authenticated, service_role;

COMMIT;

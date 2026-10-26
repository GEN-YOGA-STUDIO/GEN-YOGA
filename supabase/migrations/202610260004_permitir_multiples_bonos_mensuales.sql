-- ============================================================================
-- Migración: Soporte para Múltiples Bonos Mensuales Simultáneos en el Mismo Mes
-- Fecha: 26 oct 2026
-- Descripción:
--   1. Elimina la restricción UNIQUE (user_id, membership_month) en monthly_membership_periods
--      para permitir contratar y asignar varios bonos mensuales en el mismo mes natural
--      (ej. 1 Bono Mensual [2 cl/sem] + 1 Bono Inicial [1 cl/sem] = 3 clases semanales).
--   2. Añade un índice único sobre checkout_session_id para garantizar idempotencia en Stripe.
--   3. Actualiza reservar_con_bono para priorizar por precio:
--        1º Ilimitado (90 € · ilimitadas)
--        2º Bono Mensual (65 € · 2 clases/semana por bono contratado)
--        3º Bono Inicial (40 € · 1 clase/semana por bono contratado)
--        4º Packs de clases normales (50 € / 95 € · orden FEFO)
--        5º Saldo residual en profiles.bonos
--   4. Actualiza admin_asignar_mes_ilimitado, admin_asignar_mes_bono_mensual y
--      admin_asignar_mes_bono_inicial para permitir convivencia de modalidades sin
--      borrado forzoso de otros bonos del mismo mes.
--   5. Actualiza stripe_fulfill_checkout para insertar nuevos periodos identificados
--      por checkout_session_id sin sobreescribir modalidades previas del mes.
-- ============================================================================

-- 1. Eliminar restricción de mes único en monthly_membership_periods
ALTER TABLE public.monthly_membership_periods
  DROP CONSTRAINT IF EXISTS monthly_membership_periods_one_month_per_user;

CREATE UNIQUE INDEX IF NOT EXISTS monthly_membership_periods_checkout_session_idx
  ON public.monthly_membership_periods (checkout_session_id)
  WHERE checkout_session_id IS NOT NULL;

-- 2. admin_asignar_mes_ilimitado: Asigna Bono Ilimitado sin eliminar bonos mensuales existentes
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


-- 3. admin_asignar_mes_bono_inicial: Asigna Bono Inicial sin eliminar otros bonos
CREATE OR REPLACE FUNCTION public.admin_asignar_mes_bono_inicial(
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

  v_month := date_trunc('month', coalesce(p_membership_month, now() AT TIME ZONE 'Europe/Madrid'))::date;
  v_starts_at := (v_month::text || ' 00:00:00 Europe/Madrid')::timestamptz;
  v_ends_at := ((v_month + interval '1 month')::date::text || ' 00:00:00 Europe/Madrid')::timestamptz;

  IF p_activo THEN
    -- Si no existe un bono inicial asignado para este mes, lo insertamos
    IF NOT EXISTS (
      SELECT 1 FROM public.monthly_membership_periods
       WHERE user_id = p_user_id
         AND membership_month = v_month
         AND plan_type = 'bono_inicial'
    ) THEN
      INSERT INTO public.monthly_membership_periods (
        user_id,
        checkout_session_id,
        membership_month,
        starts_at,
        ends_at,
        max_classes_per_week,
        plan_type,
        purchased_at
      ) VALUES (
        p_user_id,
        null,
        v_month,
        v_starts_at,
        v_ends_at,
        1,
        'bono_inicial',
        now()
      );
    END IF;
  ELSE
    DELETE FROM public.monthly_membership_periods
     WHERE user_id = p_user_id
       AND plan_type = 'bono_inicial'
       AND (
         membership_month = v_month
         OR (starts_at >= v_starts_at - interval '3 days' AND starts_at <= v_starts_at + interval '3 days')
       );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_asignar_mes_bono_inicial(uuid, date, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_asignar_mes_bono_inicial(uuid, date, boolean) TO authenticated, service_role;


-- 4. admin_asignar_mes_bono_mensual: Asigna Bono Mensual sin eliminar otros bonos
CREATE OR REPLACE FUNCTION public.admin_asignar_mes_bono_mensual(
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

  v_month := date_trunc('month', coalesce(p_membership_month, now() AT TIME ZONE 'Europe/Madrid'))::date;
  v_starts_at := (v_month::text || ' 00:00:00 Europe/Madrid')::timestamptz;
  v_ends_at := ((v_month + interval '1 month')::date::text || ' 00:00:00 Europe/Madrid')::timestamptz;

  IF p_activo THEN
    -- Si no existe un bono mensual asignado para este mes, lo insertamos
    IF NOT EXISTS (
      SELECT 1 FROM public.monthly_membership_periods
       WHERE user_id = p_user_id
         AND membership_month = v_month
         AND plan_type = 'bono_mensual'
    ) THEN
      INSERT INTO public.monthly_membership_periods (
        user_id,
        checkout_session_id,
        membership_month,
        starts_at,
        ends_at,
        max_classes_per_week,
        plan_type,
        purchased_at
      ) VALUES (
        p_user_id,
        null,
        v_month,
        v_starts_at,
        v_ends_at,
        2,
        'bono_mensual',
        now()
      );
    END IF;
  ELSE
    DELETE FROM public.monthly_membership_periods
     WHERE user_id = p_user_id
       AND plan_type = 'bono_mensual'
       AND (
         membership_month = v_month
         OR (starts_at >= v_starts_at - interval '3 days' AND starts_at <= v_starts_at + interval '3 days')
       );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_asignar_mes_bono_mensual(uuid, date, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_asignar_mes_bono_mensual(uuid, date, boolean) TO authenticated, service_role;


-- 5. Actualización de reservar_con_bono con soporte acumulativo de bonos mensuales
--    y orden de prioridad estricto por precio:
--      1º Ilimitado (90 €)
--      2º Bono Mensual (65 €)
--      3º Bono Inicial (40 €)
--      4º Packs de clases normales (50 € / 95 € · orden FEFO)
--      5º Saldo residual de clases (profiles.bonos)
CREATE OR REPLACE FUNCTION public.reservar_con_bono(
  p_clase_id bigint,
  p_user_id uuid DEFAULT NULL::uuid,
  p_forzar_regular boolean DEFAULT false,
  p_force_regular boolean DEFAULT false,
  p_use_unlimited_guest boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_is_staff boolean := false;
  v_target_role text;
  v_starts_at timestamptz;
  v_capacity integer;
  v_occupied integer;
  v_free_credits integer := 0;
  v_class_name text;
  v_class_type text;
  v_class_active boolean;
  v_is_special boolean;
  v_is_free boolean := false;
  v_class_month date;
  v_special_bonus_id bigint;
  v_pack_id bigint;
  v_effective_force_regular boolean;
  v_unlimited_covers boolean := false;
  v_has_monthly_membership boolean := false;
  v_mensual_max integer := 0;
  v_inicial_max integer := 0;
  v_total_monthly_max integer := 0;
  v_weekly_mensual_used integer := 0;
  v_weekly_inicial_used integer := 0;
  v_week_start timestamptz;
  v_week_end timestamptz;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para reservar.' USING errcode = '42501';
  END IF;
  IF p_clase_id IS NULL OR p_clase_id <= 0 OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'La solicitud de reserva no es válida.' USING errcode = '22023';
  END IF;

  v_effective_force_regular := coalesce(p_forzar_regular, false) OR coalesce(p_force_regular, false);

  SELECT lower(trim(coalesce(rol, ''))) INTO v_actor_role
    FROM public.profiles WHERE id = v_actor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el perfil que realiza la reserva.'; END IF;

  v_is_staff := v_actor_role IN ('admin', 'profesor', 'trabajador', 'profesional');

  IF p_user_id <> v_actor_id AND NOT v_is_staff THEN
    RAISE EXCEPTION 'No puedes reservar una clase para otra persona.' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))), coalesce(saldo_clases_gratis, 0)
    INTO v_target_role, v_free_credits
    FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el perfil del alumno.'; END IF;

  IF NOT v_is_staff AND v_target_role IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'Solo los alumnos pueden reservar clases.' USING errcode = '42501';
  END IF;

  SELECT coalesce(capacidad_max, 10), fecha_inicio, nombre,
         lower(trim(coalesce(nullif(tipo_clase, ''), 'yoga'))),
         coalesce(activa, true),
         coalesce(es_especial, false),
         coalesce(es_gratuita, false)
    INTO v_capacity, v_starts_at, v_class_name, v_class_type,
         v_class_active, v_is_special, v_is_free
    FROM public.clases WHERE id = p_clase_id FOR UPDATE;
  IF NOT FOUND OR NOT v_class_active THEN
    RAISE EXCEPTION 'La clase o evento especificado no está disponible.' USING errcode = 'P0002';
  END IF;

  IF v_starts_at IS NULL THEN
    RAISE EXCEPTION 'La clase o evento especificado no tiene una fecha válida.' USING errcode = 'P0002';
  END IF;

  IF NOT v_is_staff THEN
    IF v_starts_at <= now() THEN
      RAISE EXCEPTION 'La clase o evento ya no está disponible para reserva.' USING errcode = 'P0001';
    END IF;
  END IF;

  -- Comprobar si el usuario ya tiene reserva confirmada en esta clase
  IF EXISTS (
    SELECT 1 FROM public.reservas_yoga
     WHERE clase_id = p_clase_id AND user_id = p_user_id AND estado = 'confirmada'
  ) OR EXISTS (
    SELECT 1 FROM public.reservas_psicologia
     WHERE clase_id = p_clase_id AND user_id = p_user_id AND estado = 'confirmada'
  ) THEN
    RAISE EXCEPTION 'Ya tienes una reserva confirmada para este horario.' USING errcode = '23505';
  END IF;

  -- Contar plazas ocupadas totales
  SELECT (
    coalesce((SELECT sum(greatest(coalesce(num_plazas_reservadas, 1), coalesce(num_plazas, 1), 1))
                FROM public.reservas_yoga
               WHERE clase_id = p_clase_id AND estado = 'confirmada'), 0)
    +
    coalesce((SELECT count(*)
                FROM public.reservas_psicologia
               WHERE clase_id = p_clase_id AND estado = 'confirmada'), 0)
  )::integer INTO v_occupied;

  IF NOT v_is_staff AND v_occupied >= v_capacity THEN
    RAISE EXCEPTION 'No quedan plazas disponibles para esta actividad.' USING errcode = 'P0001';
  END IF;

  v_class_month := date_trunc('month', v_starts_at AT TIME ZONE 'Europe/Madrid')::date;

  -- CASO A: EVENTO TALLER
  IF v_class_type = 'taller' OR lower(v_class_name) LIKE '%taller%' THEN
    IF v_is_staff THEN
      INSERT INTO public.reservas_yoga
        (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id, tipo_reserva)
      VALUES (p_clase_id, p_user_id, 'confirmada', false, false, null, 'manual_admin');
      RETURN;
    END IF;
    RAISE EXCEPTION 'Los talleres monográficos no se pueden reservar con bonos de clases regulares.' USING errcode = 'P0001';
  END IF;

  -- CASO B: CLASE ESPECIAL (MASTERCLASS / EVENTO MENSUAL)
  IF v_is_special OR v_class_type = 'clase_especial' OR (v_class_name ~* '(masterclass|especial)' AND NOT (v_class_name ~* '(taller)')) THEN
    IF v_effective_force_regular THEN
      -- Se permite forzar consumo de pack
      SELECT id INTO v_pack_id
        FROM public.class_credit_packs
       WHERE user_id = p_user_id
         AND coalesce(starts_at, purchased_at) <= v_starts_at
         AND expires_at > v_starts_at
         AND credits_remaining > 0
       ORDER BY expires_at ASC, id ASC
       LIMIT 1 FOR UPDATE;

      IF v_pack_id IS NOT NULL THEN
        UPDATE public.class_credit_packs
           SET credits_remaining = credits_remaining - 1
         WHERE id = v_pack_id AND credits_remaining > 0;
        IF FOUND THEN
          UPDATE public.profiles
             SET bonos = (
               SELECT coalesce(sum(credits_remaining), 0)::integer
                 FROM public.class_credit_packs
                WHERE user_id = p_user_id AND expires_at > now()
             )
            WHERE id = p_user_id;

          INSERT INTO public.reservas_yoga
            (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id, tipo_reserva)
          VALUES (p_clase_id, p_user_id, 'confirmada', false, true, v_pack_id, 'pack_normal');
          RETURN;
        END IF;
      END IF;

      UPDATE public.profiles
         SET bonos = bonos - 1
       WHERE id = p_user_id AND bonos > 0;
      IF FOUND THEN
        INSERT INTO public.reservas_yoga
          (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id, tipo_reserva)
        VALUES (p_clase_id, p_user_id, 'confirmada', false, true, null, 'pack_normal');
        RETURN;
      END IF;
    END IF;

    -- Bono de Clase Especial del mes correspondiente
    SELECT id INTO v_special_bonus_id
      FROM public.bonos_clases_especiales
     WHERE user_id = p_user_id
       AND mes = v_class_month
       AND saldo > 0
     ORDER BY id ASC
     LIMIT 1 FOR UPDATE;

    IF v_special_bonus_id IS NOT NULL THEN
      UPDATE public.bonos_clases_especiales
         SET saldo = saldo - 1, updated_at = now()
       WHERE id = v_special_bonus_id AND saldo > 0;
      IF FOUND THEN
        INSERT INTO public.reservas_yoga
          (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, tipo_reserva)
        VALUES (p_clase_id, p_user_id, 'confirmada', false, true, 'clase_especial');
        RETURN;
      END IF;
    END IF;

    -- Consumo residual si tiene pack de clases normales
    SELECT id INTO v_pack_id
      FROM public.class_credit_packs
     WHERE user_id = p_user_id
       AND coalesce(starts_at, purchased_at) <= v_starts_at
       AND expires_at > v_starts_at
       AND credits_remaining > 0
     ORDER BY expires_at ASC, id ASC
     LIMIT 1 FOR UPDATE;

    IF v_pack_id IS NOT NULL THEN
      UPDATE public.class_credit_packs
         SET credits_remaining = credits_remaining - 1
       WHERE id = v_pack_id AND credits_remaining > 0;
      IF FOUND THEN
        UPDATE public.profiles
           SET bonos = (
             SELECT coalesce(sum(credits_remaining), 0)::integer
               FROM public.class_credit_packs
              WHERE user_id = p_user_id AND expires_at > now()
           )
          WHERE id = p_user_id;

        INSERT INTO public.reservas_yoga
          (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id, tipo_reserva)
        VALUES (p_clase_id, p_user_id, 'confirmada', false, true, v_pack_id, 'pack_normal');
        RETURN;
      END IF;
    END IF;

    UPDATE public.profiles
       SET bonos = bonos - 1
     WHERE id = p_user_id AND bonos > 0;
    IF FOUND THEN
      INSERT INTO public.reservas_yoga
        (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id, tipo_reserva)
      VALUES (p_clase_id, p_user_id, 'confirmada', false, true, null, 'pack_normal');
      RETURN;
    END IF;

    IF v_is_staff THEN
      INSERT INTO public.reservas_yoga
        (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id, tipo_reserva)
      VALUES (p_clase_id, p_user_id, 'confirmada', false, false, null, 'manual_admin');
      RETURN;
    END IF;

    RAISE EXCEPTION 'Esta es una clase especial. Requiere un Bono de Clase Especial del mes o saldo de clases.' USING errcode = 'P0001';
  END IF;

  -- CASO GRATUITA EXPLÍCITA
  IF v_is_free OR lower(v_class_name) LIKE '%introductor%' THEN
    INSERT INTO public.reservas_yoga
      (clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
       class_pack_id, saldo_gratis_descontado, tipo_reserva)
    VALUES (p_clase_id, p_user_id, 'confirmada', false, false, null, false, 'gratuita');
    RETURN;
  END IF;

  -- CASO C: CLASES NORMALES DE YOGA
  -- 1. Bono de Bienvenida (1 clase gratis inicial)
  IF v_free_credits > 0
     AND NOT v_effective_force_regular
     AND v_class_type = 'yoga'
     AND NOT v_is_special
     AND NOT (v_class_name ~* '(taller|masterclass|especial)') THEN

    UPDATE public.profiles
       SET saldo_clases_gratis = saldo_clases_gratis - 1
     WHERE id = p_user_id AND saldo_clases_gratis > 0;
    IF FOUND THEN
      INSERT INTO public.reservas_yoga
        (clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
         class_pack_id, saldo_gratis_descontado, tipo_reserva)
      VALUES (p_clase_id, p_user_id, 'confirmada', false, false, null, true, 'bienvenida');
      RETURN;
    END IF;
  END IF;

  -- 2. Bono Ilimitado (Prioridad #1 entre bonos de pago: sin límite semanal en el mes natural)
  IF EXISTS (
    SELECT 1 FROM public.unlimited_membership_periods
     WHERE user_id = p_user_id AND starts_at <= v_starts_at AND ends_at > v_starts_at
  ) THEN
    v_unlimited_covers := true;
  END IF;

  IF v_unlimited_covers THEN
    INSERT INTO public.reservas_yoga
      (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, tipo_reserva)
    VALUES (p_clase_id, p_user_id, 'confirmada', true, false, 'ilimitado');
    RETURN;
  END IF;

  -- 3. Bonos Mensuales (Bono Mensual 65 € [2 cl/sem] y Bono Inicial 40 € [1 cl/sem])
  --    Calcula los cupos semanales acumulados de todos los bonos contratados por el usuario
  SELECT
    coalesce(sum(max_classes_per_week) FILTER (WHERE plan_type = 'bono_mensual'), 0)::integer,
    coalesce(sum(max_classes_per_week) FILTER (WHERE plan_type = 'bono_inicial'), 0)::integer
  INTO v_mensual_max, v_inicial_max
  FROM public.monthly_membership_periods
  WHERE user_id = p_user_id
    AND starts_at <= v_starts_at
    AND ends_at > v_starts_at;

  v_total_monthly_max := coalesce(v_mensual_max, 0) + coalesce(v_inicial_max, 0);

  IF v_total_monthly_max > 0 THEN
    v_has_monthly_membership := true;
    -- Inicio y fin de la semana natural de la clase (lunes a domingo, hora peninsular)
    v_week_start := date_trunc('week', v_starts_at AT TIME ZONE 'Europe/Madrid') AT TIME ZONE 'Europe/Madrid';
    v_week_end := v_week_start + interval '7 days';

    SELECT
      count(*) FILTER (WHERE ry.tipo_reserva = 'bono_mensual')::integer,
      count(*) FILTER (WHERE ry.tipo_reserva = 'bono_inicial')::integer
    INTO v_weekly_mensual_used, v_weekly_inicial_used
    FROM public.reservas_yoga ry
    JOIN public.clases c ON c.id = ry.clase_id
    WHERE ry.user_id = p_user_id
      AND ry.estado = 'confirmada'
      AND c.fecha_inicio >= v_week_start
      AND c.fecha_inicio < v_week_end;

    -- Prioridad estricta por precio: primero agotar cupo del Bono Mensual (65 €), luego Bono Inicial (40 €)
    IF v_mensual_max > 0 AND coalesce(v_weekly_mensual_used, 0) < v_mensual_max THEN
      INSERT INTO public.reservas_yoga
        (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, tipo_reserva)
      VALUES (p_clase_id, p_user_id, 'confirmada', false, false, 'bono_mensual');
      RETURN;
    ELSIF v_inicial_max > 0 AND coalesce(v_weekly_inicial_used, 0) < v_inicial_max THEN
      INSERT INTO public.reservas_yoga
        (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, tipo_reserva)
      VALUES (p_clase_id, p_user_id, 'confirmada', false, false, 'bono_inicial');
      RETURN;
    END IF;

    -- Si ambos cupos semanales están agotados, se pasa automáticamente a consumir packs o saldo
  END IF;

  -- 4. Packs de Clases Normales (FEFO: orden de caducidad más cercana primero)
  SELECT id INTO v_pack_id
    FROM public.class_credit_packs
   WHERE user_id = p_user_id
     AND coalesce(starts_at, purchased_at) <= v_starts_at
     AND expires_at > v_starts_at
     AND credits_remaining > 0
   ORDER BY expires_at ASC, id ASC
   LIMIT 1 FOR UPDATE;

  IF v_pack_id IS NOT NULL THEN
    UPDATE public.class_credit_packs
       SET credits_remaining = credits_remaining - 1
     WHERE id = v_pack_id AND credits_remaining > 0;
    IF FOUND THEN
      UPDATE public.profiles
         SET bonos = (
           SELECT coalesce(sum(credits_remaining), 0)::integer
             FROM public.class_credit_packs
            WHERE user_id = p_user_id AND expires_at > now()
         )
        WHERE id = p_user_id;

      INSERT INTO public.reservas_yoga
        (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id, tipo_reserva)
      VALUES (p_clase_id, p_user_id, 'confirmada', false, true, v_pack_id, 'pack_normal');
      RETURN;
    END IF;
  END IF;

  -- 5. Saldo residual en profiles.bonos
  UPDATE public.profiles
     SET bonos = bonos - 1
   WHERE id = p_user_id AND bonos > 0;
  IF FOUND THEN
    INSERT INTO public.reservas_yoga
      (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id, tipo_reserva)
    VALUES (p_clase_id, p_user_id, 'confirmada', false, true, null, 'pack_normal');
    RETURN;
  END IF;

  -- 6. Staff
  IF v_is_staff THEN
    INSERT INTO public.reservas_yoga
      (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id, tipo_reserva)
    VALUES (p_clase_id, p_user_id, 'confirmada', false, false, null, 'manual_admin');
    RETURN;
  END IF;

  -- Mensaje explicativo según los bonos del usuario
  IF v_has_monthly_membership THEN
    IF v_mensual_max > 0 AND v_inicial_max > 0 THEN
      RAISE EXCEPTION 'Has alcanzado el límite semanal combinado de tus bonos mensuales (% clases/semana). Adquiere una clase suelta o pack para reservar más clases esta semana.', v_total_monthly_max
        USING errcode = 'P0001';
    ELSIF v_mensual_max > 0 THEN
      RAISE EXCEPTION 'Has alcanzado el límite de % clases por semana de tu Bono Mensual para esta semana. Adquiere una clase suelta o pack para reservar más clases.', v_mensual_max
        USING errcode = 'P0001';
    ELSE
      RAISE EXCEPTION 'Has alcanzado el límite de % clase(s) por semana de tu Bono Inicial para esta semana. Adquiere una clase suelta o pack para reservar más clases.', v_inicial_max
        USING errcode = 'P0001';
    END IF;
  END IF;

  RAISE EXCEPTION 'No tienes bonos de clases normales disponibles ni Bono Ilimitado, Mensual o Inicial activo.' USING errcode = 'P0001';
END;
$function$;

REVOKE ALL ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean, boolean, boolean) TO authenticated, service_role;


-- 6. Actualización de stripe_fulfill_checkout para soportar múltiples bonos mensuales
--    Insertando cada compra identificada por checkout_session_id sin sobreescribir compras previas
CREATE OR REPLACE FUNCTION public.stripe_fulfill_checkout(
  p_event_id text,
  p_event_type text,
  p_event_created bigint,
  p_checkout_session_id text,
  p_user_id uuid,
  p_is_guest boolean,
  p_purchase_type text,
  p_price_id text,
  p_payment_intent_id text,
  p_subscription_id text,
  p_customer_id text,
  p_amount_total integer,
  p_currency text,
  p_payment_status text,
  p_membership_month text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_subscription_status text,
  p_cancel_at_period_end boolean,
  p_livemode boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_normalized_purchase_type text;
  v_pack_record_type text;
  v_credits integer := 0;
  v_purchased_at timestamptz;
  v_expires_at timestamptz;
  v_inserted_pack_id bigint;
  v_membership_month date := null;
  v_membership_start timestamptz;
  v_membership_end timestamptz;
  v_target_month date;
  v_already_processed boolean;
  v_account_deletion_pending boolean;
  v_consultation_type text := null;
  v_appointment_id bigint := null;
  v_existing_balance integer := 0;
BEGIN
  IF p_event_id IS NULL OR trim(p_event_id) = '' THEN
    RAISE EXCEPTION 'Missing event ID' USING errcode = '22023';
  END IF;

  IF p_checkout_session_id IS NULL OR trim(p_checkout_session_id) = '' THEN
    RAISE EXCEPTION 'Missing checkout session ID' USING errcode = '22023';
  END IF;

  SELECT processed INTO v_already_processed
    FROM public.stripe_events
   WHERE event_id = p_event_id
     FOR UPDATE;

  IF v_already_processed IS TRUE THEN
    RETURN true;
  END IF;

  v_normalized_purchase_type := lower(trim(coalesce(p_purchase_type, '')));
  IF v_normalized_purchase_type = 'prod_vvkt3c71eaujmt' THEN
    v_normalized_purchase_type := 'bono_mensual';
  ELSIF v_normalized_purchase_type = 'prod_vvku2penya08qe' THEN
    v_normalized_purchase_type := 'bono_inicial';
  END IF;

  -- Asignación de créditos según tipo de pack
  v_credits := CASE
    WHEN v_normalized_purchase_type IN ('clase_suelta', 'promo_50_clase') THEN 1
    WHEN v_normalized_purchase_type = 'pack_4' THEN 4
    WHEN v_normalized_purchase_type = 'pack_6' THEN 6
    WHEN v_normalized_purchase_type = 'pack_10' THEN 10
    ELSE null
  END;

  v_pack_record_type := CASE
    WHEN v_normalized_purchase_type = 'promo_50_clase' THEN 'clase_suelta'
    ELSE v_normalized_purchase_type
  END;

  -- Manejo de mes de membresía para bonos ilimitados, mensuales, iniciales y clases especiales
  IF v_normalized_purchase_type IN ('bono_ilimitado', 'bono_mensual', 'bono_inicial', 'clase_especial') THEN
    IF nullif(trim(coalesce(p_membership_month, '')), '') IS NOT NULL
       AND trim(p_membership_month) ~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
      v_membership_month := (trim(p_membership_month) || '-01')::date;
    ELSE
      v_membership_month := date_trunc('month', timezone('Europe/Madrid', now()))::date;
    END IF;

    v_membership_start := (v_membership_month::text || ' 00:00:00 Europe/Madrid')::timestamptz;
    v_membership_end := ((v_membership_month + interval '1 month')::date::text || ' 00:00:00 Europe/Madrid')::timestamptz;
  END IF;

  -- Validación de importes exactos en céntimos
  IF v_normalized_purchase_type = 'clase_suelta' AND p_amount_total IS DISTINCT FROM 1500 THEN
    RAISE EXCEPTION 'Invalid single-class amount' USING errcode = '22023';
  ELSIF v_normalized_purchase_type = 'promo_50_clase' AND p_amount_total IS DISTINCT FROM 750 THEN
    RAISE EXCEPTION 'Invalid promo single-class amount' USING errcode = '22023';
  ELSIF v_normalized_purchase_type = 'pack_4' AND p_amount_total IS DISTINCT FROM 5000 THEN
    RAISE EXCEPTION 'Invalid four-class pack amount' USING errcode = '22023';
  ELSIF v_normalized_purchase_type = 'pack_6' AND p_amount_total IS DISTINCT FROM 6500 THEN
    RAISE EXCEPTION 'Invalid six-class pack amount' USING errcode = '22023';
  ELSIF v_normalized_purchase_type = 'pack_10' AND p_amount_total IS DISTINCT FROM 9500 THEN
    RAISE EXCEPTION 'Invalid ten-class pack amount' USING errcode = '22023';
  ELSIF v_normalized_purchase_type = 'bono_ilimitado' AND p_amount_total IS DISTINCT FROM 9000 THEN
    RAISE EXCEPTION 'Invalid unlimited-membership amount' USING errcode = '22023';
  ELSIF v_normalized_purchase_type = 'bono_inicial' AND p_amount_total IS DISTINCT FROM 4000 THEN
    RAISE EXCEPTION 'Invalid initial-membership amount: expected 40.00 EUR' USING errcode = '22023';
  ELSIF v_normalized_purchase_type = 'bono_mensual' AND p_amount_total IS DISTINCT FROM 6500 THEN
    RAISE EXCEPTION 'Invalid monthly-membership amount: expected 65.00 EUR' USING errcode = '22023';
  ELSIF v_normalized_purchase_type = 'clase_especial' AND p_amount_total IS DISTINCT FROM 2000 THEN
    RAISE EXCEPTION 'Invalid special class amount: expected 20.00 EUR' USING errcode = '22023';
  ELSIF v_normalized_purchase_type IN ('taller_intro_power_vinyasa', 'taller_35', 'taller_25', 'taller')
        OR v_normalized_purchase_type LIKE '%taller%' THEN
    IF p_amount_total IS NULL OR p_amount_total <= 0 THEN
      RAISE EXCEPTION 'Invalid workshop amount' USING errcode = '22023';
    END IF;
  END IF;

  -- Comprobación de usuario / invitado
  IF p_is_guest THEN
    IF p_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'Guest purchases must not reference a user ID' USING errcode = '22023';
    END IF;
  ELSE
    IF p_user_id IS NULL THEN
      RAISE EXCEPTION 'Non-guest purchases require a user ID' USING errcode = '22023';
    END IF;

    SELECT account_deletion_requested_at IS NOT NULL
      INTO v_account_deletion_pending
      FROM public.profiles
     WHERE id = p_user_id;

    IF v_account_deletion_pending IS TRUE THEN
      RAISE EXCEPTION 'Cannot fulfill purchases for an account pending deletion' USING errcode = '22023';
    END IF;
  END IF;

  -- Registro de la compra en stripe_purchases
  INSERT INTO public.stripe_purchases (
    checkout_session_id, user_id, is_guest, purchase_type,
    price_id, payment_intent_id, subscription_id, customer_id,
    amount_total, currency, payment_status, membership_month,
    period_start, period_end, subscription_status,
    cancel_at_period_end, livemode
  ) VALUES (
    p_checkout_session_id, p_user_id, p_is_guest, v_normalized_purchase_type,
    p_price_id, p_payment_intent_id, p_subscription_id, p_customer_id,
    p_amount_total, p_currency, p_payment_status, v_membership_month,
    p_period_start, p_period_end, p_subscription_status,
    p_cancel_at_period_end, p_livemode
  )
  ON CONFLICT (checkout_session_id) DO NOTHING;

  v_purchased_at := coalesce(p_period_start, timezone('utc', now()));
  v_expires_at := v_purchased_at + interval '60 days';

  -- 1. Packs de clases regulares
  IF v_credits IS NOT NULL AND v_credits > 0 THEN
    IF NOT p_is_guest THEN
      INSERT INTO public.class_credit_packs (
        user_id, checkout_session_id, pack_type,
        credits_total, credits_remaining,
        purchased_at, expires_at
      ) VALUES (
        p_user_id, p_checkout_session_id, v_pack_record_type,
        v_credits, v_credits,
        v_purchased_at, v_expires_at
      )
      ON CONFLICT (checkout_session_id) DO NOTHING
      RETURNING id INTO v_inserted_pack_id;

      SELECT coalesce(sum(credits_remaining), 0)::integer
        INTO v_existing_balance
        FROM public.class_credit_packs
       WHERE user_id = p_user_id
         AND expires_at > timezone('utc', now());

      UPDATE public.profiles
         SET bonos = v_existing_balance,
             stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;
    END IF;

  -- 2a. Bono Ilimitado (90 € / mes natural)
  ELSIF v_normalized_purchase_type = 'bono_ilimitado' THEN
    INSERT INTO public.unlimited_membership_periods (
      user_id, checkout_session_id, membership_month,
      starts_at, ends_at, purchased_at
    ) VALUES (
      p_user_id, p_checkout_session_id, v_membership_month,
      v_membership_start, v_membership_end, v_purchased_at
    )
    ON CONFLICT (checkout_session_id) DO NOTHING;

    UPDATE public.profiles
       SET bono_mensual_activo = true,
           bono_mensual_inicio = v_membership_start,
           bono_mensual_fin = v_membership_end,
           stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
           updated_at = timezone('utc', now())
     WHERE id = p_user_id
       AND (bono_mensual_fin IS NULL OR bono_mensual_fin < v_membership_end);

    -- 1 clase especial garantizada incluida con el Bono Ilimitado
    INSERT INTO public.bonos_clases_especiales (
      user_id, mes, saldo, origen, checkout_session_id
    ) VALUES (
      p_user_id, v_membership_month, 1, 'bono_ilimitado', p_checkout_session_id
    )
    ON CONFLICT DO NOTHING;

  -- 2b. Bono Mensual (2 clases regulares/semana, mes natural, 65 € · sin clases especiales)
  --     Inserta cada compra identificada por checkout_session_id permitiendo acumular bonos en el mismo mes
  ELSIF v_normalized_purchase_type = 'bono_mensual' THEN
    INSERT INTO public.monthly_membership_periods (
      user_id, checkout_session_id, membership_month,
      starts_at, ends_at, max_classes_per_week, plan_type, purchased_at
    ) VALUES (
      p_user_id, p_checkout_session_id, v_membership_month,
      v_membership_start, v_membership_end, 2, 'bono_mensual', v_purchased_at
    )
    ON CONFLICT (checkout_session_id) DO NOTHING;

    UPDATE public.profiles
       SET stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
           updated_at = timezone('utc', now())
     WHERE id = p_user_id;

  -- 2c. Bono Inicial (1 clase regular/semana, mes natural, 40 € · sin clases especiales)
  --     Inserta cada compra identificada por checkout_session_id permitiendo acumular bonos en el mismo mes
  ELSIF v_normalized_purchase_type = 'bono_inicial' THEN
    INSERT INTO public.monthly_membership_periods (
      user_id, checkout_session_id, membership_month,
      starts_at, ends_at, max_classes_per_week, plan_type, purchased_at
    ) VALUES (
      p_user_id, p_checkout_session_id, v_membership_month,
      v_membership_start, v_membership_end, 1, 'bono_inicial', v_purchased_at
    )
    ON CONFLICT (checkout_session_id) DO NOTHING;

    UPDATE public.profiles
       SET stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
           updated_at = timezone('utc', now())
     WHERE id = p_user_id;

  -- 3. Clase Especial individual (20 €)
  ELSIF v_normalized_purchase_type = 'clase_especial' THEN
    v_target_month := coalesce(v_membership_month, date_trunc('month', timezone('Europe/Madrid', now()))::date);
    INSERT INTO public.bonos_clases_especiales (
      user_id, mes, saldo, origen, checkout_session_id
    ) VALUES (
      p_user_id, v_target_month, 1, 'compra_stripe', p_checkout_session_id
    )
    ON CONFLICT DO NOTHING;

    UPDATE public.profiles
       SET stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
           updated_at = timezone('utc', now())
     WHERE id = p_user_id;

  -- 4. Consultas de profesionales (Psicología, Ayurveda, PNI)
  ELSIF v_normalized_purchase_type IN (
    'miriam_psico_individual_1a', 'miriam_psico_individual_sig',
    'miriam_psico_pareja_1a', 'miriam_psico_pareja_sig',
    'silvia_ayurveda_1a', 'silvia_ayurveda_sig',
    'isabel_pni_1a', 'isabel_pni_sig'
  ) THEN
    v_consultation_type := CASE
      WHEN v_normalized_purchase_type LIKE 'miriam_psico%' THEN 'psicologia'
      WHEN v_normalized_purchase_type LIKE 'silvia_ayurveda%' THEN 'ayurveda'
      WHEN v_normalized_purchase_type LIKE 'isabel_pni%' THEN 'pni'
      ELSE 'psicologia'
    END;

    INSERT INTO public.consultation_purchases (
      checkout_session_id, user_id, consultation_type,
      price_id, amount_total, currency, purchased_at
    ) VALUES (
      p_checkout_session_id, p_user_id, v_consultation_type,
      p_price_id, p_amount_total, p_currency, v_purchased_at
    )
    ON CONFLICT (checkout_session_id) DO NOTHING;

    UPDATE public.profiles
       SET stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
           updated_at = timezone('utc', now())
     WHERE id = p_user_id;

  -- 5. Talleres monográficos
  ELSIF v_normalized_purchase_type IN ('taller_intro_power_vinyasa', 'taller_35', 'taller_25', 'taller')
        OR v_normalized_purchase_type LIKE '%taller%' THEN
    IF NOT p_is_guest THEN
      INSERT INTO public.creditos_reprogramacion (
        user_id, tipo, subtipo, mes, estado, created_at
      ) VALUES (
        p_user_id, 'taller', v_normalized_purchase_type, v_class_month, 'disponible', now()
      );

      UPDATE public.profiles
         SET stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;
    END IF;
  END IF;

  -- Marcar evento de Stripe como procesado
  INSERT INTO public.stripe_events (event_id, event_type, created, processed, processed_at)
  VALUES (p_event_id, p_event_type, p_event_created, true, timezone('utc', now()))
  ON CONFLICT (event_id) DO UPDATE
    SET processed = true,
        processed_at = timezone('utc', now());

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.stripe_fulfill_checkout(text, text, bigint, text, uuid, boolean, text, text, text, text, text, integer, text, text, text, timestamptz, timestamptz, text, boolean, boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stripe_fulfill_checkout(text, text, bigint, text, uuid, boolean, text, text, text, text, text, integer, text, text, text, timestamptz, timestamptz, text, boolean, boolean) TO service_role;


-- 7. RPC para que los administradores retiren un periodo mensual específico por su id
CREATE OR REPLACE FUNCTION public.admin_retirar_periodo_mensual(
  p_period_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
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

  DELETE FROM public.monthly_membership_periods WHERE id = p_period_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_retirar_periodo_mensual(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_retirar_periodo_mensual(bigint) TO authenticated, service_role;


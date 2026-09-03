-- ==============================================================================
-- Migración 202609030005: GEN YOGA v12.0
-- 1. Clasificación estricta de Eventos: Clases Especiales y Talleres.
-- 2. Asignación de los 3 eventos existentes (Yanira 75m, Yanira 120m, Miriam 120m).
-- 3. Tabla bonos_clases_especiales (mensual, plata, 1 gratis con Bono Ilimitado o 20€).
-- 4. Asignación retroactiva de bono especial de septiembre a usuarios con Bono Ilimitado.
-- 5. Tabla creditos_reprogramacion para cancelaciones >24h de talleres y consultas.
-- 6. Actualización de reservar_con_bono y cancelar_con_bono.
-- 7. Actualización de stripe_fulfill_checkout para clase_especial (20€) y bono_ilimitado.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. TIPOS DE CLASES Y CLASIFICACIÓN DE EVENTOS
-- ------------------------------------------------------------------------------

-- Permitir en tipos_clases las categorías: 'yoga', 'taller', 'clase_especial'
ALTER TABLE public.tipos_clases
  DROP CONSTRAINT IF EXISTS tipos_clases_categoria_check;

ALTER TABLE public.tipos_clases
  ADD CONSTRAINT tipos_clases_categoria_check
  CHECK (categoria IN ('yoga', 'taller', 'clase_especial'));

-- Insertar o actualizar tipos de clases especiales
INSERT INTO public.tipos_clases (nombre, duracion_predeterminada, color, icono, activo, orden, categoria)
SELECT 'Clase Especial', 75, '#A69C6A', 'ph-star-four', true, 11, 'clase_especial'
WHERE NOT EXISTS (
  SELECT 1 FROM public.tipos_clases WHERE categoria = 'clase_especial'
);

-- Actualizar los 3 eventos existentes en base de datos:
-- a) Yanira 75 min (18 Sep 2026, id 6083 o por nombre/duración): Clase Especial
UPDATE public.clases
   SET tipo_clase = 'clase_especial',
       es_especial = true,
       duracion_minutos = 75
 WHERE id = 6083
    OR (
      fecha_inicio >= '2026-09-18 00:00:00+02'
      AND fecha_inicio <= '2026-09-18 23:59:59+02'
      AND duracion_minutos = 75
    );

-- b) Yanira 120 min (19 Sep 2026, id 5821 o por fecha/duración): Taller
UPDATE public.clases
   SET tipo_clase = 'taller',
       es_especial = true,
       duracion_minutos = 120
 WHERE id = 5821
    OR (
      fecha_inicio >= '2026-09-19 00:00:00+02'
      AND fecha_inicio <= '2026-09-19 23:59:59+02'
      AND duracion_minutos = 120
    );

-- c) Miriam 120 min (25 Sep 2026, id 7847 o por fecha/profesor Miriam): Taller
UPDATE public.clases
   SET tipo_clase = 'taller',
       es_especial = true,
       duracion_minutos = 120
 WHERE id = 7847
    OR (
      fecha_inicio >= '2026-09-25 00:00:00+02'
      AND fecha_inicio <= '2026-09-25 23:59:59+02'
      AND duracion_minutos = 120
    );

-- Asegurar que cualquier otra clase especial marcada histórica mantenga coherencia
UPDATE public.clases
   SET tipo_clase = CASE
         WHEN lower(nombre) LIKE '%taller%' THEN 'taller'
         ELSE 'clase_especial'
       END
 WHERE es_especial = true
   AND tipo_clase NOT IN ('taller', 'clase_especial');

-- ------------------------------------------------------------------------------
-- 2. TABLA: bonos_clases_especiales (Mensuales, Color Plata)
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.bonos_clases_especiales (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  mes date NOT NULL, -- Primer día del mes (ej: 2026-09-01)
  saldo integer NOT NULL DEFAULT 1 CHECK (saldo >= 0),
  origen text NOT NULL DEFAULT 'compra_stripe', -- 'bono_ilimitado', 'compra_stripe', 'admin'
  checkout_session_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bonos_clases_especiales_user_mes
  ON public.bonos_clases_especiales(user_id, mes);

ALTER TABLE public.bonos_clases_especiales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bonos_clases_especiales_select" ON public.bonos_clases_especiales;
CREATE POLICY "bonos_clases_especiales_select"
  ON public.bonos_clases_especiales
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND lower(trim(coalesce(rol, ''))) IN ('admin', 'profesor', 'trabajador')
    )
  );

DROP POLICY IF EXISTS "bonos_clases_especiales_admin_all" ON public.bonos_clases_especiales;
CREATE POLICY "bonos_clases_especiales_admin_all"
  ON public.bonos_clases_especiales
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND lower(trim(coalesce(rol, ''))) IN ('admin', 'profesor', 'trabajador')
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bonos_clases_especiales TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.bonos_clases_especiales_id_seq TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 3. ASIGNACIÓN RETROACTIVA DE BONO ESPECIAL DE SEPTIEMBRE 2026
--    Para todos los usuarios con Bono Ilimitado que cubra Septiembre 2026
-- ------------------------------------------------------------------------------

INSERT INTO public.bonos_clases_especiales (user_id, mes, saldo, origen)
SELECT DISTINCT u.user_id, '2026-09-01'::date, 1, 'bono_ilimitado'
  FROM public.unlimited_membership_periods u
 WHERE (
   u.membership_month = '2026-09-01'
   OR (u.starts_at <= '2026-09-30 23:59:59+02' AND u.ends_at >= '2026-09-01 00:00:00+02')
 )
   AND NOT EXISTS (
     SELECT 1 FROM public.bonos_clases_especiales b
      WHERE b.user_id = u.user_id
        AND b.mes = '2026-09-01'
        AND b.origen = 'bono_ilimitado'
   );

-- También para perfiles con bono_mensual_activo vigente en septiembre 2026
INSERT INTO public.bonos_clases_especiales (user_id, mes, saldo, origen)
SELECT p.id, '2026-09-01'::date, 1, 'bono_ilimitado'
  FROM public.profiles p
 WHERE p.bono_mensual_activo = true
   AND coalesce(p.bono_mensual_fin, 'infinity'::timestamptz) >= '2026-09-01 00:00:00+02'
   AND NOT EXISTS (
     SELECT 1 FROM public.bonos_clases_especiales b
      WHERE b.user_id = p.id
        AND b.mes = '2026-09-01'
   );

-- ------------------------------------------------------------------------------
-- 4. TABLA: creditos_reprogramacion
--    Permite a un alumno que canceló un taller o consulta (>24h) reservar
--    otra sesión de mismas características y mismo mes sin reembolso monetario.
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.creditos_reprogramacion (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('taller', 'consulta')),
  subtipo text, -- 'psicologia', 'nutricion', 'pni', 'taller_120', etc.
  mes date NOT NULL, -- Mes natural en el que se puede reprogramar
  clase_id_origen bigint REFERENCES public.clases(id) ON DELETE SET NULL,
  reserva_id_origen bigint,
  estado text NOT NULL DEFAULT 'disponible' CHECK (estado IN ('disponible', 'utilizado', 'expirado')),
  clase_id_destino bigint REFERENCES public.clases(id) ON DELETE SET NULL,
  reserva_id_destino bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  utilizado_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_creditos_reprog_user_mes
  ON public.creditos_reprogramacion(user_id, mes, tipo, estado);

ALTER TABLE public.creditos_reprogramacion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "creditos_reprogramacion_select" ON public.creditos_reprogramacion;
CREATE POLICY "creditos_reprogramacion_select"
  ON public.creditos_reprogramacion
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND lower(trim(coalesce(rol, ''))) IN ('admin', 'profesor', 'trabajador')
    )
  );

DROP POLICY IF EXISTS "creditos_reprogramacion_admin_all" ON public.creditos_reprogramacion;
CREATE POLICY "creditos_reprogramacion_admin_all"
  ON public.creditos_reprogramacion
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND lower(trim(coalesce(rol, ''))) IN ('admin', 'profesor', 'trabajador')
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.creditos_reprogramacion TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.creditos_reprogramacion_id_seq TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 5. FUNCIÓN AUXILIAR: obtener_saldo_clases_especiales_mes
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.obtener_saldo_clases_especiales_mes(
  p_user_id uuid,
  p_mes date DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(sum(saldo), 0)::integer
    FROM public.bonos_clases_especiales
   WHERE user_id = p_user_id
     AND mes = date_trunc('month', coalesce(p_mes, timezone('Europe/Madrid', now())::date))::date
     AND saldo > 0;
$$;

GRANT EXECUTE ON FUNCTION public.obtener_saldo_clases_especiales_mes(uuid, date) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 6. RPC: reservar_con_bono (v12.0 CANÓNICA)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reservar_con_bono(
  p_clase_id bigint,
  p_user_id uuid DEFAULT NULL,
  p_forzar_regular boolean DEFAULT false,
  p_force_regular boolean DEFAULT false,
  p_use_unlimited_guest boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_target_role text;
  v_starts_at timestamptz;
  v_capacity integer;
  v_occupied integer;
  v_free_credits integer := 0;
  v_class_name text;
  v_class_type text;
  v_class_active boolean;
  v_is_special boolean;
  v_class_month date;
  v_special_bonus_id bigint;
  v_pack_id bigint;
  v_effective_force_regular boolean;
  v_unlimited_covers boolean := false;
  v_reprog_credit_id bigint;
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
  IF p_user_id <> v_actor_id
     AND v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'No puedes reservar una clase para otra persona.' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))), coalesce(saldo_clases_gratis, 0)
    INTO v_target_role, v_free_credits
    FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el perfil del alumno.'; END IF;
  IF v_target_role IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'Solo los alumnos pueden reservar clases.' USING errcode = '42501';
  END IF;

  SELECT coalesce(capacidad_max, 10), fecha_inicio, nombre,
         lower(trim(coalesce(nullif(tipo_clase, ''), 'yoga'))),
         coalesce(activa, true),
         coalesce(es_especial, false)
    INTO v_capacity, v_starts_at, v_class_name, v_class_type,
         v_class_active, v_is_special
    FROM public.clases WHERE id = p_clase_id FOR UPDATE;
  IF NOT FOUND OR NOT v_class_active THEN
    RAISE EXCEPTION 'La clase o evento especificado no está disponible.' USING errcode = 'P0002';
  END IF;

  IF v_starts_at IS NULL OR v_starts_at <= now() THEN
    RAISE EXCEPTION 'La clase o evento ya no está disponible para reserva.' USING errcode = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.reservas_yoga
     WHERE clase_id = p_clase_id AND user_id = p_user_id AND estado = 'confirmada'
  ) THEN
    RAISE EXCEPTION 'Ya tienes una reserva confirmada para este horario.' USING errcode = '23505';
  END IF;

  SELECT coalesce(sum(greatest(coalesce(num_plazas_reservadas, 1), coalesce(num_plazas, 1), 1)), 0)::integer
    INTO v_occupied
    FROM public.reservas_yoga
   WHERE clase_id = p_clase_id AND estado = 'confirmada';
  IF v_occupied >= v_capacity THEN
    RAISE EXCEPTION 'No quedan plazas disponibles para esta actividad.' USING errcode = 'P0001';
  END IF;

  v_class_month := date_trunc('month', v_starts_at AT TIME ZONE 'Europe/Madrid')::date;

  -- ============================================================================
  -- CASO A: EVENTO TALLER (120 min, reserva individual de plaza o reprogramación)
  -- ============================================================================
  IF v_class_type = 'taller' OR lower(v_class_name) LIKE '%taller%' THEN
    -- Comprobar si el usuario tiene un crédito de reprogramación para este mes
    SELECT id INTO v_reprog_credit_id
      FROM public.creditos_reprogramacion
     WHERE user_id = p_user_id
       AND tipo = 'taller'
       AND mes = v_class_month
       AND estado = 'disponible'
     ORDER BY id ASC
     LIMIT 1 FOR UPDATE;

    IF v_reprog_credit_id IS NOT NULL THEN
      UPDATE public.creditos_reprogramacion
         SET estado = 'utilizado',
             clase_id_destino = p_clase_id,
             utilizado_at = now()
       WHERE id = v_reprog_credit_id;

      INSERT INTO public.reservas_yoga
        (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, tipo_reserva)
      VALUES (p_clase_id, p_user_id, 'confirmada', false, false, 'reprogramacion_taller');
      RETURN;
    END IF;

    -- Los talleres no se reservan con bonos de yoga ni con bonos especiales
    RAISE EXCEPTION 'Los talleres se reservan mediante plaza individual (o crédito de reprogramación del mismo mes).'
      USING errcode = 'P0001';
  END IF;

  -- ============================================================================
  -- CASO B: EVENTO CLASE ESPECIAL (Se reserva ÚNICA Y EXCLUSIVAMENTE con Bono Especial del mes)
  -- ============================================================================
  IF v_class_type = 'clase_especial' OR (v_is_special AND v_class_type <> 'yoga') THEN
    SELECT id INTO v_special_bonus_id
      FROM public.bonos_clases_especiales
     WHERE user_id = p_user_id
       AND mes = v_class_month
       AND saldo > 0
     ORDER BY id ASC
     LIMIT 1 FOR UPDATE;

    IF v_special_bonus_id IS NULL THEN
      RAISE EXCEPTION 'Esta clase especial requiere un Bono de Clase Especial de % (20 € o incluido con Bono Ilimitado).',
        to_char(v_class_month, 'TMMonth YYYY') USING errcode = 'P0001';
    END IF;

    UPDATE public.bonos_clases_especiales
       SET saldo = saldo - 1,
           updated_at = now()
     WHERE id = v_special_bonus_id AND saldo > 0;

    INSERT INTO public.reservas_yoga
      (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, tipo_reserva)
    VALUES (p_clase_id, p_user_id, 'confirmada', false, true, 'clase_especial');
    RETURN;
  END IF;

  -- ============================================================================
  -- CASO C: CLASES NORMALES DE YOGA (Color Bronce / Bono Ilimitado / Bienvenida)
  -- ============================================================================

  -- 1. Bono de Bienvenida (1 clase regular gratis)
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

  -- 2. Bono Ilimitado (tarifa plana de clases normales)
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

  -- 3. Packs de Clases Normales (Bronce)
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

  -- 4. Saldo residual en profiles.bonos
  UPDATE public.profiles
     SET bonos = bonos - 1
   WHERE id = p_user_id AND bonos > 0;
  IF FOUND THEN
    INSERT INTO public.reservas_yoga
      (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id, tipo_reserva)
    VALUES (p_clase_id, p_user_id, 'confirmada', false, true, null, 'pack_normal');
    RETURN;
  END IF;

  RAISE EXCEPTION 'No tienes bonos de clases normales disponibles ni Bono Ilimitado activo.' USING errcode = 'P0001';
END;
$$;

REVOKE ALL ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean, boolean, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean, boolean, boolean) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 7. RPC: cancelar_con_bono (v12.0 CANÓNICA)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cancelar_con_bono(p_reserva_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_actor_is_staff boolean;
  v_actor_is_admin boolean;
  v_target_id uuid;
  v_class_id bigint;
  v_credit_debited boolean;
  v_free_credit_debited boolean;
  v_used_unlimited boolean;
  v_tipo_reserva text;
  v_pack_id bigint;
  v_starts_at timestamptz;
  v_class_type text;
  v_class_month date;
  v_cancel_limit_hours integer := 24;
  v_allow_admin_override boolean := false;
  v_parent_id bigint;
  v_titular_reserva_id bigint;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para cancelar.' USING errcode = '42501';
  END IF;
  IF p_reserva_id IS NULL OR p_reserva_id <= 0 THEN
    RAISE EXCEPTION 'La solicitud de cancelación no es válida.' USING errcode = '22023';
  END IF;

  SELECT lower(trim(coalesce(p.rol, '')))
    INTO v_actor_role
    FROM public.profiles p
   WHERE p.id = v_actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró el perfil que realiza la cancelación.' USING errcode = 'P0002';
  END IF;
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
    VALUES (v_target_id, v_class_month, 1, 'reintegro_cancelacion');

  -- 3. Si era bono de bienvenida
  ELSIF v_free_credit_debited THEN
    UPDATE public.profiles
       SET saldo_clases_gratis = coalesce(saldo_clases_gratis, 0) + 1
     WHERE id = v_target_id;

  -- 4. Si consumió pack de clases normales (Bronce)
  ELSIF v_credit_debited AND v_pack_id IS NOT NULL THEN
    UPDATE public.class_credit_packs
       SET credits_remaining = least(credits_total, credits_remaining + 1),
           updated_at = now()
     WHERE id = v_pack_id AND user_id = v_target_id;

    UPDATE public.profiles
       SET bonos = (
         SELECT coalesce(sum(credits_remaining), 0)::integer
           FROM public.class_credit_packs
          WHERE user_id = v_target_id AND expires_at > now()
       )
     WHERE id = v_target_id;

  ELSIF v_credit_debited THEN
    UPDATE public.profiles
       SET bonos = coalesce(bonos, 0) + 1
     WHERE id = v_target_id;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.cancelar_con_bono(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancelar_con_bono(bigint) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 8. RPC: cancelar_consulta_atomica (v12.0 con crédito de reprogramación >24h)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cancelar_consulta_atomica(
  p_tipo text,
  p_reserva_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_actor_is_staff boolean;
  v_target_id uuid;
  v_class_id bigint;
  v_starts_at timestamptz;
  v_class_month date;
  v_cancel_limit_hours integer := 24;
  v_refund_paid boolean;
  v_refund_free boolean;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING errcode = '42501';
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('psicologia', 'nutricion')
    OR p_reserva_id IS NULL OR p_reserva_id <= 0 THEN
    RAISE EXCEPTION 'invalid cancellation request' USING errcode = '22023';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))) INTO v_actor_role
    FROM public.profiles WHERE id = v_actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'actor profile not found' USING errcode = 'P0002';
  END IF;
  v_actor_is_staff := v_actor_role IN ('admin', 'profesor', 'trabajador', 'profesional');

  IF p_tipo = 'psicologia' THEN
    SELECT user_id, clase_id, coalesce(saldo_descontado, false),
           coalesce(saldo_gratis_descontado, false)
      INTO v_target_id, v_class_id, v_refund_paid, v_refund_free
      FROM public.reservas_psicologia
     WHERE id = p_reserva_id AND estado = 'confirmada'
     FOR UPDATE;
  ELSE
    SELECT user_id, clase_id, coalesce(saldo_descontado, false),
           coalesce(saldo_gratis_descontado, false)
      INTO v_target_id, v_class_id, v_refund_paid, v_refund_free
      FROM public.reservas_nutricion
     WHERE id = p_reserva_id AND estado = 'confirmada'
     FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'consultation booking not found' USING errcode = 'P0002';
  END IF;
  IF v_target_id <> v_actor_id AND NOT v_actor_is_staff THEN
    RAISE EXCEPTION 'not allowed to cancel this booking' USING errcode = '42501';
  END IF;

  SELECT fecha_inicio INTO v_starts_at
    FROM public.clases WHERE id = v_class_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'consultation slot not found' USING errcode = 'P0002';
  END IF;

  IF NOT v_actor_is_staff THEN
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

    IF v_starts_at IS NULL
      OR v_starts_at <= now() + make_interval(hours => v_cancel_limit_hours) THEN
      RAISE EXCEPTION 'Ya no puedes cancelar la consulta: faltan menos de % horas.',
        v_cancel_limit_hours USING errcode = 'P0001';
    END IF;
  END IF;

  v_class_month := date_trunc('month', v_starts_at AT TIME ZONE 'Europe/Madrid')::date;

  IF p_tipo = 'psicologia' THEN
    DELETE FROM public.reservas_psicologia WHERE id = p_reserva_id;
  ELSE
    DELETE FROM public.reservas_nutricion WHERE id = p_reserva_id;
  END IF;

  -- Si era sesión gratuita de valoración, reintegrar saldo_consultas_gratis
  IF v_refund_free THEN
    UPDATE public.profiles
       SET saldo_consultas_gratis = coalesce(saldo_consultas_gratis, 0) + 1
     WHERE id = v_target_id;
  -- Si era consulta de pago o saldo: habilitar crédito de reprogramación para el mismo mes
  ELSE
    INSERT INTO public.creditos_reprogramacion
      (user_id, tipo, subtipo, mes, clase_id_origen, reserva_id_origen, estado)
    VALUES
      (v_target_id, 'consulta', p_tipo, v_class_month, v_class_id, p_reserva_id, 'disponible');

    -- Además mantener compatibilidad reintegrando al saldo de la especialidad
    IF p_tipo = 'psicologia' THEN
      UPDATE public.profiles
         SET saldo_psicologia = coalesce(saldo_psicologia, 0) + 1
       WHERE id = v_target_id;
    ELSE
      UPDATE public.profiles
         SET saldo_nutricion = coalesce(saldo_nutricion, 0) + 1
       WHERE id = v_target_id;
    END IF;
  END IF;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.cancelar_consulta_atomica(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancelar_consulta_atomica(text, bigint) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 9. ACTUALIZACIÓN STRIPE FULFILL CHECKOUT (Clase Especial 20€ y Bono Ilimitado)
-- ------------------------------------------------------------------------------

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
  p_amount_total bigint,
  p_currency text,
  p_payment_status text,
  p_membership_month text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_subscription_status text,
  p_cancel_at_period_end boolean,
  p_livemode boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted integer := 0;
  v_profile_updated integer := 0;
  v_existing public.stripe_purchases%ROWTYPE;
  v_pack_credits integer := null;
  v_purchased_at timestamptz;
  v_account_deletion_pending boolean;
  v_membership_month date := null;
  v_membership_start timestamptz := null;
  v_membership_end timestamptz := null;
  v_current_month date;
  v_normalized_purchase_type text := p_purchase_type;
  v_effective_event_id text;
  v_target_month date;
BEGIN
  IF p_livemode IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Only LIVE Stripe events are accepted' USING errcode = '22023';
  END IF;
  IF nullif(trim(p_checkout_session_id), '') IS NULL
    OR nullif(trim(p_price_id), '') IS NULL
    OR p_event_type IS DISTINCT FROM 'checkout.session.completed' THEN
    RAISE EXCEPTION 'Missing Stripe identifiers' USING errcode = '22023';
  END IF;
  IF p_payment_status IS DISTINCT FROM 'paid' OR lower(p_currency) IS DISTINCT FROM 'eur' THEN
    RAISE EXCEPTION 'Checkout is not a paid EUR session' USING errcode = '22023';
  END IF;

  v_effective_event_id := coalesce(nullif(trim(p_event_id), ''), 'evt_' || p_checkout_session_id);

  IF p_purchase_type IN ('promo_50', 'promo') THEN
    v_normalized_purchase_type := 'promo_50_clase';
  END IF;

  v_pack_credits := CASE v_normalized_purchase_type
    WHEN 'clase_suelta' THEN 1
    WHEN 'promo_50_clase' THEN 1
    WHEN 'pack_4' THEN 4
    WHEN 'pack_6' THEN 6
    WHEN 'pack_10' THEN 10
    ELSE null
  END;

  IF v_normalized_purchase_type IN ('bono_ilimitado', 'clase_especial') THEN
    IF nullif(trim(coalesce(p_membership_month, '')), '') IS NOT NULL
       AND trim(p_membership_month) ~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
      v_membership_month := (trim(p_membership_month) || '-01')::date;
    ELSE
      v_membership_month := date_trunc('month', timezone('Europe/Madrid', now()))::date;
    END IF;

    v_membership_start := (v_membership_month::text || ' 00:00:00 Europe/Madrid')::timestamptz;
    v_membership_end := ((v_membership_month + interval '1 month')::date::text || ' 00:00:00 Europe/Madrid')::timestamptz;
  END IF;

  -- Comprobaciones de importes
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
  ELSIF v_normalized_purchase_type IN ('bono_ilimitado', 'bono_mensual') AND p_amount_total IS DISTINCT FROM 9000 THEN
    RAISE EXCEPTION 'Invalid unlimited-membership amount' USING errcode = '22023';
  ELSIF v_normalized_purchase_type = 'clase_especial' AND p_amount_total IS DISTINCT FROM 2000 THEN
    RAISE EXCEPTION 'Invalid special class amount: expected 20.00 EUR' USING errcode = '22023';
  ELSIF v_normalized_purchase_type = 'taller_intro_power_vinyasa' AND p_amount_total IS DISTINCT FROM 3500 THEN
    RAISE EXCEPTION 'Invalid workshop amount' USING errcode = '22023';
  END IF;

  IF p_is_guest THEN
    IF p_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'Guest purchases must not reference a user ID' USING errcode = '22023';
    END IF;
  ELSE
    IF p_user_id IS NULL THEN
      RAISE EXCEPTION 'Authenticated purchases must reference a user ID' USING errcode = '22023';
    END IF;
    SELECT account_deletion_pending INTO v_account_deletion_pending
      FROM public.profiles WHERE id = p_user_id FOR UPDATE;
    IF NOT found THEN
      RAISE EXCEPTION 'User profile not found' USING errcode = '22023';
    END IF;
    IF coalesce(v_account_deletion_pending, false) THEN
      RAISE EXCEPTION 'Cannot fulfill purchases for accounts pending deletion' USING errcode = '22023';
    END IF;
  END IF;

  SELECT * INTO v_existing FROM public.stripe_purchases
   WHERE checkout_session_id = p_checkout_session_id LIMIT 1;

  IF found THEN
    RETURN jsonb_build_object(
      'status', 'already_processed',
      'purchase_id', v_existing.checkout_session_id,
      'user_id', v_existing.user_id,
      'is_guest', v_existing.is_guest,
      'purchase_type', v_existing.purchase_type
    );
  END IF;

  INSERT INTO public.stripe_webhook_events (
    event_id, event_type, livemode, checkout_session_id, object_id
  ) VALUES (
    v_effective_event_id, p_event_type, true, p_checkout_session_id,
    coalesce(p_subscription_id, p_payment_intent_id, p_checkout_session_id)
  )
  ON CONFLICT (event_id) DO NOTHING;

  INSERT INTO public.stripe_purchases (
    checkout_session_id, stripe_event_id, user_id, is_guest, purchase_type,
    price_id, payment_intent_id, subscription_id, customer_id,
    amount_total, currency, payment_status, membership_month,
    fulfilled_at, created_at, updated_at
  ) VALUES (
    p_checkout_session_id, v_effective_event_id, p_user_id, p_is_guest,
    v_normalized_purchase_type, p_price_id, p_payment_intent_id,
    p_subscription_id, p_customer_id, p_amount_total, lower(p_currency),
    p_payment_status, v_membership_month, timezone('utc', now()),
    timezone('utc', now()), timezone('utc', now())
  )
  ON CONFLICT (checkout_session_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF p_event_created IS NOT NULL AND p_event_created > 0 THEN
    v_purchased_at := to_timestamp(p_event_created);
  ELSE
    v_purchased_at := timezone('utc', now());
  END IF;

  IF NOT p_is_guest AND p_user_id IS NOT NULL THEN

    -- 1. Clases regulares (Bronce)
    IF v_pack_credits IS NOT NULL THEN
      UPDATE public.profiles
         SET bonos = coalesce(bonos, 0) + v_pack_credits,
             stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             descuento_promo_50_activo = CASE WHEN v_normalized_purchase_type = 'promo_50_clase' THEN false ELSE descuento_promo_50_activo END,
             codigo_promo_usado = CASE WHEN v_normalized_purchase_type = 'promo_50_clase' THEN true ELSE codigo_promo_usado END,
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;

      INSERT INTO public.class_credit_packs (
        user_id, checkout_session_id, pack_type, credits_total,
        credits_remaining, purchased_at, expires_at
      ) VALUES (
        p_user_id, p_checkout_session_id, v_normalized_purchase_type,
        v_pack_credits, v_pack_credits, v_purchased_at, v_purchased_at + interval '60 days'
      )
      ON CONFLICT (checkout_session_id) DO NOTHING;

    -- 2. Bono Ilimitado (mes natural): Clases normales ilimitadas + 1 BONO CLASE ESPECIAL GRATIS
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

      -- Asignar 1 Bono de Clase Especial gratis para el mes comprado
      INSERT INTO public.bonos_clases_especiales (
        user_id, mes, saldo, origen, checkout_session_id
      ) VALUES (
        p_user_id, v_membership_month, 1, 'bono_ilimitado', p_checkout_session_id
      );

    -- 3. Compra Bono Clase Especial (20 €)
    ELSIF v_normalized_purchase_type = 'clase_especial' THEN
      v_target_month := coalesce(v_membership_month, date_trunc('month', timezone('Europe/Madrid', now()))::date);
      INSERT INTO public.bonos_clases_especiales (
        user_id, mes, saldo, origen, checkout_session_id
      ) VALUES (
        p_user_id, v_target_month, 1, 'compra_stripe', p_checkout_session_id
      );

      UPDATE public.profiles
         SET stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;

    -- 4. Consultas Psicología & PNI
    ELSIF v_normalized_purchase_type IN (
      'miriam_psico_individual_1a', 'miriam_psico_individual_sig',
      'miriam_psico_pareja_1a', 'miriam_psico_pareja_sig',
      'isabel_pni_1a', 'isabel_pni_sig'
    ) THEN
      UPDATE public.profiles
         SET saldo_psicologia = coalesce(saldo_psicologia, 0) + 1,
             stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;

    -- 5. Consultas Nutrición Silvia
    ELSIF v_normalized_purchase_type IN ('silvia_ayurveda_1a', 'silvia_ayurveda_sig') THEN
      UPDATE public.profiles
         SET saldo_nutricion = coalesce(saldo_nutricion, 0) + 1,
             stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;
    ELSIF v_normalized_purchase_type = 'silvia_ayurveda_bono3' THEN
      UPDATE public.profiles
         SET saldo_nutricion = coalesce(saldo_nutricion, 0) + 3,
             stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;
    ELSIF v_normalized_purchase_type = 'silvia_ayurveda_bono6' THEN
      UPDATE public.profiles
         SET saldo_nutricion = coalesce(saldo_nutricion, 0) + 6,
             stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;

    -- 6. Taller individual
    ELSIF v_normalized_purchase_type = 'taller_intro_power_vinyasa' THEN
      UPDATE public.profiles
         SET stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id;
    END IF;

  END IF;

  RETURN jsonb_build_object(
    'status', 'success',
    'purchase_id', p_checkout_session_id,
    'user_id', p_user_id,
    'is_guest', p_is_guest,
    'purchase_type', v_normalized_purchase_type
  );
END;
$$;

REVOKE ALL ON FUNCTION public.stripe_fulfill_checkout(text, text, bigint, text, uuid, boolean, text, text, text, text, text, bigint, text, text, text, timestamptz, timestamptz, text, boolean, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.stripe_fulfill_checkout(text, text, bigint, text, uuid, boolean, text, text, text, text, text, bigint, text, text, text, timestamptz, timestamptz, text, boolean, boolean) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

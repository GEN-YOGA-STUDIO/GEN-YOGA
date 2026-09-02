-- ==============================================================================
-- Migración 202609020097: Fix completo de Yoga en Compañía (multiplaza, acompañantes, aforo)
-- y consistencia de sesiones introductorias oficiales
-- Versión: 9.46
-- ==============================================================================

BEGIN;

-- 1. Normalizar clases de Yoga en Compañía
-- Fija es_gratuita = false para evitar que se interpreten como clases individuales abiertas
UPDATE public.clases
   SET es_gratuita = false
 WHERE (companion_modality IS NOT NULL AND trim(companion_modality) <> '')
    OR lower(nombre) ~* 'colegas|pareja|abuela|hijo|en compa';

UPDATE public.clases
   SET companion_modality = 'colegas',
       es_gratuita = false
 WHERE lower(nombre) ~* 'colegas'
   AND (companion_modality IS NULL OR companion_modality <> 'colegas');

UPDATE public.clases
   SET companion_modality = 'pareja',
       es_gratuita = false
 WHERE lower(nombre) ~* 'pareja'
   AND (companion_modality IS NULL OR companion_modality <> 'pareja');

UPDATE public.clases
   SET companion_modality = 'hijo',
       es_gratuita = false
 WHERE lower(nombre) ~* 'hijo'
   AND (companion_modality IS NULL OR companion_modality <> 'hijo');

UPDATE public.clases
   SET companion_modality = 'abuela',
       es_gratuita = false
 WHERE lower(nombre) ~* 'abuela'
   AND (companion_modality IS NULL OR companion_modality <> 'abuela');

-- 2. Asegurar que las sesiones introductorias oficiales gratuitas NO tengan companion_modality
-- y tengan es_gratuita = true
UPDATE public.clases
   SET companion_modality = NULL,
       es_gratuita = true
 WHERE id IN (6092, 6093, 7825, 6508, 6086, 6088, 6087, 6089);

UPDATE public.clases
   SET companion_modality = NULL,
       es_gratuita = true
 WHERE id IN (6090, 6091);

-- 3. Asegurar columnas en reservas_yoga
ALTER TABLE public.reservas_yoga ADD COLUMN IF NOT EXISTS nombre_acompanante text;
ALTER TABLE public.reservas_yoga ADD COLUMN IF NOT EXISTS num_plazas integer DEFAULT 1;
ALTER TABLE public.reservas_yoga ADD COLUMN IF NOT EXISTS num_plazas_reservadas integer DEFAULT 1;
ALTER TABLE public.reservas_yoga ADD COLUMN IF NOT EXISTS acompanantes jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.reservas_yoga ADD COLUMN IF NOT EXISTS tipo_reserva text DEFAULT 'individual';

-- 4. Recrear función RPC reservar_con_bono_compania con soporte multiplaza y compatibilidad total
DROP FUNCTION IF EXISTS public.reservar_con_bono_compania(bigint, uuid, text, integer, jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.reservar_con_bono_compania(bigint, text, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.reservar_con_bono_compania(bigint, uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.reservar_con_bono_compania(bigint, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.reservar_con_bono_compania CASCADE;

CREATE OR REPLACE FUNCTION public.reservar_con_bono_compania(
  p_clase_id bigint,
  p_user_id uuid,
  p_nombre_acompanante text,
  p_num_plazas integer DEFAULT 2,
  p_acompanantes jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_capacity integer;
  v_occupied integer;
  v_class_active boolean;
  v_companion_modality text;
  v_companion_name text := trim(coalesce(p_nombre_acompanante, ''));
  v_required_spots integer;
  v_acompanantes_json jsonb := coalesce(p_acompanantes, '[]'::jsonb);
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para reservar.' USING errcode = '42501';
  END IF;

  SELECT lower(coalesce(rol, ''))
    INTO v_actor_role
    FROM public.profiles
   WHERE id = v_actor_id;
  IF v_actor_role IS NULL OR (p_user_id <> v_actor_id
      AND v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional')) THEN
    RAISE EXCEPTION 'No puedes reservar una clase para otra persona.' USING errcode = '42501';
  END IF;

  SELECT coalesce(capacidad_max, 10), coalesce(activa, true), lower(trim(coalesce(companion_modality, '')))
    INTO v_capacity, v_class_active, v_companion_modality
    FROM public.clases
   WHERE id = p_clase_id
   FOR UPDATE;
  IF NOT FOUND OR NOT v_class_active THEN
    RAISE EXCEPTION 'La clase especificada no está disponible.' USING errcode = 'P0002';
  END IF;

  -- Calcular plazas requeridas según modalidad
  IF v_companion_modality = 'colegas' THEN
    v_required_spots := greatest(3, least(coalesce(p_num_plazas, 3), 4));
    IF v_companion_name = '' THEN
      RAISE EXCEPTION 'Para reservar Yoga con Colegas debes indicar los nombres de tus amigos (tú + 2 o 3 amigos).' USING errcode = '22023';
    END IF;
  ELSE
    v_required_spots := 2;
    IF v_companion_name = '' THEN
      RAISE EXCEPTION 'Debes indicar el nombre de tu acompañante para reservar esta sesión.' USING errcode = '22023';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.reservas_yoga
     WHERE clase_id = p_clase_id AND user_id = p_user_id AND estado = 'confirmada'
  ) THEN
    RAISE EXCEPTION 'Ya tienes una reserva confirmada para esta clase.' USING errcode = '23505';
  END IF;

  -- Verificar aforo disponible teniendo en cuenta multiplazas ya reservadas
  SELECT coalesce(sum(greatest(coalesce(num_plazas_reservadas, 1), coalesce(num_plazas, 1), 1)), 0)::integer
    INTO v_occupied
    FROM public.reservas_yoga
   WHERE clase_id = p_clase_id AND estado = 'confirmada';

  IF v_occupied + v_required_spots > v_capacity THEN
    RAISE EXCEPTION 'Esta sesión de Yoga en Compañía requiere % plazas libres y actualmente solo quedan % disponibles.',
      v_required_spots, greatest(0, v_capacity - v_occupied) USING errcode = 'P0001';
  END IF;

  -- Descontar exactamente 1 bono de Yoga en Compañía
  UPDATE public.profiles
     SET saldo_yoga_compania = coalesce(saldo_yoga_compania, 0) - 1
   WHERE id = p_user_id AND coalesce(saldo_yoga_compania, 0) >= 1;
  IF NOT FOUND AND v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'No dispones de un bono de Yoga en Compañía activo.' USING errcode = 'P0001';
  END IF;

  IF jsonb_typeof(v_acompanantes_json) <> 'array' OR jsonb_array_length(v_acompanantes_json) = 0 THEN
    v_acompanantes_json := jsonb_build_array(jsonb_build_object('nombre', v_companion_name));
  END IF;

  INSERT INTO public.reservas_yoga (
    clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
    class_pack_id, saldo_gratis_descontado, num_plazas, num_plazas_reservadas,
    tipo_reserva, nombre_acompanante, acompanantes, welcome_companion_modality
  ) VALUES (
    p_clase_id, p_user_id, 'confirmada', false, false,
    null, true, v_required_spots, v_required_spots, 'compania', v_companion_name,
    v_acompanantes_json,
    nullif(trim(v_companion_modality), '')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reservar_con_bono_compania(bigint, uuid, text, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reservar_con_bono_compania(bigint, uuid, text, integer, jsonb) TO authenticated, anon, service_role;

-- Blindar reservar_con_bono para impedir eludir los requisitos de Yoga en Compañía
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
  v_target_role text;
  v_capacity integer;
  v_occupied integer;
  v_starts_at timestamptz;
  v_class_name text;
  v_class_type text;
  v_class_active boolean;
  v_marked_free boolean;
  v_free_credits integer;
  v_companion_modality text;
  v_unlimited boolean := false;
  v_pack_id bigint;
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_special_count integer;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para reservar.' USING errcode = '42501';
  END IF;
  IF p_clase_id IS NULL OR p_clase_id <= 0 OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'La solicitud de reserva no es válida.' USING errcode = '22023';
  END IF;
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
         coalesce(activa, true), coalesce(es_gratuita, false),
         companion_modality
    INTO v_capacity, v_starts_at, v_class_name, v_class_type,
         v_class_active, v_marked_free, v_companion_modality
    FROM public.clases WHERE id = p_clase_id FOR UPDATE;
  IF NOT FOUND OR NOT v_class_active OR v_class_type NOT IN ('yoga', 'taller') THEN
    RAISE EXCEPTION 'La clase especificada no está disponible.' USING errcode = 'P0002';
  END IF;

  IF v_companion_modality IS NOT NULL AND trim(v_companion_modality) <> '' THEN
    RAISE EXCEPTION 'Esta sesión es de Yoga en Compañía y requiere reservar mediante su bono específico indicando los acompañantes.' USING errcode = 'P0001';
  END IF;

  IF v_starts_at IS NULL OR v_starts_at <= now() THEN
    RAISE EXCEPTION 'La clase ya no está disponible para reserva.' USING errcode = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.reservas_yoga
     WHERE clase_id = p_clase_id AND user_id = p_user_id AND estado = 'confirmada'
  ) THEN
    RAISE EXCEPTION 'Ya tienes una reserva confirmada para esta clase.' USING errcode = '23505';
  END IF;
  SELECT coalesce(sum(greatest(coalesce(num_plazas_reservadas, 1), coalesce(num_plazas, 1), 1)), 0)::integer
    INTO v_occupied
    FROM public.reservas_yoga
   WHERE clase_id = p_clase_id AND estado = 'confirmada';
  IF v_occupied >= v_capacity THEN
    RAISE EXCEPTION 'La clase está completa.' USING errcode = 'P0001';
  END IF;

  -- El saldo de bienvenida se consume siempre antes de crear una reserva gratuita
  IF v_free_credits > 0
     AND (
       public.es_clase_elegible_bono_gratis(v_class_name, v_starts_at, '', v_marked_free)
       OR v_class_name ~* '(introductoria|gratis|gratuita|prueba|clase abierta)'
     ) THEN
    UPDATE public.profiles SET saldo_clases_gratis = saldo_clases_gratis - 1
     WHERE id = p_user_id AND saldo_clases_gratis > 0;
    IF FOUND THEN
      INSERT INTO public.reservas_yoga
        (clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
         class_pack_id, saldo_gratis_descontado)
      VALUES (p_clase_id, p_user_id, 'confirmada', false, false, null, true);
      RETURN;
    END IF;
  END IF;

  -- Comprobar cobertura real del Bono Ilimitado para la fecha de la clase.
  SELECT starts_at, ends_at INTO v_month_start, v_month_end
    FROM public.unlimited_membership_periods
   WHERE user_id = p_user_id AND starts_at <= v_starts_at AND ends_at > v_starts_at
   ORDER BY starts_at DESC LIMIT 1 FOR SHARE;
  IF FOUND AND v_class_type <> 'taller' THEN
    v_unlimited := true;
  ELSIF FOUND AND v_class_type = 'taller' THEN
    SELECT count(*)::integer INTO v_special_count
      FROM public.reservas_yoga r
      JOIN public.clases c ON c.id = r.clase_id
     WHERE r.user_id = p_user_id AND r.estado = 'confirmada'
       AND r.usado_bono_mensual AND lower(coalesce(c.tipo_clase, '')) = 'taller'
       AND c.fecha_inicio >= v_month_start AND c.fecha_inicio < v_month_end;
    IF v_special_count = 0 THEN v_unlimited := true; END IF;
  END IF;

  IF v_unlimited THEN
    INSERT INTO public.reservas_yoga
      (clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
       class_pack_id, saldo_gratis_descontado)
    VALUES (p_clase_id, p_user_id, 'confirmada', true, false, null, false);
    RETURN;
  END IF;

  IF v_class_type = 'taller' THEN
    RAISE EXCEPTION 'Las clases especiales requieren un Bono Ilimitado activo.' USING errcode = 'P0001';
  END IF;

  -- Consumir el pack más próximo a caducar; si no existe, consumir saldo legado.
  SELECT id INTO v_pack_id FROM public.class_credit_packs
   WHERE user_id = p_user_id AND credits_remaining > 0
     AND expires_at > now() AND expires_at >= v_starts_at
   ORDER BY expires_at, purchased_at, id LIMIT 1 FOR UPDATE;
  IF v_pack_id IS NOT NULL THEN
    UPDATE public.class_credit_packs SET credits_remaining = credits_remaining - 1, updated_at = now()
     WHERE id = v_pack_id AND credits_remaining > 0;
    IF NOT FOUND THEN RAISE EXCEPTION 'El pack ya no tiene clases disponibles.'; END IF;
  ELSE
    UPDATE public.profiles SET bonos = coalesce(bonos, 0) - 1
     WHERE id = p_user_id AND coalesce(bonos, 0) > 0;
    IF NOT FOUND THEN RAISE EXCEPTION 'No tienes clases vigentes disponibles para esta fecha.' USING errcode = 'P0001'; END IF;
  END IF;

  INSERT INTO public.reservas_yoga
    (clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
     class_pack_id, saldo_gratis_descontado)
  VALUES (p_clase_id, p_user_id, 'confirmada', false, true, v_pack_id, false);
END;
$$;

REVOKE ALL ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean) TO authenticated, service_role;

-- 4. Actualizar cancelar_con_bono para que devuelva siempre saldo_yoga_compania
CREATE OR REPLACE FUNCTION public.cancelar_con_bono(
  p_reserva_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
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
  v_companion_modality text;
  v_tipo_reserva text;
  v_pack_id bigint;
  v_starts_at timestamptz;
  v_class_type text;
  v_cancel_limit_hours integer := 24;
  v_allow_admin_override boolean := false;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para cancelar.' USING errcode = '42501';
  END IF;
  IF p_reserva_id IS NULL OR p_reserva_id <= 0 THEN
    RAISE EXCEPTION 'La solicitud de cancelación no es válida.' USING errcode = '22023';
  END IF;

  SELECT lower(trim(coalesce(rol, '')))
    INTO v_actor_role
    FROM public.profiles
   WHERE id = v_actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró el perfil que realiza la cancelación.' USING errcode = 'P0002';
  END IF;
  v_actor_is_staff := v_actor_role IN ('admin', 'profesor', 'trabajador', 'profesional');
  v_actor_is_admin := v_actor_role = 'admin';

  SELECT user_id, clase_id, coalesce(bono_descontado, false),
         coalesce(saldo_gratis_descontado, false),
         coalesce(usado_bono_mensual, false),
         welcome_companion_modality, tipo_reserva, class_pack_id
    INTO v_target_id, v_class_id, v_credit_debited,
         v_free_credit_debited, v_used_unlimited,
         v_companion_modality, v_tipo_reserva, v_pack_id
    FROM public.reservas_yoga
   WHERE id = p_reserva_id
     AND estado = 'confirmada'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La reserva especificada no existe.' USING errcode = 'P0002';
  END IF;
  IF v_target_id <> v_actor_id AND NOT v_actor_is_staff THEN
    RAISE EXCEPTION 'No puedes cancelar la reserva de otra persona.' USING errcode = '42501';
  END IF;

  SELECT fecha_inicio, lower(trim(coalesce(tipo_clase, '')))
    INTO v_starts_at, v_class_type
    FROM public.clases
   WHERE id = v_class_id
   FOR UPDATE;

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
    RAISE EXCEPTION 'Ya no puedes cancelar: faltan % h o menos para la clase. El bono reservado no se devuelve.',
      v_cancel_limit_hours USING errcode = 'P0001';
  END IF;

  DELETE FROM public.reservas_yoga WHERE id = p_reserva_id;

  -- Reintegro del saldo correspondiente
  IF v_tipo_reserva = 'compania' OR (v_companion_modality IS NOT NULL AND lower(trim(v_companion_modality)) NOT IN ('', 'bienvenida', 'gratis')) THEN
    UPDATE public.profiles
       SET saldo_yoga_compania = coalesce(saldo_yoga_compania, 0) + 1
     WHERE id = v_target_id;
  ELSIF v_free_credit_debited THEN
    UPDATE public.profiles
       SET saldo_clases_gratis = coalesce(saldo_clases_gratis, 0) + 1
     WHERE id = v_target_id;
  ELSIF v_credit_debited AND v_pack_id IS NOT NULL THEN
    UPDATE public.class_credit_packs
       SET credits_remaining = least(credits_total, credits_remaining + 1),
           updated_at = now()
     WHERE id = v_pack_id
       AND user_id = v_target_id;
  ELSIF v_credit_debited THEN
    UPDATE public.profiles
       SET bonos = coalesce(bonos, 0) + 1
     WHERE id = v_target_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.cancelar_con_bono(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancelar_con_bono(bigint) TO authenticated, anon, service_role;

-- 5. Actualizar admin_obtener_asistencias_completas con soporte de acompañantes
DROP FUNCTION IF EXISTS public.admin_obtener_asistencias_completas(bigint[]) CASCADE;
CREATE OR REPLACE FUNCTION public.admin_obtener_asistencias_completas(
  p_clase_ids bigint[] DEFAULT NULL
)
RETURNS TABLE (
  reserva_id bigint,
  clase_id bigint,
  user_id uuid,
  tipo_clase text,
  estado text,
  nombre text,
  apellidos text,
  email text,
  telefono text,
  auth_method text,
  fecha_nacimiento date,
  rol text,
  usado_bono_mensual boolean,
  bono_descontado boolean,
  saldo_gratis_descontado boolean,
  welcome_companion_modality text,
  class_pack_id bigint,
  beneficio_invitado_de uuid,
  num_plazas integer,
  tipo_reserva text,
  nombre_acompanante text,
  acompanantes jsonb
)
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

  SELECT lower(coalesce(p.rol, '')) INTO v_actor_role
    FROM public.profiles p
   WHERE p.id = v_actor_id;

  IF NOT FOUND OR v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'No tienes permisos suficientes.' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT
    r.id AS reserva_id,
    r.clase_id,
    r.user_id,
    'yoga'::text AS tipo_clase,
    r.estado::text,
    coalesce(nullif(trim(p.nombre), ''), 'Alumno') AS nombre,
    coalesce(nullif(trim(p.apellidos), ''), '') AS apellidos,
    coalesce(nullif(trim(p.email), ''), '') AS email,
    coalesce(nullif(trim(p.telefono), ''), '') AS telefono,
    coalesce(p.auth_method, '') AS auth_method,
    p.fecha_nacimiento,
    coalesce(p.rol, 'alumno') AS rol,
    coalesce(r.usado_bono_mensual, false) AS usado_bono_mensual,
    coalesce(r.bono_descontado, false) AS bono_descontado,
    coalesce(r.saldo_gratis_descontado, false) AS saldo_gratis_descontado,
    r.welcome_companion_modality::text AS welcome_companion_modality,
    r.class_pack_id,
    r.beneficio_invitado_de,
    coalesce(r.num_plazas, 1)::integer AS num_plazas,
    coalesce(r.tipo_reserva, 'individual')::text AS tipo_reserva,
    r.nombre_acompanante,
    coalesce(r.acompanantes, '[]'::jsonb) AS acompanantes
  FROM public.reservas_yoga r
  LEFT JOIN public.profiles p ON p.id = r.user_id
  WHERE r.estado = 'confirmada'
    AND (p_clase_ids IS NULL OR r.clase_id = ANY(p_clase_ids))

  UNION ALL

  SELECT
    rp.id AS reserva_id,
    rp.clase_id,
    rp.user_id,
    'psicologia'::text AS tipo_clase,
    rp.estado::text,
    coalesce(nullif(trim(p.nombre), ''), 'Paciente') AS nombre,
    coalesce(nullif(trim(p.apellidos), ''), '') AS apellidos,
    coalesce(nullif(trim(p.email), ''), '') AS email,
    coalesce(nullif(trim(p.telefono), ''), '') AS telefono,
    coalesce(p.auth_method, '') AS auth_method,
    p.fecha_nacimiento,
    coalesce(p.rol, 'alumno') AS rol,
    false AS usado_bono_mensual,
    false AS bono_descontado,
    coalesce(rp.saldo_gratis_descontado, false) AS saldo_gratis_descontado,
    null::text AS welcome_companion_modality,
    null::bigint AS class_pack_id,
    null::uuid AS beneficio_invitado_de,
    1::integer AS num_plazas,
    'individual'::text AS tipo_reserva,
    null::text AS nombre_acompanante,
    '[]'::jsonb AS acompanantes
  FROM public.reservas_psicologia rp
  LEFT JOIN public.profiles p ON p.id = rp.user_id
  WHERE rp.estado = 'confirmada'
    AND (p_clase_ids IS NULL OR rp.clase_id = ANY(p_clase_ids))

  UNION ALL

  SELECT
    rn.id AS reserva_id,
    rn.clase_id,
    rn.user_id,
    'nutricion'::text AS tipo_clase,
    rn.estado::text,
    coalesce(nullif(trim(p.nombre), ''), 'Paciente') AS nombre,
    coalesce(nullif(trim(p.apellidos), ''), '') AS apellidos,
    coalesce(nullif(trim(p.email), ''), '') AS email,
    coalesce(nullif(trim(p.telefono), ''), '') AS telefono,
    coalesce(p.auth_method, '') AS auth_method,
    p.fecha_nacimiento,
    coalesce(p.rol, 'alumno') AS rol,
    false AS usado_bono_mensual,
    false AS bono_descontado,
    coalesce(rn.saldo_gratis_descontado, false) AS saldo_gratis_descontado,
    null::text AS welcome_companion_modality,
    null::bigint AS class_pack_id,
    null::uuid AS beneficio_invitado_de,
    1::integer AS num_plazas,
    'individual'::text AS tipo_reserva,
    null::text AS nombre_acompanante,
    '[]'::jsonb AS acompanantes
  FROM public.reservas_nutricion rn
  LEFT JOIN public.profiles p ON p.id = rn.user_id
  WHERE rn.estado = 'confirmada'
    AND (p_clase_ids IS NULL OR rn.clase_id = ANY(p_clase_ids));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_obtener_asistencias_completas(bigint[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_obtener_asistencias_completas(bigint[]) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

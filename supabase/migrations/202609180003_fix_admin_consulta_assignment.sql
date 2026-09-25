-- ==============================================================================
-- MIGRACIÓN 202609180003: Corrección de asignación de consultas por admin/staff,
-- soporte de metadatos (producto contratado, origen pago mostrador, notas) y
-- fix en creación de usuarios temporales (bonos en profiles).
-- ==============================================================================

BEGIN;

-- 1. Asegurar columnas de metadatos en clases y tablas de reservas
ALTER TABLE public.clases
  ADD COLUMN IF NOT EXISTS metodo_pago text,
  ADD COLUMN IF NOT EXISTS stripe_lookup_key text;

ALTER TABLE public.reservas_psicologia
  ADD COLUMN IF NOT EXISTS producto_contratado text,
  ADD COLUMN IF NOT EXISTS stripe_lookup_key text,
  ADD COLUMN IF NOT EXISTS origen_pago text DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS notas text DEFAULT '';

ALTER TABLE public.reservas_nutricion
  ADD COLUMN IF NOT EXISTS producto_contratado text,
  ADD COLUMN IF NOT EXISTS stripe_lookup_key text,
  ADD COLUMN IF NOT EXISTS origen_pago text DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS notas text DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_reservas_psicologia_origen_pago ON public.reservas_psicologia(origen_pago);
CREATE INDEX IF NOT EXISTS idx_reservas_nutricion_origen_pago ON public.reservas_nutricion(origen_pago);
CREATE INDEX IF NOT EXISTS idx_clases_metodo_pago ON public.clases(metodo_pago);
CREATE INDEX IF NOT EXISTS idx_clases_stripe_lookup_key ON public.clases(stripe_lookup_key);

-- 2. Limpiar firmas previas de funciones para evitar desajustes en PostgREST
DROP FUNCTION IF EXISTS public.reservar_consulta_atomica(text, bigint, uuid, boolean);
DROP FUNCTION IF EXISTS public.reservar_consulta_atomica(text, bigint, uuid, boolean, text, text, text, text);
DROP FUNCTION IF EXISTS public.reservar_consulta_virtual(text, bigint, timestamptz, uuid, boolean);
DROP FUNCTION IF EXISTS public.reservar_consulta_virtual(text, bigint, timestamptz, uuid, boolean, text, text, text, text);
DROP FUNCTION IF EXISTS public.admin_asignar_consulta_paciente(text, bigint, uuid, boolean, text);
DROP FUNCTION IF EXISTS public.admin_asignar_consulta_paciente(text, bigint, uuid, boolean, text, text, text, text);
DROP FUNCTION IF EXISTS public.admin_crear_o_obtener_usuario_temporal(text, text, text, text);

-- 3. Función principal unificada: reservar_consulta_atomica
CREATE OR REPLACE FUNCTION public.reservar_consulta_atomica(
  p_tipo text,
  p_clase_id bigint,
  p_user_id uuid DEFAULT NULL::uuid,
  p_cobrar_saldo boolean DEFAULT true,
  p_producto_contratado text DEFAULT NULL::text,
  p_stripe_lookup_key text DEFAULT NULL::text,
  p_origen_pago text DEFAULT 'local'::text,
  p_notas text DEFAULT NULL::text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_actor_email text;
  v_actor_is_staff boolean;
  v_target_id uuid := coalesce(p_user_id, auth.uid());
  v_target_role text;
  v_class_type text;
  v_class_active boolean;
  v_capacity integer;
  v_starts_at timestamptz;
  v_professor_id public.clases.profesor_id%type;
  v_is_free boolean;
  v_name text;
  v_occupied integer;
  v_reservation_id bigint;
  v_no_charge boolean := false;
  v_charge_credit boolean := true;
  v_booking_limit_hours integer := 12;
  v_effective_producto text := trim(coalesce(p_producto_contratado, ''));
  v_effective_lookup text := trim(coalesce(p_stripe_lookup_key, ''));
  v_effective_origen text := trim(coalesce(p_origen_pago, 'local'));
  v_effective_notas text := trim(coalesce(p_notas, ''));
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING errcode = '42501';
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('psicologia', 'nutricion') THEN
    RAISE EXCEPTION 'invalid consultation type' USING errcode = '22023';
  END IF;
  IF p_clase_id IS NULL OR p_clase_id <= 0 OR v_target_id IS NULL THEN
    RAISE EXCEPTION 'invalid booking request' USING errcode = '22023';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))), lower(nullif(trim(email), ''))
    INTO v_actor_role, v_actor_email
    FROM public.profiles
   WHERE id = v_actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'actor profile not found' USING errcode = 'P0002';
  END IF;
  v_actor_is_staff := v_actor_role IN ('admin', 'profesor', 'trabajador', 'profesional');

  IF v_target_id <> v_actor_id AND NOT v_actor_is_staff THEN
    RAISE EXCEPTION 'not allowed to book for another user' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(tipo_clase, ''))), coalesce(activa, true),
         coalesce(capacidad_max, 0), fecha_inicio, profesor_id,
         coalesce(es_gratuita, false), lower(trim(coalesce(nombre, '')))
    INTO v_class_type, v_class_active, v_capacity, v_starts_at,
         v_professor_id, v_is_free, v_name
    FROM public.clases
   WHERE id = p_clase_id
   FOR UPDATE;

  IF NOT FOUND OR v_class_type <> p_tipo OR NOT v_class_active
    OR v_capacity <= 0 OR v_starts_at IS NULL THEN
    RAISE EXCEPTION 'consultation slot not found or invalid' USING errcode = 'P0002';
  END IF;

  -- Para personal de recepción/admin/profesional del turno se permite gestionar turnos del día
  IF v_target_id <> v_actor_id AND v_actor_role NOT IN ('admin', 'trabajador')
    AND NOT EXISTS (
      SELECT 1
        FROM public.profesionales
       WHERE id = v_professor_id
         AND lower(nullif(trim(email), '')) = v_actor_email
    ) THEN
    RAISE EXCEPTION 'staff may only manage consultation slots linked to their professional profile'
      USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, '')))
    INTO v_target_role
    FROM public.profiles
   WHERE id = v_target_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'target profile not found' USING errcode = 'P0002';
  END IF;

  IF NOT v_actor_is_staff AND v_target_role IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'staff users cannot book consultations' USING errcode = '42501';
  END IF;

  -- Restricción temporal solo para reservas autoservicio de clientes
  IF NOT v_actor_is_staff THEN
    BEGIN
      SELECT CASE
        WHEN trim(coalesce(valor, '')) ~ '^[0-9]{1,3}$'
          THEN least(168, greatest(0, trim(valor)::integer))
        ELSE 12
      END
        INTO v_booking_limit_hours
        FROM public.configuracion
       WHERE clave = 'horas_limite_reserva'
       LIMIT 1;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        v_booking_limit_hours := 12;
    END;
    v_booking_limit_hours := coalesce(v_booking_limit_hours, 12);

    IF v_starts_at <= now() THEN
      RAISE EXCEPTION 'consultation slot has already passed' USING errcode = 'P0001';
    END IF;
    IF v_starts_at <= now() + make_interval(hours => v_booking_limit_hours) THEN
      RAISE EXCEPTION 'consultation slot is no longer bookable' USING errcode = 'P0001';
    END IF;
  END IF;

  IF p_tipo = 'psicologia' THEN
    IF EXISTS (
      SELECT 1 FROM public.reservas_psicologia
       WHERE clase_id = p_clase_id
         AND user_id = v_target_id
         AND estado = 'confirmada'
    ) THEN
      RAISE EXCEPTION 'consultation already booked' USING errcode = '23505';
    END IF;
    SELECT count(*)::integer
      INTO v_occupied
      FROM public.reservas_psicologia
     WHERE clase_id = p_clase_id
       AND estado = 'confirmada';
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.reservas_nutricion
       WHERE clase_id = p_clase_id
         AND user_id = v_target_id
         AND estado = 'confirmada'
    ) THEN
      RAISE EXCEPTION 'consultation already booked' USING errcode = '23505';
    END IF;
    SELECT count(*)::integer
      INTO v_occupied
      FROM public.reservas_nutricion
     WHERE clase_id = p_clase_id
       AND estado = 'confirmada';
  END IF;

  IF v_occupied >= v_capacity THEN
    RAISE EXCEPTION 'consultation is full' USING errcode = 'P0001';
  END IF;

  -- Determinar si esta reserva no debe descontar saldo (ej: 2º turno de Consulta Doble o reserva manual por staff / pago mostrador)
  v_no_charge := NOT coalesce(p_cobrar_saldo, true);

  -- Regla: Bono de Bienvenida cubre sesiones introductorias o marcadas como gratuitas
  IF (v_is_free OR v_name LIKE '%introduct%') THEN
    v_is_free := true;
  END IF;

  -- Determinar producto por defecto si no viene especificado
  IF v_effective_producto = '' THEN
    IF v_is_free THEN
      v_effective_producto := 'Consulta Gratuita de Bienvenida (0 €)';
    ELSE
      SELECT coalesce(metodo_pago, 'Consulta ' || initcap(p_tipo)) INTO v_effective_producto
        FROM public.clases WHERE id = p_clase_id;
      IF v_effective_producto IS NULL OR v_effective_producto = '' THEN
        v_effective_producto := 'Consulta ' || initcap(p_tipo);
      END IF;
    END IF;
  END IF;

  -- Actualizar clase con producto/lookup si viene especificado
  UPDATE public.clases
     SET metodo_pago = COALESCE(NULLIF(v_effective_producto, ''), metodo_pago),
         stripe_lookup_key = COALESCE(NULLIF(v_effective_lookup, ''), stripe_lookup_key)
   WHERE id = p_clase_id;

  IF v_is_free AND NOT v_no_charge THEN
    UPDATE public.profiles
       SET saldo_consultas_gratis = saldo_consultas_gratis - 1
     WHERE id = v_target_id
       AND saldo_consultas_gratis >= 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ya has utilizado tu bono de consulta gratuita o no dispones de saldo gratis suficiente.'
        USING errcode = 'P0001';
    END IF;

    IF p_tipo = 'psicologia' THEN
      INSERT INTO public.reservas_psicologia (
        clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado,
        producto_contratado, stripe_lookup_key, origen_pago, notas
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, true,
        v_effective_producto, v_effective_lookup, v_effective_origen, v_effective_notas
      ) RETURNING id INTO v_reservation_id;
    ELSE
      INSERT INTO public.reservas_nutricion (
        clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado,
        producto_contratado, stripe_lookup_key, origen_pago, notas
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, true,
        v_effective_producto, v_effective_lookup, v_effective_origen, v_effective_notas
      ) RETURNING id INTO v_reservation_id;
    END IF;
    RETURN v_reservation_id;
  ELSIF v_is_free AND v_no_charge THEN
    -- Turno gratuito / cubierto (p. ej. turno 2 de consulta doble o reserva de mostrador)
    IF p_tipo = 'psicologia' THEN
      INSERT INTO public.reservas_psicologia (
        clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado,
        producto_contratado, stripe_lookup_key, origen_pago, notas
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, false,
        v_effective_producto, v_effective_lookup, v_effective_origen, v_effective_notas
      ) RETURNING id INTO v_reservation_id;
    ELSE
      INSERT INTO public.reservas_nutricion (
        clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado,
        producto_contratado, stripe_lookup_key, origen_pago, notas
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, false,
        v_effective_producto, v_effective_lookup, v_effective_origen, v_effective_notas
      ) RETURNING id INTO v_reservation_id;
    END IF;
    RETURN v_reservation_id;
  END IF;

  v_charge_credit := NOT v_no_charge;

  IF v_charge_credit AND p_tipo = 'psicologia' THEN
    UPDATE public.profiles
       SET saldo_psicologia = saldo_psicologia - 1
     WHERE id = v_target_id
       AND saldo_psicologia >= 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'insufficient psychology credit' USING errcode = 'P0001';
    END IF;
  ELSIF v_charge_credit AND p_tipo = 'nutricion' THEN
    UPDATE public.profiles
       SET saldo_nutricion = saldo_nutricion - 1
     WHERE id = v_target_id
       AND saldo_nutricion >= 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'insufficient nutrition credit' USING errcode = 'P0001';
    END IF;
  END IF;

  IF p_tipo = 'psicologia' THEN
    INSERT INTO public.reservas_psicologia (
      clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado,
      producto_contratado, stripe_lookup_key, origen_pago, notas
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', v_charge_credit, false,
      v_effective_producto, v_effective_lookup, v_effective_origen, v_effective_notas
    ) RETURNING id INTO v_reservation_id;
  ELSE
    INSERT INTO public.reservas_nutricion (
      clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado,
      producto_contratado, stripe_lookup_key, origen_pago, notas
    ) VALUES (
      p_clase_id, v_target_id, 'confirmada', v_charge_credit, false,
      v_effective_producto, v_effective_lookup, v_effective_origen, v_effective_notas
    ) RETURNING id INTO v_reservation_id;
  END IF;

  RETURN v_reservation_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.reservar_consulta_atomica(text, bigint, uuid, boolean, text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reservar_consulta_atomica(text, bigint, uuid, boolean, text, text, text, text) TO authenticated, service_role;

-- 4. Función de compatibilidad virtual: reservar_consulta_virtual
CREATE OR REPLACE FUNCTION public.reservar_consulta_virtual(
  p_tipo text,
  p_profesor_id bigint,
  p_fecha_inicio timestamptz,
  p_user_id uuid DEFAULT NULL::uuid,
  p_cobrar_saldo boolean DEFAULT true,
  p_producto_contratado text DEFAULT NULL::text,
  p_stripe_lookup_key text DEFAULT NULL::text,
  p_origen_pago text DEFAULT 'local'::text,
  p_notas text DEFAULT NULL::text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_clase_id bigint;
  v_duracion integer := 60;
  v_nombre_clase text;
  v_fecha_fin timestamptz;
  v_effective_producto text := trim(coalesce(p_producto_contratado, ''));
  v_effective_lookup text := trim(coalesce(p_stripe_lookup_key, ''));
  v_effective_origen text := trim(coalesce(p_origen_pago, 'local'));
  v_effective_notas text := trim(coalesce(p_notas, ''));
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING errcode = '42501';
  END IF;

  SELECT id INTO v_clase_id
    FROM public.clases
   WHERE tipo_clase = p_tipo
     AND profesor_id = p_profesor_id
     AND fecha_inicio = p_fecha_inicio
     AND activa = true
   LIMIT 1;

  IF v_clase_id IS NULL THEN
    v_nombre_clase := CASE WHEN p_tipo = 'psicologia' THEN 'Consulta Psicología' ELSE 'Consulta Nutrición' END;
    v_fecha_fin := p_fecha_inicio + interval '60 minutes';

    INSERT INTO public.clases (
      nombre,
      fecha_inicio,
      fecha_fin,
      capacidad_max,
      profesor_id,
      tipo_clase,
      duracion_minutos,
      activa,
      metodo_pago,
      stripe_lookup_key
    ) VALUES (
      v_nombre_clase,
      p_fecha_inicio,
      v_fecha_fin,
      1,
      p_profesor_id,
      p_tipo,
      v_duracion,
      true,
      NULLIF(v_effective_producto, ''),
      NULLIF(v_effective_lookup, '')
    ) RETURNING id INTO v_clase_id;
  END IF;

  PERFORM public.reservar_consulta_atomica(
    p_tipo,
    v_clase_id,
    p_user_id,
    p_cobrar_saldo,
    v_effective_producto,
    v_effective_lookup,
    v_effective_origen,
    v_effective_notas
  );

  RETURN v_clase_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reservar_consulta_virtual(text, bigint, timestamptz, uuid, boolean, text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reservar_consulta_virtual(text, bigint, timestamptz, uuid, boolean, text, text, text, text) TO authenticated, service_role;

-- 5. Función de asignación administrativa directa
CREATE OR REPLACE FUNCTION public.admin_asignar_consulta_paciente(
  p_tipo text,
  p_clase_id bigint,
  p_user_id uuid,
  p_cobrar_saldo boolean DEFAULT false,
  p_notas text DEFAULT NULL::text,
  p_producto_contratado text DEFAULT NULL::text,
  p_stripe_lookup_key text DEFAULT NULL::text,
  p_origen_pago text DEFAULT 'local'::text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_reservation_id bigint;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  SELECT lower(trim(coalesce(rol, '')))
    INTO v_actor_role
    FROM public.profiles
   WHERE id = v_actor_id;

  IF NOT FOUND OR v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'unauthorized: staff or admin role required';
  END IF;

  v_reservation_id := public.reservar_consulta_atomica(
    p_tipo,
    p_clase_id,
    p_user_id,
    p_cobrar_saldo,
    p_producto_contratado,
    p_stripe_lookup_key,
    COALESCE(p_origen_pago, 'local'),
    p_notas
  );

  RETURN v_reservation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_asignar_consulta_paciente(text, bigint, uuid, boolean, text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_asignar_consulta_paciente(text, bigint, uuid, boolean, text, text, text, text) TO authenticated, service_role;

-- 6. Función de creación/recuperación de usuario temporal (usando columna 'bonos' en profiles)
CREATE OR REPLACE FUNCTION public.admin_crear_o_obtener_usuario_temporal(
  p_nombre text,
  p_apellidos text DEFAULT '',
  p_email text DEFAULT NULL,
  p_telefono text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_user_id uuid;
  v_clean_email text;
  v_clean_nombre text;
  v_clean_apellidos text;
  v_clean_telefono text;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  SELECT lower(trim(coalesce(rol, '')))
    INTO v_actor_role
    FROM public.profiles
   WHERE id = v_actor_id;

  IF NOT FOUND OR v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'unauthorized: staff or admin role required';
  END IF;

  v_clean_nombre := trim(coalesce(p_nombre, ''));
  IF v_clean_nombre = '' THEN
    RAISE EXCEPTION 'El nombre es obligatorio';
  END IF;

  v_clean_apellidos := trim(coalesce(p_apellidos, ''));
  v_clean_telefono := trim(coalesce(p_telefono, ''));
  v_clean_email := lower(trim(coalesce(p_email, '')));

  -- 1. Si se proporciona email y ya existe en profiles, retornar su id y actualizar datos
  IF v_clean_email <> '' THEN
    SELECT id INTO v_user_id
      FROM public.profiles
     WHERE lower(trim(email)) = v_clean_email
     LIMIT 1;

    IF v_user_id IS NOT NULL THEN
      UPDATE public.profiles
         SET
           nombre = coalesce(nullif(nombre, ''), v_clean_nombre),
           apellidos = coalesce(nullif(apellidos, ''), v_clean_apellidos),
           telefono = coalesce(nullif(telefono, ''), v_clean_telefono)
       WHERE id = v_user_id;

      RETURN v_user_id;
    END IF;
  ELSE
    -- Generar email ficticio temporal único si no se aportó
    v_clean_email := 'paciente.' || substr(md5(random()::text || clock_timestamp()::text), 1, 10) || '@temporal.genyoga.studio';
  END IF;

  -- 2. Crear nuevo perfil temporal/rápido con la columna correcta 'bonos'
  v_user_id := gen_random_uuid();

  INSERT INTO public.profiles (
    id,
    nombre,
    apellidos,
    email,
    telefono,
    rol,
    bonos,
    saldo_psicologia,
    saldo_nutricion,
    activo
  ) VALUES (
    v_user_id,
    v_clean_nombre,
    v_clean_apellidos,
    v_clean_email,
    v_clean_telefono,
    'cliente',
    0,
    0,
    0,
    true
  );

  RETURN v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_crear_o_obtener_usuario_temporal(text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_crear_o_obtener_usuario_temporal(text, text, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- Migration 202609020098: Unificar Reservas Yoga en Compañía y Usuarios Temporales
-- ============================================================================

BEGIN;

-- 1. Añadir columna parent_reserva_id para vincular reservas de acompañantes al titular
ALTER TABLE public.reservas_yoga
  ADD COLUMN IF NOT EXISTS parent_reserva_id bigint REFERENCES public.reservas_yoga(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS reservas_yoga_parent_reserva_idx
  ON public.reservas_yoga(parent_reserva_id);

-- 2. Actualizar función de RLS para que el titular pueda ver las reservas de sus acompañantes
CREATE OR REPLACE FUNCTION public.puede_ver_reserva_clase(p_user_id uuid, p_clase_id bigint)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_actor_email text;
  v_actor_deletion_pending boolean;
BEGIN
  IF v_actor_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT lower(trim(coalesce(profile.rol, ''))),
         lower(nullif(trim(profile.email), '')),
         coalesce(profile.account_deletion_pending, false)
    INTO v_actor_role, v_actor_email, v_actor_deletion_pending
    FROM public.profiles AS profile
   WHERE profile.id = v_actor_id
     AND coalesce(profile.activo, true);

  IF NOT FOUND OR v_actor_deletion_pending THEN
    RETURN false;
  END IF;

  -- El propio usuario
  IF v_actor_id = p_user_id THEN
    RETURN true;
  END IF;

  -- Admins
  IF v_actor_role = 'admin' THEN
    RETURN true;
  END IF;

  -- El titular que invitó a este usuario acompañante
  IF EXISTS (
    SELECT 1 FROM public.reservas_yoga
     WHERE clase_id = p_clase_id
       AND user_id = p_user_id
       AND beneficio_invitado_de = v_actor_id
  ) THEN
    RETURN true;
  END IF;

  -- Profesores y trabajadores asignados a la clase
  IF v_actor_role NOT IN ('profesor', 'trabajador', 'profesional')
    OR v_actor_email IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
      FROM public.clases AS class
      JOIN public.profesionales AS professional
        ON professional.id = class.profesor_id
     WHERE class.id = p_clase_id
       AND lower(nullif(trim(professional.email), '')) = v_actor_email
  );
END;
$function$;

-- 3. Función atómica para reservar Yoga en Compañía con reservas individuales y perfiles temporales
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
  v_titular_name text;
  v_titular_reserva_id bigint;
  v_relationship_label text;
  v_comp_elem jsonb;
  v_comp_user_id uuid;
  v_comp_email text;
  v_comp_nombre text;
  v_comp_apellidos text;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para reservar.' USING errcode = '42501';
  END IF;

  SELECT lower(coalesce(p.rol, ''))
    INTO v_actor_role
    FROM public.profiles p
   WHERE p.id = v_actor_id;

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

  -- Calcular plazas y etiquetas de parentesco según modalidad
  IF v_companion_modality = 'colegas' THEN
    v_required_spots := greatest(3, least(coalesce(p_num_plazas, 3), 4));
    v_relationship_label := 'Colega';
    IF v_companion_name = '' THEN
      RAISE EXCEPTION 'Para reservar Yoga con Colegas debes indicar los nombres de tus amigos (tú + 2 o 3 amigos).' USING errcode = '22023';
    END IF;
  ELSE
    v_required_spots := 2;
    IF v_companion_modality IN ('hijo', 'madre_hija') THEN
      v_relationship_label := 'Hijo/a';
    ELSIF v_companion_modality IN ('abuela', 'abuela_nieta') THEN
      v_relationship_label := 'Abuela/Nieta';
    ELSIF v_companion_modality = 'pareja' THEN
      v_relationship_label := 'Pareja';
    ELSE
      v_relationship_label := 'Acompañante';
    END IF;

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

  -- Verificar aforo disponible (cada reserva confirmada cuenta como 1 plaza)
  SELECT count(*)::integer
    INTO v_occupied
    FROM public.reservas_yoga
   WHERE clase_id = p_clase_id AND estado = 'confirmada';

  IF v_occupied + v_required_spots > v_capacity THEN
    RAISE EXCEPTION 'Esta sesión de Yoga en Compañía requiere % plazas libres y actualmente solo quedan % disponibles.',
      v_required_spots, greatest(0, v_capacity - v_occupied) USING errcode = 'P0001';
  END IF;

  -- Descontar exactamente 1 bono de Yoga en Compañía al titular
  UPDATE public.profiles
     SET saldo_yoga_compania = coalesce(saldo_yoga_compania, 0) - 1
   WHERE id = p_user_id AND coalesce(saldo_yoga_compania, 0) >= 1;
  IF NOT FOUND AND v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'No dispones de un bono de Yoga en Compañía activo.' USING errcode = 'P0001';
  END IF;

  -- Obtener nombre del titular para el parentesco
  SELECT coalesce(nullif(trim(coalesce(p.nombre, '') || ' ' || coalesce(p.apellidos, '')), ''), 'Alumno')
    INTO v_titular_name
    FROM public.profiles p
   WHERE p.id = p_user_id;

  -- 1. Insertar reserva del titular (1 plaza individual)
  INSERT INTO public.reservas_yoga (
    clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
    class_pack_id, saldo_gratis_descontado, num_plazas, num_plazas_reservadas,
    tipo_reserva, nombre_acompanante, welcome_companion_modality
  ) VALUES (
    p_clase_id, p_user_id, 'confirmada', false, false,
    null, true, 1, 1,
    'compania', v_companion_name, nullif(trim(v_companion_modality), '')
  ) RETURNING id INTO v_titular_reserva_id;

  -- 2. Normalizar lista de acompañantes
  IF jsonb_typeof(v_acompanantes_json) <> 'array' OR jsonb_array_length(v_acompanantes_json) = 0 THEN
    IF position(',' IN v_companion_name) > 0 THEN
      v_acompanantes_json := '[]'::jsonb;
      FOR v_comp_nombre IN SELECT trim(x) FROM unnest(string_to_array(v_companion_name, ',')) AS x LOOP
        IF v_comp_nombre <> '' THEN
          v_acompanantes_json := v_acompanantes_json || jsonb_build_object('nombre', v_comp_nombre);
        END IF;
      END LOOP;
    ELSE
      v_acompanantes_json := jsonb_build_array(jsonb_build_object('nombre', v_companion_name));
    END IF;
  END IF;

  -- 3. Crear usuario temporal y reserva individual para cada acompañante
  FOR v_comp_elem IN SELECT * FROM jsonb_array_elements(v_acompanantes_json) LOOP
    v_comp_user_id := gen_random_uuid();
    v_comp_email := 'companero+' || substr(md5(v_comp_user_id::text || clock_timestamp()::text), 1, 16) || '@genyoga.studio';
    v_comp_nombre := trim(coalesce(v_comp_elem->>'nombre', 'Acompañante'));
    v_comp_apellidos := v_relationship_label || ' de ' || v_titular_name;

    INSERT INTO public.profiles (
      id,
      email,
      nombre,
      apellidos,
      rol,
      activo,
      notas,
      saldo_yoga_compania,
      saldo_clases_gratis,
      saldo_consultas_gratis,
      bonos
    ) VALUES (
      v_comp_user_id,
      v_comp_email,
      v_comp_nombre,
      v_comp_apellidos,
      'invitado',
      true,
      'Acompañante (' || v_relationship_label || ') de ' || v_titular_name || ' en Yoga en Compañía',
      0, 0, 0, 0
    );

    INSERT INTO public.reservas_yoga (
      clase_id,
      user_id,
      estado,
      usado_bono_mensual,
      bono_descontado,
      class_pack_id,
      saldo_gratis_descontado,
      num_plazas,
      num_plazas_reservadas,
      tipo_reserva,
      welcome_companion_modality,
      beneficio_invitado_de,
      parent_reserva_id
    ) VALUES (
      p_clase_id,
      v_comp_user_id,
      'confirmada',
      false,
      false,
      null,
      true,
      1,
      1,
      'compania',
      nullif(trim(v_companion_modality), ''),
      p_user_id,
      v_titular_reserva_id
    );
  END LOOP;
END;
$$;

-- 4. Actualizar cancelación con bono para limpiar en cascada acompañantes y usuarios temporales
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
  v_companion_modality text;
  v_tipo_reserva text;
  v_pack_id bigint;
  v_starts_at timestamptz;
  v_class_type text;
  v_cancel_limit_hours integer := 24;
  v_allow_admin_override boolean := false;
  v_parent_id bigint;
  v_titular_reserva_id bigint;
  v_companion_uids uuid[];
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

  -- Si es reserva de acompañante (hija), referenciar a la titular (padre)
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
         welcome_companion_modality, tipo_reserva, class_pack_id
    INTO v_target_id, v_class_id, v_credit_debited,
         v_free_credit_debited, v_used_unlimited,
         v_companion_modality, v_tipo_reserva, v_pack_id
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

  -- Localizar usuarios temporales de acompañantes asociados para eliminarlos
  SELECT array_agg(user_id) INTO v_companion_uids
    FROM public.reservas_yoga
   WHERE parent_reserva_id = v_titular_reserva_id;

  -- Eliminar reservas de acompañantes
  DELETE FROM public.reservas_yoga WHERE parent_reserva_id = v_titular_reserva_id;

  -- Eliminar perfiles temporales de acompañantes
  IF v_companion_uids IS NOT NULL AND array_length(v_companion_uids, 1) > 0 THEN
    DELETE FROM public.profiles
     WHERE id = ANY(v_companion_uids)
       AND email LIKE 'companero+%';
  END IF;

  -- Eliminar reserva del titular
  DELETE FROM public.reservas_yoga WHERE id = v_titular_reserva_id;

  -- Reintegro del saldo correspondiente al titular
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
$function$;

-- 5. Actualizar get_public_weekly_schedule para unificar el conteo de ocupación real en todas las áreas
CREATE OR REPLACE FUNCTION public.get_public_weekly_schedule(p_week_start date)
RETURNS TABLE(
  id bigint,
  nombre text,
  fecha_inicio timestamp with time zone,
  fecha_fin timestamp with time zone,
  duracion_minutos integer,
  capacidad_max integer,
  profesor_id bigint,
  tipo_clase text,
  tipo_clase_id bigint,
  activa boolean,
  es_especial boolean,
  ocupadas bigint,
  plazas_libres bigint,
  completa boolean,
  profesor_nombre text,
  profesor_apellidos text,
  profesor_color text,
  profesor_visible_publico boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH confirmed_bookings AS (
    SELECT clase_id FROM public.reservas_yoga WHERE estado = 'confirmada'
    UNION ALL
    SELECT clase_id FROM public.reservas_psicologia WHERE estado = 'confirmada'
    UNION ALL
    SELECT clase_id FROM public.reservas_nutricion WHERE estado = 'confirmada'
  ), class_counts AS (
    SELECT clase_id, count(*)::bigint AS spots
    FROM confirmed_bookings
    GROUP BY clase_id
  )
  SELECT
    c.id,
    c.nombre,
    c.fecha_inicio,
    c.fecha_fin,
    c.duracion_minutos,
    CASE
      WHEN lower(trim(coalesce(c.tipo_clase, ''))) = 'yoga'
        THEN CASE WHEN c.capacidad_max > 0 AND c.capacidad_max <= 10 THEN c.capacidad_max ELSE 10 END
      ELSE greatest(0, coalesce(c.capacidad_max, 10))
    END AS capacidad_max,
    c.profesor_id,
    c.tipo_clase,
    c.tipo_clase_id,
    c.activa,
    coalesce(c.es_especial, false) AS es_especial,
    coalesce(cc.spots, 0)::bigint AS ocupadas,
    greatest(0, (
      CASE
        WHEN lower(trim(coalesce(c.tipo_clase, ''))) = 'yoga'
          THEN CASE WHEN c.capacidad_max > 0 AND c.capacidad_max <= 10 THEN c.capacidad_max ELSE 10 END
        ELSE greatest(0, coalesce(c.capacidad_max, 10))
      END
    ) - coalesce(cc.spots, 0))::bigint AS plazas_libres,
    (coalesce(cc.spots, 0) >= (
      CASE
        WHEN lower(trim(coalesce(c.tipo_clase, ''))) = 'yoga'
          THEN CASE WHEN c.capacidad_max > 0 AND c.capacidad_max <= 10 THEN c.capacidad_max ELSE 10 END
        ELSE greatest(0, coalesce(c.capacidad_max, 10))
      END
    )) AS completa,
    p.nombre AS profesor_nombre,
    p.apellidos AS profesor_apellidos,
    p.color AS profesor_color,
    coalesce(p.visible_publico, true) AS profesor_visible_publico
  FROM public.clases c
  LEFT JOIN public.profesionales p ON p.id = c.profesor_id
  LEFT JOIN class_counts cc ON cc.clase_id = c.id
  WHERE c.activa = true
    AND coalesce(p.visible_publico, true) = true
    AND (c.fecha_inicio AT TIME ZONE 'Europe/Madrid')::date >= p_week_start
    AND (c.fecha_inicio AT TIME ZONE 'Europe/Madrid')::date < p_week_start + 7
  ORDER BY c.fecha_inicio;
$function$;

-- 6. Actualizar obtener_ocupacion_clases para contar cada plaza individual
CREATE OR REPLACE FUNCTION public.obtener_ocupacion_clases(p_clase_ids bigint[])
RETURNS TABLE(clase_id bigint, ocupadas bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH requested_classes AS (
    SELECT class.id
      FROM public.clases AS class
     WHERE class.id = ANY(coalesce(p_clase_ids, array[]::bigint[]))
       AND class.activa IS true
       AND class.fecha_inicio >= now() - interval '2 hours'
       AND lower(trim(coalesce(class.tipo_clase, ''))) IN ('yoga', 'taller', 'especial', 'psicologia', 'nutricion')
  ), all_confirmed AS (
    SELECT r.clase_id FROM public.reservas_yoga r
     JOIN requested_classes req ON req.id = r.clase_id
     WHERE r.estado = 'confirmada'
    UNION ALL
    SELECT rp.clase_id FROM public.reservas_psicologia rp
     JOIN requested_classes req ON req.id = rp.clase_id
     WHERE rp.estado = 'confirmada'
    UNION ALL
    SELECT rn.clase_id FROM public.reservas_nutricion rn
     JOIN requested_classes req ON req.id = rn.clase_id
     WHERE rn.estado = 'confirmada'
  )
  SELECT all_confirmed.clase_id, count(*)::bigint AS ocupadas
    FROM all_confirmed
   GROUP BY all_confirmed.clase_id;
$function$;

GRANT EXECUTE ON FUNCTION public.reservar_con_bono_compania(bigint, uuid, text, integer, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancelar_con_bono(bigint) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_weekly_schedule(date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.obtener_ocupacion_clases(bigint[]) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

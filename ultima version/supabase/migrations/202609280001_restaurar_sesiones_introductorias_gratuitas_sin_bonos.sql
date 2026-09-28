-- ==============================================================================
-- Migración: 202609280001_restaurar_sesiones_introductorias_gratuitas_sin_bonos.sql
-- Descripción:
--   1. Actualizar reservar_con_bono para permitir reservas gratuitas directas a 0 €
--      en sesiones introductorias para cualquier usuario registrado sin consumir bonos.
--   2. Actualizar reservar_consulta_atomica para permitir reservas gratuitas directas a 0 €
--      en sesiones introductorias para cualquier usuario registrado sin consumir bonos.
--   3. Desactivar turnos individuales conflictivos de Isabel el 8 de octubre de 2026.
--   4. Crear la Sesión Introductoria a la Psiconeuroinmunología de Isabel el 8 de octubre de 2026 (17:45-18:45).
-- ==============================================================================

BEGIN;

-- 1. Actualizar reservar_con_bono
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

  -- Comprobar si el usuario ya tiene reserva confirmada en esta clase (en yoga o psicologia)
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
    SELECT id INTO v_reprog_credit_id
      FROM public.creditos_reprogramacion
     WHERE user_id = p_user_id
       AND tipo = 'taller'
       AND estado = 'disponible'
     ORDER BY created_at ASC, id ASC
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

    IF v_is_staff THEN
      INSERT INTO public.reservas_yoga
        (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, tipo_reserva)
      VALUES (p_clase_id, p_user_id, 'confirmada', false, false, 'manual_admin');
      RETURN;
    END IF;

    RAISE EXCEPTION 'Los talleres se reservan mediante plaza individual (o crédito de reprogramación disponible).'
      USING errcode = 'P0001';
  END IF;

  -- CASO B: EVENTO CLASE ESPECIAL
  IF v_class_type = 'clase_especial' OR (v_is_special AND v_class_type <> 'yoga') THEN
    SELECT id INTO v_special_bonus_id
      FROM public.bonos_clases_especiales
     WHERE user_id = p_user_id
       AND mes = v_class_month
       AND saldo > 0
     ORDER BY id ASC
     LIMIT 1 FOR UPDATE;

    IF v_special_bonus_id IS NOT NULL THEN
      UPDATE public.bonos_clases_especiales
         SET saldo = saldo - 1,
             updated_at = now()
       WHERE id = v_special_bonus_id AND saldo > 0;

      INSERT INTO public.reservas_yoga
        (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, tipo_reserva)
      VALUES (p_clase_id, p_user_id, 'confirmada', false, true, 'clase_especial');
      RETURN;
    END IF;

    IF v_is_staff THEN
      INSERT INTO public.reservas_yoga
        (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, tipo_reserva)
      VALUES (p_clase_id, p_user_id, 'confirmada', false, false, 'manual_admin');
      RETURN;
    END IF;

    RAISE EXCEPTION 'Esta clase especial requiere un Bono de Clase Especial de % (20 € o incluido con Bono Ilimitado).',
      to_char(v_class_month, 'TMMonth YYYY') USING errcode = 'P0001';
  END IF;

  -- CASO 0: CLASE GRATUITA / INTRODUCTORIA (100% Gratuita, sin requerir ni consumir bonos)
  IF (v_is_free OR v_class_name ~* 'introductor')
     AND NOT v_is_special
     AND NOT (v_class_name ~* '(taller|masterclass|especial)') THEN

    INSERT INTO public.reservas_yoga
      (clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
       class_pack_id, saldo_gratis_descontado, tipo_reserva)
    VALUES (p_clase_id, p_user_id, 'confirmada', false, false, null, false, 'gratuita');
    RETURN;
  END IF;

  -- CASO C: CLASES NORMALES DE YOGA
  -- 1. Bono de Bienvenida
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

  -- 2. Bono Ilimitado
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

  -- 3. Packs de Clases Normales
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

  -- 5. Staff
  IF v_is_staff THEN
    INSERT INTO public.reservas_yoga
      (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id, tipo_reserva)
    VALUES (p_clase_id, p_user_id, 'confirmada', false, false, null, 'manual_admin');
    RETURN;
  END IF;

  RAISE EXCEPTION 'No tienes bonos de clases normales disponibles ni Bono Ilimitado activo.' USING errcode = 'P0001';
END;
$function$;

-- 2. Actualizar reservar_consulta_atomica
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
  v_is_group boolean := false;
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

  -- Determinar si es sesión grupal
  v_is_group := (v_capacity > 1 OR v_name LIKE '%autoayuda%' OR v_name LIKE '%terap%' OR v_name LIKE '%grupo%' OR v_class_type = 'consulta_grupal');

  -- Permisos de gestión para staff
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

  -- Comprobar si ya está reservada por este usuario (en psicologia, nutricion o yoga)
  IF p_tipo = 'psicologia' THEN
    IF EXISTS (
      SELECT 1 FROM public.reservas_psicologia
       WHERE clase_id = p_clase_id
         AND user_id = v_target_id
         AND estado = 'confirmada'
    ) OR EXISTS (
      SELECT 1 FROM public.reservas_yoga
       WHERE clase_id = p_clase_id
         AND user_id = v_target_id
         AND estado = 'confirmada'
    ) THEN
      RAISE EXCEPTION 'consultation already booked' USING errcode = '23505';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.reservas_nutricion
       WHERE clase_id = p_clase_id
         AND user_id = v_target_id
         AND estado = 'confirmada'
    ) OR EXISTS (
      SELECT 1 FROM public.reservas_yoga
       WHERE clase_id = p_clase_id
         AND user_id = v_target_id
         AND estado = 'confirmada'
    ) THEN
      RAISE EXCEPTION 'consultation already booked' USING errcode = '23505';
    END IF;
  END IF;

  -- Calcular ocupación total
  SELECT (
    coalesce((SELECT count(*) FROM public.reservas_psicologia WHERE clase_id = p_clase_id AND estado = 'confirmada'), 0)
    +
    coalesce((SELECT count(*) FROM public.reservas_nutricion WHERE clase_id = p_clase_id AND estado = 'confirmada'), 0)
    +
    coalesce((SELECT sum(greatest(coalesce(num_plazas_reservadas, 1), coalesce(num_plazas, 1), 1)) FROM public.reservas_yoga WHERE clase_id = p_clase_id AND estado = 'confirmada'), 0)
  )::integer INTO v_occupied;

  IF v_occupied >= v_capacity THEN
    RAISE EXCEPTION 'consultation is full' USING errcode = 'P0001';
  END IF;

  v_no_charge := NOT coalesce(p_cobrar_saldo, true);

  -- Regla: sesiones introductorias o marcadas como gratuitas
  IF (v_is_free OR v_name LIKE '%introduct%') THEN
    v_is_free := true;
  END IF;

  -- Determinar producto por defecto si no viene especificado
  IF v_effective_producto = '' THEN
    IF v_is_free THEN
      v_effective_producto := 'Sesión Introductoria Gratuita (0 €)';
    ELSIF v_is_group THEN
      v_effective_producto := 'Sesión Grupal (30 €)';
    ELSE
      SELECT coalesce(metodo_pago, 'Consulta ' || initcap(p_tipo)) INTO v_effective_producto
        FROM public.clases WHERE id = p_clase_id;
      IF v_effective_producto IS NULL OR v_effective_producto = '' THEN
        v_effective_producto := 'Consulta ' || initcap(p_tipo);
      END IF;
    END IF;
  END IF;

  -- Actualizar clase con producto/lookup si viene especificado y NO es sesión grupal
  IF NOT v_is_group THEN
    UPDATE public.clases
       SET metodo_pago = COALESCE(NULLIF(v_effective_producto, ''), metodo_pago),
           stripe_lookup_key = COALESCE(NULLIF(v_effective_lookup, ''), stripe_lookup_key)
     WHERE id = p_clase_id;
  END IF;

  -- ============================================================================
  -- CASO SESIÓN GRATUITA / INTRODUCTORIA (100% Gratuita, sin requerir ni consumir bonos)
  -- ============================================================================
  IF v_is_free THEN
    IF p_tipo = 'psicologia' THEN
      INSERT INTO public.reservas_psicologia (
        clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado,
        producto_contratado, stripe_lookup_key, origen_pago, notas
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, false,
        v_effective_producto, coalesce(nullif(v_effective_lookup, ''), 'gratuita'), v_effective_origen, v_effective_notas
      ) RETURNING id INTO v_reservation_id;
    ELSE
      INSERT INTO public.reservas_nutricion (
        clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado,
        producto_contratado, stripe_lookup_key, origen_pago, notas
      ) VALUES (
        p_clase_id, v_target_id, 'confirmada', false, false,
        v_effective_producto, coalesce(nullif(v_effective_lookup, ''), 'gratuita'), v_effective_origen, v_effective_notas
      ) RETURNING id INTO v_reservation_id;
    END IF;
    RETURN v_reservation_id;
  END IF;

  v_charge_credit := NOT v_no_charge;

  IF v_charge_credit THEN
    IF v_is_group THEN
      UPDATE public.profiles
         SET saldo_grupal = saldo_grupal - 1
       WHERE id = v_target_id
         AND saldo_grupal >= 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'insufficient group session credit' USING errcode = 'P0001';
      END IF;
    ELSIF p_tipo = 'psicologia' THEN
      UPDATE public.profiles
         SET saldo_psicologia = saldo_psicologia - 1
       WHERE id = v_target_id
         AND saldo_psicologia >= 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'insufficient psychology credit' USING errcode = 'P0001';
      END IF;
    ELSIF p_tipo = 'nutricion' THEN
      UPDATE public.profiles
         SET saldo_nutricion = saldo_nutricion - 1
       WHERE id = v_target_id
         AND saldo_nutricion >= 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'insufficient nutrition credit' USING errcode = 'P0001';
      END IF;
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

-- 3. Desactivar turnos individuales conflictivos de Isabel el 8 de octubre de 2026 (17:00 a 19:00 CEST)
UPDATE public.clases
   SET activa = false
 WHERE profesor_id = 28
   AND id IN (6524, 6968);

-- 4. Crear la Sesión Introductoria a la Psiconeuroinmunología de Isabel el 8 de octubre de 2026 (17:45 a 18:45 CEST)
INSERT INTO public.clases (
  nombre,
  fecha_inicio,
  fecha_fin,
  duracion_minutos,
  capacidad_max,
  profesor_id,
  tipo_clase,
  tipo_clase_id,
  es_gratuita,
  activa,
  es_especial,
  nivel,
  descripcion,
  metodo_pago
)
SELECT
  'Sesión Introductoria a la Psiconeuroinmunología',
  '2026-10-08 15:45:00+00'::timestamptz,
  '2026-10-08 16:45:00+00'::timestamptz,
  60,
  10,
  28,
  'psicologia',
  48,
  true,
  true,
  false,
  'todos los niveles',
  'Sesión introductoria y gratuita de Psiconeuroinmunología con Isabel',
  'gratuita'
WHERE NOT EXISTS (
  SELECT 1 FROM public.clases
   WHERE profesor_id = 28
     AND fecha_inicio = '2026-10-08 15:45:00+00'::timestamptz
);

-- 5. Permisos
REVOKE ALL ON FUNCTION public.reservar_consulta_atomica(text, bigint, uuid, boolean, text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reservar_consulta_atomica(text, bigint, uuid, boolean, text, text, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean, boolean, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reservar_con_bono(bigint, uuid, boolean, boolean, boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

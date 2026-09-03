-- ==============================================================================
-- GEN YOGA - Versión 11.10: Corrección del error "starts_at does not exist"
-- ==============================================================================
-- El error ocurre cuando se intenta reservar con un bono normal. El problema es que
-- las funciones de reserva usan el alias v_starts_at pero luego intentan acceder a starts_at
-- directamente sin el alias en las consultas de class_credit_packs.
-- ==============================================================================

-- Corregir la función reservar_con_bono para usar el alias correcto
CREATE OR REPLACE FUNCTION public.reservar_con_bono(p_clase_id uuid, p_user_id uuid, p_tipo_saldo text)
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
  v_marked_free boolean;
  v_is_special boolean;
  v_companion_modality text;
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_pack_id uuid;
  v_unlimited boolean := false;
  v_special_count integer := 0;
  v_especial_used boolean := false;
  v_guest_used boolean := false;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'No se encontró el perfil del alumno.'; END IF;
  
  SELECT lower(trim(coalesce(rol, ''))) INTO v_target_role
    FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el perfil del alumno.'; END IF;
  IF v_target_role IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'Solo los alumnos pueden reservar clases.' USING errcode = '42501';
  END IF;

  SELECT coalesce(capacidad_max, 10), fecha_inicio, nombre,
         lower(trim(coalesce(nullif(tipo_clase, ''), 'yoga'))),
         coalesce(activa, true), coalesce(es_gratuita, false),
         coalesce(es_especial, false),
         companion_modality
    INTO v_capacity, v_starts_at, v_class_name, v_class_type,
         v_class_active, v_marked_free, v_is_special, v_companion_modality
    FROM public.clases WHERE id = p_clase_id FOR UPDATE;
  IF NOT FOUND OR NOT v_class_active OR v_class_type NOT IN ('yoga', 'taller') THEN
    RAISE EXCEPTION 'La clase especificada no está disponible.' USING errcode = 'P0002';
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

  -- Si se solicita usar bono gratuito, validar disponibilidad
  IF p_tipo_saldo = 'gratis' THEN
    SELECT count(*)::integer INTO v_free_credits
      FROM public.reservas_yoga r
      JOIN public.clases c ON c.id = r.clase_id
     WHERE r.user_id = p_user_id
       AND r.estado = 'confirmada'
       AND r.saldo_gratis_descontado = true
       AND c.fecha_inicio > now();
    
    IF v_free_credits = 0 THEN
      RAISE EXCEPTION 'No tienes saldo de clases gratuitas disponible.' USING errcode = '22023';
    END IF;
  END IF;

  -- Comprobar cobertura real del Bono Ilimitado para la fecha de la clase.
  SELECT starts_at, ends_at INTO v_month_start, v_month_end
    FROM public.unlimited_membership_periods
   WHERE user_id = p_user_id AND starts_at <= v_starts_at AND ends_at > v_starts_at
   ORDER BY starts_at DESC LIMIT 1 FOR SHARE;
  IF FOUND AND v_class_type <> 'taller' AND NOT v_is_special THEN
    v_unlimited := true;
  ELSIF FOUND AND (v_class_type = 'taller' OR v_is_special) THEN
    SELECT count(*)::integer INTO v_special_count
      FROM public.reservas_yoga r
      JOIN public.clases c ON c.id = r.clase_id
     WHERE r.user_id = p_user_id
       AND r.estado = 'confirmada'
       AND r.usado_bono_mensual = true
       AND (c.tipo_clase = 'taller' OR c.es_especial = true)
       AND c.fecha_inicio >= v_month_start
       AND c.fecha_inicio < v_month_end;
    IF v_special_count = 0 THEN
      INSERT INTO public.reservas_yoga
        (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id)
      VALUES (p_clase_id, p_user_id, 'confirmada', true, false, null);
      RETURN;
    END IF;
  END IF;

  -- Deducción desde packs de clases regulares (CORREGIDO: usar v_starts_at en lugar de starts_at)
  SELECT id INTO v_pack_id
    FROM public.class_credit_packs
   WHERE user_id = p_user_id
     AND starts_at <= v_starts_at
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
         SET bonos = coalesce(bonos, 0) - 1
       WHERE id = p_user_id;
      INSERT INTO public.reservas_yoga
        (clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id)
      VALUES (p_clase_id, p_user_id, 'confirmada', false, false, v_pack_id);
      RETURN;
    END IF;
  END IF;

  -- Si no hay bonos disponibles, rechazar la reserva
  RAISE EXCEPTION 'No tienes créditos suficientes para reservar esta clase.' USING errcode = '22023';
END;
$$;

-- Permisos
REVOKE ALL ON FUNCTION public.reservar_con_bono(uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.reservar_con_bono(uuid, uuid, text) TO authenticated;

-- Migration 202609020055: Borrado robusto de clases con devolucion automatica y purga de festivos
-- ==============================================================================================
-- Permite que los administradores eliminen clases con alumnos asignados devolviendo automaticamente
-- todos los tipos de bonos (sueltas, gratis, compania, packs) y eliminando las dependencias foraneas.
-- ==============================================================================================

begin;

CREATE OR REPLACE FUNCTION public.admin_eliminar_clase(
  p_clase_id bigint
)
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
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, '')))
    INTO v_actor_role
    FROM public.profiles
   WHERE id = v_actor_id;

  IF v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'Solo los administradores o profesores pueden eliminar clases.' USING errcode = '42501';
  END IF;

  SELECT nombre INTO v_class_name
    FROM public.clases
   WHERE id = p_clase_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'clase_id', p_clase_id, 'alumnos_reembolsados', 0);
  END IF;

  -- 1. Procesar todas las reservas confirmadas de Yoga y devolver los bonos a los alumnos
  FOR v_booking IN (
    SELECT id, user_id, class_pack_id,
           coalesce(bono_descontado, false) as bono_descontado,
           coalesce(saldo_gratis_descontado, false) as saldo_gratis_descontado,
           welcome_companion_modality,
           coalesce(num_plazas_reservadas, 1) as num_plazas
      FROM public.reservas_yoga
     WHERE clase_id = p_clase_id
       AND estado = 'confirmada'
  ) LOOP
    IF v_booking.welcome_companion_modality IS NOT NULL THEN
      UPDATE public.profiles
         SET saldo_yoga_compania = coalesce(saldo_yoga_compania, 0) + 1
       WHERE id = v_booking.user_id;
    ELSIF v_booking.class_pack_id IS NOT NULL THEN
      UPDATE public.class_credit_packs
         SET credits_remaining = credits_remaining + coalesce(v_booking.num_plazas, 1),
             updated_at = now()
       WHERE id = v_booking.class_pack_id;
    ELSIF v_booking.saldo_gratis_descontado THEN
      UPDATE public.profiles
         SET saldo_clases_gratis = coalesce(saldo_clases_gratis, 0) + 1
       WHERE id = v_booking.user_id;
    ELSIF v_booking.bono_descontado THEN
      UPDATE public.profiles
         SET bonos = coalesce(bonos, 0) + coalesce(v_booking.num_plazas, 1)
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

  -- 3. Eliminar todas las dependencias foráneas de la clase
  DELETE FROM public.unlimited_guest_passes WHERE clase_id = p_clase_id;
  DELETE FROM public.reservas_talleres WHERE taller_id = p_clase_id;
  DELETE FROM public.reservas_yoga WHERE clase_id = p_clase_id;
  DELETE FROM public.reservas_psicologia WHERE clase_id = p_clase_id;
  DELETE FROM public.reservas_nutricion WHERE clase_id = p_clase_id;

  -- 4. Eliminar la clase definitivamente
  DELETE FROM public.clases WHERE id = p_clase_id;

  RETURN jsonb_build_object(
    'success', true,
    'clase_id', p_clase_id,
    'alumnos_reembolsados', v_refunded_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_eliminar_clase(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_eliminar_clase(bigint) TO anon, authenticated, service_role;

-- Funcion para eliminar todas las clases de una fecha festiva
CREATE OR REPLACE FUNCTION public.eliminar_clases_en_festivo(p_fecha date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_clase record;
  v_total_eliminadas integer := 0;
BEGIN
  FOR v_clase IN (
    SELECT id
      FROM public.clases
     WHERE (fecha_inicio AT TIME ZONE 'Europe/Madrid')::date = p_fecha
  ) LOOP
    PERFORM public.admin_eliminar_clase(v_clase.id);
    v_total_eliminadas := v_total_eliminadas + 1;
  END LOOP;

  RETURN v_total_eliminadas;
END;
$function$;

REVOKE ALL ON FUNCTION public.eliminar_clases_en_festivo(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eliminar_clases_en_festivo(date) TO anon, authenticated, service_role;

-- Purga de seguridad: eliminar cualquier clase del 8 de septiembre de 2026 (festivo Virgen de los Llanos)
DO 
DECLARE
  v_clase record;
BEGIN
  FOR v_clase IN (
    SELECT id
      FROM public.clases
     WHERE (fecha_inicio AT TIME ZONE 'Europe/Madrid')::date = '2026-09-08'
  ) LOOP
    PERFORM public.admin_eliminar_clase(v_clase.id);
  END LOOP;
END ;

NOTIFY pgrst, 'reload schema';

commit;

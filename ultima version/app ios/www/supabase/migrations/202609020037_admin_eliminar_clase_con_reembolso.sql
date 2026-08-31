-- ==============================================================================
-- Migración: Función admin_eliminar_clase con devolución automática de bonos
-- Fecha: 2026-09-02
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.admin_eliminar_clase(
  p_clase_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
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
    RAISE EXCEPTION 'La clase no existe o ya fue eliminada.' USING errcode = 'P0002';
  END IF;

  -- 1. Procesar todas las reservas confirmadas de Yoga y devolver los bonos a los alumnos
  FOR v_booking IN (
    SELECT id, user_id, class_pack_id, coalesce(bono_descontado, false) as bono_descontado,
           coalesce(saldo_gratis_descontado, false) as saldo_gratis_descontado
      FROM public.reservas_yoga
     WHERE clase_id = p_clase_id
       AND estado = 'confirmada'
  ) LOOP
    IF v_booking.class_pack_id IS NOT NULL THEN
      UPDATE public.class_credit_packs
         SET credits_remaining = credits_remaining + 1,
             updated_at = now()
       WHERE id = v_booking.class_pack_id;
    ELSIF v_booking.saldo_gratis_descontado THEN
      UPDATE public.profiles
         SET saldo_clases_gratis = coalesce(saldo_clases_gratis, 0) + 1
       WHERE id = v_booking.user_id;
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
    'alumnos_reembolsados', v_refunded_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_eliminar_clase(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_eliminar_clase(bigint) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Migration 202609020100: Retornar parent_reserva_id en admin_obtener_asistencias_completas
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.admin_obtener_asistencias_completas(bigint[]);

CREATE OR REPLACE FUNCTION public.admin_obtener_asistencias_completas(p_clase_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(
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
   acompanantes jsonb,
   parent_reserva_id bigint
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    coalesce(r.acompanantes, '[]'::jsonb) AS acompanantes,
    r.parent_reserva_id
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
    '[]'::jsonb AS acompanantes,
    null::bigint AS parent_reserva_id
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
    '[]'::jsonb AS acompanantes,
    null::bigint AS parent_reserva_id
  FROM public.reservas_nutricion rn
  LEFT JOIN public.profiles p ON p.id = rn.user_id
  WHERE rn.estado = 'confirmada'
    AND (p_clase_ids IS NULL OR rn.clase_id = ANY(p_clase_ids));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_obtener_asistencias_completas(bigint[]) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

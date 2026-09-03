-- ==============================================================================
-- Migración 202609020083: Detalle del método de reserva en asistencias
-- Versión: 9.24
-- Descripción:
--   Extiende la función RPC public.admin_obtener_asistencias_completas para
--   devolver la modalidad con la que cada usuario reservó su plaza:
--   - usado_bono_mensual (Bono Ilimitado / suscripción)
--   - bono_descontado (Bono normal / pack de clases)
--   - saldo_gratis_descontado (Bono gratuito promocional / bienvenida)
--   - welcome_companion_modality ('compania', 'bienvenida')
--   - class_pack_id (identificador del pack de clases)
--   - beneficio_invitado_de (pase de invitado de Bono Ilimitado)
--   Permite a profesores y administradores ver con total transparencia
--   el origen de cada plaza reservada en la clase.
-- ==============================================================================

DROP FUNCTION IF EXISTS public.admin_obtener_asistencias_completas(bigint[]) CASCADE;

CREATE OR REPLACE FUNCTION public.admin_obtener_asistencias_completas(
  p_clase_ids bigint[] default null
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
  beneficio_invitado_de uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
BEGIN
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
    r.beneficio_invitado_de
  FROM public.reservas_yoga r
  LEFT JOIN public.profiles p ON p.id = r.user_id
  WHERE (p_clase_ids IS NULL OR r.clase_id = ANY(p_clase_ids))
    AND r.estado = 'confirmada'

  UNION ALL

  SELECT
    r.id AS reserva_id,
    r.clase_id,
    r.user_id,
    'psicologia'::text AS tipo_clase,
    r.estado::text,
    coalesce(nullif(trim(p.nombre), ''), 'Alumno') AS nombre,
    coalesce(nullif(trim(p.apellidos), ''), '') AS apellidos,
    coalesce(nullif(trim(p.email), ''), '') AS email,
    coalesce(nullif(trim(p.telefono), ''), '') AS telefono,
    coalesce(p.auth_method, '') AS auth_method,
    p.fecha_nacimiento,
    coalesce(p.rol, 'alumno') AS rol,
    false AS usado_bono_mensual,
    coalesce(r.saldo_descontado, false) AS bono_descontado,
    coalesce(r.saldo_gratis_descontado, false) AS saldo_gratis_descontado,
    null::text AS welcome_companion_modality,
    null::bigint AS class_pack_id,
    null::uuid AS beneficio_invitado_de
  FROM public.reservas_psicologia r
  LEFT JOIN public.profiles p ON p.id = r.user_id
  WHERE (p_clase_ids IS NULL OR r.clase_id = ANY(p_clase_ids))
    AND r.estado = 'confirmada'

  UNION ALL

  SELECT
    r.id AS reserva_id,
    r.clase_id,
    r.user_id,
    'nutricion'::text AS tipo_clase,
    r.estado::text,
    coalesce(nullif(trim(p.nombre), ''), 'Alumno') AS nombre,
    coalesce(nullif(trim(p.apellidos), ''), '') AS apellidos,
    coalesce(nullif(trim(p.email), ''), '') AS email,
    coalesce(nullif(trim(p.telefono), ''), '') AS telefono,
    coalesce(p.auth_method, '') AS auth_method,
    p.fecha_nacimiento,
    coalesce(p.rol, 'alumno') AS rol,
    false AS usado_bono_mensual,
    coalesce(r.saldo_descontado, false) AS bono_descontado,
    coalesce(r.saldo_gratis_descontado, false) AS saldo_gratis_descontado,
    null::text AS welcome_companion_modality,
    null::bigint AS class_pack_id,
    null::uuid AS beneficio_invitado_de
  FROM public.reservas_nutricion r
  LEFT JOIN public.profiles p ON p.id = r.user_id
  WHERE (p_clase_ids IS NULL OR r.clase_id = ANY(p_clase_ids))
    AND r.estado = 'confirmada';
END;
$func$;

REVOKE ALL ON FUNCTION public.admin_obtener_asistencias_completas(bigint[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_obtener_asistencias_completas(bigint[]) TO authenticated, anon, service_role;

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';

-- Migración v12.4: Ocupación de clases especiales y talleres en RPC
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
       AND lower(trim(coalesce(class.tipo_clase, ''))) IN ('yoga', 'taller', 'especial', 'clase_especial', 'psicologia', 'nutricion')
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

GRANT EXECUTE ON FUNCTION public.obtener_ocupacion_clases(bigint[]) TO anon, authenticated, service_role;

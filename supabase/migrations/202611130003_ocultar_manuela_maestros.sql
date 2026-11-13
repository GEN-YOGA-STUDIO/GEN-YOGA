-- Migración: Ocultar a Manuela de maestros.html y permitir clases activas de profesores no visibles
-- Fecha: 2026-11-13

-- 1. Actualizar visibilidad de Manuela en la tabla profesionales
UPDATE public.profesionales
SET visible_publico = false
WHERE id = 41 OR (lower(nombre) = 'manuela' AND visible_publico = true);

-- 2. Actualizar get_public_weekly_schedule para que las clases y talleres activos
-- se muestren en el calendario incluso si el profesor tiene visible_publico = false (ej. profesores colaboradores/eventos puntuales)
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
    AND (
      c.tipo_clase IN ('yoga', 'taller', 'clase_especial', 'especial')
      OR coalesce(c.es_especial, false) = true
      OR coalesce(p.visible_publico, true) = true
    )
    AND (c.fecha_inicio AT TIME ZONE 'Europe/Madrid')::date >= p_week_start
    AND (c.fecha_inicio AT TIME ZONE 'Europe/Madrid')::date < p_week_start + 7
  ORDER BY c.fecha_inicio;
$function$;

REVOKE ALL ON FUNCTION public.get_public_weekly_schedule(date) FROM public;
GRANT EXECUTE ON FUNCTION public.get_public_weekly_schedule(date) TO anon, authenticated, service_role;

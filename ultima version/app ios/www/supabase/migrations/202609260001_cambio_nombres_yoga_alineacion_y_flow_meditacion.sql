-- Migration 202609260001: Cambio de nombres para Yoga Alineación y Flow y Meditación
-- A partir del lunes 28 de septiembre de 2026:
-- 1. "Yoga para Hombres" -> "Yoga Alineación"
-- 2. "Yoga y Meditación" -> "Flow y Meditación"
-- Todo lo anterior al 28 de septiembre de 2026 se mantiene intacto.

-- 1. Actualizar catálogo en tipos_clases
UPDATE public.tipos_clases
SET nombre = 'Yoga Alineación'
WHERE id = 32 OR lower(btrim(nombre)) IN ('yoga para hombres', 'yoga para hombre');

UPDATE public.tipos_clases
SET nombre = 'Flow y Meditación'
WHERE id = 36 OR lower(btrim(nombre)) IN ('yoga y meditación', 'yoga y meditacion');

-- 2. Actualizar especialidad del profesional Ángel Javier
UPDATE public.profesionales
SET especialidad = 'Yoga Alineación & Yoga para Todos | clases'
WHERE id = 13 OR lower(nombre) LIKE '%ángel%' OR lower(nombre) LIKE '%angel%';

-- 3. Actualizar clases existentes a partir del lunes 28 de septiembre de 2026 (>= 2026-09-28 00:00:00+00)
-- 3.1 Clases de Yoga para Hombres -> Yoga Alineación
UPDATE public.clases
SET 
  nombre = 'Yoga Alineación',
  descripcion = regexp_replace(COALESCE(descripcion, ''), 'Yoga para [Hh]ombres', 'Yoga Alineación', 'g')
WHERE fecha_inicio >= '2026-09-28 00:00:00+00'
  AND (tipo_clase_id = 32 OR lower(nombre) LIKE '%hombres%');

-- 3.2 Clases de Yanira Yoga y Meditación -> Flow y Meditación
UPDATE public.clases
SET 
  nombre = 'Flow y Meditación'
WHERE fecha_inicio >= '2026-09-28 00:00:00+00'
  AND (tipo_clase_id = 36 OR lower(nombre) LIKE '%medita%');

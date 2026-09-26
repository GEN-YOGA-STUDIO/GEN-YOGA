-- Migration 202609260004: Purga definitiva de cualquier mención a "Yoga para Hombres" en la base de datos
-- Renombra todas las clases históricas, presentes y futuras a "Yoga Alineación"

UPDATE public.clases
SET 
  nombre = 'Yoga Alineación',
  descripcion = regexp_replace(COALESCE(descripcion, ''), 'Yoga para [Hh]ombres', 'Yoga Alineación', 'g')
WHERE tipo_clase_id = 32 OR lower(nombre) LIKE '%hombre%' OR lower(descripcion) LIKE '%hombre%';

-- Asegurar catálogo en tipos_clases
UPDATE public.tipos_clases
SET nombre = 'Yoga Alineación'
WHERE id = 32 OR lower(btrim(nombre)) IN ('yoga para hombres', 'yoga para hombre');

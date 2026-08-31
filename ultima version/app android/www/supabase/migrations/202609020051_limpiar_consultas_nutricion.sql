-- ==============================================================================
-- LIMPIEZA DE CONSULTAS Y RESERVAS DE NUTRICIÓN (EN CONSTRUCCIÓN)
-- ==============================================================================

-- 1. Eliminar reservas vinculadas a consultas de nutrición
DELETE FROM public.reservas_nutricion;

-- 2. Eliminar clases y sesiones registradas de tipo nutrición
DELETE FROM public.clases WHERE tipo_clase = 'nutricion';

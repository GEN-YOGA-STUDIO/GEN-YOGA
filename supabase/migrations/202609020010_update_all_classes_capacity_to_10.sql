-- ============================================================================
-- Migration 202609020010: Update all yoga & group classes capacity to 10
-- ============================================================================

begin;

-- 1. Actualizar la capacidad máxima de todas las clases grupales existentes a 10
update public.clases
   set capacidad_max = 10
 where tipo_clase in ('yoga', 'taller')
    or (capacidad_max > 1 and capacidad_max <> 10);

-- 2. Asegurar que las consultas individuales (1 a 1) mantengan capacidad 1
update public.clases
   set capacidad_max = 1
 where tipo_clase in ('psicologia', 'nutricion');

-- 3. Establecer valor por defecto de 10 para la columna capacidad_max
alter table public.clases alter column capacidad_max set default 10;

notify pgrst, 'reload schema';

commit;

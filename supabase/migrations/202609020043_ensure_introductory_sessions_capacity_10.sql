-- ============================================================================
-- Migration 202609020043: Ensure All Introductory Sessions Have Capacity 10
-- ============================================================================
-- 1. Asegura que todas las sesiones introductorias y gratuitas (yoga, psicología,
--    nutrición/PNI, ayurveda) tengan una capacidad máxima de 10 plazas.
-- 2. Permite que múltiples alumnos (hasta 10) se inscriban simultáneamente
--    en las sesiones introductorias de psicología con Miriam y demás sesiones.
-- ============================================================================

begin;

-- 1. Actualizar capacidad de todas las sesiones introductorias y gratuitas a 10 plazas
update public.clases
set
  capacidad_max = 10,
  es_gratuita = true
where coalesce(es_gratuita, false) = true
   or lower(coalesce(nombre, '')) like '%introductoria%';

-- 2. Asegurar específicamente las sesiones introductorias de Miriam (Psicología)
update public.clases
set
  capacidad_max = 10,
  es_gratuita = true,
  duracion_minutos = 60,
  activa = true
where lower(coalesce(nombre, '')) like '%introductoria%'
  and tipo_clase = 'psicologia';

-- 3. Asegurar específicamente las sesiones introductorias de Ángel (Yoga)
update public.clases
set
  capacidad_max = 10,
  es_gratuita = true,
  activa = true
where lower(coalesce(nombre, '')) like '%introductoria%'
  and tipo_clase = 'yoga';

notify pgrst, 'reload schema';

commit;

-- Migration 202609020057: Forzar capacidad_max = 10 en TODAS las sesiones introductorias
-- =======================================================================================

begin;

-- 1. Forzar capacidad_max = 10 en TODAS las clases introductorias
update public.clases
   set capacidad_max = 10
 where (
         lower(coalesce(nombre, '')) like '%introductoria%'
         or es_gratuita = true
       )
   and (capacidad_max is null or capacidad_max < 10);

-- 2. Asegurar que TODAS las clases de Miriam introductorias tengan 10 plazas
update public.clases c
   set capacidad_max = 10,
       es_gratuita = true
  from public.profesionales p
 where c.profesor_id = p.id
   and (lower(coalesce(p.nombre, '')) like '%miriam%' or lower(coalesce(p.email, '')) like '%miriam%')
   and c.tipo_clase = 'psicologia'
   and (lower(coalesce(c.nombre, '')) like '%introductoria%' or c.es_gratuita = true);

-- 3. Asegurar Angel: sesiones introductorias de yoga con 10 plazas
update public.clases c
   set capacidad_max = 10,
       es_gratuita = true
  from public.profesionales p
 where c.profesor_id = p.id
   and (lower(coalesce(p.nombre, '')) like '%angel%' or lower(coalesce(p.nombre, '')) like '%ngel%')
   and c.tipo_clase = 'yoga'
   and (lower(coalesce(c.nombre, '')) like '%introductoria%' or c.es_gratuita = true);

notify pgrst, 'reload schema';

commit;

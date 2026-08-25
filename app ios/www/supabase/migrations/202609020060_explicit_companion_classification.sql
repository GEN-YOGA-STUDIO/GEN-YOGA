begin;

alter table public.clases
  add column if not exists companion_modality text;

-- Las sesiones introductorias de Angel no pertenecen a ningun perfil de Yoga
-- en Compania, aunque sean gratuitas.
update public.clases as class
   set companion_modality = null
  from public.profesionales as professional
 where professional.id = class.profesor_id
   and lower(concat_ws(' ', professional.nombre, professional.apellidos, professional.email)) like '%angel%'
   and lower(coalesce(class.nombre, '')) like '%introductoria%';

-- Solo las franjas Power Vinyasa de Yanira de martes y jueves a las 19:00
-- aceptan el bono de Yoga con colegas.
update public.clases as class
   set companion_modality = 'colegas'
  from public.profesionales as professional
 where professional.id = class.profesor_id
   and lower(concat_ws(' ', professional.nombre, professional.apellidos, professional.email)) like '%yanira%'
   and lower(trim(coalesce(class.tipo_clase, ''))) = 'yoga'
   and extract(isodow from class.fecha_inicio at time zone 'Europe/Madrid') in (2, 4)
   and (class.fecha_inicio at time zone 'Europe/Madrid')::time = time '19:00'
   and (
     lower(coalesce(class.nombre, '')) like '%power%'
     or lower(coalesce(class.nombre, '')) like '%vinyasa%'
     or lower(coalesce(class.estilo_yoga, '')) like '%power%'
     or lower(coalesce(class.estilo_yoga, '')) like '%vinyasa%'
   );

notify pgrst, 'reload schema';

commit;

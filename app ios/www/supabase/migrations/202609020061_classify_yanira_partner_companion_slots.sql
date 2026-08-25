begin;

-- Estas franjas de Yanira solo admiten el perfil Yoga con tu pareja.
update public.clases as class
   set companion_modality = 'pareja'
  from public.profesionales as professional
 where professional.id = class.profesor_id
   and lower(concat_ws(' ', professional.nombre, professional.apellidos, professional.email)) like '%yanira%'
   and lower(trim(coalesce(class.tipo_clase, ''))) = 'yoga'
   and (
     (
       extract(isodow from class.fecha_inicio at time zone 'Europe/Madrid') = 3
       and (class.fecha_inicio at time zone 'Europe/Madrid')::time = time '18:00'
       and lower(coalesce(class.nombre, '')) like '%hombre%'
     )
     or (
       extract(isodow from class.fecha_inicio at time zone 'Europe/Madrid') in (2, 3, 4, 5)
       and (class.fecha_inicio at time zone 'Europe/Madrid')::time = time '09:30'
       and lower(coalesce(class.nombre, '')) like '%vinyasa%'
     )
   );

-- Yoga con tu madre: Ángel los lunes/miércoles a las 16:15 y Yanira
-- los miércoles/viernes a las 08:00.
update public.clases as class
   set companion_modality = 'abuela'
  from public.profesionales as professional
 where professional.id = class.profesor_id
   and lower(concat_ws(' ', professional.nombre, professional.apellidos, professional.email)) like '%angel%'
   and lower(trim(coalesce(class.tipo_clase, ''))) = 'yoga'
   and extract(isodow from class.fecha_inicio at time zone 'Europe/Madrid') in (1, 3)
   and (class.fecha_inicio at time zone 'Europe/Madrid')::time = time '16:15';

update public.clases as class
   set companion_modality = 'abuela'
  from public.profesionales as professional
 where professional.id = class.profesor_id
   and lower(concat_ws(' ', professional.nombre, professional.apellidos, professional.email)) like '%yanira%'
   and lower(trim(coalesce(class.tipo_clase, ''))) = 'yoga'
   and extract(isodow from class.fecha_inicio at time zone 'Europe/Madrid') in (3, 5)
   and (class.fecha_inicio at time zone 'Europe/Madrid')::time = time '08:00';

notify pgrst, 'reload schema';

commit;
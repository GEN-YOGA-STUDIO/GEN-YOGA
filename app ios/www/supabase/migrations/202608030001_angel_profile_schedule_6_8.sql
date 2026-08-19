begin;

-- Keep Ángel's public profile current without date-bound wording and without
-- the legacy qualification label that production still contains.
update public.profesionales
set descripcion = $angel$
LUGAR DE NACIMIENTO: La Roda (Albacete)

TITULACIONES:
Baso mi aprendizaje en el autoestudio y la práctica, en recibir clases e intensivos de profesores con larga trayectoria —anatomía, asana, filosofía y todo lo necesario para mi desarrollo en el camino del yoga—. Además, estoy cursando una mentoría para la certificación como profesor de yoga Iyengar.

SOBRE MÍ:
Cuento con 6 años de experiencia en la práctica del yoga, de los cuales 5 años y medio están dedicados a estudiar y practicar yoga Iyengar en Valencia y La Roda.

TE ACOMPAÑO:
La práctica se basa en el ajuste preciso y la correcta alineación del cuerpo. Adapto la postura a las condiciones de cada alumno o alumna para encontrar los efectos y beneficios del asana. Trabajamos en la comprensión de las acciones y en sentir lo que hacemos; desde la profundidad de ese trabajo físico, abrimos la posibilidad de relacionarnos de una manera acorde con el conocimiento propio que surge con la práctica.

ME DEFINE:
"Dedicación y cuidado"
$angel$,
    especialidad = 'Yoga para hombres & Yoga para Todos | clases'
where id = 13
   or lower(coalesce(nombre, '')) in ('ángel', 'ángel javier', 'angel', 'angel javier')
   or lower(coalesce(email, '')) like 'angel%';

-- Rename the configured type for new classes and every upcoming Ángel class
-- that still carries the old public name. Existing rows have no type id, so
-- they must be updated explicitly.
update public.tipos_clases
set nombre = 'Yoga para Todos'
where lower(btrim(coalesce(nombre, ''))) = 'yoga terapéutico';

update public.clases as c
set nombre = 'Yoga para Todos'
where c.profesor_id in (
    select p.id
    from public.profesionales as p
    where p.id = 13
       or lower(coalesce(p.nombre, '')) in ('ángel', 'ángel javier', 'angel', 'angel javier')
       or lower(coalesce(p.email, '')) like 'angel%'
)
  and c.fecha_inicio >= now()
  and lower(btrim(coalesce(c.nombre, ''))) = 'yoga terapéutico';

-- Ángel does not teach on Fridays. Preserve historical attendance records and
-- remove only upcoming yoga sessions from the public/booking schedule.
update public.clases as c
set activa = false
where c.profesor_id in (
    select p.id
    from public.profesionales as p
    where p.id = 13
       or lower(coalesce(p.nombre, '')) in ('ángel', 'ángel javier', 'angel', 'angel javier')
       or lower(coalesce(p.email, '')) like 'angel%'
)
  and c.fecha_inicio >= now()
  and lower(btrim(coalesce(c.tipo_clase, ''))) = 'yoga'
  and extract(isodow from c.fecha_inicio at time zone 'Europe/Madrid') = 5;

notify pgrst, 'reload schema';

commit;

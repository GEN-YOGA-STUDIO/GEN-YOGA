-- ============================================================================
-- Migration 202609020017: Delete 18:00-19:00 (60 min) legacy classes for Ángel
-- ============================================================================

begin;

-- 1. Identificar profesional Ángel
with angel_teachers as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%angel%'
     or lower(coalesce(nombre, '')) like '%ángel%'
     or lower(coalesce(email, '')) like 'angel%'
),
classes_to_delete as (
  select c.id
  from public.clases c
  join angel_teachers at on c.profesor_id = at.profesor_id
  where (
    (to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') = '18:00'
     and to_char(c.fecha_fin at time zone 'Europe/Madrid', 'HH24:MI') = '19:00')
    or (to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') = '18:00'
        and c.duracion_minutos = 60)
  )
)
delete from public.reservas_yoga
 where clase_id in (select id from classes_to_delete);

-- 2. Eliminar las clases de 18:00 a 19:00 de Ángel
with angel_teachers as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%angel%'
     or lower(coalesce(nombre, '')) like '%ángel%'
     or lower(coalesce(email, '')) like 'angel%'
)
delete from public.clases c
using angel_teachers at
where c.profesor_id = at.profesor_id
  and (
    (to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') = '18:00'
     and to_char(c.fecha_fin at time zone 'Europe/Madrid', 'HH24:MI') = '19:00')
    or (to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') = '18:00'
        and c.duracion_minutos = 60)
  );

-- 3. Confirmar que la clase oficial de 18:00 a 19:15 (75 min, 10 plazas) esté activa y configurada
with angel_teachers as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%angel%'
     or lower(coalesce(nombre, '')) like '%ángel%'
     or lower(coalesce(email, '')) like 'angel%'
  order by id
  limit 1
)
update public.clases c
set
  capacidad_max = 10,
  duracion_minutos = 75,
  fecha_fin = (c.fecha_inicio + interval '75 minutes'),
  activa = true
from angel_teachers at
where c.profesor_id = at.profesor_id
  and to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') = '18:00'
  and extract(isodow from (c.fecha_inicio at time zone 'Europe/Madrid')) in (1, 3);

notify pgrst, 'reload schema';

commit;

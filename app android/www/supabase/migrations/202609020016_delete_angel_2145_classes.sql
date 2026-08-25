-- ============================================================================
-- Migration 202609020016: Delete any 21:45-23:00 / irregular classes for Ángel
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
classes_to_remove as (
  select c.id
  from public.clases c
  join angel_teachers at on c.profesor_id = at.profesor_id
  where
    -- Cualquier clase de Ángel que empiece a partir de las 21:00 o tenga horario 21:45 / 23:00
    to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') >= '21:00'
    or to_char(c.fecha_fin at time zone 'Europe/Madrid', 'HH24:MI') >= '22:00'
    or to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') = '21:45'
    or to_char(c.fecha_inicio at time zone 'UTC', 'HH24:MI') = '19:45' -- timezone desfasado que resultaba en 21:45
    or extract(isodow from (c.fecha_inicio at time zone 'Europe/Madrid')) not in (1, 3) -- fuera de lunes y miercoles
    or to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') not in ('16:15', '18:00', '19:45')
)
delete from public.reservas_yoga
 where clase_id in (select id from classes_to_remove);

-- 2. Eliminar las clases erróneas de Ángel
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
    to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') >= '21:00'
    or to_char(c.fecha_fin at time zone 'Europe/Madrid', 'HH24:MI') >= '22:00'
    or to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') = '21:45'
    or to_char(c.fecha_inicio at time zone 'UTC', 'HH24:MI') = '19:45'
    or extract(isodow from (c.fecha_inicio at time zone 'Europe/Madrid')) not in (1, 3)
    or to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') not in ('16:15', '18:00', '19:45')
  );

notify pgrst, 'reload schema';

commit;

-- ============================================================================
-- Migration 202609020011: Delete all 11:30 to 12:30 classes for Yanira
-- ============================================================================

begin;

-- 1. Eliminar reservas asociadas a las clases de Yanira de 11:30 (si existiera alguna)
with yanira_teachers as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%yanira%'
     or lower(coalesce(email, '')) like 'yanira%'
),
classes_to_delete as (
  select c.id
  from public.clases c
  join yanira_teachers yt on c.profesor_id = yt.profesor_id
  where to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') = '11:30'
     or to_char(c.fecha_inicio at time zone 'UTC', 'HH24:MI') = '11:30'
     or (to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') between '11:00' and '12:00'
         and to_char(c.fecha_fin at time zone 'Europe/Madrid', 'HH24:MI') = '12:30')
)
delete from public.reservas_yoga
 where clase_id in (select id from classes_to_delete);

-- 2. Eliminar todas las clases de Yanira de 11:30 a 12:30
with yanira_teachers as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%yanira%'
     or lower(coalesce(email, '')) like 'yanira%'
)
delete from public.clases c
using yanira_teachers yt
where c.profesor_id = yt.profesor_id
  and (
    to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') = '11:30'
    or to_char(c.fecha_inicio at time zone 'UTC', 'HH24:MI') = '11:30'
    or (to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') between '11:00' and '12:00'
        and to_char(c.fecha_fin at time zone 'Europe/Madrid', 'HH24:MI') = '12:30')
  );

notify pgrst, 'reload schema';

commit;

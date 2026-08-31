-- ============================================================================
-- Migration 202609020014: Delete 13:30-14:30 Consultation Slots for Miriam and Isabel
-- ============================================================================

begin;

-- 1. Identificar profesionales Miriam e Isabel
with target_teachers as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%miriam%'
     or lower(coalesce(nombre, '')) like '%isabel%'
     or lower(coalesce(email, '')) in ('miriam@respirapsicologia.es', 'isarodriguez.pni@gmail.com')
),
slots_to_delete as (
  select c.id
  from public.clases c
  join target_teachers tt on c.profesor_id = tt.profesor_id
  where (
    to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') = '13:30'
    or to_char(c.fecha_inicio at time zone 'UTC', 'HH24:MI') = '13:30'
    or (to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') >= '13:30'
        and to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') < '14:30')
  )
)
-- 2. Eliminar reservas en esas consultas
delete from public.reservas_psicologia
 where clase_id in (select id from slots_to_delete);

with target_teachers as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%miriam%'
     or lower(coalesce(nombre, '')) like '%isabel%'
     or lower(coalesce(email, '')) in ('miriam@respirapsicologia.es', 'isarodriguez.pni@gmail.com')
),
slots_to_delete as (
  select c.id
  from public.clases c
  join target_teachers tt on c.profesor_id = tt.profesor_id
  where (
    to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') = '13:30'
    or to_char(c.fecha_inicio at time zone 'UTC', 'HH24:MI') = '13:30'
    or (to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') >= '13:30'
        and to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') < '14:30')
  )
)
delete from public.reservas_nutricion
 where clase_id in (select id from slots_to_delete);

-- 3. Eliminar los huecos de consulta de 13:30 a 14:30
with target_teachers as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%miriam%'
     or lower(coalesce(nombre, '')) like '%isabel%'
     or lower(coalesce(email, '')) in ('miriam@respirapsicologia.es', 'isarodriguez.pni@gmail.com')
)
delete from public.clases c
using target_teachers tt
where c.profesor_id = tt.profesor_id
  and (
    to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') = '13:30'
    or to_char(c.fecha_inicio at time zone 'UTC', 'HH24:MI') = '13:30'
    or (to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') >= '13:30'
        and to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') < '14:30')
  );

notify pgrst, 'reload schema';

commit;

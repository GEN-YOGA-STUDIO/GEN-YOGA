-- ============================================================================
-- Migration 202609020037: Purge Tuesday Yoga para Hombres Classes
-- ============================================================================
-- Elimina todas las clases de 'Yoga para Hombres' programadas los martes (dow = 2)
-- para Ángel Javier, ya que Yoga para Hombres solo se imparte los lunes y miércoles.
-- ============================================================================

begin;

-- 1. Eliminar reservas asociadas a las clases de Yoga para Hombres de los martes para Ángel
delete from public.reservas_yoga
where clase_id in (
  select c.id
  from public.clases c
  join public.profesionales p on c.profesor_id = p.id
  where extract(isodow from (c.fecha_inicio at time zone 'Europe/Madrid')) = 2 -- Martes
    and lower(c.nombre) like '%hombres%'
    and (lower(coalesce(p.nombre, '')) like '%angel%' or lower(coalesce(p.nombre, '')) like '%ángel%' or lower(coalesce(p.email, '')) like 'angel%')
);

-- 2. Eliminar las clases de Yoga para Hombres de los martes para Ángel
delete from public.clases
where id in (
  select c.id
  from public.clases c
  join public.profesionales p on c.profesor_id = p.id
  where extract(isodow from (c.fecha_inicio at time zone 'Europe/Madrid')) = 2 -- Martes
    and lower(c.nombre) like '%hombres%'
    and (lower(coalesce(p.nombre, '')) like '%angel%' or lower(coalesce(p.nombre, '')) like '%ángel%' or lower(coalesce(p.email, '')) like 'angel%')
);

notify pgrst, 'reload schema';

commit;

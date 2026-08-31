-- ============================================================================
-- Migration 202609020036: Seed Ángel Yoga para Hombres Wednesdays 18:00-19:15
-- ============================================================================
-- Crea en base de datos las clases de los miércoles de Yoga para Hombres con Ángel
-- de 18:00 a 19:15 (75 min, aforo 10) todos los miércoles a partir de septiembre 2026.
-- ============================================================================

begin;

with angel_teacher as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%angel%'
     or lower(coalesce(nombre, '')) like '%ángel%'
     or lower(coalesce(email, '')) like 'angel%'
  order by id
  limit 1
),
hombres_style as (
  select id as tipo_clase_id
  from public.tipos_clases
  where lower(btrim(coalesce(nombre, ''))) in ('yoga para hombres', 'para hombres')
  order by id
  limit 1
),
wednesday_dates as (
  select d::date as fecha
  from generate_series('2026-09-01'::date, '2028-12-31'::date, '1 day'::interval) as d
  where extract(isodow from d) = 3 -- Miércoles
),
slots_to_insert as (
  select
    'Yoga para Hombres' as nombre,
    (wd.fecha + '18:00'::time) at time zone 'Europe/Madrid' as fecha_inicio,
    (wd.fecha + '19:15'::time) at time zone 'Europe/Madrid' as fecha_fin,
    10 as capacidad_max,
    t.profesor_id,
    'yoga' as tipo_clase,
    75 as duracion_minutos,
    true as activa,
    'Clase regular de Yoga para Hombres con Ángel' as descripcion,
    s.tipo_clase_id,
    false as es_especial,
    false as es_gratuita
  from wednesday_dates wd
  cross join angel_teacher t
  cross join hombres_style s
)
insert into public.clases (
  nombre,
  fecha_inicio,
  fecha_fin,
  capacidad_max,
  profesor_id,
  tipo_clase,
  duracion_minutos,
  activa,
  descripcion,
  tipo_clase_id,
  es_especial,
  es_gratuita
)
select
  sti.nombre,
  sti.fecha_inicio,
  sti.fecha_fin,
  sti.capacidad_max,
  sti.profesor_id,
  sti.tipo_clase,
  sti.duracion_minutos,
  sti.activa,
  sti.descripcion,
  sti.tipo_clase_id,
  sti.es_especial,
  sti.es_gratuita
from slots_to_insert sti
where not exists (
  select 1
  from public.clases c
  where c.profesor_id = sti.profesor_id
    and c.fecha_inicio = sti.fecha_inicio
    and c.activa = true
);

notify pgrst, 'reload schema';

commit;

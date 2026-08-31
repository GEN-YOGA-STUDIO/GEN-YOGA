-- ============================================================================
-- Migration 202609020013: Fix Ángel Schedule (Only Mon & Wed: 16:15-17:30, 18:00-19:15, 19:45-21:00)
-- ============================================================================

begin;

-- 1. Identificar profesional Ángel y tipos de clases
with angel_teacher as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%angel%'
     or lower(coalesce(nombre, '')) like '%ángel%'
     or lower(coalesce(email, '')) like 'angel%'
  order by id
  limit 1
),
styles as (
  select
    max(case when lower(btrim(coalesce(nombre, ''))) in ('yoga para todos', 'para todos') then id end) as para_todos_id,
    max(case when lower(btrim(coalesce(nombre, ''))) in ('yoga para hombres', 'para hombres') then id end) as para_hombres_id
  from public.tipos_clases
),
valid_schedule as (
  select
    d::date as fecha,
    extract(isodow from d::date)::integer as dow
  from generate_series('2026-09-01'::date, '2028-12-31'::date, '1 day'::interval) as d
  where extract(isodow from d::date)::integer in (1, 3) -- Lunes (1) y Miércoles (3)
),
valid_slots as (
  -- Slot 1: 16:15 - 17:30 (Yoga para Todos)
  select
    (vs.fecha + '16:15'::time) at time zone 'Europe/Madrid' as fecha_inicio,
    (vs.fecha + '17:30'::time) at time zone 'Europe/Madrid' as fecha_fin,
    'Yoga para Todos' as nombre_clase,
    75 as duracion_minutos,
    10 as capacidad_max,
    t.profesor_id,
    s.para_todos_id as tipo_clase_id
  from valid_schedule vs
  cross join angel_teacher t
  cross join styles s

  union all

  -- Slot 2: 18:00 - 19:15 (Yoga para Hombres)
  select
    (vs.fecha + '18:00'::time) at time zone 'Europe/Madrid' as fecha_inicio,
    (vs.fecha + '19:15'::time) at time zone 'Europe/Madrid' as fecha_fin,
    'Yoga para Hombres' as nombre_clase,
    75 as duracion_minutos,
    10 as capacidad_max,
    t.profesor_id,
    s.para_hombres_id as tipo_clase_id
  from valid_schedule vs
  cross join angel_teacher t
  cross join styles s

  union all

  -- Slot 3: 19:45 - 21:00 (Yoga para Todos)
  select
    (vs.fecha + '19:45'::time) at time zone 'Europe/Madrid' as fecha_inicio,
    (vs.fecha + '21:00'::time) at time zone 'Europe/Madrid' as fecha_fin,
    'Yoga para Todos' as nombre_clase,
    75 as duracion_minutos,
    10 as capacidad_max,
    t.profesor_id,
    s.para_todos_id as tipo_clase_id
  from valid_schedule vs
  cross join angel_teacher t
  cross join styles s
),
invalid_classes as (
  select c.id
  from public.clases c
  join angel_teacher t on c.profesor_id = t.profesor_id
  where c.fecha_inicio >= '2026-09-01 00:00:00+00'
    and not exists (
      select 1
      from valid_slots vs
      where vs.profesor_id = c.profesor_id
        and vs.fecha_inicio = c.fecha_inicio
        and vs.fecha_fin = c.fecha_fin
    )
)
-- 2. Eliminar reservas en clases inválidas de Ángel
delete from public.reservas_yoga
where clase_id in (select id from invalid_classes);

-- 3. Eliminar clases inválidas de Ángel (que no sean exactamente los 3 horarios oficiales)
with angel_teacher as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%angel%'
     or lower(coalesce(nombre, '')) like '%ángel%'
     or lower(coalesce(email, '')) like 'angel%'
  order by id
  limit 1
),
styles as (
  select
    max(case when lower(btrim(coalesce(nombre, ''))) in ('yoga para todos', 'para todos') then id end) as para_todos_id,
    max(case when lower(btrim(coalesce(nombre, ''))) in ('yoga para hombres', 'para hombres') then id end) as para_hombres_id
  from public.tipos_clases
),
valid_schedule as (
  select
    d::date as fecha,
    extract(isodow from d::date)::integer as dow
  from generate_series('2026-09-01'::date, '2028-12-31'::date, '1 day'::interval) as d
  where extract(isodow from d::date)::integer in (1, 3)
),
valid_slots as (
  select
    (vs.fecha + '16:15'::time) at time zone 'Europe/Madrid' as fecha_inicio,
    (vs.fecha + '17:30'::time) at time zone 'Europe/Madrid' as fecha_fin
  from valid_schedule vs
  union all
  select
    (vs.fecha + '18:00'::time) at time zone 'Europe/Madrid' as fecha_inicio,
    (vs.fecha + '19:15'::time) at time zone 'Europe/Madrid' as fecha_fin
  from valid_schedule vs
  union all
  select
    (vs.fecha + '19:45'::time) at time zone 'Europe/Madrid' as fecha_inicio,
    (vs.fecha + '21:00'::time) at time zone 'Europe/Madrid' as fecha_fin
  from valid_schedule vs
)
delete from public.clases c
using angel_teacher t
where c.profesor_id = t.profesor_id
  and c.fecha_inicio >= '2026-09-01 00:00:00+00'
  and not exists (
    select 1
    from valid_slots vs
    where vs.fecha_inicio = c.fecha_inicio
      and vs.fecha_fin = c.fecha_fin
  );

-- 4. Actualizar o insertar exactamente los 3 turnos válidos de Ángel
with angel_teacher as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%angel%'
     or lower(coalesce(nombre, '')) like '%ángel%'
     or lower(coalesce(email, '')) like 'angel%'
  order by id
  limit 1
),
styles as (
  select
    max(case when lower(btrim(coalesce(nombre, ''))) in ('yoga para todos', 'para todos') then id end) as para_todos_id,
    max(case when lower(btrim(coalesce(nombre, ''))) in ('yoga para hombres', 'para hombres') then id end) as para_hombres_id
  from public.tipos_clases
),
valid_schedule as (
  select
    d::date as fecha,
    extract(isodow from d::date)::integer as dow
  from generate_series('2026-09-01'::date, '2028-12-31'::date, '1 day'::interval) as d
  where extract(isodow from d::date)::integer in (1, 3)
),
valid_slots as (
  select
    vs.fecha,
    (vs.fecha + '16:15'::time) at time zone 'Europe/Madrid' as fecha_inicio,
    (vs.fecha + '17:30'::time) at time zone 'Europe/Madrid' as fecha_fin,
    'Yoga para Todos' as nombre_clase,
    75 as duracion_minutos,
    10 as capacidad_max,
    t.profesor_id,
    s.para_todos_id as tipo_clase_id
  from valid_schedule vs
  cross join angel_teacher t
  cross join styles s

  union all

  select
    vs.fecha,
    (vs.fecha + '18:00'::time) at time zone 'Europe/Madrid' as fecha_inicio,
    (vs.fecha + '19:15'::time) at time zone 'Europe/Madrid' as fecha_fin,
    'Yoga para Hombres' as nombre_clase,
    75 as duracion_minutos,
    10 as capacidad_max,
    t.profesor_id,
    s.para_hombres_id as tipo_clase_id
  from valid_schedule vs
  cross join angel_teacher t
  cross join styles s

  union all

  select
    vs.fecha,
    (vs.fecha + '19:45'::time) at time zone 'Europe/Madrid' as fecha_inicio,
    (vs.fecha + '21:00'::time) at time zone 'Europe/Madrid' as fecha_fin,
    'Yoga para Todos' as nombre_clase,
    75 as duracion_minutos,
    10 as capacidad_max,
    t.profesor_id,
    s.para_todos_id as tipo_clase_id
  from valid_schedule vs
  cross join angel_teacher t
  cross join styles s
)
insert into public.clases (
  nombre,
  fecha_inicio,
  fecha_fin,
  capacidad_max,
  profesor_id,
  tipo_clase,
  tipo_clase_id,
  duracion_minutos,
  activa
)
select
  vs.nombre_clase,
  vs.fecha_inicio,
  vs.fecha_fin,
  10,
  vs.profesor_id,
  'yoga',
  vs.tipo_clase_id,
  75,
  true
from valid_slots vs
where not exists (
  select 1
  from public.clases c
  where c.profesor_id = vs.profesor_id
    and c.fecha_inicio = vs.fecha_inicio
);

-- Asegurar capacidad 10 y duración 75 en las clases existentes de Ángel
with angel_teacher as (
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
  activa = true
from angel_teacher t
where c.profesor_id = t.profesor_id
  and c.fecha_inicio >= '2026-09-01 00:00:00+00';

notify pgrst, 'reload schema';

commit;

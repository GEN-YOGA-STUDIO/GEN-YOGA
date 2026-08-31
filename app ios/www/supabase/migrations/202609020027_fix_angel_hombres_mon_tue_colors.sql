-- ============================================================================
-- Migration: Fix Ángel schedule – Yoga para Hombres is Mon+Tue 18:00-19:15
-- Also update class type colors: blue (#7F9FC0) reserved for Yoga para Todos,
-- Yoga para Hombres gets a distinct teal/slate color (#5A8A7A).
-- ============================================================================

begin;

-- 1. Update tipo_clase color: Yoga para Todos = blue, Yoga para Hombres = teal/slate
update public.tipos_clases
set color = '#7F9FC0'
where lower(btrim(nombre)) = 'yoga para todos';

update public.tipos_clases
set color = '#5A8A7A'
where lower(btrim(nombre)) = 'yoga para hombres';

-- 2. Identify Ángel's profesional ID
-- 3. Delete all Ángel classes from 2026-09-01 onwards that don't match the correct schedule
-- 4. Insert the correct schedule: Mon+Tue+Wed (Yoga para Todos Mon+Wed, Yoga para Hombres Mon+Tue)

-- Correct schedule for Ángel:
-- LUNES (dow=1): 16:15-17:30 Yoga para Todos, 18:00-19:15 Yoga para Hombres, 19:45-21:00 Yoga para Todos
-- MARTES (dow=2): 18:00-19:15 Yoga para Hombres
-- MIÉRCOLES (dow=3): 16:15-17:30 Yoga para Todos, 19:45-21:00 Yoga para Todos
-- (NO Yoga para Hombres on Wednesday)

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
date_range as (
  select d::date as fecha
  from generate_series('2026-09-01'::date, '2028-12-31'::date, '1 day'::interval) as d
),
schedule_rules as (
  select
    dr.fecha,
    extract(isodow from dr.fecha)::integer as dow
  from date_range dr
),
-- Define all valid slots for Ángel
valid_slots as (
  -- LUNES (dow=1): 3 classes
  select sr.fecha,
    (sr.fecha + '16:15'::time) at time zone 'Europe/Madrid' as fecha_inicio,
    (sr.fecha + '17:30'::time) at time zone 'Europe/Madrid' as fecha_fin,
    'Yoga para Todos' as nombre_clase, 75 as duracion_minutos,
    t.profesor_id, s.para_todos_id as tipo_clase_id
  from schedule_rules sr cross join angel_teacher t cross join styles s
  where sr.dow = 1

  union all
  select sr.fecha,
    (sr.fecha + '18:00'::time) at time zone 'Europe/Madrid',
    (sr.fecha + '19:15'::time) at time zone 'Europe/Madrid',
    'Yoga para Hombres', 75,
    t.profesor_id, s.para_hombres_id
  from schedule_rules sr cross join angel_teacher t cross join styles s
  where sr.dow = 1

  union all
  select sr.fecha,
    (sr.fecha + '19:45'::time) at time zone 'Europe/Madrid',
    (sr.fecha + '21:00'::time) at time zone 'Europe/Madrid',
    'Yoga para Todos', 75,
    t.profesor_id, s.para_todos_id
  from schedule_rules sr cross join angel_teacher t cross join styles s
  where sr.dow = 1

  -- MARTES (dow=2): 1 class (Yoga para Hombres 18:00-19:15)
  union all
  select sr.fecha,
    (sr.fecha + '18:00'::time) at time zone 'Europe/Madrid',
    (sr.fecha + '19:15'::time) at time zone 'Europe/Madrid',
    'Yoga para Hombres', 75,
    t.profesor_id, s.para_hombres_id
  from schedule_rules sr cross join angel_teacher t cross join styles s
  where sr.dow = 2

  -- MIÉRCOLES (dow=3): 2 classes (NO Yoga para Hombres)
  union all
  select sr.fecha,
    (sr.fecha + '16:15'::time) at time zone 'Europe/Madrid',
    (sr.fecha + '17:30'::time) at time zone 'Europe/Madrid',
    'Yoga para Todos', 75,
    t.profesor_id, s.para_todos_id
  from schedule_rules sr cross join angel_teacher t cross join styles s
  where sr.dow = 3

  union all
  select sr.fecha,
    (sr.fecha + '19:45'::time) at time zone 'Europe/Madrid',
    (sr.fecha + '21:00'::time) at time zone 'Europe/Madrid',
    'Yoga para Todos', 75,
    t.profesor_id, s.para_todos_id
  from schedule_rules sr cross join angel_teacher t cross join styles s
  where sr.dow = 3
)
-- First: delete reservas on invalid Ángel classes
delete from public.reservas_yoga
where clase_id in (
  select c.id
  from public.clases c
  join angel_teacher t on c.profesor_id = t.profesor_id
  where c.fecha_inicio >= '2026-09-01 00:00:00+00'
    and not exists (
      select 1 from valid_slots vs
      where vs.fecha_inicio = c.fecha_inicio
        and vs.fecha_fin = c.fecha_fin
        and vs.profesor_id = c.profesor_id
    )
);

-- Delete invalid Ángel classes
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
date_range as (
  select d::date as fecha
  from generate_series('2026-09-01'::date, '2028-12-31'::date, '1 day'::interval) as d
),
schedule_rules as (
  select dr.fecha, extract(isodow from dr.fecha)::integer as dow
  from date_range dr
),
valid_slots as (
  -- Mon: 3 slots
  select (sr.fecha + '16:15'::time) at time zone 'Europe/Madrid' as fecha_inicio,
         (sr.fecha + '17:30'::time) at time zone 'Europe/Madrid' as fecha_fin
  from schedule_rules sr where sr.dow = 1
  union all
  select (sr.fecha + '18:00'::time) at time zone 'Europe/Madrid',
         (sr.fecha + '19:15'::time) at time zone 'Europe/Madrid'
  from schedule_rules sr where sr.dow = 1
  union all
  select (sr.fecha + '19:45'::time) at time zone 'Europe/Madrid',
         (sr.fecha + '21:00'::time) at time zone 'Europe/Madrid'
  from schedule_rules sr where sr.dow = 1
  -- Tue: 1 slot
  union all
  select (sr.fecha + '18:00'::time) at time zone 'Europe/Madrid',
         (sr.fecha + '19:15'::time) at time zone 'Europe/Madrid'
  from schedule_rules sr where sr.dow = 2
  -- Wed: 2 slots
  union all
  select (sr.fecha + '16:15'::time) at time zone 'Europe/Madrid',
         (sr.fecha + '17:30'::time) at time zone 'Europe/Madrid'
  from schedule_rules sr where sr.dow = 3
  union all
  select (sr.fecha + '19:45'::time) at time zone 'Europe/Madrid',
         (sr.fecha + '21:00'::time) at time zone 'Europe/Madrid'
  from schedule_rules sr where sr.dow = 3
)
delete from public.clases c
using angel_teacher t
where c.profesor_id = t.profesor_id
  and c.fecha_inicio >= '2026-09-01 00:00:00+00'
  and not exists (
    select 1 from valid_slots vs
    where vs.fecha_inicio = c.fecha_inicio
      and vs.fecha_fin = c.fecha_fin
  );

-- Insert missing valid classes for Ángel
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
date_range as (
  select d::date as fecha
  from generate_series('2026-09-01'::date, '2028-12-31'::date, '1 day'::interval) as d
),
schedule_rules as (
  select dr.fecha, extract(isodow from dr.fecha)::integer as dow
  from date_range dr
),
valid_slots as (
  -- LUNES
  select sr.fecha,
    (sr.fecha + '16:15'::time) at time zone 'Europe/Madrid' as fecha_inicio,
    (sr.fecha + '17:30'::time) at time zone 'Europe/Madrid' as fecha_fin,
    'Yoga para Todos' as nombre_clase, t.profesor_id, s.para_todos_id as tipo_clase_id
  from schedule_rules sr cross join angel_teacher t cross join styles s where sr.dow = 1
  union all
  select sr.fecha,
    (sr.fecha + '18:00'::time) at time zone 'Europe/Madrid',
    (sr.fecha + '19:15'::time) at time zone 'Europe/Madrid',
    'Yoga para Hombres', t.profesor_id, s.para_hombres_id
  from schedule_rules sr cross join angel_teacher t cross join styles s where sr.dow = 1
  union all
  select sr.fecha,
    (sr.fecha + '19:45'::time) at time zone 'Europe/Madrid',
    (sr.fecha + '21:00'::time) at time zone 'Europe/Madrid',
    'Yoga para Todos', t.profesor_id, s.para_todos_id
  from schedule_rules sr cross join angel_teacher t cross join styles s where sr.dow = 1
  -- MARTES
  union all
  select sr.fecha,
    (sr.fecha + '18:00'::time) at time zone 'Europe/Madrid',
    (sr.fecha + '19:15'::time) at time zone 'Europe/Madrid',
    'Yoga para Hombres', t.profesor_id, s.para_hombres_id
  from schedule_rules sr cross join angel_teacher t cross join styles s where sr.dow = 2
  -- MIÉRCOLES
  union all
  select sr.fecha,
    (sr.fecha + '16:15'::time) at time zone 'Europe/Madrid',
    (sr.fecha + '17:30'::time) at time zone 'Europe/Madrid',
    'Yoga para Todos', t.profesor_id, s.para_todos_id
  from schedule_rules sr cross join angel_teacher t cross join styles s where sr.dow = 3
  union all
  select sr.fecha,
    (sr.fecha + '19:45'::time) at time zone 'Europe/Madrid',
    (sr.fecha + '21:00'::time) at time zone 'Europe/Madrid',
    'Yoga para Todos', t.profesor_id, s.para_todos_id
  from schedule_rules sr cross join angel_teacher t cross join styles s where sr.dow = 3
)
insert into public.clases (
  nombre, fecha_inicio, fecha_fin, capacidad_max, profesor_id,
  tipo_clase, tipo_clase_id, duracion_minutos, activa
)
select
  vs.nombre_clase, vs.fecha_inicio, vs.fecha_fin, 10, vs.profesor_id,
  'yoga', vs.tipo_clase_id, 75, true
from valid_slots vs
where vs.profesor_id is not null
  and not exists (
    select 1 from public.clases c
    where c.profesor_id = vs.profesor_id
      and c.fecha_inicio = vs.fecha_inicio
  );

-- Ensure capacity=10 and duration=75 on all existing Ángel classes
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
set capacidad_max = 10, duracion_minutos = 75, activa = true
from angel_teacher t
where c.profesor_id = t.profesor_id
  and c.fecha_inicio >= '2026-09-01 00:00:00+00';

notify pgrst, 'reload schema';

commit;

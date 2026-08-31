-- ============================================================================
-- Migration 202609020039: Seed All Consultation Slots in Clases Table
-- ============================================================================
-- Materializa e inserta en la tabla 'clases' todos los huecos de consulta disponibles:
-- - Miriam: Martes y Miércoles (09:30, 10:30, 11:30, 12:30, 17:00, 18:00, 19:00, 20:00)
-- - Isabel: Martes y Jueves (09:30, 10:30, 11:30, 12:30, 17:00, 18:00, 19:00, 20:00)
-- - Silvia: Viernes alternos (15:00, 16:30, 18:00 - 90 min)
-- ============================================================================

begin;

with teachers as (
  select
    max(case when lower(coalesce(nombre, '')) like '%miriam%' or lower(coalesce(email, '')) like 'miriam%' then id end) as miriam_id,
    max(case when lower(coalesce(nombre, '')) like '%isabel%' or lower(coalesce(email, '')) like 'isarodriguez%' then id end) as isabel_id,
    max(case when lower(coalesce(nombre, '')) like '%silvia%' or lower(coalesce(email, '')) like 'sil-hada%' then id end) as silvia_id
  from public.profesionales
),
date_range as (
  select d::date as fecha
  from generate_series('2026-09-01'::date, '2027-07-31'::date, '1 day'::interval) as d
),
rules as (
  select
    dr.fecha,
    extract(isodow from dr.fecha)::integer as dow,
    mod(dr.fecha - date '2026-06-19', 14) as silvia_offset
  from date_range dr
),
standard_hours as (
  select unnest(array[
    '09:30'::time, '10:30'::time, '11:30'::time, '12:30'::time,
    '17:00'::time, '18:00'::time, '19:00'::time, '20:00'::time
  ]) as hora_inicio
),
silvia_hours as (
  select unnest(array[
    '15:00'::time, '16:30'::time, '18:00'::time
  ]) as hora_inicio
),
all_slots as (
  -- 1. Miriam: Martes (dow = 2) y Miércoles (dow = 3)
  select
    'Consulta Psicología' as nombre,
    (r.fecha + sh.hora_inicio) at time zone 'Europe/Madrid' as fecha_inicio,
    (r.fecha + sh.hora_inicio + interval '60 minutes') at time zone 'Europe/Madrid' as fecha_fin,
    1 as capacidad_max,
    t.miriam_id as profesor_id,
    'psicologia' as tipo_clase,
    60 as duracion_minutos,
    true as activa,
    'Consulta Individual Psicología' as descripcion,
    false as es_especial,
    false as es_gratuita
  from rules r
  cross join standard_hours sh
  cross join teachers t
  where r.dow in (2, 3) and t.miriam_id is not null

  union all

  -- 2. Isabel: Martes (dow = 2) y Jueves (dow = 4)
  select
    'Consulta PNI / Psicología' as nombre,
    (r.fecha + sh.hora_inicio) at time zone 'Europe/Madrid' as fecha_inicio,
    (r.fecha + sh.hora_inicio + interval '60 minutes') at time zone 'Europe/Madrid' as fecha_fin,
    1 as capacidad_max,
    t.isabel_id as profesor_id,
    'psicologia' as tipo_clase,
    60 as duracion_minutos,
    true as activa,
    'Consulta Individual PNI / Psicología' as descripcion,
    false as es_especial,
    false as es_gratuita
  from rules r
  cross join standard_hours sh
  cross join teachers t
  where r.dow in (2, 4) and t.isabel_id is not null

  union all

  -- 3. Silvia: Viernes alternos (dow = 5)
  select
    'Consulta Ayurveda' as nombre,
    (r.fecha + sh.hora_inicio) at time zone 'Europe/Madrid' as fecha_inicio,
    (r.fecha + sh.hora_inicio + interval '90 minutes') at time zone 'Europe/Madrid' as fecha_fin,
    1 as capacidad_max,
    t.silvia_id as profesor_id,
    'nutricion' as tipo_clase,
    90 as duracion_minutos,
    true as activa,
    'Consulta Individual Ayurveda' as descripcion,
    false as es_especial,
    false as es_gratuita
  from rules r
  cross join silvia_hours sh
  cross join teachers t
  where r.dow = 5 and r.silvia_offset = 0 and t.silvia_id is not null
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
  es_especial,
  es_gratuita
)
select
  s.nombre,
  s.fecha_inicio,
  s.fecha_fin,
  s.capacidad_max,
  s.profesor_id,
  s.tipo_clase,
  s.duracion_minutos,
  s.activa,
  s.descripcion,
  s.es_especial,
  s.es_gratuita
from all_slots s
where not exists (
  select 1
  from public.clases c
  where c.profesor_id = s.profesor_id
    and c.fecha_inicio = s.fecha_inicio
    and c.activa = true
);

notify pgrst, 'reload schema';

commit;

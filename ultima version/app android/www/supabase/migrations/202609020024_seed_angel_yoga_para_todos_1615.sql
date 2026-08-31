-- ============================================================================
-- Migration 202609020024: Create / Ensure Ángel's 'Yoga para Todos' (16:15 - 17:30, Mon & Wed)
-- ============================================================================

begin;

-- 1. Asegurar tipo de clase 'Yoga para Todos'
insert into public.tipos_clases (nombre, duracion_predeterminada, color, icono, activo, orden, categoria)
values ('Yoga para Todos', 75, '#7F9FC0', 'ph-users', true, 3, 'yoga')
on conflict (nombre) do update set
  duracion_predeterminada = 75,
  color = '#7F9FC0',
  categoria = 'yoga',
  activo = true;

-- 2. Identificar Ángel Javier
with teacher as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%angel%'
     or lower(coalesce(nombre, '')) like '%ángel%'
     or lower(coalesce(email, '')) like 'angel%'
  order by id
  limit 1
),
style as (
  select id as tipo_clase_id
  from public.tipos_clases
  where lower(btrim(coalesce(nombre, ''))) = 'yoga para todos'
  limit 1
)
-- Actualizar clases previas que estuvieran a las 16:00 o 16:15 en Lunes o Miércoles
update public.clases c
set
  nombre = 'Yoga para Todos',
  fecha_inicio = ((c.fecha_inicio at time zone 'Europe/Madrid')::date + '16:15'::time) at time zone 'Europe/Madrid',
  fecha_fin = ((c.fecha_inicio at time zone 'Europe/Madrid')::date + '17:30'::time) at time zone 'Europe/Madrid',
  duracion_minutos = 75,
  capacidad_max = 10,
  tipo_clase = 'yoga',
  tipo_clase_id = s.tipo_clase_id,
  activa = true,
  es_especial = false
from teacher t, style s
where c.profesor_id = t.profesor_id
  and extract(isodow from (c.fecha_inicio at time zone 'Europe/Madrid')) in (1, 3)
  and (c.fecha_inicio at time zone 'Europe/Madrid')::time >= '15:30'::time
  and (c.fecha_inicio at time zone 'Europe/Madrid')::time <= '17:00'::time;

-- 3. Insertar para todos los Lunes y Miércoles desde Septiembre 2026 en adelante
with teacher as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%angel%'
     or lower(coalesce(nombre, '')) like '%ángel%'
     or lower(coalesce(email, '')) like 'angel%'
  order by id
  limit 1
),
style as (
  select id as tipo_clase_id
  from public.tipos_clases
  where lower(btrim(coalesce(nombre, ''))) = 'yoga para todos'
  limit 1
),
date_range as (
  select d::date as fecha
  from generate_series('2026-09-01'::date, '2028-12-31'::date, '1 day'::interval) as d
),
target_slots as (
  select
    sd.fecha,
    ((sd.fecha + '16:15'::time) at time zone 'Europe/Madrid') as fecha_inicio,
    ((sd.fecha + '17:30'::time) at time zone 'Europe/Madrid') as fecha_fin,
    75 as duracion_minutos,
    10 as capacidad_max,
    t.profesor_id,
    s.tipo_clase_id
  from date_range sd
  cross join teacher t
  cross join style s
  where extract(isodow from sd.fecha) in (1, 3) -- Lunes (1) y Miércoles (3)
)
insert into public.clases (
  nombre,
  fecha_inicio,
  fecha_fin,
  duracion_minutos,
  capacidad_max,
  profesor_id,
  tipo_clase,
  tipo_clase_id,
  activa,
  es_especial
)
select
  'Yoga para Todos',
  ts.fecha_inicio,
  ts.fecha_fin,
  ts.duracion_minutos,
  ts.capacidad_max,
  ts.profesor_id,
  'yoga',
  ts.tipo_clase_id,
  true,
  false
from target_slots ts
where not exists (
  select 1
  from public.clases existing
  where existing.profesor_id = ts.profesor_id
    and existing.fecha_inicio = ts.fecha_inicio
    and existing.activa is true
);

notify pgrst, 'reload schema';

commit;

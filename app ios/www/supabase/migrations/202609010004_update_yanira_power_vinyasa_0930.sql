begin;

-- 1. Asegurar la existencia del tipo de clase 'Power Vinyasa'
insert into public.tipos_clases (nombre, duracion_predeterminada, color, icono, activo, orden, categoria)
values ('Power Vinyasa', 60, '#DF7FA5', 'ph-lightning', true, 1, 'yoga')
on conflict (nombre) do update set
  categoria = excluded.categoria,
  activo = true;

-- 2. Modificar el horario de las clases matutinas de 'Power Vinyasa' de Yanira en Martes, Miércoles, Jueves y Viernes a 09:30 - 10:30
with teacher as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%yanira%'
     or lower(coalesce(email, '')) like 'yanira%'
  order by id
  limit 1
),
style as (
  select id as tipo_clase_id
  from public.tipos_clases
  where lower(btrim(coalesce(nombre, ''))) = 'power vinyasa'
  limit 1
)
update public.clases c
set
  fecha_inicio = (c.fecha_inicio at time zone 'Europe/Madrid')::date + '09:30'::time at time zone 'Europe/Madrid',
  fecha_fin = (c.fecha_inicio at time zone 'Europe/Madrid')::date + '10:30'::time at time zone 'Europe/Madrid',
  duracion_minutos = 60,
  tipo_clase_id = coalesce(c.tipo_clase_id, s.tipo_clase_id)
from teacher t, style s
where c.profesor_id = t.profesor_id
  and extract(isodow from c.fecha_inicio at time zone 'Europe/Madrid')::integer in (2, 3, 4, 5) -- Martes, Miércoles, Jueves, Viernes
  and (
    (c.fecha_inicio at time zone 'Europe/Madrid')::time >= '08:45'::time
    and (c.fecha_inicio at time zone 'Europe/Madrid')::time <= '09:35'::time
  )
  and lower(btrim(coalesce(c.nombre, ''))) = 'power vinyasa';

-- 3. Insertar las clases de 09:30 a 10:30 que pudieran faltar en Martes, Miércoles, Jueves y Viernes
with teacher as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%yanira%'
     or lower(coalesce(email, '')) like 'yanira%'
  order by id
  limit 1
),
style as (
  select id as tipo_clase_id
  from public.tipos_clases
  where lower(btrim(coalesce(nombre, ''))) = 'power vinyasa'
  limit 1
),
date_range as (
  select d::date as fecha
  from generate_series('2026-09-01'::date, '2028-12-31'::date, '1 day'::interval) as d
),
target_slots as (
  select
    sd.fecha,
    (sd.fecha + '09:30'::time) at time zone 'Europe/Madrid' as fecha_inicio,
    (sd.fecha + '10:30'::time) at time zone 'Europe/Madrid' as fecha_fin,
    60 as duracion_minutos,
    15 as capacidad_max,
    t.profesor_id,
    s.tipo_clase_id
  from date_range sd
  cross join teacher t
  cross join style s
  where extract(isodow from sd.fecha)::integer in (2, 3, 4, 5)
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
  'Power Vinyasa',
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

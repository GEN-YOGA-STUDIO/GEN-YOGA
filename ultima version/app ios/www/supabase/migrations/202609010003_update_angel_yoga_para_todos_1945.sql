begin;

-- 1. Asegurar la existencia del tipo de clase 'Yoga para Todos'
insert into public.tipos_clases (nombre, duracion_predeterminada, color, icono, activo, orden, categoria)
values ('Yoga para Todos', 75, '#7F9FC0', 'ph-users', true, 3, 'yoga')
on conflict (nombre) do update set
  categoria = excluded.categoria,
  activo = true;

-- 2. Modificar el horario de todas las clases nocturnas de 'Yoga para Todos' de Ángel en Lunes y Miércoles a 19:45 - 21:00
with teacher as (
  select id as profesor_id
  from public.profesionales
  where id = 13
     or lower(coalesce(nombre, '')) in ('ángel', 'ángel javier', 'angel', 'angel javier')
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
update public.clases c
set
  fecha_inicio = (c.fecha_inicio at time zone 'Europe/Madrid')::date + '19:45'::time at time zone 'Europe/Madrid',
  fecha_fin = (c.fecha_inicio at time zone 'Europe/Madrid')::date + '21:00'::time at time zone 'Europe/Madrid',
  duracion_minutos = 75,
  tipo_clase_id = coalesce(c.tipo_clase_id, s.tipo_clase_id)
from teacher t, style s
where c.profesor_id = t.profesor_id
  and extract(isodow from c.fecha_inicio at time zone 'Europe/Madrid')::integer in (1, 3) -- Lunes (1) y Miércoles (3)
  and (
    (c.fecha_inicio at time zone 'Europe/Madrid')::time >= '19:00'::time
    and (c.fecha_inicio at time zone 'Europe/Madrid')::time <= '20:30'::time
  )
  and lower(btrim(coalesce(c.nombre, ''))) = 'yoga para todos';

-- 3. Insertar las clases de 19:45 a 21:00 que pudieran faltar para Lunes y Miércoles
with teacher as (
  select id as profesor_id
  from public.profesionales
  where id = 13
     or lower(coalesce(nombre, '')) in ('ángel', 'ángel javier', 'angel', 'angel javier')
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
    (sd.fecha + '19:45'::time) at time zone 'Europe/Madrid' as fecha_inicio,
    (sd.fecha + '21:00'::time) at time zone 'Europe/Madrid' as fecha_fin,
    75 as duracion_minutos,
    15 as capacidad_max,
    t.profesor_id,
    s.tipo_clase_id
  from date_range sd
  cross join teacher t
  cross join style s
  where extract(isodow from sd.fecha)::integer in (1, 3)
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

begin;

-- 1. Asegurar la existencia del tipo de clase 'Power Vinyasa'
insert into public.tipos_clases (nombre, duracion_predeterminada, color, icono, activo, orden, categoria)
values ('Power Vinyasa', 60, '#DF7FA5', 'ph-lightning', true, 1, 'yoga')
on conflict (nombre) do update set
  categoria = excluded.categoria,
  activo = true;

-- 2. Desactivar clases de tarde (>= 12:00) de Yanira que no sean Martes/Jueves 19:00-20:00 con reservas confirmadas
with yanira as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%yanira%'
     or lower(coalesce(email, '')) like 'yanira%'
  order by id
  limit 1
)
update public.clases c
set activa = false
from yanira y
where c.profesor_id = y.profesor_id
  and (c.fecha_inicio at time zone 'Europe/Madrid')::time >= '12:00'::time
  and not (
    extract(isodow from c.fecha_inicio at time zone 'Europe/Madrid')::integer in (2, 4)
    and (c.fecha_inicio at time zone 'Europe/Madrid')::time = '19:00'::time
  )
  and c.id in (select clase_id from public.reservas_yoga where estado = 'confirmada');

-- 3. Eliminar clases de tarde (>= 12:00) de Yanira que no sean Martes/Jueves 19:00-20:00 sin reservas confirmadas
with yanira as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%yanira%'
     or lower(coalesce(email, '')) like 'yanira%'
  order by id
  limit 1
)
delete from public.clases c
using yanira y
where c.profesor_id = y.profesor_id
  and (c.fecha_inicio at time zone 'Europe/Madrid')::time >= '12:00'::time
  and not (
    extract(isodow from c.fecha_inicio at time zone 'Europe/Madrid')::integer in (2, 4)
    and (c.fecha_inicio at time zone 'Europe/Madrid')::time = '19:00'::time
  )
  and c.id not in (select clase_id from public.reservas_yoga where estado = 'confirmada');

-- 4. Actualizar/Asegurar las clases de tarde de Yanira exclusivamente los Martes y Jueves de 19:00 a 20:00
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
    (sd.fecha + '19:00'::time) at time zone 'Europe/Madrid' as fecha_inicio,
    (sd.fecha + '20:00'::time) at time zone 'Europe/Madrid' as fecha_fin,
    60 as duracion_minutos,
    15 as capacidad_max,
    t.profesor_id,
    s.tipo_clase_id
  from date_range sd
  cross join teacher t
  cross join style s
  where extract(isodow from sd.fecha)::integer in (2, 4) -- Martes (2) y Jueves (4)
)
update public.clases c
set
  nombre = 'Power Vinyasa',
  fecha_inicio = ts.fecha_inicio,
  fecha_fin = ts.fecha_fin,
  duracion_minutos = 60,
  activa = true,
  tipo_clase_id = coalesce(c.tipo_clase_id, ts.tipo_clase_id)
from target_slots ts
where c.profesor_id = ts.profesor_id
  and c.fecha_inicio = ts.fecha_inicio;

-- 5. Insertar cualquier clase de Martes o Jueves de 19:00 a 20:00 para Yanira que no existiera aún
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
    (sd.fecha + '19:00'::time) at time zone 'Europe/Madrid' as fecha_inicio,
    (sd.fecha + '20:00'::time) at time zone 'Europe/Madrid' as fecha_fin,
    60 as duracion_minutos,
    15 as capacidad_max,
    t.profesor_id,
    s.tipo_clase_id
  from date_range sd
  cross join teacher t
  cross join style s
  where extract(isodow from sd.fecha)::integer in (2, 4)
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

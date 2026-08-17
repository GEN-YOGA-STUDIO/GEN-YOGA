begin;

-- 1. Si ya existe 'Restaurativo y Suave', reasociar clases y borrar el duplicado 'Restaurativo o Suave'
do $$
declare
  v_main_id bigint;
  v_dup_id bigint;
begin
  select id into v_main_id from public.tipos_clases where lower(btrim(nombre)) = 'restaurativo y suave' limit 1;
  select id into v_dup_id from public.tipos_clases where lower(btrim(nombre)) in ('restaurativa o suave', 'restaurativo o suave', 'yoga restaurativo o suave', 'yoga restaurativa o suave') and id != coalesce(v_main_id, 0) limit 1;

  if v_main_id is not null and v_dup_id is not null then
    update public.clases set tipo_clase_id = v_main_id where tipo_clase_id = v_dup_id;
    delete from public.tipos_clases where id = v_dup_id;
  elsif v_main_id is null and v_dup_id is not null then
    update public.tipos_clases set nombre = 'Restaurativo y Suave' where id = v_dup_id;
  end if;
end $$;

-- Asegurar existencia en public.tipos_clases
insert into public.tipos_clases (nombre, duracion_predeterminada, color, icono, activo, orden, categoria)
values ('Restaurativo y Suave', 60, '#C9A74C', 'ph-heart', true, 2, 'yoga')
on conflict (nombre) do update set
  categoria = excluded.categoria,
  activo = true;

-- 2. Corregir el nombre de cualquier clase existente que tuviera la versión con 'o'
update public.clases
set nombre = 'Restaurativo y Suave'
where lower(btrim(coalesce(nombre, ''))) in (
  'restaurativa o suave',
  'restaurativo o suave',
  'yoga restaurativo o suave',
  'yoga restaurativa o suave'
);

-- 3. Actualizar clases existentes de Yanira en Miércoles y Viernes de 08:00 a 09:00
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
  where lower(btrim(coalesce(nombre, ''))) = 'restaurativo y suave'
  limit 1
),
date_range as (
  select d::date as fecha
  from generate_series('2026-09-01'::date, '2028-12-31'::date, '1 day'::interval) as d
),
target_slots as (
  select
    sd.fecha,
    (sd.fecha + '08:00'::time) at time zone 'Europe/Madrid' as fecha_inicio,
    (sd.fecha + '09:00'::time) at time zone 'Europe/Madrid' as fecha_fin,
    60 as duracion_minutos,
    15 as capacidad_max,
    t.profesor_id,
    s.tipo_clase_id
  from date_range sd
  cross join teacher t
  cross join style s
  where extract(isodow from sd.fecha)::integer in (3, 5) -- Miércoles (3) y Viernes (5)
)
update public.clases c
set
  nombre = 'Restaurativo y Suave',
  fecha_inicio = ts.fecha_inicio,
  fecha_fin = ts.fecha_fin,
  duracion_minutos = 60,
  activa = true,
  tipo_clase_id = coalesce(c.tipo_clase_id, ts.tipo_clase_id)
from target_slots ts
where c.profesor_id = ts.profesor_id
  and c.fecha_inicio = ts.fecha_inicio;

-- 4. Insertar las clases que falten para Miércoles y Viernes de 08:00 a 09:00 para Yanira
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
  where lower(btrim(coalesce(nombre, ''))) = 'restaurativo y suave'
  limit 1
),
date_range as (
  select d::date as fecha
  from generate_series('2026-09-01'::date, '2028-12-31'::date, '1 day'::interval) as d
),
target_slots as (
  select
    sd.fecha,
    (sd.fecha + '08:00'::time) at time zone 'Europe/Madrid' as fecha_inicio,
    (sd.fecha + '09:00'::time) at time zone 'Europe/Madrid' as fecha_fin,
    60 as duracion_minutos,
    15 as capacidad_max,
    t.profesor_id,
    s.tipo_clase_id
  from date_range sd
  cross join teacher t
  cross join style s
  where extract(isodow from sd.fecha)::integer in (3, 5)
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
  'Restaurativo y Suave',
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

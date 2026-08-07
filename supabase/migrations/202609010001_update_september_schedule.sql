begin;

-- 1. Asegurar la existencia de los tipos de clase en public.tipos_clases
insert into public.tipos_clases (nombre, duracion_predeterminada, color, icono, activo, orden, categoria)
values
  ('Power Vinyasa', 60, '#DF7FA5', 'ph-lightning', true, 1, 'yoga'),
  ('Restaurativo y Suave', 60, '#C9A74C', 'ph-heart', true, 2, 'yoga'),
  ('Yoga para Todos', 60, '#7F9FC0', 'ph-users', true, 3, 'yoga'),
  ('Yoga para Hombres', 60, '#5C6F84', 'ph-user-check', true, 4, 'yoga'),
  ('Yoga Ayurveda', 60, '#B45C47', 'ph-sparkle', true, 5, 'yoga')
on conflict (nombre) do update set
  categoria = excluded.categoria,
  activo = true;

-- 2. Limpiar/desactivar clases regulares existentes desde el 01/09/2026 en adelante
-- Se preservan las clases con reservas confirmadas para no alterar historiales de los alumnos.
update public.clases
set activa = false
where fecha_inicio >= '2026-09-01 00:00:00+02'
  and lower(btrim(coalesce(tipo_clase, ''))) = 'yoga'
  and id in (
    select clase_id from public.reservas_yoga where estado = 'confirmada'
  );

delete from public.clases
where fecha_inicio >= '2026-09-01 00:00:00+02'
  and lower(btrim(coalesce(tipo_clase, ''))) = 'yoga'
  and id not in (
    select clase_id from public.reservas_yoga where estado = 'confirmada'
  );

-- 3. Generar e insertar las clases semanales recurrentes desde el 01/09/2026 hasta el 31/12/2028
with teachers as (
  select
    max(case when lower(coalesce(nombre, '')) like '%yanira%' then id end) as yanira_id,
    max(case when lower(coalesce(nombre, '')) like '%angel%' or lower(coalesce(nombre, '')) like '%ángel%' then id end) as angel_id,
    max(case when lower(coalesce(nombre, '')) like '%silvia%' then id end) as silvia_id
  from public.profesionales
),
styles as (
  select
    max(case when lower(btrim(coalesce(nombre, ''))) like '%power vinyasa%' then id end) as power_vinyasa_id,
    max(case when lower(btrim(coalesce(nombre, ''))) like '%restaurativ%' then id end) as restaurativo_id,
    max(case when lower(btrim(coalesce(nombre, ''))) like '%yoga para todos%' then id end) as para_todos_id,
    max(case when lower(btrim(coalesce(nombre, ''))) like '%yoga para hombres%' then id end) as para_hombres_id,
    max(case when lower(btrim(coalesce(nombre, ''))) like '%ayurveda%' then id end) as ayurveda_id
  from public.tipos_clases
),
date_range as (
  select d::date as fecha
  from generate_series('2026-09-01'::date, '2028-12-31'::date, '1 day'::interval) as d
),
schedule_rules as (
  select
    dr.fecha,
    extract(isodow from dr.fecha)::integer as dow,
    ceil(extract(day from dr.fecha) / 7.0)::integer as week_of_month
  from date_range dr
),
classes_to_create as (
  -- LUNES (dow = 1) - Ángel
  select sr.fecha, '16:00'::time as hora_ini, '17:00'::time as hora_fin, 'Yoga para Todos' as nombre_clase, t.angel_id as profesor_id, s.para_todos_id as tipo_clase_id
  from schedule_rules sr, teachers t, styles s where sr.dow = 1
  union all
  select sr.fecha, '18:00'::time, '19:00'::time, 'Yoga para Hombres', t.angel_id, s.para_hombres_id
  from schedule_rules sr, teachers t, styles s where sr.dow = 1
  union all
  select sr.fecha, '20:00'::time, '21:00'::time, 'Yoga para Todos', t.angel_id, s.para_todos_id
  from schedule_rules sr, teachers t, styles s where sr.dow = 1

  -- MARTES (dow = 2) - Yanira
  union all select sr.fecha, '07:00'::time, '08:00'::time, 'Power Vinyasa', t.yanira_id, s.power_vinyasa_id from schedule_rules sr, teachers t, styles s where sr.dow = 2
  union all select sr.fecha, '09:00'::time, '10:00'::time, 'Power Vinyasa', t.yanira_id, s.power_vinyasa_id from schedule_rules sr, teachers t, styles s where sr.dow = 2
  union all select sr.fecha, '10:00'::time, '11:00'::time, 'Power Vinyasa', t.yanira_id, s.power_vinyasa_id from schedule_rules sr, teachers t, styles s where sr.dow = 2
  union all select sr.fecha, '19:00'::time, '20:00'::time, 'Power Vinyasa', t.yanira_id, s.power_vinyasa_id from schedule_rules sr, teachers t, styles s where sr.dow = 2

  -- MIÉRCOLES (dow = 3) - Yanira & Ángel
  union all select sr.fecha, '08:00'::time, '09:00'::time, 'Restaurativo y Suave', t.yanira_id, s.restaurativo_id from schedule_rules sr, teachers t, styles s where sr.dow = 3
  union all select sr.fecha, '09:00'::time, '10:00'::time, 'Power Vinyasa', t.yanira_id, s.power_vinyasa_id from schedule_rules sr, teachers t, styles s where sr.dow = 3
  union all select sr.fecha, '10:00'::time, '11:00'::time, 'Power Vinyasa', t.yanira_id, s.power_vinyasa_id from schedule_rules sr, teachers t, styles s where sr.dow = 3
  union all select sr.fecha, '16:00'::time, '17:00'::time, 'Yoga para Todos', t.angel_id, s.para_todos_id from schedule_rules sr, teachers t, styles s where sr.dow = 3
  union all select sr.fecha, '18:00'::time, '19:00'::time, 'Yoga para Hombres', t.angel_id, s.para_hombres_id from schedule_rules sr, teachers t, styles s where sr.dow = 3
  union all select sr.fecha, '20:00'::time, '21:00'::time, 'Yoga para Todos', t.angel_id, s.para_todos_id from schedule_rules sr, teachers t, styles s where sr.dow = 3

  -- JUEVES (dow = 4) - Yanira
  union all select sr.fecha, '07:00'::time, '08:00'::time, 'Power Vinyasa', t.yanira_id, s.power_vinyasa_id from schedule_rules sr, teachers t, styles s where sr.dow = 4
  union all select sr.fecha, '09:00'::time, '10:00'::time, 'Power Vinyasa', t.yanira_id, s.power_vinyasa_id from schedule_rules sr, teachers t, styles s where sr.dow = 4
  union all select sr.fecha, '10:00'::time, '11:00'::time, 'Power Vinyasa', t.yanira_id, s.power_vinyasa_id from schedule_rules sr, teachers t, styles s where sr.dow = 4
  union all select sr.fecha, '19:00'::time, '20:00'::time, 'Power Vinyasa', t.yanira_id, s.power_vinyasa_id from schedule_rules sr, teachers t, styles s where sr.dow = 4

  -- VIERNES (dow = 5) - Yanira & Silvia (Silvia: Viernes 2º y 4º de cada mes -> 11 y 25 de septiembre y sus viernes alternos)
  union all select sr.fecha, '08:00'::time, '09:00'::time, 'Restaurativo y Suave', t.yanira_id, s.restaurativo_id from schedule_rules sr, teachers t, styles s where sr.dow = 5
  union all select sr.fecha, '09:00'::time, '10:00'::time, 'Power Vinyasa', t.yanira_id, s.power_vinyasa_id from schedule_rules sr, teachers t, styles s where sr.dow = 5
  union all select sr.fecha, '10:00'::time, '11:00'::time, 'Power Vinyasa', t.yanira_id, s.power_vinyasa_id from schedule_rules sr, teachers t, styles s where sr.dow = 5
  union all select sr.fecha, '11:00'::time, '12:00'::time, 'Yoga Ayurveda', t.silvia_id, s.ayurveda_id from schedule_rules sr, teachers t, styles s where sr.dow = 5 and sr.week_of_month in (2, 4)
  union all select sr.fecha, '13:00'::time, '14:00'::time, 'Yoga Ayurveda', t.silvia_id, s.ayurveda_id from schedule_rules sr, teachers t, styles s where sr.dow = 5 and sr.week_of_month in (2, 4)
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
  c.nombre_clase,
  (c.fecha + c.hora_ini) at time zone 'Europe/Madrid' as fecha_inicio,
  (c.fecha + c.hora_fin) at time zone 'Europe/Madrid' as fecha_fin,
  extract(epoch from (c.hora_fin - c.hora_ini)) / 60 as duracion_minutos,
  15 as capacidad_max,
  c.profesor_id,
  'yoga' as tipo_clase,
  c.tipo_clase_id,
  true as activa,
  false as es_especial
from classes_to_create c
where c.profesor_id is not null;

notify pgrst, 'reload schema';

commit;

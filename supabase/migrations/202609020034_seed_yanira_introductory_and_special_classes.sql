-- ============================================================================
-- Migration 202609020034: Seed & Enforce Yanira Introductory & Special Classes
-- 1. Sesiones Introductorias Gratuitas de Yoga con Yanira:
--    - Martes 1 de Septiembre de 2026 a las 19:00h (19:00 a 20:15, 75 min)
--    - Jueves 3 de Septiembre de 2026 a las 19:00h (19:00 a 20:15, 75 min)
-- 2. Sesiones Especiales de Yanira:
--    - Viernes 18 de Septiembre de 2026 a las 19:00h (75 min): "Yoga y Meditación"
--    - Sábado 19 de Septiembre de 2026 de 09:00 a 11:00h (120 min): "Introducción a Power Vinyasa"
-- ============================================================================

begin;

-- 1. Sesión Introductoria de Yanira: Martes 1 de Septiembre a las 19:00h
with teacher_yanira as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%yanira%'
     or lower(coalesce(email, '')) like 'yanira%'
  order by id
  limit 1
)
insert into public.clases (
  nombre,
  descripcion,
  fecha_inicio,
  fecha_fin,
  duracion_minutos,
  capacidad_max,
  profesor_id,
  tipo_clase,
  activa,
  es_gratuita
)
select
  'Sesión Introductoria de Yoga',
  'Descubre nuestro espacio y conoce a nuestros maestros en una sesión guiada para todos los niveles.',
  '2026-09-01 19:00:00+02'::timestamptz,
  '2026-09-01 20:15:00+02'::timestamptz,
  75,
  10,
  y.profesor_id,
  'yoga',
  true,
  true
from teacher_yanira y
where not exists (
  select 1
  from public.clases existing
  where existing.fecha_inicio = '2026-09-01 19:00:00+02'::timestamptz
    and lower(existing.nombre) like '%introductoria%'
);

-- Si ya existía la clase regular de las 19:00 del 1 de septiembre, habilitarla también con es_gratuita = true
update public.clases
set
  nombre = 'Sesión Introductoria de Yoga',
  descripcion = 'Descubre nuestro espacio y conoce a nuestros maestros en una sesión guiada para todos los niveles.',
  duracion_minutos = 75,
  fecha_fin = '2026-09-01 20:15:00+02'::timestamptz,
  capacidad_max = 10,
  tipo_clase = 'yoga',
  activa = true,
  es_gratuita = true
where fecha_inicio = '2026-09-01 19:00:00+02'::timestamptz;


-- 2. Sesión Introductoria de Yanira: Jueves 3 de Septiembre a las 19:00h
with teacher_yanira as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%yanira%'
     or lower(coalesce(email, '')) like 'yanira%'
  order by id
  limit 1
)
insert into public.clases (
  nombre,
  descripcion,
  fecha_inicio,
  fecha_fin,
  duracion_minutos,
  capacidad_max,
  profesor_id,
  tipo_clase,
  activa,
  es_gratuita
)
select
  'Sesión Introductoria de Yoga',
  'Descubre nuestro espacio y conoce a nuestros maestros en una sesión guiada para todos los niveles.',
  '2026-09-03 19:00:00+02'::timestamptz,
  '2026-09-03 20:15:00+02'::timestamptz,
  75,
  10,
  y.profesor_id,
  'yoga',
  true,
  true
from teacher_yanira y
where not exists (
  select 1
  from public.clases existing
  where existing.fecha_inicio = '2026-09-03 19:00:00+02'::timestamptz
    and lower(existing.nombre) like '%introductoria%'
);

-- Si ya existía la clase regular de las 19:00 del 3 de septiembre, habilitarla también con es_gratuita = true
update public.clases
set
  nombre = 'Sesión Introductoria de Yoga',
  descripcion = 'Descubre nuestro espacio y conoce a nuestros maestros en una sesión guiada para todos los niveles.',
  duracion_minutos = 75,
  fecha_fin = '2026-09-03 20:15:00+02'::timestamptz,
  capacidad_max = 10,
  tipo_clase = 'yoga',
  activa = true,
  es_gratuita = true
where fecha_inicio = '2026-09-03 19:00:00+02'::timestamptz;


-- 3. Asegurar Clase Especial: Yoga y Meditación (Viernes 18 de Septiembre 2026, 19:00 a 20:15)
with teacher_yanira as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%yanira%'
     or lower(coalesce(email, '')) like 'yanira%'
  order by id
  limit 1
),
taller_tipo as (
  select id as tipo_id
  from public.tipos_clases
  where lower(btrim(coalesce(nombre, ''))) in ('yoga y meditación', 'yoga y meditacion', 'taller', 'clase especial')
     or lower(coalesce(categoria, '')) = 'taller'
  order by (case when lower(btrim(nombre)) in ('yoga y meditación', 'yoga y meditacion') then 1 else 2 end)
  limit 1
)
insert into public.clases (
  nombre,
  descripcion,
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
  'Yoga y Meditación',
  'Sesiones mensuales de profundización que aúnan asana consciente, pranayama y meditación profunda para calmar el sistema nervioso y restaurar tu centro interior. Incluida gratis 1 al mes con tu Bono Ilimitado o accesible con entrada individual.',
  '2026-09-18 19:00:00+02'::timestamptz,
  '2026-09-18 20:15:00+02'::timestamptz,
  75,
  10,
  y.profesor_id,
  'taller',
  tt.tipo_id,
  true,
  true
from teacher_yanira y, taller_tipo tt
where not exists (
  select 1
  from public.clases existing
  where existing.fecha_inicio = '2026-09-18 19:00:00+02'::timestamptz
    and lower(existing.nombre) like '%meditaci%'
);

update public.clases
set
  nombre = 'Yoga y Meditación',
  descripcion = 'Sesiones mensuales de profundización que aúnan asana consciente, pranayama y meditación profunda para calmar el sistema nervioso y restaurar tu centro interior. Incluida gratis 1 al mes con tu Bono Ilimitado o accesible con entrada individual.',
  fecha_inicio = '2026-09-18 19:00:00+02'::timestamptz,
  fecha_fin = '2026-09-18 20:15:00+02'::timestamptz,
  duracion_minutos = 75,
  capacidad_max = 10,
  tipo_clase = 'taller',
  activa = true,
  es_especial = true
where fecha_inicio = '2026-09-18 19:00:00+02'::timestamptz
  and lower(nombre) like '%meditaci%';


-- 4. Asegurar Taller Intensivo: Introducción a Power Vinyasa (Sábado 19 de Septiembre 2026, 09:00 a 11:00)
with teacher_yanira as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%yanira%'
     or lower(coalesce(email, '')) like 'yanira%'
  order by id
  limit 1
),
taller_tipo as (
  select id as tipo_id
  from public.tipos_clases
  where lower(btrim(coalesce(nombre, ''))) in ('introducción a power vinyasa', 'power vinyasa', 'taller', 'clase especial')
     or lower(coalesce(categoria, '')) = 'taller'
  order by (case when lower(btrim(nombre)) like '%power vinyasa%' then 1 else 2 end)
  limit 1
)
insert into public.clases (
  nombre,
  descripcion,
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
  'Introducción a Power Vinyasa',
  'Inmersión completa de 2 horas (09:00 a 11:00) diseñada para aprender y consolidar los fundamentos de Power Vinyasa: alineación precisa, control del flujo respiratorio y transiciones fluidas.',
  '2026-09-19 09:00:00+02'::timestamptz,
  '2026-09-19 11:00:00+02'::timestamptz,
  120,
  10,
  y.profesor_id,
  'taller',
  tt.tipo_id,
  true,
  true
from teacher_yanira y, taller_tipo tt
where not exists (
  select 1
  from public.clases existing
  where existing.fecha_inicio = '2026-09-19 09:00:00+02'::timestamptz
    and (lower(existing.nombre) like '%power vinyasa%' or lower(existing.nombre) like '%introducci%')
);

update public.clases
set
  nombre = 'Introducción a Power Vinyasa',
  descripcion = 'Inmersión completa de 2 horas (09:00 a 11:00) diseñada para aprender y consolidar los fundamentos de Power Vinyasa: alineación precisa, control del flujo respiratorio y transiciones fluidas.',
  fecha_inicio = '2026-09-19 09:00:00+02'::timestamptz,
  fecha_fin = '2026-09-19 11:00:00+02'::timestamptz,
  duracion_minutos = 120,
  capacidad_max = 10,
  tipo_clase = 'taller',
  activa = true,
  es_especial = true
where fecha_inicio = '2026-09-19 09:00:00+02'::timestamptz
  and (lower(nombre) like '%power vinyasa%' or lower(nombre) like '%introducci%');

notify pgrst, 'reload schema';

commit;

-- ============================================================================
-- Migration 202609020033: Fix Ángel Introductory Session Date -> Sunday 30 August 2026
-- Corrige la fecha de las sesiones introductorias de Ángel del 20 de septiembre
-- al domingo 30 de agosto de 2026 (10:00h y 12:00h).
-- ============================================================================

begin;

-- 1. Eliminar cualquier sesión introductoria errónea del 20 de septiembre de 2026 para Ángel
delete from public.clases
where fecha_inicio in ('2026-09-20 10:00:00+02'::timestamptz, '2026-09-20 12:00:00+02'::timestamptz)
  and lower(nombre) like '%introductoria%';

-- 2. Asegurar la sesión de las 10:00h del Domingo 30 de Agosto de 2026 (75 min, 10:00 a 11:15)
with teacher_angel as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%angel%'
     or lower(coalesce(nombre, '')) like '%ángel%'
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
  '2026-08-30 10:00:00+02'::timestamptz,
  '2026-08-30 11:15:00+02'::timestamptz,
  75,
  10,
  t.profesor_id,
  'yoga',
  true,
  true
from teacher_angel t
where not exists (
  select 1
  from public.clases existing
  where existing.fecha_inicio = '2026-08-30 10:00:00+02'::timestamptz
    and lower(existing.nombre) like '%introductoria%'
);

-- 3. Asegurar la sesión de las 12:00h del Domingo 30 de Agosto de 2026 (75 min, 12:00 a 13:15)
with teacher_angel as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%angel%'
     or lower(coalesce(nombre, '')) like '%ángel%'
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
  '2026-08-30 12:00:00+02'::timestamptz,
  '2026-08-30 13:15:00+02'::timestamptz,
  75,
  10,
  t.profesor_id,
  'yoga',
  true,
  true
from teacher_angel t
where not exists (
  select 1
  from public.clases existing
  where existing.fecha_inicio = '2026-08-30 12:00:00+02'::timestamptz
    and lower(existing.nombre) like '%introductoria%'
);

-- 4. Actualizar por si ya existían clases en 30 de Agosto para garantizar datos canónicos
update public.clases
set
  nombre = 'Sesión Introductoria de Yoga',
  duracion_minutos = 75,
  fecha_fin = '2026-08-30 11:15:00+02'::timestamptz,
  capacidad_max = 10,
  tipo_clase = 'yoga',
  activa = true,
  es_gratuita = true
where fecha_inicio = '2026-08-30 10:00:00+02'::timestamptz
  and lower(nombre) like '%introductoria%';

update public.clases
set
  nombre = 'Sesión Introductoria de Yoga',
  duracion_minutos = 75,
  fecha_fin = '2026-08-30 13:15:00+02'::timestamptz,
  capacidad_max = 10,
  tipo_clase = 'yoga',
  activa = true,
  es_gratuita = true
where fecha_inicio = '2026-08-30 12:00:00+02'::timestamptz
  and lower(nombre) like '%introductoria%';

notify pgrst, 'reload schema';

commit;

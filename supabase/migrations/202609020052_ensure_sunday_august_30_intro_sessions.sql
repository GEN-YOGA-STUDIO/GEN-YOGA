-- Migration 202609020052: Garantizar Sesiones Introductorias de Angel el Domingo 30 de Agosto
-- ==========================================================================================
-- Asegura que las 2 sesiones introductorias de Angel (10:00 y 12:00) queden registradas
-- en public.clases para el domingo 30 de agosto de 2026 como clases gratuitas de yoga.
-- ==========================================================================================

begin;

-- 1. Sesión de las 10:00 del domingo 30 de agosto
insert into public.clases (
  nombre,
  descripcion,
  fecha_inicio,
  fecha_fin,
  duracion_minutos,
  capacidad_max,
  profesor_id,
  tipo_clase,
  es_especial,
  es_gratuita,
  activa
)
select
  'Sesión Introductoria de Yoga',
  'Descubre nuestro espacio y conoce a nuestros maestros en una sesión guiada para todos los niveles con Ángel.',
  '2026-08-30 10:00:00+02'::timestamptz,
  '2026-08-30 11:15:00+02'::timestamptz,
  75,
  10,
  p.id,
  'yoga',
  false,
  true,
  true
from public.profesionales p
where (lower(coalesce(p.nombre, '')) like '%angel%' or lower(coalesce(p.nombre, '')) like '%ángel%')
  and not exists (
    select 1 from public.clases c
    where c.fecha_inicio = '2026-08-30 10:00:00+02'::timestamptz
      and c.profesor_id = p.id
  )
limit 1;

update public.clases
set
  nombre = 'Sesión Introductoria de Yoga',
  descripcion = 'Descubre nuestro espacio y conoce a nuestros maestros en una sesión guiada para todos los niveles con Ángel.',
  duracion_minutos = 75,
  fecha_inicio = '2026-08-30 10:00:00+02'::timestamptz,
  fecha_fin = '2026-08-30 11:15:00+02'::timestamptz,
  capacidad_max = 10,
  tipo_clase = 'yoga',
  es_especial = false,
  es_gratuita = true,
  activa = true
where fecha_inicio = '2026-08-30 10:00:00+02'::timestamptz
  and profesor_id in (
    select id from public.profesionales
    where lower(coalesce(nombre, '')) like '%angel%' or lower(coalesce(nombre, '')) like '%ángel%'
  );

-- 2. Sesión de las 12:00 del domingo 30 de agosto
insert into public.clases (
  nombre,
  descripcion,
  fecha_inicio,
  fecha_fin,
  duracion_minutos,
  capacidad_max,
  profesor_id,
  tipo_clase,
  es_especial,
  es_gratuita,
  activa
)
select
  'Sesión Introductoria de Yoga',
  'Descubre nuestro espacio y conoce a nuestros maestros en una sesión guiada para todos los niveles con Ángel.',
  '2026-08-30 12:00:00+02'::timestamptz,
  '2026-08-30 13:15:00+02'::timestamptz,
  75,
  10,
  p.id,
  'yoga',
  false,
  true,
  true
from public.profesionales p
where (lower(coalesce(p.nombre, '')) like '%angel%' or lower(coalesce(p.nombre, '')) like '%ángel%')
  and not exists (
    select 1 from public.clases c
    where c.fecha_inicio = '2026-08-30 12:00:00+02'::timestamptz
      and c.profesor_id = p.id
  )
limit 1;

update public.clases
set
  nombre = 'Sesión Introductoria de Yoga',
  descripcion = 'Descubre nuestro espacio y conoce a nuestros maestros en una sesión guiada para todos los niveles con Ángel.',
  duracion_minutos = 75,
  fecha_inicio = '2026-08-30 12:00:00+02'::timestamptz,
  fecha_fin = '2026-08-30 13:15:00+02'::timestamptz,
  capacidad_max = 10,
  tipo_clase = 'yoga',
  es_especial = false,
  es_gratuita = true,
  activa = true
where fecha_inicio = '2026-08-30 12:00:00+02'::timestamptz
  and profesor_id in (
    select id from public.profesionales
    where lower(coalesce(nombre, '')) like '%angel%' or lower(coalesce(nombre, '')) like '%ángel%'
  );

commit;

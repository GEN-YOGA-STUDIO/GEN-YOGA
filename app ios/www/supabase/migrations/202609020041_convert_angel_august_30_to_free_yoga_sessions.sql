-- ============================================================================
-- Migration 202609020041: Convert Ángel August 30 Classes to Free Intro Yoga
-- Convierte cualquier clase/taller de Ángel del domingo 30 de agosto de 2026
-- (10:00 y 12:00) a sesiones introductorias regulares de Yoga (es_gratuita = true,
-- es_especial = false, duracion = 75 min).
-- ============================================================================

begin;

-- 1. Actualizar la clase de las 10:00 (o cualquier clase de Ángel en esa franja)
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
where (fecha_inicio = '2026-08-30 10:00:00+02'::timestamptz or (fecha_inicio >= '2026-08-30 09:30:00+02'::timestamptz and fecha_inicio <= '2026-08-30 10:30:00+02'::timestamptz))
  and profesor_id in (
    select id from public.profesionales
    where lower(coalesce(nombre, '')) like '%angel%' or lower(coalesce(nombre, '')) like '%ángel%'
  );

-- 2. Actualizar la clase de las 12:00 (o cualquier clase de Ángel en esa franja)
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
where (fecha_inicio = '2026-08-30 12:00:00+02'::timestamptz or (fecha_inicio >= '2026-08-30 11:30:00+02'::timestamptz and fecha_inicio <= '2026-08-30 12:30:00+02'::timestamptz))
  and profesor_id in (
    select id from public.profesionales
    where lower(coalesce(nombre, '')) like '%angel%' or lower(coalesce(nombre, '')) like '%ángel%'
  );

-- 3. Insertar si no existiera la clase de las 10:00
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

-- 4. Insertar si no existiera la clase de las 12:00
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

notify pgrst, 'reload schema';

commit;

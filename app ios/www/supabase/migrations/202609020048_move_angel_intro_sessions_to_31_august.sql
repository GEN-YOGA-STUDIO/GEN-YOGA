-- Migration 202609020048: Asegurar sesiones introductorias de Ángel el lunes 31 de agosto de 2026
-- ==============================================================================
-- Crea/actualiza las 2 sesiones introductorias gratuitas de Yoga con Ángel:
-- 1) Lunes 31 de agosto de 2026 de 10:00 a 11:15 (75 min, 10 plazas, es_gratuita = true)
-- 2) Lunes 31 de agosto de 2026 de 12:00 a 13:15 (75 min, 10 plazas, es_gratuita = true)
-- ==============================================================================

begin;

-- 1. Eliminar cualquier sesión introductoria erróneamente sembrada en domingo 30 de agosto
delete from public.clases
where (fecha_inicio >= '2026-08-30 00:00:00+02' and fecha_inicio < '2026-08-31 00:00:00+02')
  and lower(nombre) like '%introductoria%';

-- 2. Asegurar la sesión de las 10:00 del lunes 31 de agosto de 2026
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
  es_especial,
  es_gratuita,
  activa
)
select
  'Sesión Introductoria de Yoga',
  'Descubre nuestro espacio y conoce a nuestros maestros en una sesión guiada para todos los niveles con Ángel.',
  '2026-08-31 10:00:00+02'::timestamptz,
  '2026-08-31 11:15:00+02'::timestamptz,
  75,
  10,
  t.profesor_id,
  'yoga',
  false,
  true,
  true
from teacher_angel t
where not exists (
  select 1 from public.clases c
  where c.fecha_inicio = '2026-08-31 10:00:00+02'::timestamptz
    and c.profesor_id = t.profesor_id
);

-- 3. Asegurar la sesión de las 12:00 del lunes 31 de agosto de 2026
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
  es_especial,
  es_gratuita,
  activa
)
select
  'Sesión Introductoria de Yoga',
  'Descubre nuestro espacio y conoce a nuestros maestros en una sesión guiada para todos los niveles con Ángel.',
  '2026-08-31 12:00:00+02'::timestamptz,
  '2026-08-31 13:15:00+02'::timestamptz,
  75,
  10,
  t.profesor_id,
  'yoga',
  false,
  true,
  true
from teacher_angel t
where not exists (
  select 1 from public.clases c
  where c.fecha_inicio = '2026-08-31 12:00:00+02'::timestamptz
    and c.profesor_id = t.profesor_id
);

-- 4. Actualizar propiedades si ya existían para garantizar visibilidad y gratuidad
update public.clases
set
  nombre = 'Sesión Introductoria de Yoga',
  descripcion = 'Descubre nuestro espacio y conoce a nuestros maestros en una sesión guiada para todos los niveles con Ángel.',
  duracion_minutos = 75,
  capacidad_max = 10,
  tipo_clase = 'yoga',
  es_especial = false,
  es_gratuita = true,
  activa = true
where fecha_inicio in ('2026-08-31 10:00:00+02'::timestamptz, '2026-08-31 12:00:00+02'::timestamptz)
  and profesor_id in (
    select id from public.profesionales
    where lower(coalesce(nombre, '')) like '%angel%' or lower(coalesce(nombre, '')) like '%ángel%'
  );

commit;

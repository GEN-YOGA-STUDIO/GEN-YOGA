-- ============================================================================
-- Migration 202609020044: Fix Schedule for Yanira Power Vinyasa Workshop
-- ============================================================================
-- Modifica el horario del taller "Introducción a Power Vinyasa" del
-- sábado 19 de septiembre de 2026 para que sea de 10:00 a 12:00 (120 min)
-- en lugar de 09:00 a 11:00.
-- ============================================================================

begin;

-- 1. Actualizar el horario del taller si ya existe registrado el 19 de septiembre
update public.clases
set
  fecha_inicio = '2026-09-19 10:00:00+02'::timestamptz,
  fecha_fin = '2026-09-19 12:00:00+02'::timestamptz,
  duracion_minutos = 120,
  descripcion = 'Inmersión completa de 2 horas (10:00 a 12:00) diseñada para aprender y consolidar los fundamentos de Power Vinyasa: alineación precisa, control del flujo respiratorio y transiciones fluidas.',
  capacidad_max = 10,
  tipo_clase = 'taller',
  activa = true,
  es_especial = true
where (fecha_inicio >= '2026-09-19 00:00:00+02'::timestamptz and fecha_inicio < '2026-09-20 00:00:00+02'::timestamptz)
  and (lower(nombre) like '%power vinyasa%' or lower(nombre) like '%introducci%');

-- 2. Asegurar que exista con el horario correcto (10:00 a 12:00) si no estuviera
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
  'Inmersión completa de 2 horas (10:00 a 12:00) diseñada para aprender y consolidar los fundamentos de Power Vinyasa: alineación precisa, control del flujo respiratorio y transiciones fluidas.',
  '2026-09-19 10:00:00+02'::timestamptz,
  '2026-09-19 12:00:00+02'::timestamptz,
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
  where existing.fecha_inicio >= '2026-09-19 00:00:00+02'::timestamptz
    and existing.fecha_inicio < '2026-09-20 00:00:00+02'::timestamptz
    and (lower(existing.nombre) like '%power vinyasa%' or lower(existing.nombre) like '%introducci%')
);

notify pgrst, 'reload schema';

commit;

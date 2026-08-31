-- ============================================================================
-- Migration 202609020020: Add special class and workshop with Yanira in September 2026
-- 1) Viernes 18 de septiembre 2026, 18:00 - 19:15 (75 min): "Yoga y Meditación"
-- 2) Sábado 19 de septiembre 2026, 09:00 - 11:00 (120 min): "Introducción a Power Vinyasa"
-- ============================================================================

begin;

-- 1. Asegurar tipo de clase Taller/Especial en tipos_clases
insert into public.tipos_clases (nombre, duracion_predeterminada, color, icono, activo, orden, categoria)
values
  ('Taller', 75, '#C07238', 'ph-chalkboard-teacher', true, 10, 'taller')
on conflict (nombre) do update set
  categoria = 'taller',
  activo = true;

-- 2. Limpiar versiones previas no reservadas si existieran para evitar duplicados
delete from public.clases
 where fecha_inicio in (
   '2026-09-18 18:00:00+02'::timestamptz,
   '2026-09-19 09:00:00+02'::timestamptz
 )
 and id not in (select clase_id from public.reservas_yoga where estado = 'confirmada');

-- 3. Insertar las dos sesiones especiales con Yanira
with yanira as (
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
  where lower(btrim(coalesce(nombre, ''))) in ('taller', 'clase especial')
     or lower(coalesce(categoria, '')) = 'taller'
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
  tipo_clase_id,
  es_especial,
  activa
)
select
  'Yoga y Meditación',
  'Clase especial de 75 minutos guiada por Yanira para profundizar en la respiración, la consciencia corporal y la meditación.',
  '2026-09-18 18:00:00+02'::timestamptz,
  '2026-09-18 19:15:00+02'::timestamptz,
  75,
  10,
  y.profesor_id,
  'taller',
  tt.tipo_id,
  true,
  true
from yanira y, taller_tipo tt
union all
select
  'Introducción a Power Vinyasa',
  'Taller intensivo de 2 horas guiado por Yanira: técnica de transiciones dinámicas, alineación postural y fluidez de Power Vinyasa.',
  '2026-09-19 09:00:00+02'::timestamptz,
  '2026-09-19 11:00:00+02'::timestamptz,
  120,
  10,
  y.profesor_id,
  'taller',
  tt.tipo_id,
  true,
  true
from yanira y, taller_tipo tt;

notify pgrst, 'reload schema';

commit;

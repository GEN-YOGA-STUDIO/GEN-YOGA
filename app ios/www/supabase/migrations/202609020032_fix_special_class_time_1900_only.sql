-- ============================================================================
-- Migration 202609020032: Fix Special Class Time - Keep ONLY 19:00h (75 min) on 18 Sep 2026
-- Elimina la errata duplicada de las 18:00h y garantiza que exista única y exclusivamente
-- la clase especial "Yoga y Meditación" a las 19:00h (19:00 a 20:15, 75 min).
-- ============================================================================

begin;

-- 1. Eliminar cualquier clase especial / taller duplicado a las 18:00h del 18 de septiembre
delete from public.clases
where fecha_inicio = '2026-09-18 18:00:00+02'::timestamptz
  and (lower(nombre) like '%meditaci%' or es_especial is true or tipo_clase in ('taller', 'especial'));

-- 2. Asegurar que exista de forma canónica y única la clase especial a las 19:00h
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
  'Práctica guiada de profundización de 75 minutos que combina asana suave con técnicas de pranayama y meditación profunda para calmar el sistema nervioso y restaurar el equilibrio interior.',
  '2026-09-18 19:00:00+02'::timestamptz,
  '2026-09-18 20:15:00+02'::timestamptz,
  75,
  10,
  y.profesor_id,
  'taller',
  tt.tipo_id,
  true,
  true
from yanira y, taller_tipo tt
where not exists (
  select 1
  from public.clases existing
  where existing.fecha_inicio = '2026-09-18 19:00:00+02'::timestamptz
    and lower(existing.nombre) like '%meditaci%'
);

-- 3. Actualizar los atributos exactos de la clase de las 19:00h
update public.clases
set
  nombre = 'Yoga y Meditación',
  descripcion = 'Práctica guiada de profundización de 75 minutos que combina asana suave con técnicas de pranayama y meditación profunda para calmar el sistema nervioso y restaurar el equilibrio interior.',
  fecha_inicio = '2026-09-18 19:00:00+02'::timestamptz,
  fecha_fin = '2026-09-18 20:15:00+02'::timestamptz,
  duracion_minutos = 75,
  capacidad_max = 10,
  tipo_clase = 'taller',
  activa = true,
  es_especial = true
where fecha_inicio = '2026-09-18 19:00:00+02'::timestamptz
  and lower(nombre) like '%meditaci%';

notify pgrst, 'reload schema';

commit;

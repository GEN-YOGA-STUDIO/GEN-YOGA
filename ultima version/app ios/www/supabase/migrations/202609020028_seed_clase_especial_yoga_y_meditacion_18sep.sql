-- ============================================================================
-- Migration 202609020028: Seed & Enforce Clase Especial: Yoga y Meditación (18 Sep 2026, 19:00 - 75 min)
-- ============================================================================

begin;

-- 1. Asegurar tipo de clase en public.tipos_clases
insert into public.tipos_clases (nombre, duracion_predeterminada, color, icono, activo, orden, categoria)
select 'Yoga y Meditación', 75, '#6a6540', 'ph-sparkle', true, 50, 'taller'
where not exists (
  select 1 from public.tipos_clases where lower(btrim(nombre)) in ('yoga y meditación', 'yoga y meditacion')
);

-- 2. Asegurar Clase Especial: Yoga y Meditación (Viernes 18 Sept 2026, 19:00 a 20:15)
with teacher as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%yanira%'
  order by id
  limit 1
),
taller_style as (
  select id as tipo_clase_id
  from public.tipos_clases
  where lower(btrim(nombre)) in ('yoga y meditación', 'yoga y meditacion')
     or categoria = 'taller'
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
  'Práctica guiada de profundización que combina asana suave con técnicas de pranayama y meditación profunda para calmar el sistema nervioso y restaurar el equilibrio interior.',
  '2026-09-18 19:00:00+02'::timestamptz,
  '2026-09-18 20:15:00+02'::timestamptz,
  75,
  10,
  t.profesor_id,
  'taller',
  ts.tipo_clase_id,
  true,
  true
from teacher t
left join taller_style ts on true
where not exists (
  select 1
  from public.clases existing
  where existing.fecha_inicio = '2026-09-18 19:00:00+02'::timestamptz
);

-- Actualizar clase existente para garantizar todos los atributos requeridos
with teacher as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%yanira%'
  order by id
  limit 1
),
taller_style as (
  select id as tipo_clase_id
  from public.tipos_clases
  where lower(btrim(nombre)) in ('yoga y meditación', 'yoga y meditacion')
     or categoria = 'taller'
  order by (case when lower(btrim(nombre)) in ('yoga y meditación', 'yoga y meditacion') then 1 else 2 end)
  limit 1
)
update public.clases
set
  nombre = 'Yoga y Meditación',
  descripcion = 'Práctica guiada de profundización que combina asana suave con técnicas de pranayama y meditación profunda para calmar el sistema nervioso y restaurar el equilibrio interior.',
  fecha_fin = '2026-09-18 20:15:00+02'::timestamptz,
  duracion_minutos = 75,
  capacidad_max = 10,
  tipo_clase = 'taller',
  tipo_clase_id = (select tipo_clase_id from taller_style),
  profesor_id = (select profesor_id from teacher),
  activa = true,
  es_especial = true
where fecha_inicio = '2026-09-18 19:00:00+02'::timestamptz;

notify pgrst, 'reload schema';

commit;

-- ============================================================================
-- Migration 202609020040: Seed Miriam Free Introductory Sessions
-- ============================================================================
-- Crea las sesiones gratuitas e introductorias de Miriam:
-- 1. Martes 1 de septiembre de 2026 a las 20:15 h (duración 60 min, 10 plazas, es_gratuita = true)
-- 2. Miércoles 2 de septiembre de 2026 a las 11:30 h (duración 60 min, 10 plazas, es_gratuita = true)
-- ============================================================================

begin;

-- 1. Sesión gratuita de Miriam: Martes 1 de septiembre a las 20:15
insert into public.clases (
  nombre,
  fecha_inicio,
  fecha_fin,
  duracion_minutos,
  capacidad_max,
  profesor_id,
  tipo_clase,
  activa,
  es_gratuita,
  descripcion
)
select
  'Sesión Introductoria de Psicología',
  '2026-09-01 20:15:00+02'::timestamptz,
  '2026-09-01 21:15:00+02'::timestamptz,
  60,
  10,
  p.id,
  'psicologia',
  true,
  true,
  'Sesión introductoria y gratuita de Psicología con Miriam'
from public.profesionales p
where (lower(coalesce(p.nombre, '')) like '%miriam%' or lower(coalesce(p.email, '')) like 'miriam%')
  and not exists (
    select 1
    from public.clases existing
    where existing.fecha_inicio = '2026-09-01 20:15:00+02'::timestamptz
      and existing.profesor_id = p.id
      and existing.activa = true
  )
limit 1;

-- 2. Sesión gratuita de Miriam: Miércoles 2 de septiembre a las 11:30
insert into public.clases (
  nombre,
  fecha_inicio,
  fecha_fin,
  duracion_minutos,
  capacidad_max,
  profesor_id,
  tipo_clase,
  activa,
  es_gratuita,
  descripcion
)
select
  'Sesión Introductoria de Psicología',
  '2026-09-02 11:30:00+02'::timestamptz,
  '2026-09-02 12:30:00+02'::timestamptz,
  60,
  10,
  p.id,
  'psicologia',
  true,
  true,
  'Sesión introductoria y gratuita de Psicología con Miriam'
from public.profesionales p
where (lower(coalesce(p.nombre, '')) like '%miriam%' or lower(coalesce(p.email, '')) like 'miriam%')
  and not exists (
    select 1
    from public.clases existing
    where existing.fecha_inicio = '2026-09-02 11:30:00+02'::timestamptz
      and existing.profesor_id = p.id
      and existing.activa = true
  )
limit 1;

notify pgrst, 'reload schema';

commit;

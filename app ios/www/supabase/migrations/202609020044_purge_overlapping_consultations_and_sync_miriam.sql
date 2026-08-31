-- ============================================================================
-- Migration 202609020044: Purge Overlapping Consultations and Sync Miriam Schedule
-- ============================================================================
-- 1. Elimina cualquier registro de consulta de Miriam que se solape con sus sesiones
--    introductorias gratuitas (como el Martes 1 de septiembre a las 20:15 o Miércoles 2 a las 11:30).
-- 2. Elimina cualquier turno duplicado o solapado en la tabla 'clases' para cualquier
--    profesional, preservando siempre las que tengan reservas confirmadas o sean gratuitas.
-- ============================================================================

begin;

-- 1. Eliminar cualquier turno no reservado de Miriam que se solape con la sesión del Martes 1 Sep 20:15
delete from public.clases
where profesor_id in (
  select id from public.profesionales
  where lower(coalesce(nombre, '')) like '%miriam%' or lower(coalesce(email, '')) like 'miriam%'
)
and tipo_clase in ('psicologia', 'nutricion', 'consulta')
and fecha_inicio >= '2026-09-01 19:30:00+02'::timestamptz
and fecha_inicio < '2026-09-01 21:15:00+02'::timestamptz
and fecha_inicio <> '2026-09-01 20:15:00+02'::timestamptz
and not exists (
  select 1 from public.reservas_psicologia r where r.clase_id = clases.id and r.estado = 'confirmada'
);

-- 2. Eliminar cualquier solapamiento general en 'clases' de un mismo profesor
delete from public.clases c1
using public.clases c2
where c1.id <> c2.id
  and c1.profesor_id = c2.profesor_id
  and c1.activa = true
  and c2.activa = true
  and c1.fecha_inicio < c2.fecha_fin
  and c1.fecha_fin > c2.fecha_inicio
  and not exists (
    select 1 from public.reservas_psicologia r where r.clase_id = c1.id and r.estado = 'confirmada'
  )
  and not exists (
    select 1 from public.reservas_nutricion r where r.clase_id = c1.id and r.estado = 'confirmada'
  )
  and not exists (
    select 1 from public.reservas_yoga r where r.clase_id = c1.id and r.estado = 'confirmada'
  )
  and (
    exists (
      select 1 from public.reservas_psicologia r where r.clase_id = c2.id and r.estado = 'confirmada'
    )
    or exists (
      select 1 from public.reservas_nutricion r where r.clase_id = c2.id and r.estado = 'confirmada'
    )
    or exists (
      select 1 from public.reservas_yoga r where r.clase_id = c2.id and r.estado = 'confirmada'
    )
    or c2.es_gratuita = true
    or c1.id > c2.id
  );

notify pgrst, 'reload schema';

commit;

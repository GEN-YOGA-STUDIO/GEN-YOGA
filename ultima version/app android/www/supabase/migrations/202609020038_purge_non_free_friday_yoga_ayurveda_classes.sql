-- ============================================================================
-- Migration 202609020038: Purge Non-Free Friday Yoga Ayurveda Classes
-- ============================================================================
-- Elimina las clases no gratuitas de 'Yoga Ayurveda' de los viernes alternos
-- para conservar únicamente la clase gratuita válida ("Sesión Introductoria al Yoga y Ayurveda").
-- ============================================================================

begin;

-- 1. Eliminar posibles reservas vinculadas a estas clases duplicadas
delete from public.reservas_yoga
where clase_id in (
  select c.id
  from public.clases c
  where extract(isodow from (c.fecha_inicio at time zone 'Europe/Madrid')) = 5 -- Viernes
    and lower(c.nombre) like '%yoga ayurveda%'
    and coalesce(c.es_gratuita, false) is false
);

-- 2. Eliminar las clases no gratuitas de Yoga Ayurveda de los viernes
delete from public.clases
where extract(isodow from (fecha_inicio at time zone 'Europe/Madrid')) = 5 -- Viernes
  and lower(nombre) like '%yoga ayurveda%'
  and coalesce(es_gratuita, false) is false;

notify pgrst, 'reload schema';

commit;

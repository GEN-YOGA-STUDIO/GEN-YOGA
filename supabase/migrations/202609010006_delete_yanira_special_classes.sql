begin;

-- 1. Desactivar clases especiales (talleres) de Yanira que tengan reservas confirmadas (para preservar historial)
with yanira as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%yanira%'
     or lower(coalesce(email, '')) like 'yanira%'
  order by id
  limit 1
)
update public.clases c
set activa = false
from yanira y
where c.profesor_id = y.profesor_id
  and (c.es_especial is true or lower(btrim(coalesce(c.tipo_clase, ''))) = 'taller')
  and c.id in (select clase_id from public.reservas_yoga where estado = 'confirmada');

-- 2. Eliminar todas las clases especiales (talleres) de Yanira que no tengan reservas confirmadas
with yanira as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%yanira%'
     or lower(coalesce(email, '')) like 'yanira%'
  order by id
  limit 1
)
delete from public.clases c
using yanira y
where c.profesor_id = y.profesor_id
  and (c.es_especial is true or lower(btrim(coalesce(c.tipo_clase, ''))) = 'taller')
  and c.id not in (select clase_id from public.reservas_yoga where estado = 'confirmada');

notify pgrst, 'reload schema';

commit;

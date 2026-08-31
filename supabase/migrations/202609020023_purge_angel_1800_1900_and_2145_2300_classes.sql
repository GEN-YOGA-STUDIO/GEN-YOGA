-- ============================================================================
-- Migration 202609020023: Purge Ángel 18:00-19:00 and 21:45-23:00 classes
-- ============================================================================

begin;

-- 1. Eliminar reservas asociadas a las clases de 18:00-19:00 o 21:45-23:00 de Ángel
with angel_teachers as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%angel%'
     or lower(coalesce(nombre, '')) like '%ángel%'
     or lower(coalesce(email, '')) like 'angel%'
),
classes_to_delete as (
  select c.id
  from public.clases c
  join angel_teachers at on c.profesor_id = at.profesor_id
  where (
    -- Franja 18:00 - 19:00 (duración 60 min)
    (to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') = '18:00'
     and (c.duracion_minutos = 60 or to_char(c.fecha_fin at time zone 'Europe/Madrid', 'HH24:MI') = '19:00'))
    -- Franja 21:45 - 23:00 o cualquier inicio a partir de las 21:00
    or to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') >= '21:00'
    or to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') = '21:45'
    or to_char(c.fecha_fin at time zone 'Europe/Madrid', 'HH24:MI') = '23:00'
  )
)
delete from public.reservas_yoga
 where clase_id in (select id from classes_to_delete);

-- 2. Eliminar definitivamente las clases inválidas de Ángel
with angel_teachers as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%angel%'
     or lower(coalesce(nombre, '')) like '%ángel%'
     or lower(coalesce(email, '')) like 'angel%'
)
delete from public.clases c
using angel_teachers at
where c.profesor_id = at.profesor_id
  and (
    -- Franja 18:00 - 19:00 (duración 60 min)
    (to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') = '18:00'
     and (c.duracion_minutos = 60 or to_char(c.fecha_fin at time zone 'Europe/Madrid', 'HH24:MI') = '19:00'))
    -- Franja 21:45 - 23:00 o cualquier inicio a partir de las 21:00
    or to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') >= '21:00'
    or to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') = '21:45'
    or to_char(c.fecha_fin at time zone 'Europe/Madrid', 'HH24:MI') = '23:00'
  );

-- 3. Trigger para rechazar de raíz la creación de clases de 18:00-19:00 o >= 21:00 para Ángel
create or replace function public.fn_reject_angel_invalid_slots()
returns trigger
language plpgsql
as $$
declare
  v_is_angel boolean;
  v_start_madrid text;
  v_end_madrid text;
begin
  select exists(
    select 1
    from public.profesionales p
    where p.id = new.profesor_id
      and (lower(coalesce(p.nombre, '')) like '%angel%'
           or lower(coalesce(p.nombre, '')) like '%ángel%'
           or lower(coalesce(p.email, '')) like 'angel%')
  ) into v_is_angel;

  if v_is_angel then
    v_start_madrid := to_char(new.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI');
    v_end_madrid := to_char(new.fecha_fin at time zone 'Europe/Madrid', 'HH24:MI');

    -- Prohibir 18:00 a 19:00 (debe ser 18:00 a 19:15)
    if v_start_madrid = '18:00' and (new.duracion_minutos = 60 or v_end_madrid = '19:00') then
      raise exception 'Horario inválido para Ángel: las clases de las 18:00 deben ser de 75 min (18:00 a 19:15), no de 18:00 a 19:00';
    end if;

    -- Prohibir clases tardías (>= 21:00 o 21:45 a 23:00)
    if v_start_madrid >= '21:00' or v_start_madrid = '21:45' or v_end_madrid = '23:00' then
      raise exception 'Horario inválido para Ángel: no existen clases a partir de las 21:00 ni de 21:45 a 23:00';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_reject_angel_invalid_slots on public.clases;
create trigger trg_reject_angel_invalid_slots
before insert or update on public.clases
for each row
execute function public.fn_reject_angel_invalid_slots();

-- 4. Asegurar que las 3 clases válidas de Ángel (Lunes y Miércoles 16:15, 18:00 y 19:45) tengan 10 plazas
with angel_teachers as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%angel%'
     or lower(coalesce(nombre, '')) like '%ángel%'
     or lower(coalesce(email, '')) like 'angel%'
)
update public.clases c
set
  capacidad_max = 10,
  activa = true
from angel_teachers at
where c.profesor_id = at.profesor_id
  and to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') in ('16:15', '18:00', '19:45');

notify pgrst, 'reload schema';

commit;

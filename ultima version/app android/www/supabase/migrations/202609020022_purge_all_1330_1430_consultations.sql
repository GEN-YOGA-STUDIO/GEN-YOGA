-- ============================================================================
-- Migration 202609020022: Total Purge of 13:30-14:30 Consultations and Classes
-- ============================================================================

begin;

-- 1. Eliminar reservas asociadas a turnos de 13:30 a 14:30
delete from public.reservas_psicologia
 where clase_id in (
   select id from public.clases
    where (
      (extract(hour from fecha_inicio at time zone 'Europe/Madrid') = 13 and extract(minute from fecha_inicio at time zone 'Europe/Madrid') >= 30)
      or (extract(hour from fecha_inicio at time zone 'Europe/Madrid') = 14 and extract(minute from fecha_inicio at time zone 'Europe/Madrid') < 30)
      or (extract(hour from fecha_inicio) = 13 and extract(minute from fecha_inicio) >= 30)
      or (extract(hour from fecha_inicio) = 14 and extract(minute from fecha_inicio) < 30)
      or (extract(hour from fecha_inicio at time zone 'UTC') = 13 and extract(minute from fecha_inicio at time zone 'UTC') >= 30)
      or (extract(hour from fecha_inicio at time zone 'UTC') = 14 and extract(minute from fecha_inicio at time zone 'UTC') < 30)
      or to_char(fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') = '13:30'
      or to_char(fecha_inicio at time zone 'UTC', 'HH24:MI') = '13:30'
      or to_char(fecha_inicio, 'HH24:MI') = '13:30'
    )
 );

delete from public.reservas_nutricion
 where clase_id in (
   select id from public.clases
    where (
      (extract(hour from fecha_inicio at time zone 'Europe/Madrid') = 13 and extract(minute from fecha_inicio at time zone 'Europe/Madrid') >= 30)
      or (extract(hour from fecha_inicio at time zone 'Europe/Madrid') = 14 and extract(minute from fecha_inicio at time zone 'Europe/Madrid') < 30)
      or (extract(hour from fecha_inicio) = 13 and extract(minute from fecha_inicio) >= 30)
      or (extract(hour from fecha_inicio) = 14 and extract(minute from fecha_inicio) < 30)
      or (extract(hour from fecha_inicio at time zone 'UTC') = 13 and extract(minute from fecha_inicio at time zone 'UTC') >= 30)
      or (extract(hour from fecha_inicio at time zone 'UTC') = 14 and extract(minute from fecha_inicio at time zone 'UTC') < 30)
      or to_char(fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') = '13:30'
      or to_char(fecha_inicio at time zone 'UTC', 'HH24:MI') = '13:30'
      or to_char(fecha_inicio, 'HH24:MI') = '13:30'
    )
 );

delete from public.reservas_yoga
 where clase_id in (
   select id from public.clases
    where (
      (extract(hour from fecha_inicio at time zone 'Europe/Madrid') = 13 and extract(minute from fecha_inicio at time zone 'Europe/Madrid') >= 30)
      or (extract(hour from fecha_inicio at time zone 'Europe/Madrid') = 14 and extract(minute from fecha_inicio at time zone 'Europe/Madrid') < 30)
      or (extract(hour from fecha_inicio) = 13 and extract(minute from fecha_inicio) >= 30)
      or (extract(hour from fecha_inicio) = 14 and extract(minute from fecha_inicio) < 30)
      or (extract(hour from fecha_inicio at time zone 'UTC') = 13 and extract(minute from fecha_inicio at time zone 'UTC') >= 30)
      or (extract(hour from fecha_inicio at time zone 'UTC') = 14 and extract(minute from fecha_inicio at time zone 'UTC') < 30)
      or to_char(fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') = '13:30'
      or to_char(fecha_inicio at time zone 'UTC', 'HH24:MI') = '13:30'
      or to_char(fecha_inicio, 'HH24:MI') = '13:30'
    )
 );

-- 2. Eliminar completamente de la tabla public.clases todos los turnos entre 13:30 y 14:30
delete from public.clases
 where (
   (extract(hour from fecha_inicio at time zone 'Europe/Madrid') = 13 and extract(minute from fecha_inicio at time zone 'Europe/Madrid') >= 30)
   or (extract(hour from fecha_inicio at time zone 'Europe/Madrid') = 14 and extract(minute from fecha_inicio at time zone 'Europe/Madrid') < 30)
   or (extract(hour from fecha_inicio) = 13 and extract(minute from fecha_inicio) >= 30)
   or (extract(hour from fecha_inicio) = 14 and extract(minute from fecha_inicio) < 30)
   or (extract(hour from fecha_inicio at time zone 'UTC') = 13 and extract(minute from fecha_inicio at time zone 'UTC') >= 30)
   or (extract(hour from fecha_inicio at time zone 'UTC') = 14 and extract(minute from fecha_inicio at time zone 'UTC') < 30)
   or to_char(fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') = '13:30'
   or to_char(fecha_inicio at time zone 'UTC', 'HH24:MI') = '13:30'
   or to_char(fecha_inicio, 'HH24:MI') = '13:30'
 );

-- 3. Trigger para impedir que se cree o guarde jamás una clase o consulta entre 13:30 y 14:30
create or replace function public.reject_1330_to_1430_slots()
returns trigger
language plpgsql
as $$
declare
  v_madrid_time text;
begin
  v_madrid_time := to_char(new.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI');
  if v_madrid_time >= '13:30' and v_madrid_time < '14:30' then
    raise exception 'El intervalo horario de 13:30 a 14:30 está deshabilitado para consultas y clases.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reject_1330_to_1430_slots on public.clases;
create trigger trg_reject_1330_to_1430_slots
  before insert or update on public.clases
  for each row
  execute function public.reject_1330_to_1430_slots();

notify pgrst, 'reload schema';

commit;

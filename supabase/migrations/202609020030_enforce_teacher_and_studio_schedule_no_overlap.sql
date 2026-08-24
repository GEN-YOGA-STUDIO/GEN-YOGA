-- ============================================================================
-- Migration 202609020030: Enforce Teacher and Studio Schedule Overlap Prevention
-- ============================================================================
-- Previene que:
--   1. Un mismo profesor/a tenga 2 clases o consultas activas a la misma hora.
--   2. Dos clases presenciales de estudio (yoga / taller) coincidan en la misma sala a la misma hora.
-- ============================================================================

begin;

create or replace function public.check_clases_schedule_no_overlap()
returns trigger
language plpgsql
security definer
as 
declare
  v_conflict record;
begin
  -- Solo validar si la clase está activa y tiene fechas válidas
  if new.activa = false or new.fecha_inicio is null or new.fecha_fin is null then
    return new;
  end if;

  -- 1. Validar que el mismo profesor/a no tenga otra clase o consulta solapada
  if new.profesor_id is not null then
    select c.id, c.nombre, c.fecha_inicio, c.fecha_fin, coalesce(p.nombre, '') || ' ' || coalesce(p.apellidos, '') as prof_name
      into v_conflict
      from public.clases c
      left join public.profesionales p on p.id = c.profesor_id
     where c.profesor_id = new.profesor_id
       and c.activa = true
       and c.id <> coalesce(new.id, 0)
       and (new.fecha_inicio < c.fecha_fin and new.fecha_fin > c.fecha_inicio)
     limit 1;

    if v_conflict.id is not null then
      raise exception 'Conflicto de horario: % ya tiene la clase o sesión "%" de % a %',
        trim(v_conflict.prof_name),
        v_conflict.nombre,
        to_char(v_conflict.fecha_inicio at time zone 'Europe/Madrid', 'YYYY-MM-DD HH24:MI'),
        to_char(v_conflict.fecha_fin at time zone 'Europe/Madrid', 'HH24:MI');
    end if;
  end if;

  -- 2. Validar que no haya dos clases presenciales de estudio (yoga / taller) solapadas en la sala
  if lower(btrim(coalesce(new.tipo_clase, 'yoga'))) in ('yoga', 'taller', 'especial', '')
     or new.tipo_clase is null
     or lower(btrim(coalesce(new.tipo_clase, ''))) not in ('psicologia', 'nutricion') then

    select c.id, c.nombre, c.fecha_inicio, c.fecha_fin, coalesce(p.nombre, '') || ' ' || coalesce(p.apellidos, '') as prof_name
      into v_conflict
      from public.clases c
      left join public.profesionales p on p.id = c.profesor_id
     where (
       lower(btrim(coalesce(c.tipo_clase, 'yoga'))) in ('yoga', 'taller', 'especial', '')
       or c.tipo_clase is null
       or lower(btrim(coalesce(c.tipo_clase, ''))) not in ('psicologia', 'nutricion')
     )
       and c.activa = true
       and c.id <> coalesce(new.id, 0)
       and (new.fecha_inicio < c.fecha_fin and new.fecha_fin > c.fecha_inicio)
     limit 1;

    if v_conflict.id is not null then
      raise exception 'Conflicto de sala en el estudio: ya existe la clase "%" (con %) de % a %',
        v_conflict.nombre,
        trim(v_conflict.prof_name),
        to_char(v_conflict.fecha_inicio at time zone 'Europe/Madrid', 'YYYY-MM-DD HH24:MI'),
        to_char(v_conflict.fecha_fin at time zone 'Europe/Madrid', 'HH24:MI');
    end if;
  end if;

  return new;
end;
;

drop trigger if exists trg_check_clases_schedule_no_overlap on public.clases;
create trigger trg_check_clases_schedule_no_overlap
  before insert or update on public.clases
  for each row
  execute function public.check_clases_schedule_no_overlap();

commit;

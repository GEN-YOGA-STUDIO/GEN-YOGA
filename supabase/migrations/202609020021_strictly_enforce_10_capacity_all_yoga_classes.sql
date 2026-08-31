-- ============================================================================
-- Migration 202609020021: Strictly enforce 10 capacity on all yoga classes & workshops
-- ============================================================================

begin;

-- 1. Actualizar TODAS las clases de Yoga y Talleres existentes en la base de datos a capacidad_max = 10
update public.clases
   set capacidad_max = 10
 where (
   lower(btrim(coalesce(tipo_clase, ''))) in ('yoga', 'taller', 'especial', '')
   or tipo_clase is null
   or lower(btrim(coalesce(tipo_clase, ''))) not in ('psicologia', 'nutricion')
 );

-- 2. Asegurar que las consultas individuales tengan capacidad_max = 1
update public.clases
   set capacidad_max = 1
 where lower(btrim(coalesce(tipo_clase, ''))) in ('psicologia', 'nutricion');

-- 3. Fijar el DEFAULT de la columna capacidad_max a 10
alter table public.clases alter column capacidad_max set default 10;

-- 4. Trigger permanente para garantizar que ninguna clase de yoga/taller se cree o actualice jamás con > 10 plazas
create or replace function public.enforce_capacidad_max_rules()
returns trigger
language plpgsql
as $$
begin
  if lower(btrim(coalesce(new.tipo_clase, 'yoga'))) in ('yoga', 'taller', 'especial', '')
     or new.tipo_clase is null
     or lower(btrim(coalesce(new.tipo_clase, ''))) not in ('psicologia', 'nutricion') then
    if new.capacidad_max is null or new.capacidad_max <> 10 then
      new.capacidad_max := 10;
    end if;
  elsif lower(btrim(coalesce(new.tipo_clase, ''))) in ('psicologia', 'nutricion') then
    new.capacidad_max := 1;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_capacidad_max on public.clases;
create trigger trg_enforce_capacidad_max
  before insert or update on public.clases
  for each row
  execute function public.enforce_capacidad_max_rules();

-- 5. Actualizar la función get_public_weekly_schedule para que siempre devuelva 10
create or replace function public.get_public_weekly_schedule(
  p_start_date date,
  p_end_date date
)
returns table (
  id bigint,
  nombre text,
  fecha_inicio timestamptz,
  fecha_fin timestamptz,
  duracion_minutos integer,
  capacidad_max integer,
  profesor_id bigint,
  profesor_nombre text,
  profesor_apellidos text,
  profesor_color text,
  plazas_libres integer,
  ocupadas integer,
  completa boolean,
  tipo_clase text,
  tipo_clase_id bigint
)
language sql
security definer
set search_path = public, pg_temp
as $$
  with confirmed_bookings as (
    select
      r.clase_id,
      count(*)::integer as total
    from public.reservas_yoga r
    where r.estado = 'confirmada'
    group by r.clase_id
  )
  select
    c.id,
    c.nombre,
    c.fecha_inicio,
    c.fecha_fin,
    c.duracion_minutos,
    case
      when lower(btrim(coalesce(c.tipo_clase, ''))) in ('yoga', 'taller') or c.tipo_clase is null then 10
      else least(coalesce(c.capacidad_max, 1), 1)::integer
    end as capacidad_max,
    c.profesor_id,
    p.nombre as profesor_nombre,
    p.apellidos as profesor_apellidos,
    p.color as profesor_color,
    case
      when lower(btrim(coalesce(c.tipo_clase, ''))) in ('yoga', 'taller') or c.tipo_clase is null
        then greatest(0, 10 - coalesce(confirmed.total, 0))::integer
      else greatest(0, least(coalesce(c.capacidad_max, 1), 1) - coalesce(confirmed.total, 0))::integer
    end as plazas_libres,
    coalesce(confirmed.total, 0)::integer as ocupadas,
    case
      when lower(btrim(coalesce(c.tipo_clase, ''))) in ('yoga', 'taller') or c.tipo_clase is null
        then (coalesce(confirmed.total, 0) >= 10)
      else (coalesce(confirmed.total, 0) >= least(coalesce(c.capacidad_max, 1), 1))
    end as completa,
    lower(btrim(coalesce(c.tipo_clase, 'yoga')))::text as tipo_clase,
    c.tipo_clase_id::bigint as tipo_clase_id
  from public.clases c
  join public.profesionales p on p.id = c.profesor_id
  left join confirmed_bookings confirmed on confirmed.clase_id = c.id
  where c.activa = true
    and c.fecha_inicio >= (p_start_date::timestamptz at time zone 'Europe/Madrid')
    and c.fecha_inicio < ((p_end_date + 1)::timestamptz at time zone 'Europe/Madrid')
    and lower(btrim(coalesce(c.tipo_clase, ''))) in ('yoga', 'taller')
  order by c.fecha_inicio asc;
$$;

revoke all on function public.get_public_weekly_schedule(date, date) from public, anon;
grant execute on function public.get_public_weekly_schedule(date, date) to anon, authenticated;

notify pgrst, 'reload schema';

commit;

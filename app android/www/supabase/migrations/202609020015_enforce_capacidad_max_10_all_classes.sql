-- ============================================================================
-- Migration 202609020015: Enforce Max Capacity 10 on All Group Classes & RPC
-- ============================================================================

begin;

-- 1. Actualizar capacidad de todas las clases grupales existentes a 10
update public.clases
   set capacidad_max = 10
 where (lower(btrim(coalesce(tipo_clase, ''))) in ('yoga', 'taller') or tipo_clase is null)
   and (capacidad_max is null or capacidad_max <> 10);

-- 2. Asegurar que las consultas individuales mantengan capacidad 1
update public.clases
   set capacidad_max = 1
 where lower(btrim(coalesce(tipo_clase, ''))) in ('psicologia', 'nutricion');

-- 3. Establecer valor por defecto 10
alter table public.clases alter column capacidad_max set default 10;

-- 4. Actualizar la funcion get_public_weekly_schedule asegurando max 10 plazas
create or replace function public.get_public_weekly_schedule(p_week_start date default null)
returns table (
  id bigint,
  nombre text,
  fecha_inicio timestamptz,
  fecha_fin timestamptz,
  duracion_minutos integer,
  capacidad_max integer,
  ocupadas integer,
  plazas_libres integer,
  completa boolean,
  profesor_id bigint,
  profesor_nombre text,
  profesor_apellidos text,
  profesor_color text,
  tipo_clase text,
  tipo_clase_id bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  with requested_week as (
    select date_trunc(
      'week',
      coalesce(
        p_week_start,
        (now() at time zone 'Europe/Madrid')::date
      )::timestamp
    )::date as monday_local
  ),
  week_bounds as (
    select
      monday_local::timestamp at time zone 'Europe/Madrid' as starts_at,
      (monday_local + 7)::timestamp at time zone 'Europe/Madrid' as ends_at
    from requested_week
  )
  select
    c.id::bigint as id,
    c.nombre::text as nombre,
    c.fecha_inicio::timestamptz as fecha_inicio,
    c.fecha_fin::timestamptz as fecha_fin,
    c.duracion_minutos::integer as duracion_minutos,
    case
      when lower(btrim(coalesce(c.tipo_clase, ''))) = 'yoga' then least(coalesce(c.capacidad_max, 10), 10)::integer
      else coalesce(c.capacidad_max, 10)::integer
    end as capacidad_max,
    coalesce(booking_count.ocupadas, 0)::integer as ocupadas,
    greatest(
      case
        when lower(btrim(coalesce(c.tipo_clase, ''))) = 'yoga' then least(coalesce(c.capacidad_max, 10), 10)::integer
        else coalesce(c.capacidad_max, 10)::integer
      end - coalesce(booking_count.ocupadas, 0)::integer,
      0
    )::integer as plazas_libres,
    (
      case
        when lower(btrim(coalesce(c.tipo_clase, ''))) = 'yoga' then least(coalesce(c.capacidad_max, 10), 10)::integer
        else coalesce(c.capacidad_max, 10)::integer
      end <= coalesce(booking_count.ocupadas, 0)::integer
    ) as completa,
    professional.id::bigint as profesor_id,
    professional.nombre::text as profesor_nombre,
    professional.apellidos::text as profesor_apellidos,
    professional.color::text as profesor_color,
    lower(btrim(c.tipo_clase))::text as tipo_clase,
    c.tipo_clase_id::bigint as tipo_clase_id
  from public.clases as c
  cross join week_bounds
  join public.profesionales as professional
    on professional.id = c.profesor_id
   and professional.visible_publico is true
  left join lateral (
    select count(*)::integer as ocupadas
    from public.reservas_yoga as booking
    where booking.clase_id = c.id
      and booking.estado = 'confirmada'
  ) as booking_count on true
  where c.activa is true
    and lower(btrim(coalesce(c.tipo_clase, ''))) in ('yoga', 'taller')
    and c.fecha_inicio >= week_bounds.starts_at
    and c.fecha_inicio < week_bounds.ends_at
  order by c.fecha_inicio, c.id;
$function$;

revoke all on function public.get_public_weekly_schedule(date)
  from public, anon, authenticated;
grant execute on function public.get_public_weekly_schedule(date)
  to anon, authenticated;

notify pgrst, 'reload schema';

commit;

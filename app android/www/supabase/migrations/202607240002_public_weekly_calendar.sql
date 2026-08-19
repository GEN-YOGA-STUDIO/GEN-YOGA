begin;

-- Correct the legacy public label before linking historical classes to their
-- configured type. Future classes already persist tipo_clase_id from the app.
update public.tipos_clases
set nombre = 'Yoga Ayurveda'
where lower(btrim(coalesce(nombre, ''))) = 'yoga aryuveda';

update public.clases
set nombre = 'Yoga Ayurveda'
where lower(btrim(coalesce(nombre, ''))) = 'yoga aryuveda';

-- Production inherited an incorrect foreign key from tipo_clase_id to
-- tipos_servicios. The application stores yoga style IDs from tipos_clases in
-- this column, and historical rows are still NULL, so repair the relationship
-- before backfilling the configured styles.
alter table public.clases
  drop constraint if exists clases_tipo_clase_id_fkey;
alter table public.clases
  add constraint clases_tipo_clase_id_fkey
  foreign key (tipo_clase_id) references public.tipos_clases(id) on delete set null;

update public.clases as c
set tipo_clase_id = tc.id
from public.tipos_clases as tc
where c.tipo_clase_id is null
  and lower(btrim(coalesce(c.nombre, '')))
      = lower(btrim(coalesce(tc.nombre, '')));

-- Public schedule lookups are always bounded to one Madrid calendar week.
-- The partial index excludes inactive and private appointment slots, while
-- keeping both regular yoga classes and public weekend workshops efficient.
create index if not exists clases_public_weekly_schedule_idx
  on public.clases (fecha_inicio, profesor_id)
  where activa is true
    and lower(btrim(coalesce(tipo_clase, ''))) in ('yoga', 'taller');

-- Availability is derived from confirmed bookings instead of trusting the
-- denormalized clases.plazas_reservadas value, which may be stale.
create index if not exists reservas_yoga_confirmadas_clase_idx
  on public.reservas_yoga (clase_id)
  where estado = 'confirmada';

create or replace function public.get_public_weekly_schedule(
  p_week_start date default null
)
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
    coalesce(c.capacidad_max, 0)::integer as capacidad_max,
    coalesce(booking_count.ocupadas, 0)::integer as ocupadas,
    greatest(
      coalesce(c.capacidad_max, 0)::integer
        - coalesce(booking_count.ocupadas, 0)::integer,
      0
    )::integer as plazas_libres,
    (
      coalesce(c.capacidad_max, 0)::integer
        <= coalesce(booking_count.ocupadas, 0)::integer
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

-- SECURITY DEFINER is intentional: anonymous visitors may see aggregate
-- availability, but RLS on reservas_yoga continues to hide every booking row,
-- user identifier and payment/credit field.
revoke all on function public.get_public_weekly_schedule(date)
  from public, anon, authenticated;
grant execute on function public.get_public_weekly_schedule(date)
  to anon, authenticated;

comment on function public.get_public_weekly_schedule(date)
  is 'Returns the active public yoga/workshop schedule for one Europe/Madrid week with aggregate confirmed occupancy and no attendee data.';

notify pgrst, 'reload schema';

commit;

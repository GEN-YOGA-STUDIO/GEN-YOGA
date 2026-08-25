begin;

-- La ocupacion real suma las plazas de cada reserva, incluidos acompanantes.
create or replace function public.obtener_ocupacion_clases(
  p_clase_ids bigint[]
)
returns table (
  clase_id bigint,
  ocupadas bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  with requested_classes as (
    select class.id
      from public.clases as class
     where class.id = any(coalesce(p_clase_ids, array[]::bigint[]))
       and class.activa is true
       and class.fecha_inicio >= now() - interval '2 hours'
       and lower(trim(coalesce(class.tipo_clase, ''))) in ('yoga', 'taller', 'especial', 'psicologia', 'nutricion')
  ), yoga_occupancy as (
    select booking.clase_id as class_id,
           sum(case
             when jsonb_typeof(coalesce(booking.acompanantes, '[]'::jsonb)) = 'array'
                  and jsonb_array_length(coalesce(booking.acompanantes, '[]'::jsonb)) > 0
               then greatest(coalesce(booking.num_plazas_reservadas, 1), coalesce(booking.num_plazas, 1),
                             jsonb_array_length(booking.acompanantes) + 1)
             else coalesce(booking.num_plazas_reservadas, booking.num_plazas, 1)
           end)::bigint as spots
      from public.reservas_yoga as booking
      join requested_classes as requested on requested.id = booking.clase_id
     where booking.estado = 'confirmada'
     group by booking.clase_id
  ), other_occupancy as (
    select booking.clase_id as class_id, count(*)::bigint as spots
      from public.reservas_psicologia as booking
      join requested_classes as requested on requested.id = booking.clase_id
     where booking.estado = 'confirmada'
     group by booking.clase_id
    union all
    select booking.clase_id, count(*)::bigint
      from public.reservas_nutricion as booking
      join requested_classes as requested on requested.id = booking.clase_id
     where booking.estado = 'confirmada'
     group by booking.clase_id
  )
  select occupancy.class_id, sum(occupancy.spots)::bigint
    from (select * from yoga_occupancy union all select * from other_occupancy) as occupancy
   group by occupancy.class_id;
$function$;

revoke all on function public.obtener_ocupacion_clases(bigint[])
  from public, anon, authenticated;
grant execute on function public.obtener_ocupacion_clases(bigint[])
  to anon, authenticated, service_role;

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
  tipo_clase_id bigint,
  es_gratuita boolean,
  companion_modality text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  with requested_week as (
    select date_trunc('week', coalesce(p_week_start, (now() at time zone 'Europe/Madrid')::date)::timestamp)::date as monday_local
  ), week_bounds as (
    select monday_local::timestamp at time zone 'Europe/Madrid' as starts_at,
           (monday_local + 7)::timestamp at time zone 'Europe/Madrid' as ends_at
      from requested_week
  ), booking_totals as (
    select booking.clase_id,
           sum(case
             when jsonb_typeof(coalesce(booking.acompanantes, '[]'::jsonb)) = 'array'
                  and jsonb_array_length(coalesce(booking.acompanantes, '[]'::jsonb)) > 0
               then greatest(coalesce(booking.num_plazas_reservadas, 1), coalesce(booking.num_plazas, 1),
                             jsonb_array_length(booking.acompanantes) + 1)
             else coalesce(booking.num_plazas_reservadas, booking.num_plazas, 1)
           end)::integer as ocupadas
      from public.reservas_yoga as booking
     where booking.estado = 'confirmada'
     group by booking.clase_id
  )
  select class.id::bigint, class.nombre::text, class.fecha_inicio::timestamptz, class.fecha_fin::timestamptz,
         class.duracion_minutos::integer,
         case when lower(btrim(coalesce(class.tipo_clase, ''))) = 'yoga'
           then least(coalesce(class.capacidad_max, 10), 10)::integer
           else coalesce(class.capacidad_max, 10)::integer end,
         coalesce(booking_totals.ocupadas, 0)::integer,
         greatest((case when lower(btrim(coalesce(class.tipo_clase, ''))) = 'yoga'
           then least(coalesce(class.capacidad_max, 10), 10)::integer
           else coalesce(class.capacidad_max, 10)::integer end) - coalesce(booking_totals.ocupadas, 0), 0)::integer,
         ((case when lower(btrim(coalesce(class.tipo_clase, ''))) = 'yoga'
           then least(coalesce(class.capacidad_max, 10), 10)::integer
           else coalesce(class.capacidad_max, 10)::integer end) <= coalesce(booking_totals.ocupadas, 0)),
         professional.id::bigint, professional.nombre::text, professional.apellidos::text, professional.color::text,
         lower(btrim(class.tipo_clase))::text, class.tipo_clase_id::bigint, coalesce(class.es_gratuita, false)::boolean,
         class.companion_modality::text
    from public.clases as class
    cross join week_bounds
    join public.profesionales as professional on professional.id = class.profesor_id and professional.visible_publico is true
    left join booking_totals on booking_totals.clase_id = class.id
   where class.activa is true
     and lower(btrim(coalesce(class.tipo_clase, ''))) in ('yoga', 'taller')
     and class.fecha_inicio >= week_bounds.starts_at
     and class.fecha_inicio < week_bounds.ends_at
     and not exists (
       select 1 from public.festivos as holiday
        where holiday.fecha = (class.fecha_inicio at time zone 'Europe/Madrid')::date
          and holiday.activo is true
     )
   order by class.fecha_inicio, class.id;
$function$;

revoke all on function public.get_public_weekly_schedule(date)
  from public, anon, authenticated;
grant execute on function public.get_public_weekly_schedule(date)
  to anon, authenticated;

notify pgrst, 'reload schema';

commit;

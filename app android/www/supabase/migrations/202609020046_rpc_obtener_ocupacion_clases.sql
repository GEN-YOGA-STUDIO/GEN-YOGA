-- 202609020046: RPC obtener_ocupacion_clases (aforo real por clase).
--
-- Contexto: las tablas reservas_yoga / reservas_psicologia / reservas_nutricion
-- tienen RLS restrictivo (cada usuario solo ve sus propias reservas; los
-- profesores las de sus clases y los admin todo). Cualquier recuento de
-- ocupación hecho en el frontend contando filas visibles mostraba todas las
-- clases como vacías para un alumno. Esta RPC SECURITY DEFINER devuelve el
-- aforo real confirmado por clase sin exponer datos personales de terceros.
--
-- Existía aplicada manualmente en producción; esta migración la captura en el
-- repositorio de forma idempotente.

create or replace function public.obtener_ocupacion_clases(p_clase_ids bigint[])
returns table(clase_id bigint, ocupadas bigint)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
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

-- Solo se devuelven recuentos agregados, nunca datos personales: seguro para
-- anon (calendario público), authenticated y service_role.
revoke all on function public.obtener_ocupacion_clases(bigint[]) from public;
grant execute on function public.obtener_ocupacion_clases(bigint[]) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

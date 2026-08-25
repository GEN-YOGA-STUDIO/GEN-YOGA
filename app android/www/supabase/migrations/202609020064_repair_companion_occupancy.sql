begin;

-- Corrige las reservas de compania ya creadas cuando solo se contabilizo al titular.
update public.clases as class
   set ocupadas = coalesce(booking_totals.total_plazas, 0)
  from (
    select r.clase_id,
           sum(case
             when jsonb_typeof(coalesce(r.acompanantes, '[]'::jsonb)) = 'array'
                  and jsonb_array_length(coalesce(r.acompanantes, '[]'::jsonb)) > 0
               then greatest(coalesce(r.num_plazas_reservadas, 1), coalesce(r.num_plazas, 1),
                             jsonb_array_length(r.acompanantes) + 1)
             else coalesce(r.num_plazas_reservadas, r.num_plazas, 1)
           end)::integer as total_plazas
      from public.reservas_yoga as r
     where r.estado = 'confirmada'
     group by r.clase_id
  ) as booking_totals
 where booking_totals.clase_id = class.id;

-- Las clases sin reservas confirmadas deben mostrar cero plazas ocupadas.
update public.clases as class
   set ocupadas = 0
 where not exists (
   select 1
     from public.reservas_yoga as r
    where r.clase_id = class.id
      and r.estado = 'confirmada'
 );

notify pgrst, 'reload schema';

commit;

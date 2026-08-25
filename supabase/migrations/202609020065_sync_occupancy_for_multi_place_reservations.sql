begin;

create or replace function public.recalcular_ocupacion_clase(p_clase_id bigint)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $function$
  update public.clases as class
     set ocupadas = coalesce((
       select sum(case
         when jsonb_typeof(coalesce(r.acompanantes, '[]'::jsonb)) = 'array'
              and jsonb_array_length(coalesce(r.acompanantes, '[]'::jsonb)) > 0
           then greatest(coalesce(r.num_plazas_reservadas, 1), coalesce(r.num_plazas, 1),
                         jsonb_array_length(r.acompanantes) + 1)
         else coalesce(r.num_plazas_reservadas, r.num_plazas, 1)
       end)::integer
         from public.reservas_yoga as r
        where r.clase_id = p_clase_id
          and r.estado = 'confirmada'
     ), 0)
   where class.id = p_clase_id;
$function$;

create or replace function public.sincronizar_ocupacion_reserva_yoga()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if tg_op <> 'INSERT' and old.clase_id is not null then
    perform public.recalcular_ocupacion_clase(old.clase_id);
  end if;
  if tg_op <> 'DELETE' and new.clase_id is not null then
    perform public.recalcular_ocupacion_clase(new.clase_id);
  end if;
  return coalesce(new, old);
end;
$function$;

drop trigger if exists reservas_yoga_sync_ocupacion on public.reservas_yoga;
create trigger reservas_yoga_sync_ocupacion
after insert or update of clase_id, estado, num_plazas, num_plazas_reservadas, acompanantes or delete
on public.reservas_yoga
for each row execute function public.sincronizar_ocupacion_reserva_yoga();

-- Repara también reservas creadas antes de instalar el trigger.
do $$
declare
  class_row record;
begin
  for class_row in select id from public.clases loop
    perform public.recalcular_ocupacion_clase(class_row.id);
  end loop;
end;
$$;

notify pgrst, 'reload schema';

commit;

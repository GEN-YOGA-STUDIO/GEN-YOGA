begin;

-- Version 6.9 moved special classes into reservas_yoga. All browser writes for
-- both regular and special classes must now pass through the security-definer
-- booking RPCs so capacity, entitlements and refunds stay atomic.
revoke insert, update, delete on table public.reservas_yoga
  from public, anon, authenticated;

create or replace function public.reservas_yoga_proteger_mutacion_directa()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_old_class_type text;
  v_new_class_type text;
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    select lower(trim(coalesce(tipo_clase, '')))
      into v_old_class_type
    from public.clases
    where id = old.clase_id;

    if old.clase_id is not null
      and (not found or coalesce(v_old_class_type, '') = '') then
      raise exception 'No se pudo verificar de forma segura la clase de la reserva.'
        using errcode = '42501';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select lower(trim(coalesce(tipo_clase, '')))
      into v_new_class_type
    from public.clases
    where id = new.clase_id;

    if new.clase_id is not null
      and (not found or coalesce(v_new_class_type, '') = '') then
      raise exception 'No se pudo verificar de forma segura la clase de la reserva.'
        using errcode = '42501';
    end if;
  end if;

  if v_old_class_type in ('yoga', 'taller')
     or v_new_class_type in ('yoga', 'taller') then
    raise exception 'Las reservas de yoga y talleres solo pueden modificarse mediante su operación segura.'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.reservas_yoga_proteger_mutacion_directa()
  from public, anon, authenticated;

comment on function public.reservas_yoga_proteger_mutacion_directa()
  is 'Blocks browser mutations of regular and special-class bookings; trusted security-definer RPCs remain authoritative.';

commit;

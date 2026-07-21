-- Keep administrative balance adjustments atomic. A browser-side read followed
-- by an update could overwrite a simultaneous payment, booking or admin change.

begin;

create or replace function public.ajustar_saldo_usuario(
  p_user_id uuid,
  p_tipo text,
  p_delta integer
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_target_role text;
  v_new_balance integer;
begin
  if v_actor_id is null then
    raise exception 'authentication required';
  end if;
  if p_user_id is null or p_tipo is null or p_tipo not in ('yoga', 'psicologia', 'nutricion') then
    raise exception 'invalid balance adjustment';
  end if;
  if p_delta is null or p_delta = 0 or p_delta < -1000 or p_delta > 1000 then
    raise exception 'invalid balance delta';
  end if;

  select lower(coalesce(rol, '')) into v_actor_role
    from public.profiles
   where id = v_actor_id;
  if not found or v_actor_role <> 'admin' then
    raise exception 'only administrators may adjust balances';
  end if;

  select lower(coalesce(rol, '')) into v_target_role
    from public.profiles
   where id = p_user_id
   for update;
  if not found then
    raise exception 'client profile not found';
  end if;
  if v_target_role in ('admin', 'profesor', 'trabajador', 'profesional') then
    raise exception 'staff balances cannot be adjusted';
  end if;

  if p_tipo = 'yoga' then
    update public.profiles
       set bonos = greatest(coalesce(bonos, 0) + p_delta, 0)
     where id = p_user_id
     returning bonos into v_new_balance;
  elsif p_tipo = 'psicologia' then
    update public.profiles
       set saldo_psicologia = greatest(coalesce(saldo_psicologia, 0) + p_delta, 0)
     where id = p_user_id
     returning saldo_psicologia into v_new_balance;
  else
    update public.profiles
       set saldo_nutricion = greatest(coalesce(saldo_nutricion, 0) + p_delta, 0)
     where id = p_user_id
     returning saldo_nutricion into v_new_balance;
  end if;

  return v_new_balance;
end;
$$;

revoke all on function public.ajustar_saldo_usuario(uuid, text, integer) from public, anon;
grant execute on function public.ajustar_saldo_usuario(uuid, text, integer) to authenticated;

comment on function public.ajustar_saldo_usuario(uuid, text, integer)
  is 'Atomically adjusts a client balance after verifying that the caller is an administrator.';

commit;

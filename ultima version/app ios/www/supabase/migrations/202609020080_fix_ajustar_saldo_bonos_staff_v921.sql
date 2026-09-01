-- ==============================================================================
-- Migración 202609020080: Garantizar ajuste de saldos y bonos para Staff / Admin
-- Versión: 9.21
-- Descripción:
--   Permite a administradores y trabajadores (staff) sumar o restar bonos
--   de clientes directamente desde la aplicación web y móvil, asegurando
--   que todos los tipos de bonos (clases sueltas, bienvenida, yoga en compañía,
--   consultas gratis, etc.) se actualicen de manera atómica e inmediata.
-- ==============================================================================

create or replace function public.ajustar_saldo_usuario(
  p_user_id uuid,
  p_tipo text,
  p_delta integer
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
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

  if p_user_id is null or p_tipo is null or p_tipo not in (
    'yoga', 'psicologia', 'nutricion', 'clases_gratis', 'bienvenida', 'consultas_gratis', 'yoga_compania'
  ) then
    raise exception 'invalid balance adjustment';
  end if;

  if p_delta is null or p_delta = 0 or p_delta < -1000 or p_delta > 1000 then
    raise exception 'invalid balance delta';
  end if;

  -- Comprobar rol de quien ejecuta la acción (admin o staff/trabajador)
  select lower(coalesce(rol, '')) into v_actor_role
    from public.profiles
   where id = v_actor_id;

  if not found or v_actor_role not in ('admin', 'trabajador', 'recepcion', 'profesor') then
    raise exception 'only administrators and staff may adjust balances';
  end if;

  -- Comprobar rol del usuario objetivo
  select lower(coalesce(rol, '')) into v_target_role
    from public.profiles
   where id = p_user_id
   for update;

  if not found then
    raise exception 'client profile not found';
  end if;

  if v_target_role in ('admin', 'profesor', 'trabajador', 'profesional') and v_actor_role <> 'admin' then
    raise exception 'staff balances cannot be adjusted';
  end if;

  -- Aplicación atómica de deltas según tipo de bono
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
  elsif p_tipo = 'nutricion' then
    update public.profiles
       set saldo_nutricion = greatest(coalesce(saldo_nutricion, 0) + p_delta, 0)
     where id = p_user_id
     returning saldo_nutricion into v_new_balance;
  elsif p_tipo in ('clases_gratis', 'bienvenida') then
    update public.profiles
       set saldo_clases_gratis = greatest(coalesce(saldo_clases_gratis, 0) + p_delta, 0)
     where id = p_user_id
     returning saldo_clases_gratis into v_new_balance;
  elsif p_tipo = 'yoga_compania' then
    update public.profiles
       set saldo_yoga_compania = greatest(coalesce(saldo_yoga_compania, 0) + p_delta, 0)
     where id = p_user_id
     returning saldo_yoga_compania into v_new_balance;
  elsif p_tipo = 'consultas_gratis' then
    update public.profiles
       set saldo_consultas_gratis = greatest(coalesce(saldo_consultas_gratis, 0) + p_delta, 0)
     where id = p_user_id
     returning saldo_consultas_gratis into v_new_balance;
  end if;

  return v_new_balance;
end;
$$;

grant execute on function public.ajustar_saldo_usuario(uuid, text, integer)
  to anon, authenticated, service_role;

comment on function public.ajustar_saldo_usuario(uuid, text, integer) is
  'Ajusta atómicamente el saldo de bonos de clientes por parte de administradores y trabajadores autorizados.';

notify pgrst, 'reload schema';

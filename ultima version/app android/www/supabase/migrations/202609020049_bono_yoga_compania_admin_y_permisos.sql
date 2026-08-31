-- 202609020049_bono_yoga_compania_admin_y_permisos.sql
--
-- PROBLEMA DETECTADO (verificado en producción 2026-08-27):
--   El "Bono de Yoga en Compañía" vive en profiles.saldo_yoga_compania y se
--   consume con la RPC reservar_yoga_compania_multiplaza (reserva multiplaza
--   por modalidad: pareja/hijo/abuela = 2 plazas, colegas = 3 o 4).
--   Sin embargo:
--     1) ajustar_saldo_usuario NO aceptaba el tipo 'yoga_compania', así que el
--        panel de administración no podía dar/quitar este bono.
--     2) reservar_yoga_compania_multiplaza no tenía EXECUTE para el rol anon,
--        y el cliente web emite la clave anon antes del JWT de sesión.
--   Resultado: el bono quedaba "perdido" (invisible e inutilizable).
--
-- SOLUCIÓN:
--   - Recrear ajustar_saldo_usuario añadiendo la rama 'yoga_compania'
--     (mantiene el resto de validaciones: solo admin, no staff, límites).
--   - Conceder EXECUTE de ambas funciones a anon/authenticated/service_role.

create or replace function public.ajustar_saldo_usuario(p_user_id uuid, p_tipo text, p_delta integer)
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
    'yoga', 'psicologia', 'nutricion', 'clases_gratis', 'consultas_gratis', 'yoga_compania'
  ) then
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
  elsif p_tipo = 'nutricion' then
    update public.profiles
       set saldo_nutricion = greatest(coalesce(saldo_nutricion, 0) + p_delta, 0)
     where id = p_user_id
     returning saldo_nutricion into v_new_balance;
  elsif p_tipo = 'clases_gratis' then
    update public.profiles
       set saldo_clases_gratis = greatest(coalesce(saldo_clases_gratis, 0) + p_delta, 0)
     where id = p_user_id
     returning saldo_clases_gratis into v_new_balance;
  elsif p_tipo = 'consultas_gratis' then
    update public.profiles
       set saldo_consultas_gratis = greatest(coalesce(saldo_consultas_gratis, 0) + p_delta, 0)
     where id = p_user_id
     returning saldo_consultas_gratis into v_new_balance;
  elsif p_tipo = 'yoga_compania' then
    update public.profiles
       set saldo_yoga_compania = greatest(coalesce(saldo_yoga_compania, 0) + p_delta, 0)
     where id = p_user_id
     returning saldo_yoga_compania into v_new_balance;
  end if;

  return v_new_balance;
end;
$$;

grant execute on function public.ajustar_saldo_usuario(uuid, text, integer)
  to anon, authenticated, service_role;

grant execute on function public.reservar_yoga_compania_multiplaza(bigint, text, integer, jsonb)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';

-- Migration 202609020056: Sincronizacion de fuente unica de verdad en saldos de usuarios y Yoga en Compania
-- =======================================================================================================
-- Garantiza que public.profiles.saldo_yoga_compania y todos los demas saldos sean la unica fuente
-- de verdad sincronizada entre el perfil del usuario y el panel del administrador.
-- =======================================================================================================

begin;

-- 1. Asegurar columnas de saldo en public.profiles
alter table public.profiles
  add column if not exists bonos integer not null default 0,
  add column if not exists saldo_clases_gratis integer not null default 0,
  add column if not exists saldo_consultas_gratis integer not null default 0,
  add column if not exists saldo_yoga_compania integer not null default 0,
  add column if not exists saldo_psicologia integer not null default 0,
  add column if not exists saldo_nutricion integer not null default 0,
  add column if not exists bono_mensual_activo boolean not null default false;

-- 2. Sincronizar saldos de Yoga en Compañía entre private.welcome_companion_bonuses y public.profiles
update public.profiles p
   set saldo_yoga_compania = coalesce(w.credits_remaining, p.saldo_yoga_compania, 0)
  from private.welcome_companion_bonuses w
 where w.profile_id = p.id;

-- 3. Limpiar cualquier valor nulo en saldos
update public.profiles
   set bonos = coalesce(bonos, 0),
       saldo_clases_gratis = coalesce(saldo_clases_gratis, 0),
       saldo_consultas_gratis = coalesce(saldo_consultas_gratis, 0),
       saldo_yoga_compania = coalesce(saldo_yoga_compania, 0),
       saldo_psicologia = coalesce(saldo_psicologia, 0),
       saldo_nutricion = coalesce(saldo_nutricion, 0),
       bono_mensual_activo = coalesce(bono_mensual_activo, false);

-- 4. Recrear funcion RPC ajustar_saldo_usuario sincronizando public.profiles y private.welcome_companion_bonuses
create or replace function public.ajustar_saldo_usuario(
  p_user_id uuid,
  p_tipo text,
  p_delta integer
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_target_role text;
  v_new_balance integer := 0;
  v_tipo_norm text;
begin
  if v_actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_user_id is null or p_tipo is null then
    raise exception 'invalid parameters' using errcode = '22023';
  end if;

  if p_delta is null or p_delta = 0 or p_delta < -1000 or p_delta > 1000 then
    raise exception 'invalid balance delta' using errcode = '22023';
  end if;

  -- Comprobar que quien ejecuta es administrador
  select lower(coalesce(profile.rol, ''))
    into v_actor_role
    from public.profiles as profile
   where profile.id = v_actor_id;
  if not found or v_actor_role <> 'admin' then
    raise exception 'only administrators may adjust balances' using errcode = '42501';
  end if;

  -- Comprobar perfil objetivo
  select lower(coalesce(profile.rol, ''))
    into v_target_role
    from public.profiles as profile
   where profile.id = p_user_id
   for update;
  if not found then
    raise exception 'client profile not found' using errcode = 'P0002';
  end if;

  v_tipo_norm := lower(trim(p_tipo));

  if v_tipo_norm in ('yoga', 'bonos', 'clases_sueltas', 'clase', 'clases') then
    update public.profiles
       set bonos = greatest(0, coalesce(bonos, 0) + p_delta)
     where id = p_user_id
     returning bonos into v_new_balance;

  elsif v_tipo_norm in ('clases_gratis', 'clase_gratis', 'gratis') then
    update public.profiles
       set saldo_clases_gratis = greatest(0, coalesce(saldo_clases_gratis, 0) + p_delta)
     where id = p_user_id
     returning saldo_clases_gratis into v_new_balance;

    update private.welcome_companion_bonuses
       set credits_remaining = greatest(0, least(1, credits_remaining + p_delta)),
           updated_at = now()
     where profile_id = p_user_id;

  elsif v_tipo_norm in ('consultas_gratis', 'consulta_gratis') then
    update public.profiles
       set saldo_consultas_gratis = greatest(0, coalesce(saldo_consultas_gratis, 0) + p_delta)
     where id = p_user_id
     returning saldo_consultas_gratis into v_new_balance;

  elsif v_tipo_norm in ('yoga_compania', 'compania', 'yoga_en_compania') then
    update public.profiles
       set saldo_yoga_compania = greatest(0, coalesce(saldo_yoga_compania, 0) + p_delta)
     where id = p_user_id
     returning saldo_yoga_compania into v_new_balance;

    update private.welcome_companion_bonuses
       set credits_remaining = greatest(0, least(1, credits_remaining + p_delta)),
           updated_at = now()
     where profile_id = p_user_id;

  elsif v_tipo_norm in ('psicologia', 'psico') then
    update public.profiles
       set saldo_psicologia = greatest(0, coalesce(saldo_psicologia, 0) + p_delta)
     where id = p_user_id
     returning saldo_psicologia into v_new_balance;

  elsif v_tipo_norm in ('nutricion', 'nutri') then
    update public.profiles
       set saldo_nutricion = greatest(0, coalesce(saldo_nutricion, 0) + p_delta)
     where id = p_user_id
     returning saldo_nutricion into v_new_balance;

  else
    raise exception 'invalid balance adjustment: %', p_tipo using errcode = '22023';
  end if;

  return coalesce(v_new_balance, 0);
end;
$function$;

revoke all on function public.ajustar_saldo_usuario(uuid, text, integer) from public, anon;
grant execute on function public.ajustar_saldo_usuario(uuid, text, integer) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

-- ============================================================================
-- Auditoría fase 3 (2026-09-25): permisos que permitían escalado y mint.
-- Verificado antes: ningún cliente hace UPDATE directo a profiles ni escribe
-- stripe_productos; stripe_fulfill_checkout solo lo llaman edge functions con
-- service_role; admin_actualizar_clase_simple no la llama nadie (ni en repo).
--
-- C2: trigger que impide cambiar rol/email salvo admin o vía servidor.
--     (Policies solas no pueden comparar OLD/NEW; el trigger sí.)
-- C5: stripe_fulfill_checkout fuera del alcance de anon/authenticated.
-- C7: admin_configurar_bono_mensual exige admin o trabajador (igual que UI).
-- C10: admin_actualizar_clase_simple muerta: fuera del alcance de anon/auth.
-- A0: stripe_productos solo escribible por servicio/staff.
-- ============================================================================

-- C2: guardián de rol/email.
-- NOTA HISTORIAL: la primera versión de este fix solo traía el trigger y
-- falló en vivo con 42P17: las policies pol_profiles_update_admin y
-- staff_can_update_profiles (EXISTS autorreferentes) provocaban recursión
-- infinita en CUALQUIER update directo (bug preexistente: la app nunca hace
-- updates directos, por eso nadie lo notó). Se reescribieron con helpers
-- SECURITY DEFINER (es_admin_actual/es_staff_o_admin) y entonces el trigger
-- funciona. Verificado: edición legítima 204, rol/email 42501, rol intacto.
create or replace function public.proteger_rol_email_perfiles()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_rol text;
begin
  if new.rol is not distinct from old.rol
     and new.email is not distinct from old.email then
    return new;
  end if;
  -- Vías servidoras revisadas (webhook, edge functions, owner): pasan.
  if auth.role() = 'service_role' or auth.uid() is null then
    return new;
  end if;
  select lower(trim(coalesce(p.rol, ''))) into v_rol
    from public.profiles as p
   where p.id = auth.uid();
  if v_rol = 'admin' then
    return new;
  end if;
  raise exception 'Solo un administrador puede cambiar rol o email.'
    using errcode = '42501';
end;
$$;
revoke all on function public.proteger_rol_email_perfiles() from anon, authenticated, public;
drop trigger if exists trg_proteger_rol_email on public.profiles;
create trigger trg_proteger_rol_email
  before update on public.profiles
  for each row execute function public.proteger_rol_email_perfiles();

-- C2 (cont.): reescritura anti-recursión de policies autorreferentes.
drop policy if exists pol_profiles_update_admin on public.profiles;
create policy pol_profiles_update_admin
on public.profiles for update to authenticated
using (public.es_admin_actual());
drop policy if exists staff_can_update_profiles on public.profiles;
create policy staff_can_update_profiles
on public.profiles for update to authenticated
using (public.es_staff_o_admin(auth.uid()))
with check (public.es_staff_o_admin(auth.uid()));
drop policy if exists "Admins pueden borrar perfiles" on public.profiles;
create policy "Admins pueden borrar perfiles"
on public.profiles for delete to authenticated
using (public.es_admin_actual());

-- C5: fulfillment solo vía servicio (lo llaman stripe-webhook y
-- get-checkout-session con service_role).
revoke all on function public.stripe_fulfill_checkout(text, text, bigint, text, uuid, boolean, text, text, text, text, text, bigint, text, text, text, timestamptz, timestamptz, text, boolean, boolean)
  from anon, authenticated, public;

-- C7: bono mensual solo admin/trabajador (igual que la UI cambiarBonoMensual).
create or replace function public.admin_configurar_bono_mensual(p_user_id uuid, p_activo boolean, p_inicio timestamp with time zone DEFAULT NULL::timestamp with time zone, p_fin timestamp with time zone DEFAULT NULL::timestamp with time zone)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_rol text;
  v_membership_month date;
  v_extra_month date;
begin
  select lower(trim(coalesce(p.rol, ''))) into v_rol
    from public.profiles as p
   where p.id = auth.uid();
  if v_rol is distinct from 'admin' and v_rol is distinct from 'trabajador' then
    raise exception 'Solo el equipo de GEN Yoga puede gestionar el bono mensual.'
      using errcode = '42501';
  end if;
  if p_activo then
    v_membership_month := date_trunc('month', coalesce(p_inicio, now()) at time zone 'Europe/Madrid')::date;
    perform public.admin_asignar_mes_ilimitado(p_user_id, v_membership_month, true);
    if p_fin is not null then
      v_extra_month := date_trunc('month', (p_fin - interval '1 second') at time zone 'Europe/Madrid')::date;
      if v_extra_month > v_membership_month then
        perform public.admin_asignar_mes_ilimitado(p_user_id, v_extra_month, true);
      end if;
    end if;
  else
    delete from public.unlimited_membership_periods where user_id = p_user_id;
    update public.profiles
       set bono_mensual_activo = false,
           bono_mensual_inicio = null,
           bono_mensual_fin = null
     where id = p_user_id;
  end if;
end;
$function$;
revoke all on function public.admin_configurar_bono_mensual(uuid, boolean, timestamptz, timestamptz)
  from anon, public;

-- C10: función muerta fuera del alcance de clientes.
revoke all on function public.admin_actualizar_clase_simple(bigint, text, bigint, timestamptz, timestamptz, integer, integer, bigint, boolean, text, text)
  from anon, authenticated, public;

-- A0: productos solo escribibles por servicio/staff (lectura pública intacta).
drop policy if exists "Permitir escritura servicio y autenticados en stripe_productos" on public.stripe_productos;
create policy "stripe_productos_staff_write"
on public.stripe_productos
for all
to authenticated
using (public.es_staff_o_admin(auth.uid()))
with check (public.es_staff_o_admin(auth.uid()));

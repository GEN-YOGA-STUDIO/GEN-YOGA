-- Migration 202609260006: Retirada de la promoción del 50% (código GENYOGA)
-- Manu (octubre 2026): se mantiene solo el Bono de Bienvenida (1 clase gratis
-- por registro). Se desactiva el 50% en todos los alumnos, se impide cualquier
-- canje o reactivación futura y se retira 'promo_50_clase' de los packs.
-- Histórico (compras, columnas y saldos) se conserva sin tocar.
begin;

-- 1. Ningún alumno conserva el descuento del 50% activo.
update public.profiles
   set descuento_promo_50_activo = false
 where descuento_promo_50_activo = true;

-- 2. El 50% no puede volver a activarse: el valor queda fijado a false en la
--    propia tabla (cualquier intento de reactivación falla a nivel de datos).
alter table public.profiles
  drop constraint if exists profiles_descuento_promo_50_retirado;
alter table public.profiles
  add constraint profiles_descuento_promo_50_retirado
  check (descuento_promo_50_activo = false);

-- 3. Canje del código GENYOGA: retirado. Se conserva la firma de la RPC para no
--    romper llamadas antiguas, pero siempre responde que la promo ha finalizado.
create or replace function public.canjear_codigo_promocional(p_codigo text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  raise exception 'La promoción del 50% (código GENYOGA) ha finalizado.'
    using errcode = '22023';
end;
$$;

revoke all on function public.canjear_codigo_promocional(text) from public, anon;
grant execute on function public.canjear_codigo_promocional(text) to authenticated, anon;

-- 4. Gestión administrativa del 50%: también retirada.
create or replace function public.admin_set_promo_50(
  p_user_id uuid,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  raise exception 'La promoción del 50% de la primera clase ha finalizado.'
    using errcode = '22023';
end;
$$;

revoke all on function public.admin_set_promo_50(uuid, boolean) from public, anon;
grant execute on function public.admin_set_promo_50(uuid, boolean) to authenticated, anon;

-- 5. 'promo_50_clase' deja de ser un pack_type admitido. Las compras históricas
--    se registraron como 'clase_suelta' (mapeo de stripe_fulfill_checkout), así
--    que la restricción no rompe datos existentes ni el fulfillment de sesiones
--    de Checkout abiertas antes del retiro.
alter table public.class_credit_packs
  drop constraint if exists class_credit_packs_pack_type_check;
alter table public.class_credit_packs
  add constraint class_credit_packs_pack_type_check check (
    pack_type in ('clase_suelta', 'pack_4', 'pack_6', 'pack_10')
  );

-- Recargar caché de esquema de PostGREST
notify pgrst, 'reload schema';

commit;

-- =====================================================================
-- DIAGNÓSTICO DE BONOS Y SU CADUCIDAD (solo lectura, seguro)
-- Un único resultado con todo. Ejecutar en el SQL Editor de Supabase.
-- =====================================================================
with fefo as (
  select case
    when pg_get_functiondef(p.oid) like '%ORDER BY expires_at%'
      then 'OK - consume primero el bono que caduca antes'
    else 'REVISAR - no se detecta orden por expires_at'
  end as detalle
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.proname = 'reservar_con_bono' and n.nspname = 'public'
  order by p.oid desc limit 1
),
inventario as (
  select
    pr.email || ' | ' || ccp.pack_type || ' | ' || ccp.credits_remaining || '/' || ccp.credits_total
    || ' bonos | compra ' || to_char(ccp.purchased_at at time zone 'Europe/Madrid', 'DD/MM/YYYY')
    || ' | caduca ' || to_char(ccp.expires_at at time zone 'Europe/Madrid', 'DD/MM/YYYY')
    || ' | ' || greatest(0, CEIL(extract(epoch from (ccp.expires_at - now())) / 86400))::int || ' dias'
    || ' | ' || case when ccp.expires_at <= now() then 'CADUCADO'
                     when ccp.credits_remaining = 0 then 'GASTADO' else 'ACTIVO' end as detalle
  from public.class_credit_packs ccp
  join public.profiles pr on pr.id = ccp.user_id
  where ccp.credits_remaining > 0 or ccp.expires_at > now() - interval '90 days'
),
coherencia as (
  select
    pr.email || ' | declarado=' || pr.bonos || ' | packs vigentes=' ||
      coalesce(sum(ccp.credits_remaining) filter (where ccp.expires_at > now()), 0)::int ||
      case when pr.bonos = coalesce(sum(ccp.credits_remaining) filter (where ccp.expires_at > now()), 0)::int
           then ' | OK' else ' | DESAJUSTE' end as detalle
  from public.profiles pr
  left join public.class_credit_packs ccp on ccp.user_id = pr.id
  group by pr.id, pr.email, pr.bonos
  having pr.bonos > 0 or coalesce(sum(ccp.credits_remaining) filter (where ccp.expires_at > now()), 0) > 0
)
select '1. RPC reserva FEFO' as apartado, 1 as orden, (select detalle from fefo) as detalle
union all
select '2. Pack ' || row_number() over (order by detalle), 2, detalle from inventario
union all
select '3. Coherencia saldo', 3, detalle from coherencia
union all
select '4. Ahora Madrid', 4, to_char(now() at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI')
order by orden, apartado;

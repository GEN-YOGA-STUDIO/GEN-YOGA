-- =====================================================================
-- DIAGNÓSTICO DE BONOS Y SU CADUCIDAD (solo lectura, seguro)
-- Ejecutar en el SQL Editor de Supabase (proyecto jkjifmrrlyncuwpjhxvk).
-- No modifica nada: solo consulta.
-- =====================================================================

-- 1) ¿La reserva ya consume por caducidad (FEFO)?
--    Busca 'ORDER BY expires_at' dentro de la definición de reservar_con_bono.
select
  '1. RPC reservar_con_bono usa FEFO' as comprobacion,
  case
    when pg_get_functiondef(p.oid) like '%ORDER BY expires_at%'
      then 'OK — consume primero el bono que caduca antes'
    else '⚠ REVISAR — no se detecta orden por expires_at'
  end as resultado
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.proname = 'reservar_con_bono'
  and n.nspname = 'public'
order by p.oid desc
limit 1;

-- 2) Inventario de packs: cada bono, cuándo se compró y cuándo caduca.
select
  pr.nombre || ' ' || coalesce(pr.apellidos, '') as alumno,
  pr.email,
  ccp.pack_type as tipo_pack,
  ccp.credits_total as bonos_totales,
  ccp.credits_remaining as bonos_restantes,
  to_char(ccp.purchased_at at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') as comprado,
  to_char(ccp.expires_at  at time zone 'Europe/Madrid', 'DD/MM/YYYY') as caduca,
  greatest(0, CEIL(extract(epoch from (ccp.expires_at - now())) / 86400))::int as dias_restantes,
  case
    when ccp.expires_at <= now() then 'CADUCADO'
    when ccp.credits_remaining = 0 then 'GASTADO'
    else 'ACTIVO'
  end as estado
from public.class_credit_packs ccp
join public.profiles pr on pr.id = ccp.user_id
where ccp.credits_remaining > 0 or ccp.expires_at > now() - interval '90 days'
order by pr.email, ccp.expires_at asc;

-- 3) Coherencia: profiles.bonos (celda del usuario) vs suma real de sus packs.
select
  pr.email,
  pr.bonos as saldo_declarado,
  coalesce(sum(ccp.credits_remaining) filter (where ccp.expires_at > now()), 0)::int as suma_packs_vigentes,
  case
    when pr.bonos = coalesce(sum(ccp.credits_remaining) filter (where ccp.expires_at > now()), 0)::int
      then 'OK'
    else '⚠ DESAJUSTE'
  end as estado
from public.profiles pr
left join public.class_credit_packs ccp on ccp.user_id = pr.id
group by pr.id, pr.email, pr.bonos
having pr.bonos > 0
    or coalesce(sum(ccp.credits_remaining) filter (where ccp.expires_at > now()), 0) > 0
order by pr.email;

-- 4) Fecha actual del servidor (para interpretar las caducidades).
select to_char(now() at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') as ahora_madrid;

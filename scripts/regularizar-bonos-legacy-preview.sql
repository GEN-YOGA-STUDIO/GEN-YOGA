-- =====================================================================
-- PREVIEW (SOLO LECTURA, SEGURO) · Regularización de bonos legacy
-- Usuarios con saldo en profiles.bonos pero sin packs activos (DESAJUSTE).
-- Ejecutar en el SQL Editor de Supabase ANTES del script de regularización.
--
-- Criterio: se les creará un pack 'manual_admin' con sus bonos actuales
-- y caducidad a 60 días (mismo trato que los bonos dados por admin).
-- Excluidos: personal (rol admin/profesor/trabajador/profesional/recepcion)
-- y cuentas de mostrador/móvil/pruebas.
-- =====================================================================

SELECT
  pr.email,
  coalesce(pr.rol, 'sin rol')                       AS rol,
  pr.bonos                                          AS bonos_declarados,
  coalesce(packs_vigentes.saldo, 0)                 AS bonos_en_packs_activos,
  pr.bonos - coalesce(packs_vigentes.saldo, 0)      AS bonos_a_convertir,
  case
    when lower(coalesce(pr.rol, '')) in ('admin', 'profesor', 'trabajador', 'profesional', 'recepcion')
      then 'EXCLUIDO · personal'
    when lower(pr.email) like '%mostrador%'
      or lower(pr.email) like '%movil%'
      or lower(pr.email) like '%test%'
      or lower(pr.email) = 'profesor@profesor.com'
      then 'EXCLUIDO · cuenta de prueba'
    when pr.bonos - coalesce(packs_vigentes.saldo, 0) <= 0
      then 'OK · ya cuadra'
    else 'SE CONVERTIRÁ en pack manual_admin (caduca 60 días)'
  end as accion
FROM public.profiles pr
LEFT JOIN LATERAL (
  SELECT coalesce(sum(ccp.credits_remaining), 0)::integer AS saldo
    FROM public.class_credit_packs ccp
   WHERE ccp.user_id = pr.id
     AND ccp.credits_remaining > 0
     AND ccp.expires_at > now()
) packs_vigentes ON true
WHERE pr.bonos > 0
  AND coalesce(packs_vigentes.saldo, 0) = 0
ORDER BY accion, pr.email;

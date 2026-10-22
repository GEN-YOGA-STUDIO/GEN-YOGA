-- =====================================================================
-- REGULARIZACIÓN DE BONOS LEGACY (ejecutar tras el preview)
-- Usuarios con saldo en profiles.bonos pero sin packs activos (DESAJUSTE).
--
-- Qué hace (en una transacción):
--  1. Crea un pack 'manual_admin' por usuario con sus bonos actuales,
--     caducando a los 60 días (mismo criterio que los bonos dados por admin).
--  2. Sincroniza profiles.bonos con la suma de sus packs vigentes.
--
-- Exclusiones (NO se les crea pack):
--  · Personal: rol admin, profesor, trabajador, profesional, recepcion
--  · Cuentas de prueba: email con 'mostrador', 'movil', 'test' o
--    profesor@profesor.com
--
-- Idempotente: si un usuario ya tiene packs activos, se le ignora.
-- Antes de ejecutar, revisa el resultado de regularizar-bonos-legacy-preview.sql
-- =====================================================================

BEGIN;

-- 1. Crear pack 'manual_admin' con los bonos declarados (caducidad +60 días)
INSERT INTO public.class_credit_packs (
  user_id,
  checkout_session_id,
  pack_type,
  credits_total,
  credits_remaining,
  purchased_at,
  expires_at
)
SELECT
  pr.id,
  NULL,
  'manual_admin',
  pr.bonos,
  pr.bonos,
  timezone('utc', now()),
  timezone('utc', now()) + interval '60 days'
FROM public.profiles pr
WHERE pr.bonos > 0
  AND lower(coalesce(pr.rol, '')) not in ('admin', 'profesor', 'trabajador', 'profesional', 'recepcion')
  AND lower(pr.email) not like '%mostrador%'
  AND lower(pr.email) not like '%movil%'
  AND lower(pr.email) not like '%test%'
  AND lower(pr.email) <> 'profesor@profesor.com'
  -- Solo quienes no tienen ningún pack activo (idempotencia)
  AND NOT EXISTS (
    SELECT 1 FROM public.class_credit_packs ccp
     WHERE ccp.user_id = pr.id
       AND ccp.credits_remaining > 0
       AND ccp.expires_at > now()
  );

-- 2. Sincronizar profiles.bonos con la suma de packs vigentes de cada usuario
UPDATE public.profiles pr
   SET bonos = vigentes.saldo,
       updated_at = timezone('utc', now())
  FROM (
    SELECT user_id, coalesce(sum(credits_remaining), 0)::integer AS saldo
      FROM public.class_credit_packs
     WHERE expires_at > now()
     GROUP BY user_id
  ) vigentes
 WHERE vigentes.user_id = pr.id
   AND pr.bonos is distinct from vigentes.saldo;

-- 3. Resultado: estado final de coherencia (saldo vs packs vigentes)
SELECT
  pr.email,
  pr.bonos                                             AS bonos_declarados,
  coalesce(packs.saldo, 0)                             AS bonos_en_packs_activos,
  case when pr.bonos = coalesce(packs.saldo, 0)
       then 'OK' else 'REVISAR' end                    AS coherencia,
  to_char(min(ccp.expires_at) at time zone 'Europe/Madrid', 'DD/MM/YYYY') AS caduca_pack
FROM public.profiles pr
LEFT JOIN LATERAL (
  SELECT coalesce(sum(ccp.credits_remaining), 0)::integer AS saldo
    FROM public.class_credit_packs ccp
   WHERE ccp.user_id = pr.id
     AND ccp.credits_remaining > 0
     AND ccp.expires_at > now()
) packs ON true
LEFT JOIN public.class_credit_packs ccp ON ccp.user_id = pr.id
WHERE pr.bonos > 0
GROUP BY pr.id, pr.email, pr.bonos, packs.saldo
HAVING pr.bonos <> coalesce(packs.saldo, 0)
    OR min(ccp.expires_at) is not null
ORDER BY coherencia, pr.email;

COMMIT;

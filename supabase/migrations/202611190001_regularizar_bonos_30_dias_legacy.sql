-- Migration: 202611190001_regularizar_bonos_30_dias_legacy.sql
-- Descripción:
--   Regulariza los periodos de Bono Inicial / Bono Mensual que se crearon con la
--   lógica antigua de "mes natural" (starts_at = día 1 del mes, ends_at = día 1
--   del mes siguiente) para que tengan vigencia de 30 días naturales desde la
--   fecha real de compra (purchased_at), tal como establece la migración
--   202611160001_bonos_30_dias_desde_compra.sql.
--
--   Alcance: solo periodos VIGENTES con inicio el día 1 del mes, purchased_at
--   informado y ends_at distinto de purchased_at + 30 días. Es idempotente.
--   No toca Bono Ilimitado (no hay ninguno legacy en producción) ni packs.
--
--   Ejemplo: ENCARNACIÓN ESCRIBANO LÓPEZ compró el 12/11/2026 19:29 (Madrid)
--   y tenía 01/11/2026 - 01/12/2026. Pasa a 12/11/2026 - 12/12/2026.

BEGIN;

-- 1. Captura de los valores originales para auditoría (vive solo en esta sesión).
CREATE TEMP TABLE _bonos_30d_antes ON COMMIT DROP AS
SELECT mp.id,
       mp.user_id,
       pr.email,
       mp.plan_type,
       mp.membership_month,
       mp.starts_at  AS starts_at_antes,
       mp.ends_at    AS ends_at_antes,
       mp.purchased_at,
       (mp.ends_at::date - mp.starts_at::date) AS dias_antes
FROM public.monthly_membership_periods mp
JOIN public.profiles pr ON pr.id = mp.user_id
WHERE mp.ends_at > now()
  AND mp.purchased_at IS NOT NULL
  AND (mp.starts_at AT TIME ZONE 'Europe/Madrid')::date
      = date_trunc('month', mp.starts_at AT TIME ZONE 'Europe/Madrid')::date
  AND mp.ends_at IS DISTINCT FROM (mp.purchased_at + interval '30 days');

-- 2. Reajuste: inicio = fecha de compra; fin = compra + 30 días naturales.
UPDATE public.monthly_membership_periods mp
   SET starts_at = a.purchased_at,
       ends_at = a.purchased_at + interval '30 days',
       membership_month = date_trunc('month', a.purchased_at AT TIME ZONE 'Europe/Madrid')::date
  FROM _bonos_30d_antes a
 WHERE mp.id = a.id
   AND mp.ends_at IS DISTINCT FROM (a.purchased_at + interval '30 days');

-- 3. Resultado antes / después (queda registrado en el log de la migración).
SELECT a.email,
       a.plan_type,
       to_char(a.starts_at_antes AT TIME ZONE 'Europe/Madrid','DD/MM/YYYY HH24:MI') AS inicio_antes,
       to_char(a.ends_at_antes   AT TIME ZONE 'Europe/Madrid','DD/MM/YYYY HH24:MI') AS fin_antes,
       to_char(mp.starts_at AT TIME ZONE 'Europe/Madrid','DD/MM/YYYY HH24:MI') AS inicio_despues,
       to_char(mp.ends_at   AT TIME ZONE 'Europe/Madrid','DD/MM/YYYY HH24:MI') AS fin_despues
FROM _bonos_30d_antes a
JOIN public.monthly_membership_periods mp ON mp.id = a.id
ORDER BY a.email;

COMMIT;

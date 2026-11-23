-- Migration: 202611230001_reparar_bonos_stripe_pagados_sin_periodo.sql
-- Fecha: 23 nov 2026 — INCIDENCIA PAGOS APPLE PAY / BONO INICIAL 40 €
--
-- ⚠️  ESTA MIGRACIÓN NO HA SIDO APLICADA A PRODUCCIÓN.
--     Preparada para ejecutarse desde el SQL Editor de Supabase (o MCP
--     `apply_migration`) una vez se confirme el diagnóstico con el script
--     scripts/sql/diagnostico-pagos-20261123.sql.
--
-- Objetivo:
--   Reparar los bonuses no entregados cuando Stripe confirma el cobro
--   (checkout.session.completed, payment_status = 'paid') pero el
--   fulfillment (stripe_fulfill_checkout) no llegó a crear el periodo
--   correspondiente en monthly_membership_periods / unlimited_membership_periods.
--
-- Criterio: solo compras LIVE, pagadas, no reembolsadas, no invitado, de un
--   tipo de bono que NO tenga ya un periodo con el mismo checkout_session_id.
--   La vigencia se calcula con la misma regla vigente (30 días naturales
--   desde la fecha de cobro), coherente con 202611160001.
--
-- Idempotente: el índice único (checkout_session_id) impide duplicados;
--   ON CONFLICT DO NOTHING hace que repetirla sea inofensivo.
-- No toca ningún periodo ya existente ni ningún saldo manual.

BEGIN;

-- 1) Auditoría: qué compras pagadas no tienen periodo entregado.
CREATE TEMP TABLE _bonos_stripe_faltantes ON COMMIT DROP AS
SELECT sp.checkout_session_id,
       sp.user_id,
       pr.email,
       sp.purchase_type,
       sp.amount_total,
       coalesce(sp.fulfilled_at, sp.created_at, timezone('utc', now())) AS purchased_at
FROM public.stripe_purchases sp
JOIN public.profiles pr ON pr.id = sp.user_id
LEFT JOIN public.monthly_membership_periods mp
       ON mp.checkout_session_id = sp.checkout_session_id
LEFT JOIN public.unlimited_membership_periods up
       ON up.checkout_session_id = sp.checkout_session_id
WHERE sp.payment_status = 'paid'
  AND sp.currency = 'eur'
  AND sp.refunded_at IS NULL
  AND coalesce(sp.is_guest, false) = false
  AND sp.purchase_type IN ('bono_inicial', 'bono_mensual', 'bono_ilimitado')
  AND mp.id IS NULL
  AND up.id IS NULL;

-- 2) Reparar Bono Inicial / Bono Mensual.
INSERT INTO public.monthly_membership_periods (
  user_id, membership_month, starts_at, ends_at,
  max_classes_per_week, plan_type, checkout_session_id, purchased_at
)
SELECT f.user_id,
       date_trunc('month', f.purchased_at AT TIME ZONE 'Europe/Madrid')::date,
       f.purchased_at,
       f.purchased_at + interval '30 days',
       CASE WHEN f.purchase_type = 'bono_inicial' THEN 1 ELSE 2 END,
       f.purchase_type,
       f.checkout_session_id,
       f.purchased_at
FROM _bonos_stripe_faltantes f
WHERE f.purchase_type IN ('bono_inicial', 'bono_mensual')
ON CONFLICT (checkout_session_id) DO NOTHING;

-- 3) Reparar Bono Ilimitado (periodo + bono de clase especial asociado).
INSERT INTO public.unlimited_membership_periods (
  user_id, checkout_session_id, membership_month, starts_at, ends_at, purchased_at
)
SELECT f.user_id,
       f.checkout_session_id,
       date_trunc('month', f.purchased_at AT TIME ZONE 'Europe/Madrid')::date,
       f.purchased_at,
       f.purchased_at + interval '30 days',
       f.purchased_at
FROM _bonos_stripe_faltantes f
WHERE f.purchase_type = 'bono_ilimitado'
ON CONFLICT DO NOTHING;

INSERT INTO public.bonos_clases_especiales (user_id, mes, saldo, origen, checkout_session_id)
SELECT f.user_id,
       date_trunc('month', f.purchased_at AT TIME ZONE 'Europe/Madrid')::date,
       1,
       'bono_ilimitado',
       f.checkout_session_id
FROM _bonos_stripe_faltantes f
WHERE f.purchase_type = 'bono_ilimitado'
  AND NOT EXISTS (
    SELECT 1 FROM public.bonos_clases_especiales b
     WHERE b.checkout_session_id = f.checkout_session_id
  );

-- 4) Informe de lo reparado (queda en el log de la migración).
SELECT f.email,
       f.purchase_type,
       f.amount_total / 100.0 AS euros,
       to_char(f.purchased_at AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') AS comprado,
       to_char((f.purchased_at + interval '30 days') AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') AS nuevo_fin,
       CASE WHEN f.purchase_type = 'bono_ilimitado'
            THEN EXISTS (SELECT 1 FROM public.unlimited_membership_periods u WHERE u.checkout_session_id = f.checkout_session_id)
            ELSE EXISTS (SELECT 1 FROM public.monthly_membership_periods m WHERE m.checkout_session_id = f.checkout_session_id)
       END AS periodo_creado
FROM _bonos_stripe_faltantes f
ORDER BY f.email;

COMMIT;

-- NOTA IMPORTANTE -----------------------------------------------------------
-- Si el diagnóstico previo muestra que ALGUNO de los tres cobros de 40 €
-- (Mercedes Escribano Gómez, Marta Pérez Inocencio, Alejandra Sánchez Tébar)
-- NO aparece en public.stripe_purchases, el webhook falló ANTES de escribir
-- en BD y esta migración no puede repararlo. En ese caso hay que reenviar el
-- evento `checkout.session.completed` desde Stripe (Developers → Events) o
-- ejecutar el MCP de Stripe para localizar el checkout_session_id y invocar
-- `stripe_fulfill_checkout` con service_role. No inventar el periodo a mano
-- sin ese identificador: se perdería la trazabilidad del cobro.

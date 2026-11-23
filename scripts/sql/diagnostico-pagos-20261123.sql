-- Diagnóstico SOLO LECTURA —Incidente 23 nov 2026: 3 cobros de 40 € (Bono Inicial)
-- con Apple Pay, solo 1 con bono cargado. Ejecutar en el SQL Editor de Supabase.
-- No modifica datos.

-- A) Los 3 cobros de 40 € de ayer/hoy y su estado en la BD.
SELECT 'purchases' AS bloque,
       sp.checkout_session_id,
       pr.email,
       pr.full_name,
       sp.purchase_type,
       sp.amount_total,
       sp.payment_status,
       sp.refunded_at,
       sp.is_guest,
       sp.fulfilled_at
FROM public.stripe_purchases sp
LEFT JOIN public.profiles pr ON pr.id = sp.user_id
WHERE sp.amount_total = 4000
  AND sp.created_at >= now() - interval '7 days'
ORDER BY sp.created_at DESC;

-- B) ¿Existe el periodo del bono para esos checkout?
SELECT 'periodos' AS bloque,
       mp.checkout_session_id,
       pr.email,
       mp.plan_type,
       mp.membership_month,
       mp.starts_at,
       mp.ends_at,
       mp.purchased_at
FROM public.monthly_membership_periods mp
JOIN public.profiles pr ON pr.id = mp.user_id
WHERE mp.checkout_session_id IN (
  SELECT checkout_session_id FROM public.stripe_purchases WHERE amount_total = 4000
)
ORDER BY mp.starts_at DESC;

-- C) Eventos webhook recibidos para esos patrones de pago.
SELECT 'webhook_events' AS bloque,
       event_id, event_type, checkout_session_id, object_id, created_at
FROM public.stripe_webhook_events
WHERE checkout_session_id IN (
  SELECT checkout_session_id FROM public.stripe_purchases WHERE amount_total = 4000
)
ORDER BY created_at DESC;

-- D) Perfiles por los emails del parte (para detectar bono en otra cuenta).
SELECT 'perfiles' AS bloque,
       pr.id, pr.email, pr.full_name,
       pr.created_at,
       pr.bono_mensual_activo, pr.bono_mensual_fin
FROM public.profiles pr
WHERE lower(pr.email) IN (
  'mercescrigo@gmail.com',
  'alejandrasancheztebar@gmail.com',
  'martaprz119@gmail.com'
)
ORDER BY pr.email;

-- E) Cualquier periodo vigente de esos perfiles, aunque venga de otra cuenta.
SELECT 'todos_los_periodos' AS bloque,
       pr.email, mp.plan_type, mp.checkout_session_id,
       mp.starts_at, mp.ends_at
FROM public.monthly_membership_periods mp
JOIN public.profiles pr ON pr.id = mp.user_id
WHERE lower(pr.email) IN (
  'mercescrigo@gmail.com',
  'alejandrasancheztebar@gmail.com',
  'martaprz119@gmail.com'
)
ORDER BY pr.email, mp.starts_at DESC;

-- Interpretación rápida:
--  * Si en A falta un checkout => el webhook no llegó a escribir en BD:
--    reenviar el evento desde Stripe (Developers → Events → Resend).
--  * Si está en A pero falta en B => ejecutar la migración
--    202611230001_reparar_bonos_stripe_pagados_sin_periodo.sql.
--  * Si el periodo existe en otro email/cuenta (E) => el app_user_id del
--    checkout apuntaba a otro perfil (p. ej. otra identidad Apple); hay que
--    revisar los metadatos del checkout en Stripe antes de mover el bono.

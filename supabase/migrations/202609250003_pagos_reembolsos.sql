-- Auditoría fase dinero (2026-09-25): reembolsos.
-- S1: stripe_purchases no registraba reembolsos (los créditos sobrevivían).
-- Columnas para marcar compras reembolsadas (las escribe el webhook con
-- service_role al recibir charge.refunded).
alter table public.stripe_purchases
  add column if not exists refunded_at timestamptz,
  add column if not exists refund_id text;

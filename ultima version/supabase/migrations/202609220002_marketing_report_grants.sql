-- ============================================================================
-- v15.0 fix: las policies RLS no bastan sin GRANT de tabla. stripe_purchases
-- y stripe_customers no tenían ningún GRANT -> Postgres devolvía
-- "permission denied for table" (42501) antes siquiera de evaluar RLS.
-- ============================================================================

grant select on public.stripe_purchases to authenticated;
grant select on public.stripe_customers to authenticated;
grant select on public.class_credit_packs to authenticated;
grant select on public.unlimited_membership_periods to authenticated;

-- ============================================================================
-- v15.0 Informe marketing: lecturas staff/admin para el generador de informes
-- (botón Excel/PDF del Dashboard Ejecutivo). Solo SELECT, sin escrituras.
-- Las descargas las ejecuta el navegador del admin con su propia sesión,
-- así que RLS debe permitir a staff/admin leer estas tablas de negocio.
-- ============================================================================

-- 1. Compras Stripe (ingresos): sin policies -> denegado todo. Lectura staff.
drop policy if exists "marketing_report_staff_select_purchases" on public.stripe_purchases;
create policy "marketing_report_staff_select_purchases"
on public.stripe_purchases
for select
to authenticated
using (public.es_staff_o_admin(auth.uid()));

-- 2. Packs de créditos: solo _select_own (cada uno lo suyo). Lectura staff.
drop policy if exists "marketing_report_staff_select_packs" on public.class_credit_packs;
create policy "marketing_report_staff_select_packs"
on public.class_credit_packs
for select
to authenticated
using (public.es_staff_o_admin(auth.uid()));

-- 3. Periodos de membresía ilimitada: solo _select_own. Lectura staff.
drop policy if exists "marketing_report_staff_select_memberships" on public.unlimited_membership_periods;
create policy "marketing_report_staff_select_memberships"
on public.unlimited_membership_periods
for select
to authenticated
using (public.es_staff_o_admin(auth.uid()));

-- 4. Clientes Stripe (mapeo compra->cliente para el informe): sin policies. Lectura staff.
drop policy if exists "marketing_report_staff_select_customers" on public.stripe_customers;
create policy "marketing_report_staff_select_customers"
on public.stripe_customers
for select
to authenticated
using (public.es_staff_o_admin(auth.uid()));

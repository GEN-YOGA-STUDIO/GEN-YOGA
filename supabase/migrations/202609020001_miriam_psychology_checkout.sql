-- Migration 202609020001_miriam_psychology_checkout.sql
-- Integración de compras online con Stripe Checkout para consultas de Psicología de Miriam:
-- 1. miriam_psico_individual_1a (Acompañamiento psicoterapéutico 1ª sesión - 75 €)
-- 2. miriam_psico_individual_sig (Acompañamiento psicoterapéutico siguientes - 65 €)
-- 3. miriam_psico_pareja_1a (Terapia de pareja 1ª sesión - 120 €)
-- 4. miriam_psico_pareja_sig (Terapia de pareja siguientes - 100 €)

begin;

do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'compras_stripe') then
    comment on table public.compras_stripe is 'Registro de compras realizadas mediante Stripe Checkout (clases, bonos y consultas de psicología con Miriam).';
  end if;
end $$;

commit;

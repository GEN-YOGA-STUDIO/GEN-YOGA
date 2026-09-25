-- ============================================================================
-- Auditoría 2026-09-25 (lote 1): secretos fuera del alcance público y
-- escrituras anónimas cerradas. Solo lectura/denes necesarios; ningún flujo
-- legítimo de la app escribe como anon en estas tablas.
-- 1) C11: la fila resend_api_key era legible por cualquiera (policy SELECT
--    USING true + select('*') en clientes). El mailer usa la env
--    RESEND_API_KEY (34 envíos ok): la fila sobra -> se borra y la policy
--    pasa a denegar claves secretas por patrón (convención documentada).
--    PENDIENTE PROPIETARIO: rotar la clave en Resend (la anterior es pública).
-- 2) A13: tipos_clases y grupos_profesionales permitían INSERT/UPDATE/DELETE
--    a anon. anon queda en solo lectura; escritura, solo staff.
-- ============================================================================

-- 1. Configuración sin secretos.
drop policy if exists "Todos leen configuración pública" on public.configuracion;
create policy "Lectura pública sin secretos"
on public.configuracion
for select
to public
using (
  clave <> 'resend_api_key'
  and clave not ilike '%secret%'
  and clave not ilike '%api_key%'
  and clave not ilike '%token%'
);
delete from public.configuracion where clave = 'resend_api_key';

-- 2. tipos_clases: anon solo lee; escribir, solo staff.
drop policy if exists "Allow all for anonymous users" on public.tipos_clases;
drop policy if exists "Allow all for authenticated users" on public.tipos_clases;
create policy "tipos_clases_select_anon"
on public.tipos_clases
for select
to anon
using (true);
create policy "tipos_clases_staff_all"
on public.tipos_clases
for all
to authenticated
using (public.es_staff_o_admin(auth.uid()))
with check (public.es_staff_o_admin(auth.uid()));

-- 3. grupos_profesionales: anon solo lee; escribir, solo staff.
drop policy if exists "Allow all for anon in grupos_profesionales" on public.grupos_profesionales;
drop policy if exists "Allow all for authenticated in grupos_profesionales" on public.grupos_profesionales;
create policy "grupos_profesionales_select_anon"
on public.grupos_profesionales
for select
to anon
using (true);
create policy "grupos_profesionales_staff_all"
on public.grupos_profesionales
for all
to authenticated
using (public.es_staff_o_admin(auth.uid()))
with check (public.es_staff_o_admin(auth.uid()));

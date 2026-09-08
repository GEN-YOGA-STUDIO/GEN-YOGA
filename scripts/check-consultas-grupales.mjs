import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';

const ROOT = process.cwd();

console.log('--- Verifying Consultas Grupales & Dynamic Stripe Integration ---');

// 1. Migration checks
const migrationPath = path.join(ROOT, 'supabase/migrations/202609080001_consultas_grupales_y_stripe_dinamico.sql');
assert(fs.existsSync(migrationPath), 'Migration 202609080001 must exist');
const migrationSql = fs.readFileSync(migrationPath, 'utf8');
assert(migrationSql.includes("'consulta_grupal'"), 'Migration must include consulta_grupal constraint');
assert(migrationSql.includes("'consulta'"), 'Migration must include consulta constraint');
assert(migrationSql.includes('prod_VDmmlmsGGhMebt'), 'Migration must seed prod_VDmmlmsGGhMebt for Miriam group session');
assert(migrationSql.includes('capacidad_predeterminada'), 'Migration must add capacidad_predeterminada column');
assert(migrationSql.includes('enforce_capacidad_max_rules'), 'Migration must update enforce_capacidad_max_rules trigger');

const migration2Path = path.join(ROOT, 'supabase/migrations/202609080002_catalogo_consultas_integracion_estricta.sql');
assert(fs.existsSync(migration2Path), 'Migration 202609080002 must exist');
const migration2Sql = fs.readFileSync(migration2Path, 'utf8');
assert(migration2Sql.includes('especialidad text'), 'Migration 202609080002 must add especialidad column');
assert(migration2Sql.includes('tipo_clase_id = (SELECT id FROM public.tipos_clases'), 'Migration 202609080002 must backfill tipo_clase_id for existing consultations');
console.log('✓ Database migrations verified');

// 2. list-stripe-products Edge Function
const listProductsPath = path.join(ROOT, 'supabase/functions/list-stripe-products/index.ts');
assert(fs.existsSync(listProductsPath), 'list-stripe-products Edge Function must exist');
const listProductsTs = fs.readFileSync(listProductsPath, 'utf8');
assert(listProductsTs.includes('stripe.products.list'), 'Must query Stripe products.list');
assert(listProductsTs.includes('corsHeaders'), 'Must handle CORS');
console.log('✓ list-stripe-products Edge Function verified');

// 3. stripe-production.ts
const sharedStripePath = path.join(ROOT, 'supabase/functions/_shared/stripe-production.ts');
const sharedTs = fs.readFileSync(sharedStripePath, 'utf8');
assert(sharedTs.includes("MIRIAM_PSICO_GRUPAL: 'prod_VDmmlmsGGhMebt'"), 'Must define MIRIAM_PSICO_GRUPAL');
assert(sharedTs.includes("SESION_GRUPAL: 'prod_VDmmlmsGGhMebt'"), 'Must define SESION_GRUPAL');
assert(sharedTs.includes('resolveDynamicStripePrice'), 'Must export resolveDynamicStripePrice');
assert(sharedTs.includes("rawMetaType.startsWith('prod_')"), 'validateCheckoutPurchase must support prod_*');
console.log('✓ stripe-production.ts verified');

// 4. create-checkout-session
const checkoutPath = path.join(ROOT, 'supabase/functions/create-checkout-session/index.ts');
const checkoutTs = fs.readFileSync(checkoutPath, 'utf8');
assert(checkoutTs.includes('resolveDynamicStripePrice'), 'Must import resolveDynamicStripePrice');
assert(checkoutTs.includes('isDynamicStripe'), 'Must define isDynamicStripe');
assert(checkoutTs.includes('resolveDynamicStripePrice(stripe, purchaseType)'), 'Must resolve dynamic price in create-checkout-session');
console.log('✓ create-checkout-session verified');

// 5. profile.html
const profilePath = path.join(ROOT, 'profile.html');
const profileHtml = fs.readFileSync(profilePath, 'utf8');
assert(profileHtml.includes('id="consulta-nombre"'), 'Must have consulta-nombre input');
assert(profileHtml.includes('id="consulta-tipo-select"'), 'Must have consulta-tipo-select input bound to catalog');
assert(profileHtml.includes('actualizarCamposTipoConsultaModal'), 'Must define actualizarCamposTipoConsultaModal');
assert(profileHtml.includes('consulta-duracion-display'), 'Must have locked consulta-duracion-display input');
assert(profileHtml.includes('consulta-metodo-pago-display'), 'Must have locked consulta-metodo-pago-display input');
assert(profileHtml.includes('id="consulta-capacidad"'), 'Must have consulta-capacidad input');
assert(profileHtml.includes('prod_VDmmlmsGGhMebt'), 'Must reference Miriam group session prod_VDmmlmsGGhMebt');
assert(profileHtml.includes('cargarStripeProductosDinamicos'), 'Must define cargarStripeProductosDinamicos');
assert(profileHtml.includes('new-tipo-capacidad'), 'Must have new-tipo-capacidad in class type creator');
assert(profileHtml.includes('new-tipo-especialidad'), 'Must have new-tipo-especialidad in class type creator');
assert(profileHtml.includes('new-tipo-stripe-product'), 'Must have new-tipo-stripe-product in class type creator');
assert(profileHtml.includes('value="consulta_grupal"'), 'Must have consulta_grupal in new-tipo-categoria');
assert(profileHtml.includes('value="consulta"'), 'Must have consulta in new-tipo-categoria');
assert(profileHtml.includes('CONSULTA EN GRUPO'), 'Must render badge for CONSULTA EN GRUPO');
assert(profileHtml.includes('CONSULTA INDIVIDUAL'), 'Must render badge for CONSULTA INDIVIDUAL');
assert(profileHtml.includes('tipo_clase_id: tipoClaseId'), 'Must persist tipo_clase_id in guardarConsultaAdmin');
console.log('✓ profile.html verified');

// 6. public-calendar.js
const calendarPath = path.join(ROOT, 'public-calendar.js');
const calendarJs = fs.readFileSync(calendarPath, 'utf8');
assert(calendarJs.includes('finalFreeSpots = Math.max(0, capacity - finalOccupied)'), 'Must calculate free spots correctly for group capacity');
console.log('✓ public-calendar.js verified');

console.log('\nALL VERIFICATIONS PASSED SUCCESSFULLY!');

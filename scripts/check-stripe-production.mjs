import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

function requireText(source, expected, label) {
  if (!source.includes(expected)) errors.push(`${label}: falta ${expected}`);
}

function requireBefore(source, first, second, label) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex >= secondIndex) {
    errors.push(`${label}: ${first} debe ejecutarse antes de ${second}`);
  }
}

function forbid(source, pattern, label) {
  if (pattern.test(source)) errors.push(`${label}: contiene ${pattern}`);
}

async function collectTextFiles(directory) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'img', 'fonts', '.temp'].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...await collectTextFiles(absolute));
    } else if (/\.(?:html|css|js|mjs|ts|toml|md|json|sql|example|gitignore)$/i.test(entry.name)) {
      results.push(absolute);
    }
  }
  return results;
}

const functionPaths = [
  'supabase/functions/_shared/stripe-production.ts',
  'supabase/functions/create-checkout-session/index.ts',
  'supabase/functions/create-portal-session/index.ts',
  'supabase/functions/get-checkout-session/index.ts',
  'supabase/functions/book-guest-class/index.ts',
  'supabase/functions/stripe-webhook/index.ts',
];

const functionSources = await Promise.all(functionPaths.map(read));
const allFunctions = functionSources.join('\n');
const [shared, checkout, portal, getSession, guestBooking, webhook] = functionSources;
const migration = await read('supabase/migrations/202607200001_stripe_production.sql');
const config = await read('supabase/config.toml');
const frontendPaths = ['tarifas.html', 'profile.html', 'success.html'];
const frontendSources = await Promise.all(frontendPaths.map(read));
const frontend = frontendSources.join('\n');

forbid(allFunctions, /sk_test_|pk_test_|price_1T|http:\/\/localhost|event\s*=\s*JSON\.parse/i, 'Edge Functions');
forbid(allFunctions, /\bsite_url\b/, 'Edge Functions');
forbid(frontend, /\bsite_url\b|\bsiteUrl\b/, 'Frontend Stripe');

requireText(shared, "startsWith('sk_live_')", 'Configuración LIVE');
requireText(shared, "startsWith('whsec_')", 'Firma del webhook');
requireText(shared, "startsWith('bpc_')", 'Configuración del portal');
requireText(shared, 'price.unit_amount !== expectedAmount', 'Validación de importes');
requireText(shared, "buildOriginSet('ALLOWED_ORIGINS'", 'Lista de orígenes CORS');
requireText(shared, 'config.allowedOrigins.has(origin)', 'Validación CORS por lista blanca');
requireText(shared, "buildOriginSet('PAYMENT_ALLOWED_ORIGINS'", 'Lista de orígenes de pago LIVE');
requireText(shared, 'config.paymentAllowedOrigins.has(origin)', 'Bloqueo de pagos fuera de producción');
requireText(shared, "'https://genyoga.studio'", 'Origen LIVE principal fijado en código');
requireText(shared, "'https://www.genyoga.studio'", 'Origen LIVE www fijado en código');
requireText(shared, "'https://jaime312.github.io'", 'Origen LIVE certificación fijado en código');
requireText(shared, "requireEnv('PAYMENT_ALLOWED_ORIGINS')", 'Orígenes de pago obligatorios');
requireText(shared, 'siteUrl !== PRODUCTION_SITE_ORIGIN', 'SITE_URL canónica sin rutas de certificación');
requireText(checkout, 'getAuthenticatedUser', 'Identidad de Checkout');
requireText(checkout, 'getValidatedCatalog', 'Catálogo de Checkout');
requireText(portal, 'checkoutSession.client_reference_id !== user!.id', 'Propiedad del portal');
requireText(portal, 'configuration: config.portalConfigurationId!', 'Configuración LIVE del portal');
requireText(checkout, 'idempotencyKey', 'Idempotencia de Checkout');
requireText(checkout, 'checkoutAttemptId', 'Idempotencia individual de invitados');
requireText(getSession, 'validateCheckoutPurchase', 'Validación de retorno');
requireText(guestBooking, 'stripe_redeem_guest_checkout', 'Canje invitado');
requireText(webhook, 'constructEventAsync', 'Firma Stripe');
requireText(webhook, 'if (!event.livemode)', 'Evento LIVE');
requireText(webhook, "supabase.rpc('stripe_fulfill_checkout'", 'Fulfillment atómico');
requireText(webhook, "event.type === 'invoice.paid'", 'Renovaciones');
requireText(webhook, 'parent?.subscription_details?.subscription', 'Compatibilidad Invoice Basil');
requireText(webhook, "event.type === 'customer.subscription.deleted'", 'Cancelaciones');

for (const [source, label] of [
  [checkout, 'Checkout'],
  [portal, 'Portal'],
  [getSession, 'Consulta Checkout'],
  [guestBooking, 'Reserva invitado'],
]) {
  requireText(source, 'readCorsConfig()', `CORS temprano en ${label}`);
  requireText(source, 'assertPaymentOrigin(req, config)', `Guard LIVE en ${label}`);
  requireBefore(
    source,
    'assertPaymentOrigin(req, config)',
    'const stripe = createStripeClient(config)',
    `Orden del guard LIVE en ${label}`,
  );
}

requireText(frontendSources[2], 'APP_DEPLOYMENT_ENVIRONMENT', 'Entorno explícito en success.html');
requireText(frontendSources[2], 'ensureLivePaymentEnvironment()', 'Guard frontend en success.html');

for (const rpc of [
  'stripe_fulfill_checkout',
  'stripe_sync_subscription',
  'stripe_register_guest_checkout',
  'stripe_redeem_guest_checkout',
]) {
  requireText(migration, `function public.${rpc}`, `Migración ${rpc}`);
}
requireText(migration, 'enable row level security', 'RLS Stripe');
requireText(config, '[functions.stripe-webhook]', 'Configuración webhook');
requireText(config, 'verify_jwt = false', 'Configuración JWT');

for (let index = 0; index < frontendSources.length; index++) {
  const html = frontendSources[index];
  const inlineScript = /<script(?![^>]*\bsrc=)(?![^>]*type=["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(inlineScript)) {
    try {
      new Script(match[1], { filename: frontendPaths[index] });
    } catch (error) {
      errors.push(`${frontendPaths[index]}: JavaScript inválido (${error.message})`);
    }
  }
}

const sensitivePattern = /(?:sk_(?:live|test)|rk_live|whsec)_[A-Za-z0-9]{20,}/g;
for (const absolute of await collectTextFiles(root)) {
  const source = await readFile(absolute, 'utf8');
  if (sensitivePattern.test(source)) {
    errors.push(`${path.relative(root, absolute)}: posible secreto Stripe almacenado`);
  }
  sensitivePattern.lastIndex = 0;
}

if (errors.length) {
  console.error('Stripe production check failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Stripe production checks passed.');

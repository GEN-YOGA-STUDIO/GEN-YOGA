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

function count(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

async function collectTextFiles(directory) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'img', 'fonts', '.temp'].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...await collectTextFiles(absolute));
    } else if (/\.(?:html|css|js|mjs|ts|toml|md|json|sql|example|gitignore|local)$/i.test(entry.name)) {
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
  'supabase/functions/book-unlimited-guest/index.ts',
  'supabase/functions/stripe-webhook/index.ts',
  'supabase/functions/delete-account/index.ts',
];

const functionSources = await Promise.all(functionPaths.map(read));
const allFunctions = functionSources.join('\n');
const [shared, checkout, portal, getSession, guestBooking, unlimitedGuestBooking, webhook, deleteAccount] = functionSources;
const migration = await read('supabase/migrations/202607200001_stripe_production.sql');
const consultationMigration = await read('supabase/migrations/202607210001_consultation_booking_integrity.sql');
const balanceMigration = await read('supabase/migrations/202607210002_admin_balance_integrity.sql');
const accountDeletionMigration = await read('supabase/migrations/202607210003_account_deletion_guard.sql');
const profileAuthorizationMigration = await read('supabase/migrations/202607210004_profile_authorization_integrity.sql');
const packsMigration = await read('supabase/migrations/202608030002_class_packs_unlimited_6_9.sql');
const consultationBillingMigration = await read('supabase/migrations/202609020004_consultas_checkout_billing.sql');
const config = await read('supabase/config.toml');
const envExample = await read('supabase/functions/.env.example');
const productionGuide = await read('STRIPE_PRODUCTION.md');
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
for (const [productId, label] of [
  ['prod_V0ITB6mD71fwnD', 'pack de 4 clases'],
  ['prod_V0IUpyuvd7uX00', 'pack de 6 clases'],
  ['prod_V0IUYoGJJbX7FW', 'pack de 10 clases'],
  ['prod_V1pKHgtMwPkCpC', 'Miriam acompañamiento inicial'],
  ['prod_V1pLmzpCRU8ZpL', 'Miriam acompañamiento sucesivo'],
  ['prod_V1pLCY3t5sprlK', 'Miriam pareja inicial'],
  ['prod_V1pLWNLzr9Vb3g', 'Miriam pareja sucesiva'],
  ['prod_V1ppAeiDF9dlkZ', 'Isabel PNI inicial'],
  ['prod_V1pqPF6rtJf0SW', 'Isabel PNI sucesiva'],
]) {
  requireText(shared, productId, `Producto Stripe de ${label}`);
}
for (const variableName of [
  'STRIPE_PRICE_PACK_4',
  'STRIPE_PRICE_PACK_6',
  'STRIPE_PRICE_PACK_10',
  'STRIPE_PRICE_BONO_ILIMITADO',
]) {
  requireText(shared, `requireEnv('${variableName}')`, `Catálogo ${variableName}`);
  requireText(envExample, `${variableName}=`, `Ejemplo ${variableName}`);
}
requireText(shared, "buildOriginSet('ALLOWED_ORIGINS'", 'Lista de orígenes CORS');
requireText(shared, 'config.allowedOrigins.has(origin)', 'Validación CORS por lista blanca');
requireText(shared, "buildOriginSet('PAYMENT_ALLOWED_ORIGINS'", 'Lista de orígenes de pago LIVE');
requireText(shared, 'config.paymentAllowedOrigins.has(origin)', 'Bloqueo de pagos fuera de producción');
requireText(shared, "'https://genyoga.studio'", 'Origen LIVE principal fijado en código');
requireText(shared, "'https://www.genyoga.studio'", 'Origen LIVE www fijado en código');
requireText(shared, "requireEnv('PAYMENT_ALLOWED_ORIGINS')", 'Orígenes de pago obligatorios');
requireText(shared, 'siteUrl !== PRODUCTION_SITE_ORIGIN', 'SITE_URL canónica sin rutas de certificación');
requireText(shared, 'return config.siteUrl', 'Retorno Stripe siempre canónico');
const liveOriginsBlock = shared.match(/const LIVE_PAYMENT_ORIGINS[\s\S]*?\]\)/)?.[0] || '';
const returnResolverBlock = shared.match(/export function resolveReturnBaseUrl[\s\S]*?\n}/)?.[0] || '';
forbid(liveOriginsBlock, /jaime312|github\.io/i, 'Pagos LIVE');
forbid(shared, /CERTIFICATION_BASE_URL|\/GEN-YOGA/i, 'Retornos Stripe');
forbid(returnResolverBlock, /return\s+origin\b/i, 'Retornos Stripe');
forbid(envExample.match(/^PAYMENT_ALLOWED_ORIGINS=.*$/m)?.[0] || '', /github\.io/i, 'PAYMENT_ALLOWED_ORIGINS de ejemplo');
forbid(productionGuide.match(/PAYMENT_ALLOWED_ORIGINS[\s\S]*?```/i)?.[0] || '', /github\.io/i, 'Guía de orígenes LIVE');
requireText(checkout, 'getAuthenticatedUser', 'Identidad de Checkout');
requireText(checkout, 'getValidatedCatalog', 'Catálogo de Checkout');
requireText(portal, 'checkoutSession.client_reference_id !== user!.id', 'Propiedad del portal');
requireText(portal, 'configuration: config.portalConfigurationId!', 'Configuración LIVE del portal');
requireText(checkout, 'idempotencyKey', 'Idempotencia de Checkout');
requireText(checkout, 'checkoutAttemptId', 'Idempotencia individual de invitados');
requireText(checkout, 'profile.account_deletion_pending', 'Checkout bloqueado por eliminación pendiente');
requireText(checkout, 'expireCreatedCheckoutSession', 'Cierre del Checkout creado durante eliminación');
requireText(checkout, ".select('account_deletion_pending')", 'Revalidación post-Checkout del tombstone');
requireText(checkout, "const APP_RELEASE = '6.27'", 'Versión autoritativa de Checkout');
requireText(checkout, 'app_version: APP_RELEASE', 'Metadato uniforme de versión en Checkout');
requireText(shared, 'getConsultationDetails', 'Catálogo canónico de consultas');
requireText(checkout, 'getConsultationDetails', 'Resolución canónica de consultas en Checkout');
requireText(shared, 'resolveConsultationPrice', 'Resolución del Price reutilizable de consultas');
requireText(checkout, 'resolveConsultationPrice', 'Price reutilizable de consultas en Checkout');
const resolveConsultationPriceBlock = shared.match(
  /export async function resolveConsultationPrice[\s\S]*?(?=\nexport function assertValidConsultationPrice)/,
)?.[0] || '';
requireText(resolveConsultationPriceBlock, 'params.product = details.productId', 'Filtrado de Prices por Product canónico');
requireText(resolveConsultationPriceBlock, 'active: true', 'Price activo de consulta');
requireText(resolveConsultationPriceBlock, "type: 'one_time'", 'Price de pago único de consulta');
requireText(checkout, 'if (details.productId)', 'Sin fallback efímero para Products canónicos');
const validateCheckoutPurchaseBlock = shared.match(
  /export function validateCheckoutPurchase[\s\S]*?(?=\nexport function validateMonthlySubscription)/,
)?.[0] || '';
requireText(validateCheckoutPurchaseBlock, 'getConsultationDetails', 'Catálogo canónico al validar Checkout');
requireText(validateCheckoutPurchaseBlock, 'assertValidConsultationPrice', 'Validación del Price de consulta en Checkout');
requireText(shared, 'stripeObjectId(price.product) === details.productId', 'Validación de price.product de consulta');
forbid(checkout, /\bpayment_method_types\s*:/, 'Checkout con métodos de pago dinámicos');
requireText(shared, "bonoIlimitado.type !== 'one_time'", 'Bono Ilimitado como pago único');
requireText(shared, 'membership_month', 'Mes natural validado desde Stripe');
requireText(checkout, 'validateMembershipMonth(body.membership_month)', 'Mes natural validado antes de Checkout');
requireText(checkout, ".from('unlimited_membership_periods')", 'Duplicados de mes natural bloqueados');
requireText(checkout, 'metadata.membership_month = membershipMonth', 'Mes natural incluido en metadatos Stripe');
requireText(getSession, 'p_membership_month: purchase.membershipMonth', 'Mes natural consolidado en retorno');
requireText(webhook, 'p_membership_month: purchase.membershipMonth', 'Mes natural consolidado por webhook');
forbid(
  checkout,
  /appVersion\s*!==\s*APP_RELEASE|web está desactualizada/i,
  'Checkout no muestra avisos de incompatibilidad entre builds',
);
requireText(getSession, 'validateCheckoutPurchase', 'Validación de retorno');
requireText(guestBooking, 'stripe_redeem_guest_checkout', 'Canje invitado');
requireText(unlimitedGuestBooking, "supabase.rpc(\n      'reservar_invitado_ilimitado'", 'Canje de invitado ilimitado');
requireText(webhook, 'constructEventAsync', 'Firma Stripe');
requireText(webhook, 'if (!event.livemode)', 'Evento LIVE');
requireText(webhook, "supabase.rpc('stripe_fulfill_checkout'", 'Fulfillment atómico');
requireText(webhook, "event.type === 'invoice.paid'", 'Renovaciones');
requireText(webhook, 'parent?.subscription_details?.subscription', 'Compatibilidad Invoice Basil');
requireText(webhook, "event.type === 'customer.subscription.deleted'", 'Cancelaciones');
requireText(deleteAccount, 'getAuthenticatedUser(req, supabase, true)', 'Autenticación de eliminación de cuenta');
requireText(deleteAccount, 'createAdminClient(config)', 'Service role aislado en eliminación de cuenta');
requireText(deleteAccount, 'actorIsAdmin', 'Autorización administrativa de eliminación de cuenta');
requireText(deleteAccount, 'remainingAdminCount === 0', 'Protección de la última cuenta administradora');
requireText(deleteAccount, "supabase.rpc('claim_account_deletion'", 'Claim exclusivo de eliminación');
requireText(deleteAccount, "supabase.rpc('release_account_deletion'", 'Liberación del claim fallido');
requireText(deleteAccount, 'closeOpenCheckoutsAndAssertNoPendingPayment', 'Cierre de Checkouts abiertos');
requireText(deleteAccount, 'knownCheckoutSessionIds', 'Bloqueo de pagos aún no registrados');
requireText(deleteAccount, 'session.customer_details?.email', 'Compatibilidad con Checkouts antiguos por correo');
requireText(deleteAccount, 'customerIds.has(customerId)', 'Compatibilidad con Checkouts antiguos por Customer');
requireText(deleteAccount, 'readCorsConfig()', 'CORS temprano en eliminación de cuenta');
requireText(deleteAccount, 'assertAllowedOrigin(req, corsConfig)', 'CORS de eliminación de cuenta');
requireText(deleteAccount, 'requirePost(req)', 'Método POST de eliminación de cuenta');
requireText(deleteAccount, 'assertAccountDeletionOrigin(req, config)', 'Guard productivo de eliminación de cuenta');
requireText(deleteAccount, 'config.paymentAllowedOrigins.has(origin)', 'Origen productivo de eliminación de cuenta');
requireText(deleteAccount, "body.confirmation !== DELETE_CONFIRMATION", 'Confirmación explícita de eliminación');
requireText(deleteAccount, 'confirmationEmails.has(confirmationEmail)', 'Confirmación de correo en servidor');
requireText(deleteAccount, 'stripe.subscriptions.search', 'Búsqueda Stripe por propietario antes de eliminar');
requireText(deleteAccount, 'stripe.subscriptions.list', 'Comprobación Stripe por Customer antes de eliminar');
requireText(deleteAccount, 'TERMINATED_SUBSCRIPTION_STATUSES', 'Estados terminales de suscripción');
requireText(deleteAccount, "supabase.rpc(\n        'finalize_account_deletion'", 'Limpieza transaccional de la cuenta');
requireText(deleteAccount, 'supabase.auth.admin.deleteUser', 'Borrado de Supabase Auth');
requireBefore(
  deleteAccount,
  'await ensureSubscriptionsAreTerminated(',
  "'finalize_account_deletion'",
  'Suscripción comprobada antes de eliminar datos',
);
requireBefore(
  deleteAccount,
  "supabase.rpc('claim_account_deletion'",
  'await closeOpenCheckoutsAndAssertNoPendingPayment(',
  'Tombstone activado antes de cerrar Checkouts',
);
requireBefore(
  deleteAccount,
  "'finalize_account_deletion'",
  'supabase.auth.admin.deleteUser',
  'Auth se elimina después de limpiar los datos',
);

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

requireText(unlimitedGuestBooking, 'readCorsConfig()', 'CORS temprano en Invitado del Bono Ilimitado');
requireText(unlimitedGuestBooking, 'assertPaymentOrigin(req, config)', 'Guard LIVE en Invitado del Bono Ilimitado');
requireBefore(
  unlimitedGuestBooking,
  'assertPaymentOrigin(req, config)',
  'const supabase = createAdminClient(config)',
  'Orden del guard LIVE en Invitado del Bono Ilimitado',
);

requireBefore(
  deleteAccount,
  'assertAccountDeletionOrigin(req, config)',
  'const stripe = createStripeClient(config)',
  'Orden del guard productivo en eliminación de cuenta',
);

const universalSupabaseClient =
  'window.supabase?.createClient ? window.supabase.createClient(SUPA_URL, SUPA_KEY) : null';
for (const [source, label] of [
  [frontendSources[0], 'tarifas.html'],
  [frontendSources[1], 'profile.html'],
  [frontendSources[2], 'success.html'],
]) {
  requireText(source, universalSupabaseClient, `Cliente Supabase único en ${label}`);
  forbid(source, /APP_DEPLOYMENT_ENVIRONMENT|USING_PRODUCTION_BACKEND/, `Sin bifurcación de build en ${label}`);
  forbid(
    source,
    /Esta compilación|build aislado|Pagos desactivados en certificación|Pagos no permitidos en desarrollo|Pago LIVE bloqueado en certificación/,
    `Sin avisos técnicos de entorno en ${label}`,
  );
}
forbid(
  checkout,
  /app_environment|frontend_environment|frontendEnvironment/,
  'Checkout no confía en una etiqueta de entorno enviada por el navegador',
);

for (const rpc of [
  'stripe_fulfill_checkout',
  'stripe_sync_subscription',
  'stripe_register_guest_checkout',
  'stripe_redeem_guest_checkout',
]) {
  requireText(migration, `function public.${rpc}`, `Migración ${rpc}`);
}
for (const expected of [
  'class_credit_packs',
  'unlimited_membership_periods',
  "when 'clase_suelta' then 1",
  "at time zone 'Europe/Madrid'",
  'membership_month',
  'es_especial',
  'tipos_clases_categoria_check',
  "v_is_special := v_class_type = 'taller'",
  'interval \'60 days\'',
  'function public.reservar_invitado_ilimitado',
  'function public.registrar_descuento_primera_consulta',
]) {
  requireText(packsMigration, expected, `Migración de packs 6.9`);
}
for (const [expected, label] of [
  ["'isabel_pni_1a'", 'tipo de compra Isabel PNI inicial'],
  ["'isabel_pni_sig'", 'tipo de compra Isabel PNI sucesiva'],
  ["p_purchase_type = 'isabel_pni_1a' and p_amount_total is distinct from 8000", 'importe Isabel PNI inicial'],
  ["p_purchase_type = 'isabel_pni_sig' and p_amount_total is distinct from 6000", 'importe Isabel PNI sucesiva'],
]) {
  requireText(consultationBillingMigration, expected, `Migración de consultas: ${label}`);
}
const ownerShapeBlock = consultationBillingMigration.match(
  /drop constraint if exists stripe_purchases_owner_shape_check;[\s\S]*?add constraint stripe_purchases_owner_shape_check check \([\s\S]*?\n\s*\);/,
)?.[0] || '';
for (const expected of [
  'is_guest',
  'user_id is null',
  'purchase_type in (',
  "'clase_suelta'",
  "'miriam_psico_individual_1a'",
  "'miriam_psico_individual_sig'",
  "'miriam_psico_pareja_1a'",
  "'miriam_psico_pareja_sig'",
  "'silvia_ayurveda_1a'",
  "'silvia_ayurveda_sig'",
  "'isabel_pni_1a'",
  "'isabel_pni_sig'",
  'or not is_guest',
]) {
  requireText(ownerShapeBlock, expected, 'Owner shape de consultas de invitado');
}
forbid(ownerShapeBlock, /silvia_ayurveda_bono(?:3|6)/, 'Owner shape sin bonos de consulta para invitados');
const isabelCreditBlock = consultationBillingMigration.match(
  /elsif p_purchase_type in \(\s*'miriam_psico_individual_1a',[\s\S]*?'isabel_pni_1a',[\s\S]*?'isabel_pni_sig'\s*\) then[\s\S]*?get diagnostics v_profile_updated = row_count;/,
)?.[0] || '';
requireText(isabelCreditBlock, 'set saldo_psicologia = saldo_psicologia + 1', 'Crédito de consultas de Isabel');
requireText(frontendSources[1], 'role="progressbar" aria-label="Clases utilizadas"', 'Progreso de consumo en el perfil');
requireText(frontendSources[1], 'role="progressbar" aria-label="Tiempo transcurrido del mes"', 'Progreso del mes natural en el perfil');
requireText(frontendSources[1], 'membership_month: membershipMonth', 'Mes natural enviado desde el perfil');
requireText(frontendSources[0], '60 días naturales desde la compra', 'Caducidad de clase suelta visible en tarifas');
requireText(migration, 'enable row level security', 'RLS Stripe');
requireText(config, '[functions.stripe-webhook]', 'Configuración webhook');
requireText(config, 'verify_jwt = false', 'Configuración JWT');
const deleteAccountConfig = config.match(/\[functions\.delete-account\][\s\S]*?(?=\n\[|$)/)?.[0] || '';
requireText(deleteAccountConfig, 'verify_jwt = true', 'JWT obligatorio para eliminar cuentas');
forbid(deleteAccountConfig, /verify_jwt\s*=\s*false/, 'Eliminación de cuenta');

requireText(consultationMigration, 'begin;', 'Transacción de consultas');
requireText(consultationMigration, 'commit;', 'Commit de consultas');
requireText(consultationMigration, 'function public.reservar_consulta_atomica', 'Reserva atómica de consultas');
requireText(consultationMigration, 'function public.cancelar_consulta_atomica', 'Cancelación atómica de consultas');
requireText(consultationMigration, 'saldo_descontado', 'Trazabilidad del saldo de consultas');
requireText(consultationMigration, 'for update', 'Bloqueo concurrente de consultas');
requireText(consultationMigration, 'horas_limite_cancelacion', 'Límite servidor de cancelación de consultas');
requireText(consultationMigration, 'staff may only manage consultation slots linked to their professional profile', 'Aislamiento de agenda del profesional');
requireText(consultationMigration, 'revoke insert, update, delete on table public.reservas_psicologia', 'Escrituras directas cerradas en reservas de psicología');
requireText(consultationMigration, 'revoke insert, update, delete on table public.reservas_nutricion', 'Escrituras directas cerradas en reservas de nutrición');
requireText(consultationMigration, 'grant execute on function public.reservar_consulta_atomica', 'Permisos RPC de consultas');
requireText(balanceMigration, 'function public.ajustar_saldo_usuario', 'Ajuste atómico de saldos');
requireText(balanceMigration, "v_actor_role <> 'admin'", 'Autorización del ajuste de saldos');
requireText(balanceMigration, 'for update', 'Bloqueo concurrente del ajuste de saldos');
requireText(frontendSources[1], "client.rpc('ajustar_saldo_usuario'", 'Perfil usa ajuste atómico de saldos');
requireText(accountDeletionMigration, 'account_deletion_pending', 'Tombstone de eliminación');
requireText(accountDeletionMigration, 'function public.claim_account_deletion', 'Claim atómico de eliminación');
requireText(accountDeletionMigration, 'function public.release_account_deletion', 'Liberación segura de eliminación');
requireText(accountDeletionMigration, 'profiles_protect_account_deletion_state', 'Trigger de protección de eliminación');
requireText(accountDeletionMigration, 'entitlement update rejected', 'Bloqueo de fulfillment durante eliminación');
requireText(accountDeletionMigration, 'pg_advisory_xact_lock', 'Serialización del borrado de administradores');
requireText(accountDeletionMigration, 'last administrator cannot be deleted', 'Último administrador protegido en base de datos');
requireText(accountDeletionMigration, "auth.role(), '') <> 'service_role'", 'Tombstone reservado a service role');
requireText(accountDeletionMigration, 'grant execute on function public.claim_account_deletion', 'Permiso service role del claim');
requireText(profileAuthorizationMigration, 'revoke insert, update, delete on table public.profiles', 'Escrituras de perfil cerradas al navegador');
requireText(profileAuthorizationMigration, 'function public.crear_perfil_nuevo_usuario', 'Creación transaccional del perfil al registrarse');
requireText(profileAuthorizationMigration, 'zz_gen_yoga_profile_after_signup', 'Trigger de perfil para Auth');
requireText(profileAuthorizationMigration, 'function public.actualizar_mi_perfil', 'Edición propia limitada');
requireText(profileAuthorizationMigration, 'function public.admin_configurar_bono_mensual', 'Administración protegida del bono mensual');
requireText(profileAuthorizationMigration, 'function public.admin_promover_usuario_profesor', 'Promoción protegida de profesionales');
if (count(profileAuthorizationMigration, /if not found or v_actor_role is distinct from 'admin'/g) !== 2) {
  errors.push('Migración de perfiles: ambas RPC administrativas deben fallar si el perfil del actor no existe');
}
forbid(
  frontendSources[1],
  /\.from\(['"]profiles['"]\)\s*\.(?:insert|upsert|update|delete)\s*\(/,
  'profile.html no debe escribir perfiles directamente',
);
if (count(frontendSources[1], /functions\.invoke\(['"]delete-account['"]/g) !== 2) {
  errors.push('profile.html: ambos flujos de eliminación deben usar delete-account');
}
forbid(
  frontendSources[1],
  /from\(['"]profiles['"]\)\s*\.delete\s*\(/,
  'profile.html no debe borrar cuentas directamente',
);

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

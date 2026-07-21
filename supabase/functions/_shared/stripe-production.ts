import Stripe from "https://esm.sh/stripe@14.22.0?target=deno"
import {
  createClient,
  type SupabaseClient,
  type User,
} from "https://esm.sh/@supabase/supabase-js@2.39.0"

export const PURCHASE_TYPES = {
  CLASE_SUELTA: 'clase_suelta',
  BONO_MENSUAL: 'bono_mensual',
} as const

export type PurchaseType = typeof PURCHASE_TYPES[keyof typeof PURCHASE_TYPES]

export type CorsConfig = {
  allowedOrigins: ReadonlySet<string>
}

export type ProductionConfig = CorsConfig & {
  stripeSecretKey: string
  webhookSecret?: string
  portalConfigurationId?: string
  priceClaseSuelta: string
  priceBonoMensual: string
  siteUrl: string
  siteOrigin: string
  paymentAllowedOrigins: ReadonlySet<string>
  supabaseUrl: string
  supabaseServiceRoleKey: string
}

export type ValidatedCatalog = {
  claseSuelta: Stripe.Price
  bonoMensual: Stripe.Price
}

export type ValidatedPurchase = {
  purchaseType: PurchaseType
  price: Stripe.Price
  expectedAmount: number
  appUserId: string
}

const catalogCache = new Map<string, Promise<ValidatedCatalog>>()
const PRODUCTION_SITE_ORIGIN = 'https://genyoga.studio'
const LIVE_PAYMENT_ORIGINS = new Set([
  PRODUCTION_SITE_ORIGIN,
  'https://www.genyoga.studio',
])

export class HttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`${name} no está configurado.`)
  return value
}

function normaliseSiteUrl(rawValue: string): { siteUrl: string; siteOrigin: string } {
  let parsed: URL
  try {
    parsed = new URL(rawValue)
  } catch {
    throw new Error('SITE_URL no es una URL válida.')
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('SITE_URL debe utilizar HTTPS en producción.')
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('SITE_URL no puede incluir credenciales, query string ni fragmento.')
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  const siteUrl = parsed.toString().replace(/\/$/, '')
  return { siteUrl, siteOrigin: parsed.origin }
}

function normaliseAllowedOrigin(rawValue: string, variableName: string): string {
  let parsed: URL
  try {
    parsed = new URL(rawValue)
  } catch {
    throw new Error(`${variableName} contiene una URL no válida: ${rawValue}`)
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`Todos los valores de ${variableName} deben utilizar HTTPS.`)
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname && parsed.pathname !== '/')
  ) {
    throw new Error(`${variableName} solo puede contener orígenes HTTPS, sin rutas ni parámetros.`)
  }
  return parsed.origin
}

function buildOriginSet(variableName: string, defaultOrigins: string[]): ReadonlySet<string> {
  const allowedOrigins = new Set<string>(defaultOrigins)
  const configuredOrigins = Deno.env.get(variableName)?.trim()
  if (!configuredOrigins) return allowedOrigins

  const values = configuredOrigins.split(',').map((value) => value.trim())
  if (values.some((value) => !value)) {
    throw new Error(`${variableName} contiene un valor vacío.`)
  }
  if (values.length > 20) {
    throw new Error(`${variableName} contiene demasiados orígenes.`)
  }
  for (const value of values) allowedOrigins.add(normaliseAllowedOrigin(value, variableName))
  return allowedOrigins
}

function buildAllowedOrigins(siteOrigin: string): ReadonlySet<string> {
  return buildOriginSet('ALLOWED_ORIGINS', [siteOrigin])
}

function buildPaymentAllowedOrigins(): ReadonlySet<string> {
  requireEnv('PAYMENT_ALLOWED_ORIGINS')
  const paymentAllowedOrigins = buildOriginSet('PAYMENT_ALLOWED_ORIGINS', [])
  if (paymentAllowedOrigins.size === 0) {
    throw new Error('PAYMENT_ALLOWED_ORIGINS debe incluir al menos un origen productivo.')
  }
  for (const origin of paymentAllowedOrigins) {
    if (!LIVE_PAYMENT_ORIGINS.has(origin)) {
      throw new Error(`PAYMENT_ALLOWED_ORIGINS no puede autorizar un origen no productivo: ${origin}`)
    }
  }
  return paymentAllowedOrigins
}

export function readCorsConfig(): CorsConfig {
  // CORS must be available even when another production secret is missing, so
  // the browser receives the real JSON error instead of reporting a misleading
  // network failure. The payment guard remains stricter and is checked later.
  return { allowedOrigins: buildOriginSet('ALLOWED_ORIGINS', [...LIVE_PAYMENT_ORIGINS]) }
}

export function readProductionConfig(options: {
  requireWebhookSecret?: boolean
  requirePortalConfiguration?: boolean
} = {}): ProductionConfig {
  const stripeSecretKey = requireEnv('STRIPE_SECRET_KEY')
  if (!stripeSecretKey.startsWith('sk_live_')) {
    throw new Error('STRIPE_SECRET_KEY debe ser una clave LIVE de Stripe.')
  }

  const priceClaseSuelta = requireEnv('STRIPE_PRICE_CLASE_SUELTA')
  const priceBonoMensual = requireEnv('STRIPE_PRICE_BONO_MENSUAL')
  if (!priceClaseSuelta.startsWith('price_') || !priceBonoMensual.startsWith('price_')) {
    throw new Error('Los identificadores Stripe de precio no son válidos.')
  }
  if (priceClaseSuelta === priceBonoMensual) {
    throw new Error('Los dos productos no pueden compartir el mismo Price ID.')
  }

  const { siteUrl, siteOrigin } = normaliseSiteUrl(requireEnv('SITE_URL'))
  if (siteOrigin !== PRODUCTION_SITE_ORIGIN || siteUrl !== PRODUCTION_SITE_ORIGIN) {
    throw new Error('SITE_URL debe ser exactamente https://genyoga.studio, sin rutas.')
  }
  const allowedOrigins = buildAllowedOrigins(siteOrigin)
  const paymentAllowedOrigins = buildPaymentAllowedOrigins()
  const webhookSecret = options.requireWebhookSecret ? requireEnv('STRIPE_WEBHOOK_SECRET') : undefined
  if (webhookSecret && !webhookSecret.startsWith('whsec_')) {
    throw new Error('STRIPE_WEBHOOK_SECRET no tiene un formato válido.')
  }
  const portalConfigurationId = options.requirePortalConfiguration
    ? requireEnv('STRIPE_PORTAL_CONFIGURATION')
    : undefined
  if (portalConfigurationId && !portalConfigurationId.startsWith('bpc_')) {
    throw new Error('STRIPE_PORTAL_CONFIGURATION no tiene un formato válido.')
  }

  return {
    stripeSecretKey,
    webhookSecret,
    portalConfigurationId,
    priceClaseSuelta,
    priceBonoMensual,
    siteUrl,
    siteOrigin,
    allowedOrigins,
    paymentAllowedOrigins,
    supabaseUrl: requireEnv('SUPABASE_URL'),
    supabaseServiceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  }
}

export function createStripeClient(config: ProductionConfig): Stripe {
  return new Stripe(config.stripeSecretKey, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  })
}

export function createAdminClient(config: ProductionConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function validateCommonPrice(price: Stripe.Price, expectedId: string, expectedAmount: number): void {
  if (price.id !== expectedId || !price.livemode || !price.active) {
    throw new Error(`El Price ${expectedId} no está activo en modo LIVE.`)
  }
  if (price.currency.toLowerCase() !== 'eur' || price.unit_amount !== expectedAmount) {
    throw new Error(`El Price ${expectedId} no tiene el importe EUR esperado.`)
  }
}

export async function loadAndValidateCatalog(
  stripe: Stripe,
  config: ProductionConfig,
): Promise<ValidatedCatalog> {
  const [claseSuelta, bonoMensual] = await Promise.all([
    stripe.prices.retrieve(config.priceClaseSuelta),
    stripe.prices.retrieve(config.priceBonoMensual),
  ])

  validateCommonPrice(claseSuelta, config.priceClaseSuelta, 1500)
  if (claseSuelta.type !== 'one_time' || claseSuelta.recurring) {
    throw new Error('STRIPE_PRICE_CLASE_SUELTA debe ser un pago único.')
  }

  validateCommonPrice(bonoMensual, config.priceBonoMensual, 9000)
  if (
    bonoMensual.type !== 'recurring' ||
    bonoMensual.recurring?.interval !== 'month' ||
    bonoMensual.recurring.interval_count !== 1
  ) {
    throw new Error('STRIPE_PRICE_BONO_MENSUAL debe ser una suscripción mensual.')
  }

  return { claseSuelta, bonoMensual }
}

export function getValidatedCatalog(
  stripe: Stripe,
  config: ProductionConfig,
): Promise<ValidatedCatalog> {
  const cacheKey = `${config.priceClaseSuelta}:${config.priceBonoMensual}`
  let promise = catalogCache.get(cacheKey)
  if (!promise) {
    promise = loadAndValidateCatalog(stripe, config)
    catalogCache.set(cacheKey, promise)
    promise.catch(() => catalogCache.delete(cacheKey))
  }
  return promise
}

export function corsHeaders(req: Request, config: CorsConfig): Record<string, string> {
  const origin = req.headers.get('origin')
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
  if (origin && config.allowedOrigins.has(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

export function assertAllowedOrigin(req: Request, config: CorsConfig): void {
  const origin = req.headers.get('origin')
  if (origin && !config.allowedOrigins.has(origin)) {
    throw new HttpError(403, 'Origen no permitido.')
  }
}

export function getRequestOrigin(req: Request): string | null {
  const origin = req.headers.get('origin')?.trim()
  if (origin) return origin
  const referer = req.headers.get('referer')?.trim()
  if (referer) {
    try {
      return new URL(referer).origin
    } catch {}
  }
  return null
}

export function assertPaymentOrigin(
  req: Request,
  config: Pick<ProductionConfig, 'paymentAllowedOrigins'>,
): void {
  const origin = getRequestOrigin(req)
  if (!origin || !config.paymentAllowedOrigins.has(origin)) {
    throw new HttpError(
      403,
      'Los pagos LIVE no están permitidos desde este origen.',
    )
  }
}

export function resolveReturnBaseUrl(
  _req: Request,
  config: Pick<ProductionConfig, 'siteUrl'>,
): string {
  // Stripe must always return to the canonical HTTPS hostname. Reflecting the
  // browser Origin leaks the Checkout session through redirect chains and can
  // make certification jump into a different published repository.
  return config.siteUrl
}

export function handleOptions(req: Request, config: CorsConfig): Response | null {
  if (req.method !== 'OPTIONS') return null
  const origin = req.headers.get('origin')
  if (origin && !config.allowedOrigins.has(origin)) {
    return jsonResponse({ error: 'Origen no permitido.' }, 403, corsHeaders(req, config))
  }
  return new Response('ok', { status: 200, headers: corsHeaders(req, config) })
}

export function requirePost(req: Request): void {
  if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido.')
}

export function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

export function safeErrorResponse(
  error: unknown,
  headers: Record<string, string> = {},
): Response {
  if (error instanceof HttpError) {
    return jsonResponse({ error: error.message }, error.status, headers)
  }
  console.error('Error interno de Stripe:', error)
  return jsonResponse({ error: 'No se pudo procesar la solicitud de pago.' }, 500, headers)
}

export async function getAuthenticatedUser(
  req: Request,
  supabase: SupabaseClient,
  required = true,
): Promise<User | null> {
  const authorization = req.headers.get('authorization') || ''
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  if (!match) {
    if (required) throw new HttpError(401, 'Debes iniciar sesión.')
    return null
  }

  const token = match[1].trim()
  if (!token || token.startsWith('sb_publishable_') || token.startsWith('sb_anon_')) {
    if (required) throw new HttpError(401, 'Sesión de usuario no válida.')
    return null
  }

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) {
    if (required) throw new HttpError(401, 'Sesión de usuario no válida.')
    return null
  }
  return data.user
}

export function isUuid(value: string | null | undefined): value is string {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export function stripeObjectId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null
  return typeof value === 'string' ? value : value.id
}

export function unixSecondsToIso(value: number | null | undefined): string | null {
  return typeof value === 'number' ? new Date(value * 1000).toISOString() : null
}

export function validateCheckoutPurchase(
  session: Stripe.Checkout.Session,
  catalog: ValidatedCatalog,
): ValidatedPurchase {
  if (!session.livemode) throw new HttpError(400, 'La sesión no pertenece al entorno LIVE.')
  if (session.payment_status !== 'paid') throw new HttpError(400, 'La sesión no está pagada.')

  const lineItems = session.line_items?.data || []
  if (lineItems.length !== 1 || lineItems[0].quantity !== 1 || !lineItems[0].price) {
    throw new HttpError(400, 'La compra no contiene un único producto válido.')
  }

  const priceId = lineItems[0].price.id
  let purchaseType: PurchaseType
  let price: Stripe.Price
  let expectedAmount: number
  if (priceId === catalog.claseSuelta.id) {
    purchaseType = PURCHASE_TYPES.CLASE_SUELTA
    price = catalog.claseSuelta
    expectedAmount = 1500
  } else if (priceId === catalog.bonoMensual.id) {
    purchaseType = PURCHASE_TYPES.BONO_MENSUAL
    price = catalog.bonoMensual
    expectedAmount = 9000
  } else {
    throw new HttpError(400, 'El producto comprado no está permitido.')
  }

  if (session.currency?.toLowerCase() !== 'eur' || session.amount_total !== expectedAmount) {
    throw new HttpError(400, 'El importe de la sesión no coincide con el producto.')
  }
  const expectedMode = purchaseType === PURCHASE_TYPES.BONO_MENSUAL ? 'subscription' : 'payment'
  if (session.mode !== expectedMode || session.status !== 'complete') {
    throw new HttpError(400, 'El tipo o estado de la sesión no coincide con el producto.')
  }

  const metadata = session.metadata || {}
  const appUserId = metadata.app_user_id || session.client_reference_id || ''
  if (
    metadata.app !== 'gen_yoga' ||
    metadata.environment !== 'production' ||
    metadata.purchase_type !== purchaseType ||
    !appUserId ||
    session.client_reference_id !== appUserId
  ) {
    throw new HttpError(400, 'Los metadatos de la sesión no son válidos.')
  }
  if (appUserId === 'guest' && purchaseType !== PURCHASE_TYPES.CLASE_SUELTA) {
    throw new HttpError(400, 'Una compra de invitado solo puede ser una clase suelta.')
  }
  if (appUserId !== 'guest' && !isUuid(appUserId)) {
    throw new HttpError(400, 'La sesión no está vinculada a un usuario válido.')
  }

  return { purchaseType, price, expectedAmount, appUserId }
}

export function validateMonthlySubscription(
  subscription: Stripe.Subscription,
  catalog: ValidatedCatalog,
): { appUserId: string; priceId: string } {
  if (!subscription.livemode) throw new HttpError(400, 'La suscripción no pertenece al entorno LIVE.')
  const matchingItem = subscription.items.data.find(
    (item: Stripe.SubscriptionItem) => item.price.id === catalog.bonoMensual.id,
  )
  // Stripe omits quantity in some historical API shapes; its documented
  // default is one. Any explicit quantity above one would no longer match the
  // fixed 90 EUR monthly product validated by this application.
  if (
    !matchingItem ||
    subscription.items.data.length !== 1 ||
    (matchingItem.quantity ?? 1) !== 1
  ) {
    throw new HttpError(400, 'La suscripción no contiene el bono mensual permitido.')
  }

  const metadata = subscription.metadata || {}
  const appUserId = metadata.app_user_id || ''
  if (
    metadata.app !== 'gen_yoga' ||
    metadata.environment !== 'production' ||
    metadata.purchase_type !== PURCHASE_TYPES.BONO_MENSUAL ||
    !isUuid(appUserId)
  ) {
    throw new HttpError(400, 'Los metadatos de la suscripción no son válidos.')
  }
  return { appUserId, priceId: matchingItem.price.id }
}

export function subscriptionIsEntitled(status: Stripe.Subscription.Status): boolean {
  return status === 'active' || status === 'trialing'
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

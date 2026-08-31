import Stripe from "https://esm.sh/stripe@14.22.0?target=deno"
import {
  createClient,
  type SupabaseClient,
  type User,
} from "https://esm.sh/@supabase/supabase-js@2.39.0"

export const PURCHASE_TYPES = {
  CLASE_SUELTA: 'clase_suelta',
  PACK_4: 'pack_4',
  PACK_6: 'pack_6',
  PACK_10: 'pack_10',
  BONO_ILIMITADO: 'bono_ilimitado',
  BONO_MENSUAL: 'bono_mensual',
  MIRIAM_PSICO_INDIVIDUAL_1A: 'miriam_psico_individual_1a',
  MIRIAM_PSICO_INDIVIDUAL_SIG: 'miriam_psico_individual_sig',
  MIRIAM_PSICO_PAREJA_1A: 'miriam_psico_pareja_1a',
  MIRIAM_PSICO_PAREJA_SIG: 'miriam_psico_pareja_sig',
  SILVIA_AYURVEDA_1A: 'silvia_ayurveda_1a',
  SILVIA_AYURVEDA_SIG: 'silvia_ayurveda_sig',
  SILVIA_AYURVEDA_BONO3: 'silvia_ayurveda_bono3',
  SILVIA_AYURVEDA_BONO6: 'silvia_ayurveda_bono6',
  ISABEL_PNI_1A: 'isabel_pni_1a',
  ISABEL_PNI_SIG: 'isabel_pni_sig',
  CLASE_ESPECIAL: 'clase_especial',
  TALLER_INTRO_POWER_VINYASA: 'taller_intro_power_vinyasa',
  PROMO_50_CLASE: 'promo_50_clase',
} as const

// Public LIVE product identifiers supplied by GEN Yoga. Checkout still uses
// Price IDs, but every configured pack Price must belong to its expected
// product so a valid-looking Price from another Stripe product is rejected.
export const PACK_PRODUCT_IDS = {
  PACK_4: 'prod_V0ITB6mD71fwnD',
  PACK_6: 'prod_V0IUpyuvd7uX00',
  PACK_10: 'prod_V0IUYoGJJbX7FW',
} as const

export const PROMO_PRODUCT_IDS = {
  PROMO_50_CLASE: 'prod_V9eGZTzwCNJ55q',
} as const

export const MIRIAM_PRODUCT_IDS = {
  INDIVIDUAL_1A: 'prod_V1pKHgtMwPkCpC',
  INDIVIDUAL_SIG: 'prod_V1pLmzpCRU8ZpL',
  PAREJA_1A: 'prod_V1pLCY3t5sprlK',
  PAREJA_SIG: 'prod_V1pLWNLzr9Vb3g',
} as const

export const ISABEL_PRODUCT_IDS = {
  PNI_1A: 'prod_V1ppAeiDF9dlkZ',
  PNI_SIG: 'prod_V1pqPF6rtJf0SW',
} as const

export const WORKSHOP_PRODUCT_IDS = {
  CLASE_ESPECIAL: 'prod_V5uBKuweMRE6ig',
  TALLER_INTRO_POWER_VINYASA: 'prod_V5uCPKKKH5K74P',
} as const

export type PurchaseType = typeof PURCHASE_TYPES[keyof typeof PURCHASE_TYPES]

export type ConsultationDetails = {
  name: string
  amount: number
  productId?: string
  guestAllowed: boolean
}

export type WorkshopDetails = {
  name: string
  amount?: number
  productId: string
  guestAllowed: boolean
}

// Product IDs are the canonical Stripe identity when GEN Yoga has supplied
// one. The internal purchase type remains application metadata; it must never
// be treated as if it were necessarily a Stripe Price lookup_key.
export const CONSULTATION_CATALOG: Partial<Record<PurchaseType, ConsultationDetails>> = {
  [PURCHASE_TYPES.MIRIAM_PSICO_INDIVIDUAL_1A]: {
    name: 'Acompañamiento psicoterapéutico (1ª sesión)',
    amount: 7500,
    productId: MIRIAM_PRODUCT_IDS.INDIVIDUAL_1A,
    guestAllowed: true,
  },
  [PURCHASE_TYPES.MIRIAM_PSICO_INDIVIDUAL_SIG]: {
    name: 'Acompañamiento psicoterapéutico (siguientes)',
    amount: 6500,
    productId: MIRIAM_PRODUCT_IDS.INDIVIDUAL_SIG,
    guestAllowed: true,
  },
  [PURCHASE_TYPES.MIRIAM_PSICO_PAREJA_1A]: {
    name: 'Terapia de pareja (1ª sesión)',
    amount: 12000,
    productId: MIRIAM_PRODUCT_IDS.PAREJA_1A,
    guestAllowed: true,
  },
  [PURCHASE_TYPES.MIRIAM_PSICO_PAREJA_SIG]: {
    name: 'Terapia de pareja (siguientes)',
    amount: 10000,
    productId: MIRIAM_PRODUCT_IDS.PAREJA_SIG,
    guestAllowed: true,
  },
  [PURCHASE_TYPES.SILVIA_AYURVEDA_1A]: {
    name: 'Consulta de Ayurveda (1ª sesión)',
    amount: 8000,
    guestAllowed: true,
  },
  [PURCHASE_TYPES.SILVIA_AYURVEDA_SIG]: {
    name: 'Consulta de Ayurveda (seguimiento)',
    amount: 6000,
    guestAllowed: true,
  },
  [PURCHASE_TYPES.SILVIA_AYURVEDA_BONO3]: {
    name: 'Bono de Salud Integrativa (3 consultas)',
    amount: 17000,
    guestAllowed: false,
  },
  [PURCHASE_TYPES.SILVIA_AYURVEDA_BONO6]: {
    name: 'Bono de Salud Integrativa (6 consultas)',
    amount: 28000,
    guestAllowed: false,
  },
  [PURCHASE_TYPES.ISABEL_PNI_1A]: {
    name: 'Consulta de Psiconeuroinmunología Clínica (1ª sesión)',
    amount: 8000,
    productId: ISABEL_PRODUCT_IDS.PNI_1A,
    guestAllowed: true,
  },
  [PURCHASE_TYPES.ISABEL_PNI_SIG]: {
    name: 'Consulta de Psiconeuroinmunología Clínica (seguimiento)',
    amount: 6000,
    productId: ISABEL_PRODUCT_IDS.PNI_SIG,
    guestAllowed: true,
  },
}

export const WORKSHOP_CATALOG: Partial<Record<PurchaseType, WorkshopDetails>> = {
  [PURCHASE_TYPES.CLASE_ESPECIAL]: {
    name: 'Clase Especial',
    productId: WORKSHOP_PRODUCT_IDS.CLASE_ESPECIAL,
    guestAllowed: true,
  },
  [PURCHASE_TYPES.TALLER_INTRO_POWER_VINYASA]: {
    name: 'Taller: Introducción a Power Vinyasa',
    amount: 3500,
    productId: WORKSHOP_PRODUCT_IDS.TALLER_INTRO_POWER_VINYASA,
    guestAllowed: true,
  },
}

export type PromoDetails = {
  name: string
  amount?: number
  productId: string
  guestAllowed: boolean
}

export const PROMO_CATALOG: Partial<Record<PurchaseType, PromoDetails>> = {
  [PURCHASE_TYPES.PROMO_50_CLASE]: {
    name: '1ª Clase con 50% Dto. (Promo GEN YOGA)',
    amount: 750,
    productId: PROMO_PRODUCT_IDS.PROMO_50_CLASE,
    guestAllowed: false,
  },
}

export function normalizePromoPurchaseType(type: string): string {
  const norm = String(type || '').trim().toLowerCase()
  if (['promo_50_clase', 'promo_50', 'promo', 'descuento_promo_50', 'promo_gen_yoga'].includes(norm)) {
    return PURCHASE_TYPES.PROMO_50_CLASE
  }
  return norm
}

export function getConsultationDetails(purchaseType: string): ConsultationDetails | null {
  return CONSULTATION_CATALOG[purchaseType as PurchaseType] || null
}

export function getWorkshopDetails(purchaseType: string): WorkshopDetails | null {
  return WORKSHOP_CATALOG[purchaseType as PurchaseType] || null
}

export function getPromoDetails(purchaseType: string): PromoDetails | null {
  const normalized = normalizePromoPurchaseType(purchaseType)
  return PROMO_CATALOG[normalized as PurchaseType] || null
}

export function isSingleConsultation(purchaseType: string): boolean {
  return getConsultationDetails(purchaseType)?.guestAllowed === true
}

export function isWorkshopPurchase(purchaseType: string): boolean {
  return getWorkshopDetails(purchaseType) !== null
}

export function isPromoPurchase(purchaseType: string): boolean {
  return getPromoDetails(purchaseType) !== null
}

export type CorsConfig = {
  allowedOrigins: ReadonlySet<string>
}

export type ProductionConfig = CorsConfig & {
  stripeSecretKey: string
  webhookSecret?: string
  portalConfigurationId?: string
  priceClaseSuelta: string
  pricePack4: string
  pricePack6: string
  pricePack10: string
  priceBonoIlimitado: string
  priceBonoMensual: string
  siteUrl: string
  siteOrigin: string
  paymentAllowedOrigins: ReadonlySet<string>
  supabaseUrl: string
  supabaseServiceRoleKey: string
}

export type ValidatedCatalog = {
  claseSuelta: Stripe.Price
  pack4: Stripe.Price
  pack6: Stripe.Price
  pack10: Stripe.Price
  bonoIlimitado: Stripe.Price
  bonoMensual: Stripe.Price
}

export type ValidatedPurchase = {
  purchaseType: PurchaseType
  price: Stripe.Price
  expectedAmount: number
  appUserId: string
  membershipMonth: string | null
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
  const pricePack4 = requireEnv('STRIPE_PRICE_PACK_4')
  const pricePack6 = requireEnv('STRIPE_PRICE_PACK_6')
  const pricePack10 = requireEnv('STRIPE_PRICE_PACK_10')
  const priceBonoIlimitado = requireEnv('STRIPE_PRICE_BONO_ILIMITADO')
  const priceBonoMensual = requireEnv('STRIPE_PRICE_BONO_MENSUAL')
  const configuredPriceIds = [
    priceClaseSuelta,
    pricePack4,
    pricePack6,
    pricePack10,
    priceBonoIlimitado,
    priceBonoMensual,
  ]
  if (configuredPriceIds.some((priceId) => !priceId.startsWith('price_'))) {
    throw new Error('Los identificadores Stripe de precio no son válidos.')
  }
  const oneTimePriceIds = [
    priceClaseSuelta,
    pricePack4,
    pricePack6,
    pricePack10,
    priceBonoIlimitado,
  ]
  if (new Set(oneTimePriceIds).size !== oneTimePriceIds.length) {
    throw new Error('Los productos de pago único no pueden compartir Price ID.')
  }
  if (oneTimePriceIds.includes(priceBonoMensual)) {
    throw new Error('El Price recurrente antiguo no puede reutilizar un Price de pago único.')
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
    pricePack4,
    pricePack6,
    pricePack10,
    priceBonoIlimitado,
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

function validateCommonPrice(
  price: Stripe.Price,
  expectedId: string,
  expectedAmount: number,
  expectedProductId?: string,
): void {
  if (price.id !== expectedId || !price.livemode || !price.active) {
    throw new Error(`El Price ${expectedId} no está activo en modo LIVE.`)
  }
  if (price.currency.toLowerCase() !== 'eur' || price.unit_amount !== expectedAmount) {
    throw new Error(`El Price ${expectedId} no tiene el importe EUR esperado.`)
  }
  if (expectedProductId && stripeObjectId(price.product) !== expectedProductId) {
    throw new Error(`El Price ${expectedId} no pertenece al producto ${expectedProductId}.`)
  }
}

export async function loadAndValidateCatalog(
  stripe: Stripe,
  config: ProductionConfig,
): Promise<ValidatedCatalog> {
  const [claseSuelta, pack4, pack6, pack10, bonoIlimitado, bonoMensual] = await Promise.all([
    stripe.prices.retrieve(config.priceClaseSuelta),
    stripe.prices.retrieve(config.pricePack4),
    stripe.prices.retrieve(config.pricePack6),
    stripe.prices.retrieve(config.pricePack10),
    stripe.prices.retrieve(config.priceBonoIlimitado),
    stripe.prices.retrieve(config.priceBonoMensual),
  ])

  validateCommonPrice(claseSuelta, config.priceClaseSuelta, 1500)
  if (claseSuelta.type !== 'one_time' || claseSuelta.recurring) {
    throw new Error('STRIPE_PRICE_CLASE_SUELTA debe ser un pago único.')
  }

  for (const [price, priceId, amount, variableName, expectedProductId] of [
    [pack4, config.pricePack4, 5000, 'STRIPE_PRICE_PACK_4', PACK_PRODUCT_IDS.PACK_4],
    [pack6, config.pricePack6, 6500, 'STRIPE_PRICE_PACK_6', PACK_PRODUCT_IDS.PACK_6],
    [pack10, config.pricePack10, 9500, 'STRIPE_PRICE_PACK_10', PACK_PRODUCT_IDS.PACK_10],
  ] as const) {
    validateCommonPrice(price, priceId, amount, expectedProductId)
    if (price.type !== 'one_time' || price.recurring) {
      throw new Error(`${variableName} debe ser un pago único.`)
    }
  }

  validateCommonPrice(bonoIlimitado, config.priceBonoIlimitado, 9000)
  if (bonoIlimitado.type !== 'one_time' || bonoIlimitado.recurring) {
    throw new Error('STRIPE_PRICE_BONO_ILIMITADO debe ser un pago único de un mes natural.')
  }

  validateCommonPrice(bonoMensual, config.priceBonoMensual, 9000)
  if (
    bonoMensual.type !== 'recurring' ||
    bonoMensual.recurring?.interval !== 'month' ||
    bonoMensual.recurring.interval_count !== 1
  ) {
    throw new Error('STRIPE_PRICE_BONO_MENSUAL debe ser una suscripción mensual.')
  }

  return { claseSuelta, pack4, pack6, pack10, bonoIlimitado, bonoMensual }
}

export function getValidatedCatalog(
  stripe: Stripe,
  config: ProductionConfig,
): Promise<ValidatedCatalog> {
  const cacheKey = [
    config.priceClaseSuelta,
    config.pricePack4,
    config.pricePack6,
    config.pricePack10,
    config.priceBonoIlimitado,
    config.priceBonoMensual,
  ].join(':')
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

function consultationPriceMatches(
  price: Stripe.Price,
  details: ConsultationDetails,
  requireActive: boolean,
): boolean {
  return (
    price.livemode &&
    (!requireActive || price.active) &&
    price.currency.toLowerCase() === 'eur' &&
    price.unit_amount === details.amount &&
    price.type === 'one_time' &&
    !price.recurring &&
    (!details.productId || stripeObjectId(price.product) === details.productId)
  )
}

export async function resolveConsultationPrice(
  stripe: Stripe,
  purchaseType: string,
): Promise<Stripe.Price | null> {
  const details = getConsultationDetails(purchaseType)
  if (!details) return null

  const params: Stripe.PriceListParams = {
    active: true,
    currency: 'eur',
    type: 'one_time',
    limit: 100,
  }
  if (details.productId) {
    params.product = details.productId
  } else {
    params.lookup_keys = [purchaseType]
  }

  const prices = await stripe.prices.list(params)
  const matchingPrice = prices.data.find(
    (price: Stripe.Price) => consultationPriceMatches(price, details, true),
  ) || null
  if (!matchingPrice && details.productId) {
    throw new Error(
      `El producto ${details.productId} no tiene un Price LIVE activo de ${details.amount} EUR céntimos.`,
    )
  }
  return matchingPrice
}

export function assertValidConsultationPrice(
  price: Stripe.Price,
  purchaseType: string,
): ConsultationDetails {
  const details = getConsultationDetails(purchaseType)
  if (!details || !consultationPriceMatches(price, details, false)) {
    throw new HttpError(400, 'La consulta comprada no coincide con el producto y precio autorizados.')
  }
  return details
}

export async function resolveWorkshopPrice(
  stripe: Stripe,
  purchaseType: string,
): Promise<Stripe.Price | null> {
  const details = getWorkshopDetails(purchaseType)
  if (!details) return null

  const params: Stripe.PriceListParams = {
    active: true,
    currency: 'eur',
    type: 'one_time',
    product: details.productId,
    limit: 20,
  }
  const prices = await stripe.prices.list(params)
  const matchingPrice = prices.data.find((price: Stripe.Price) => {
    if (!price.livemode || !price.active || price.currency.toLowerCase() !== 'eur' || price.type !== 'one_time' || price.recurring) {
      return false
    }
    if (stripeObjectId(price.product) !== details.productId) return false
    if (details.amount !== undefined && price.unit_amount !== details.amount) return false
    return true
  }) || prices.data[0] || null

  if (!matchingPrice) {
    throw new Error(`El producto ${details.productId} no tiene un Price LIVE activo en Stripe.`)
  }
  return matchingPrice
}

export function assertValidWorkshopPrice(
  price: Stripe.Price,
  purchaseType: string,
): WorkshopDetails {
  const details = getWorkshopDetails(purchaseType)
  if (!details) {
    throw new HttpError(400, 'El taller o clase especial comprado no está autorizado.')
  }
  if (!price.livemode || price.currency.toLowerCase() !== 'eur' || stripeObjectId(price.product) !== details.productId) {
    throw new HttpError(400, 'El producto comprado no coincide con el producto autorizado de Stripe.')
  }
  if (details.amount !== undefined && price.unit_amount !== details.amount) {
    throw new HttpError(400, 'El importe del taller no coincide con el precio esperado.')
  }
  return details
}

export async function resolvePromoPrice(
  stripe: Stripe,
  purchaseType: string,
): Promise<Stripe.Price | null> {
  const details = getPromoDetails(purchaseType)
  if (!details) return null

  try {
    const params: Stripe.PriceListParams = {
      active: true,
      currency: 'eur',
      type: 'one_time',
      product: details.productId,
      limit: 20,
    }
    const prices = await stripe.prices.list(params)
    const matchingPrice = prices.data.find((price: Stripe.Price) => {
      if (!price.livemode || !price.active || price.currency.toLowerCase() !== 'eur' || price.type !== 'one_time' || price.recurring) {
        return false
      }
      if (stripeObjectId(price.product) !== details.productId) return false
      if (details.amount !== undefined && price.unit_amount !== details.amount) return false
      return true
    }) || prices.data[0] || null

    if (matchingPrice) return matchingPrice

    const allProductPrices = await stripe.prices.list({ product: details.productId, active: true, limit: 10 })
    if (allProductPrices.data.length > 0) {
      return allProductPrices.data[0]
    }
  } catch (err) {
    console.warn(`Error al consultar precios para el producto promocional ${details.productId}:`, err)
  }

  return null
}

export function assertValidPromoPrice(
  price: Stripe.Price,
  purchaseType: string,
): PromoDetails {
  const details = getPromoDetails(purchaseType)
  if (!details) {
    throw new HttpError(400, 'El producto promocional comprado no está autorizado.')
  }
  const prodId = stripeObjectId(price.product)
  if (!price.livemode || price.currency.toLowerCase() !== 'eur' || (prodId && prodId !== details.productId)) {
    throw new HttpError(400, 'El producto comprado no coincide con el producto promocional autorizado de Stripe.')
  }
  if (details.amount !== undefined && price.unit_amount !== details.amount) {
    throw new HttpError(400, 'El importe de la promoción no coincide con el precio esperado.')
  }
  return details
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
  const itemProduct = stripeObjectId(lineItems[0].price.product)
  const metadata = session.metadata || {}
  let purchaseType: PurchaseType
  let price: Stripe.Price
  let expectedAmount: number

  if (priceId === catalog.claseSuelta.id) {
    purchaseType = PURCHASE_TYPES.CLASE_SUELTA
    price = catalog.claseSuelta
    expectedAmount = 1500
  } else if (priceId === catalog.pack4.id) {
    purchaseType = PURCHASE_TYPES.PACK_4
    price = catalog.pack4
    expectedAmount = 5000
  } else if (priceId === catalog.pack6.id) {
    purchaseType = PURCHASE_TYPES.PACK_6
    price = catalog.pack6
    expectedAmount = 6500
  } else if (priceId === catalog.pack10.id) {
    purchaseType = PURCHASE_TYPES.PACK_10
    price = catalog.pack10
    expectedAmount = 9500
  } else if (priceId === catalog.bonoIlimitado.id) {
    purchaseType = PURCHASE_TYPES.BONO_ILIMITADO
    price = catalog.bonoIlimitado
    expectedAmount = 9000
  } else if (priceId === catalog.bonoMensual.id) {
    purchaseType = PURCHASE_TYPES.BONO_MENSUAL
    price = catalog.bonoMensual
    expectedAmount = 9000
  } else if (itemProduct === PROMO_PRODUCT_IDS.PROMO_50_CLASE || metadata.purchase_type === PURCHASE_TYPES.PROMO_50_CLASE || metadata.purchase_type === 'promo_50' || metadata.purchase_type === 'promo') {
    purchaseType = PURCHASE_TYPES.PROMO_50_CLASE
    price = lineItems[0].price
    const validDetails = assertValidPromoPrice(price, purchaseType)
    expectedAmount = validDetails.amount ?? price.unit_amount ?? session.amount_total
  } else {
    // Consultations, workshops and promo products select their server-owned definition,
    // and the line-item Price is validated against its canonical product.
    const rawMetaType = metadata.purchase_type || ''
    const normPromoType = normalizePromoPurchaseType(rawMetaType)
    const consultationDetails = getConsultationDetails(rawMetaType)
    const workshopDetails = getWorkshopDetails(rawMetaType)
    const promoDetails = getPromoDetails(normPromoType)
    if (consultationDetails) {
      purchaseType = rawMetaType as PurchaseType
      price = lineItems[0].price
      expectedAmount = assertValidConsultationPrice(price, purchaseType).amount
    } else if (workshopDetails) {
      purchaseType = rawMetaType as PurchaseType
      price = lineItems[0].price
      const validDetails = assertValidWorkshopPrice(price, purchaseType)
      expectedAmount = validDetails.amount ?? price.unit_amount ?? session.amount_total
    } else if (promoDetails) {
      purchaseType = normPromoType as PurchaseType
      price = lineItems[0].price
      const validDetails = assertValidPromoPrice(price, purchaseType)
      expectedAmount = validDetails.amount ?? price.unit_amount ?? session.amount_total
    } else {
      throw new HttpError(400, 'El producto comprado no está permitido.')
    }
  }

  if (session.currency?.toLowerCase() !== 'eur' || session.amount_total !== expectedAmount) {
    throw new HttpError(400, 'El importe de la sesión no coincide con el producto.')
  }
  const expectedMode = purchaseType === PURCHASE_TYPES.BONO_MENSUAL
    ? 'subscription'
    : 'payment'
  if (session.mode !== expectedMode || session.status !== 'complete') {
    throw new HttpError(400, 'El tipo o estado de la sesión no coincide con el producto.')
  }

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
  if (
    appUserId === 'guest' &&
    purchaseType !== PURCHASE_TYPES.CLASE_SUELTA &&
    !isSingleConsultation(purchaseType) &&
    !isWorkshopPurchase(purchaseType)
  ) {
    throw new HttpError(400, 'Una compra de invitado solo puede ser una clase suelta, consulta individual o taller.')
  }
  if (appUserId !== 'guest' && !isUuid(appUserId)) {
    throw new HttpError(400, 'La sesión no está vinculada a un usuario válido.')
  }

  const membershipMonth = metadata.membership_month?.trim() || null
  if (
    purchaseType === PURCHASE_TYPES.BONO_ILIMITADO &&
    (!membershipMonth || !/^\d{4}-(0[1-9]|1[0-2])$/.test(membershipMonth))
  ) {
    throw new HttpError(400, 'La sesión no contiene un mes natural válido.')
  }
  if (purchaseType !== PURCHASE_TYPES.BONO_ILIMITADO && membershipMonth) {
    throw new HttpError(400, 'El producto no admite un mes natural seleccionado.')
  }

  return { purchaseType, price, expectedAmount, appUserId, membershipMonth }
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
    !([
      PURCHASE_TYPES.BONO_MENSUAL,
      PURCHASE_TYPES.BONO_ILIMITADO,
    ] as readonly string[]).includes(metadata.purchase_type || '') ||
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

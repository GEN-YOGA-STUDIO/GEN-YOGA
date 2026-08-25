import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "https://esm.sh/stripe@14.22.0?target=deno"
import {
  CONSULTATION_CATALOG,
  WORKSHOP_CATALOG,
  PURCHASE_TYPES,
  HttpError,
  assertAllowedOrigin,
  assertPaymentOrigin,
  corsHeaders,
  createAdminClient,
  createStripeClient,
  getAuthenticatedUser,
  getConsultationDetails,
  getWorkshopDetails,
  getValidatedCatalog,
  handleOptions,
  isUuid,
  jsonResponse,
  readCorsConfig,
  readProductionConfig,
  requirePost,
  resolveConsultationPrice,
  resolveWorkshopPrice,
  resolveReturnBaseUrl,
  safeErrorResponse,
  isSingleConsultation,
  isWorkshopPurchase,
} from "../_shared/stripe-production.ts"

const APP_RELEASE = '7.37'
const MADRID_TIME_ZONE = 'Europe/Madrid'
const MEMBERSHIP_MONTHS_AHEAD = 11

function madridYearMonth(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: MADRID_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  if (!year || !month) throw new Error('No se pudo determinar el mes natural en Madrid.')
  return `${year}-${month}`
}

function addMonths(yearMonth: string, amount: number): string {
  const [year, month] = yearMonth.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1 + amount, 1))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`
}

function validateMembershipMonth(value: unknown): string {
  const membershipMonth = String(value || '').trim()
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(membershipMonth)) {
    throw new HttpError(400, 'Selecciona un mes natural válido para el Bono Ilimitado.')
  }
  const currentMonth = madridYearMonth()
  const lastAllowedMonth = addMonths(currentMonth, MEMBERSHIP_MONTHS_AHEAD)
  if (membershipMonth < currentMonth || membershipMonth > lastAllowedMonth) {
    throw new HttpError(400, 'El mes elegido debe estar entre el mes actual y los próximos 11 meses.')
  }
  return membershipMonth
}

async function expireCreatedCheckoutSession(
  stripe: ReturnType<typeof createStripeClient>,
  sessionId: string,
): Promise<void> {
  try {
    await stripe.checkout.sessions.expire(sessionId)
  } catch {
    const currentSession = await stripe.checkout.sessions.retrieve(sessionId)
    if (currentSession.status !== 'expired') {
      throw new Error('No se pudo cerrar la sesión de pago creada durante la eliminación de la cuenta.')
    }
  }
}

serve(async (req) => {
  let headers: Record<string, string> = {}
  try {
    const corsConfig = readCorsConfig()
    headers = corsHeaders(req, corsConfig)
    const preflight = handleOptions(req, corsConfig)
    if (preflight) return preflight

    assertAllowedOrigin(req, corsConfig)
    requirePost(req)
    const config = readProductionConfig()
    assertPaymentOrigin(req, config)

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      throw new HttpError(400, 'El cuerpo de la solicitud no es válido.')
    }

    const lookupKey = String(body.lookup_key || '').trim()
    const allowedPurchaseTypes = new Set<string>([
      PURCHASE_TYPES.CLASE_SUELTA,
      PURCHASE_TYPES.PACK_4,
      PURCHASE_TYPES.PACK_6,
      PURCHASE_TYPES.PACK_10,
      PURCHASE_TYPES.BONO_ILIMITADO,
      ...Object.keys(CONSULTATION_CATALOG),
      ...Object.keys(WORKSHOP_CATALOG),
    ])
    if (!allowedPurchaseTypes.has(lookupKey)) {
      throw new HttpError(400, 'Producto no permitido.')
    }
    const membershipMonth = lookupKey === PURCHASE_TYPES.BONO_ILIMITADO
      ? validateMembershipMonth(body.membership_month)
      : null

    const requestedUserId = String(body.user_id || '').trim()
    const isGuest = requestedUserId === 'guest'
    const isConsultationSingle = isSingleConsultation(lookupKey)
    const isWorkshop = isWorkshopPurchase(lookupKey)

    if (isGuest && lookupKey !== PURCHASE_TYPES.CLASE_SUELTA && !isConsultationSingle && !isWorkshop) {
      throw new HttpError(400, 'Los invitados solo pueden adquirir una clase suelta, consulta individual o taller.')
    }
    const requestedAttemptId = String(body.checkout_attempt_id || '').trim()
    if (requestedAttemptId && !isUuid(requestedAttemptId)) {
      throw new HttpError(400, 'El identificador del intento de pago no es válido.')
    }
    const checkoutAttemptId = requestedAttemptId || crypto.randomUUID()

    const stripe = createStripeClient(config)
    const supabase = createAdminClient(config)

    const user = isGuest ? null : await getAuthenticatedUser(req, supabase, true)
    if (!isGuest && requestedUserId !== user?.id) {
      throw new HttpError(403, 'El usuario de la compra no coincide con la sesión autenticada.')
    }

    let stripeCustomerId: string | null = null
    if (user) {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('stripe_customer_id, account_deletion_pending')
        .eq('id', user.id)
        .single()

      if (error || !profile) throw new Error('No se pudo cargar el perfil del comprador.')
      if (profile.account_deletion_pending) {
        throw new HttpError(409, 'La cuenta se está eliminando y no puede iniciar nuevos pagos.')
      }

      if (membershipMonth) {
        const { data: existingMonth, error: existingMonthError } = await supabase
          .from('unlimited_membership_periods')
          .select('id')
          .eq('user_id', user.id)
          .eq('membership_month', `${membershipMonth}-01`)
          .maybeSingle()
        if (existingMonthError) throw new Error('No se pudo comprobar el mes ilimitado elegido.')
        if (existingMonth) {
          throw new HttpError(409, 'Ya tienes comprado el Bono Ilimitado para ese mes natural.')
        }
      }
      if (profile.stripe_customer_id && !String(profile.stripe_customer_id).startsWith('cus_')) {
        throw new Error('El identificador Stripe del perfil no es válido.')
      }
      stripeCustomerId = profile.stripe_customer_id || null
    }

    const catalog = await getValidatedCatalog(stripe, config)
    const purchaseType = lookupKey
    const priceByPurchaseType: Record<string, Stripe.Price> = {
      [PURCHASE_TYPES.CLASE_SUELTA]: catalog.claseSuelta,
      [PURCHASE_TYPES.PACK_4]: catalog.pack4,
      [PURCHASE_TYPES.PACK_6]: catalog.pack6,
      [PURCHASE_TYPES.PACK_10]: catalog.pack10,
      [PURCHASE_TYPES.BONO_ILIMITADO]: catalog.bonoIlimitado,
    }
    const price = priceByPurchaseType[purchaseType]
    const isSubscription = purchaseType === PURCHASE_TYPES.BONO_MENSUAL
    const appUserId = isGuest ? 'guest' : user!.id
    const source = body.from === 'profile' ? 'profile' : 'tarifas'
    const metadata: Stripe.MetadataParam = {
      app: 'gen_yoga',
      environment: 'production',
      app_version: APP_RELEASE,
      purchase_type: purchaseType,
      app_user_id: appUserId,
      source,
      checkout_attempt_id: checkoutAttemptId,
    }
    if (membershipMonth) metadata.membership_month = membershipMonth

    const returnBaseUrl = resolveReturnBaseUrl(req, config)

    let lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = []

    if (price) {
      lineItems = [{ price: price.id, quantity: 1 }]
    } else if (getConsultationDetails(purchaseType)) {
      const details = getConsultationDetails(purchaseType)!
      const consultationPrice = await resolveConsultationPrice(stripe, purchaseType)

      if (consultationPrice) {
        lineItems = [{ price: consultationPrice.id, quantity: 1 }]
      } else {
        if (details.productId) {
          throw new Error(`No se pudo resolver el Price del producto ${details.productId}.`)
        }
        lineItems = [
          {
            price_data: {
              currency: 'eur',
              unit_amount: details.amount,
              product_data: {
                name: details.name,
                metadata: { lookup_key: lookupKey },
              },
            },
            quantity: 1,
          },
        ]
      }
    } else if (getWorkshopDetails(purchaseType)) {
      const workshopPrice = await resolveWorkshopPrice(stripe, purchaseType)
      if (!workshopPrice) {
        throw new Error(`No se pudo resolver el precio del taller ${purchaseType}.`)
      }
      lineItems = [{ price: workshopPrice.id, quantity: 1 }]
    } else {
      throw new HttpError(400, 'Precio no configurado para el producto seleccionado.')
    }

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      line_items: lineItems,
      mode: isSubscription ? 'subscription' : 'payment',
      client_reference_id: appUserId,
      success_url: `${returnBaseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}${isGuest ? '&guest=true' : ''}&from=${source}`,
      cancel_url: `${returnBaseUrl}/cancel.html?from=${source}`,
      metadata,
    }

    if (stripeCustomerId) {
      sessionParams.customer = stripeCustomerId
    } else if (user?.email) {
      sessionParams.customer_email = user.email
    }

    if (isGuest || isConsultationSingle || isWorkshop) {
      sessionParams.phone_number_collection = { enabled: true }
    }

    if (!isSubscription) {
      if (!stripeCustomerId) sessionParams.customer_creation = 'always'
      sessionParams.payment_intent_data = { metadata }
    } else {
      sessionParams.subscription_data = { metadata }
    }

    // Retries of the same UI action reuse one Checkout Session. A later purchase
    // gets a fresh attempt id, so legitimate purchases never collide by time.
    const idempotencyKey = [
      'genyoga',
      'production',
      'checkout',
      purchaseType,
      appUserId,
      membershipMonth || 'no_month',
      checkoutAttemptId,
    ].join(':')
    const session = await stripe.checkout.sessions.create(sessionParams, { idempotencyKey })
    if (!session.livemode) {
      throw new Error('Stripe no devolvió una sesión LIVE válida.')
    }

    if (user) {
      const { data: deletionState, error: deletionStateError } = await supabase
        .from('profiles')
        .select('account_deletion_pending')
        .eq('id', user.id)
        .maybeSingle()
      if (deletionStateError || !deletionState || deletionState.account_deletion_pending) {
        await expireCreatedCheckoutSession(stripe, session.id)
        if (deletionStateError) throw new Error('No se pudo volver a comprobar el estado de la cuenta.')
        throw new HttpError(409, 'La cuenta se está eliminando y la sesión de pago se ha cerrado.')
      }
    }

    if (!session.url) throw new Error('Stripe no devolvió una URL de Checkout válida.')

    return jsonResponse({ url: session.url }, 200, headers)
  } catch (error) {
    return safeErrorResponse(error, headers)
  }
})

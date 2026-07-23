import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "https://esm.sh/stripe@14.22.0?target=deno"
import {
  PURCHASE_TYPES,
  HttpError,
  assertAllowedOrigin,
  assertPaymentOrigin,
  corsHeaders,
  createAdminClient,
  createStripeClient,
  getAuthenticatedUser,
  getValidatedCatalog,
  handleOptions,
  isUuid,
  jsonResponse,
  readCorsConfig,
  readProductionConfig,
  requirePost,
  resolveReturnBaseUrl,
  safeErrorResponse,
} from "../_shared/stripe-production.ts"

const APP_RELEASE = '6.6'

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
    if (lookupKey !== PURCHASE_TYPES.CLASE_SUELTA && lookupKey !== PURCHASE_TYPES.BONO_MENSUAL) {
      throw new HttpError(400, 'Producto no permitido.')
    }

    const requestedUserId = String(body.user_id || '').trim()
    const isGuest = requestedUserId === 'guest'
    if (isGuest && lookupKey !== PURCHASE_TYPES.CLASE_SUELTA) {
      throw new HttpError(400, 'Los invitados solo pueden adquirir una clase suelta.')
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
        .select('bono_mensual_activo, bono_mensual_fin, stripe_subscription_status, stripe_customer_id, account_deletion_pending')
        .eq('id', user.id)
        .single()

      if (error || !profile) throw new Error('No se pudo cargar el perfil del comprador.')
      if (profile.account_deletion_pending) {
        throw new HttpError(409, 'La cuenta se está eliminando y no puede iniciar nuevos pagos.')
      }

      const manualMonthlyEnd = profile.bono_mensual_fin
        ? Date.parse(String(profile.bono_mensual_fin))
        : Number.NaN
      const hasCurrentManualMonthly = Boolean(profile.bono_mensual_activo) && (
        !profile.bono_mensual_fin ||
        Number.isNaN(manualMonthlyEnd) ||
        manualMonthlyEnd > Date.now()
      )

      if (
        lookupKey === PURCHASE_TYPES.BONO_MENSUAL &&
        (hasCurrentManualMonthly || ['active', 'trialing', 'past_due'].includes(profile.stripe_subscription_status || ''))
      ) {
        throw new HttpError(409, 'Ya tienes un Bono Mensual vinculado a tu cuenta.')
      }
      if (profile.stripe_customer_id && !String(profile.stripe_customer_id).startsWith('cus_')) {
        throw new Error('El identificador Stripe del perfil no es válido.')
      }
      stripeCustomerId = profile.stripe_customer_id || null
    }

    const catalog = await getValidatedCatalog(stripe, config)
    const purchaseType = lookupKey
    const price = purchaseType === PURCHASE_TYPES.CLASE_SUELTA
      ? catalog.claseSuelta
      : catalog.bonoMensual
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

    const returnBaseUrl = resolveReturnBaseUrl(req, config)
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      line_items: [{ price: price.id, quantity: 1 }],
      mode: purchaseType === PURCHASE_TYPES.BONO_MENSUAL ? 'subscription' : 'payment',
      client_reference_id: appUserId,
      success_url: `${returnBaseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}${isGuest ? '&guest=true' : ''}&from=${source}`,
      cancel_url: `${returnBaseUrl}/cancel.html?from=${source}`,
      payment_method_types: ['card'],
      metadata,
    }

    if (stripeCustomerId) {
      sessionParams.customer = stripeCustomerId
    } else if (user?.email) {
      sessionParams.customer_email = user.email
    }

    if (purchaseType === PURCHASE_TYPES.CLASE_SUELTA) {
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

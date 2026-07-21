import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
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
  jsonResponse,
  readCorsConfig,
  readProductionConfig,
  requirePost,
  safeErrorResponse,
  stripeObjectId,
  validateCheckoutPurchase,
} from "../_shared/stripe-production.ts"

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
    const sessionId = String(body.session_id || '').trim()
    if (!sessionId.startsWith('cs_live_')) throw new HttpError(400, 'La sesión LIVE no es válida.')

    const stripe = createStripeClient(config)
    const supabase = createAdminClient(config)
    const catalog = await getValidatedCatalog(stripe, config)

    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['line_items'] })
    const purchase = validateCheckoutPurchase(session, catalog)
    const isGuest = purchase.appUserId === 'guest'

    if (isGuest) {
      if (purchase.purchaseType !== PURCHASE_TYPES.CLASE_SUELTA) {
        throw new HttpError(403, 'La compra de invitado no es válida.')
      }
    } else {
      const user = await getAuthenticatedUser(req, supabase, true)
      if (user?.id !== purchase.appUserId) {
        throw new HttpError(403, 'La sesión de pago pertenece a otro usuario.')
      }

      // A paid one-off class must be credited before success.html redirects to
      // the promised automatic booking. This is idempotent with the webhook and
      // also recovers safely if delivery of that webhook is delayed.
      if (purchase.purchaseType === PURCHASE_TYPES.CLASE_SUELTA) {
        const { error: fulfillError } = await supabase.rpc('stripe_fulfill_checkout', {
          p_event_id: `checkout_return:${session.id}`,
          p_event_type: 'checkout.session.completed',
          p_event_created: session.created,
          p_checkout_session_id: session.id,
          p_user_id: purchase.appUserId,
          p_is_guest: false,
          p_purchase_type: purchase.purchaseType,
          p_price_id: purchase.price.id,
          p_payment_intent_id: stripeObjectId(session.payment_intent),
          p_subscription_id: null,
          p_customer_id: stripeObjectId(session.customer),
          p_amount_total: session.amount_total,
          p_currency: session.currency,
          p_payment_status: session.payment_status,
          p_period_start: null,
          p_period_end: null,
          p_subscription_status: null,
          p_cancel_at_period_end: false,
          p_livemode: session.livemode,
        })
        if (fulfillError) {
          throw new Error(`No se pudo consolidar la compra verificada: ${fulfillError.message}`)
        }
      }
    }

    let alreadyRedeemed = false
    if (isGuest) {
      const { data, error } = await supabase
        .from('stripe_purchases')
        .select('guest_redeemed_at')
        .eq('checkout_session_id', session.id)
        .maybeSingle()
      if (error) throw new Error('No se pudo comprobar el canje de invitado.')
      alreadyRedeemed = !!data?.guest_redeemed_at
    }

    const rawName = isGuest ? (session.customer_details?.name || '').trim() : ''
    const nameParts = rawName.split(/\s+/).filter(Boolean)

    return jsonResponse({
      isGuest,
      purchaseType: purchase.purchaseType,
      email: isGuest ? (session.customer_details?.email || '') : '',
      nombre: isGuest ? (nameParts[0] || '') : '',
      apellidos: isGuest ? nameParts.slice(1).join(' ') : '',
      alreadyRedeemed,
      paymentStatus: 'paid',
    }, 200, headers)
  } catch (error) {
    return safeErrorResponse(error, headers)
  }
})

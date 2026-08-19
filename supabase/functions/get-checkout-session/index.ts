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
  isSingleConsultation,
  isWorkshopPurchase,
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
    const supportsGuestConsultationUi = body.supports_guest_consultation_ui === true
    if (!sessionId.startsWith('cs_live_')) throw new HttpError(400, 'La sesión LIVE no es válida.')

    const stripe = createStripeClient(config)
    const supabase = createAdminClient(config)
    const catalog = await getValidatedCatalog(stripe, config)

    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['line_items'] })
    const purchase = validateCheckoutPurchase(session, catalog)
    const isGuest = purchase.appUserId === 'guest'
    const isGuestConsultation = isGuest && isSingleConsultation(purchase.purchaseType)
    const isGuestWorkshop = isGuest && isWorkshopPurchase(purchase.purchaseType)

    if (isGuest) {
      if (
        purchase.purchaseType !== PURCHASE_TYPES.CLASE_SUELTA &&
        !isGuestConsultation &&
        !isGuestWorkshop
      ) {
        throw new HttpError(403, 'La compra de invitado no es válida.')
      }
    } else {
      const user = await getAuthenticatedUser(req, supabase, true)
      if (user?.id !== purchase.appUserId) {
        throw new HttpError(403, 'La sesión de pago pertenece a otro usuario.')
      }
    }

    // Every authenticated one-off purchase and every guest consultation or
    // workshop must be recorded before success.html renders. The Checkout Session
    // remains the idempotency boundary shared with the webhook. Guest regular
    // yoga classes keep their existing redemption flow and are fulfilled on class pick.
    const shouldFulfillOnReturn = purchase.purchaseType !== PURCHASE_TYPES.BONO_MENSUAL &&
      (!isGuest || isGuestConsultation || isGuestWorkshop)
    if (shouldFulfillOnReturn) {
      const { error: fulfillError } = await supabase.rpc('stripe_fulfill_checkout', {
        p_event_id: `checkout_return:${session.id}`,
        p_event_type: 'checkout.session.completed',
        p_event_created: session.created,
        p_checkout_session_id: session.id,
        p_user_id: isGuest ? null : purchase.appUserId,
        p_is_guest: isGuest,
        p_purchase_type: purchase.purchaseType,
        p_price_id: purchase.price.id,
        p_payment_intent_id: stripeObjectId(session.payment_intent),
        p_subscription_id: null,
        p_customer_id: stripeObjectId(session.customer),
        p_amount_total: session.amount_total,
        p_currency: session.currency,
        p_payment_status: session.payment_status,
        p_membership_month: purchase.membershipMonth,
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

    let alreadyRedeemed = false
    if (isGuest && purchase.purchaseType === PURCHASE_TYPES.CLASE_SUELTA) {
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
    // The production v6.17 success page treats every `isGuest` purchase as a
    // yoga class. Keep that page on its generic success state until the v6.18+
    // consultation UI declares support explicitly.
    const uiIsGuest = isGuest && (!isGuestConsultation && !isGuestWorkshop || supportsGuestConsultationUi)

    return jsonResponse({
      isGuest: uiIsGuest,
      purchaseIsGuest: isGuest,
      isGuestConsultation,
      isGuestWorkshop,
      purchaseType: purchase.purchaseType,
      membershipMonth: purchase.membershipMonth,
      email: isGuest ? (session.customer_details?.email || '') : '',
      phone: isGuest ? (session.customer_details?.phone || '') : '',
      nombre: isGuest ? (nameParts[0] || '') : '',
      apellidos: isGuest ? nameParts.slice(1).join(' ') : '',
      alreadyRedeemed,
      paymentStatus: 'paid',
    }, 200, headers)
  } catch (error) {
    return safeErrorResponse(error, headers)
  }
})

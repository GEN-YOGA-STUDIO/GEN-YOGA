import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "https://esm.sh/stripe@14.22.0?target=deno"
import {
  PURCHASE_TYPES,
  HttpError,
  bookPaidTallerClass,
  createAdminClient,
  createStripeClient,
  getValidatedCatalog,
  jsonResponse,
  metadataClaseId,
  readProductionConfig,
  stripeObjectId,
  subscriptionIsEntitled,
  unixSecondsToIso,
  validateCheckoutPurchase,
  validateMonthlySubscription,
  type ValidatedCatalog,
} from "../_shared/stripe-production.ts"

type InvoiceWithBasilParent = Stripe.Invoice & {
  parent?: {
    subscription_details?: {
      subscription?: string | Stripe.Subscription | null
    } | null
  } | null
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Método no permitido.' }, 405)
  }

  try {
    const config = readProductionConfig({ requireWebhookSecret: true })
    const signature = req.headers.get('stripe-signature')
    if (!signature) throw new HttpError(400, 'Falta la firma de Stripe.')

    const stripe = createStripeClient(config)
    const supabase = createAdminClient(config)

    // M10: la firma se verifica ANTES de gastar cuota de la API de Stripe.
    let event: Stripe.Event
    try {
      event = await stripe.webhooks.constructEventAsync(
        await req.text(),
        signature,
        config.webhookSecret!,
      )
    } catch (error) {
      console.warn('Firma Stripe rechazada:', error instanceof Error ? error.message : 'firma inválida')
      throw new HttpError(400, 'Firma de Stripe no válida.')
    }

    if (!event.livemode) throw new HttpError(400, 'Solo se aceptan eventos LIVE.')

    const catalog = await getValidatedCatalog(stripe, config)

    if (event.type === 'checkout.session.completed') {
      const eventSession = event.data.object as Stripe.Checkout.Session
      const session = await stripe.checkout.sessions.retrieve(eventSession.id, {
        expand: ['line_items'],
      })
      const purchase = validateCheckoutPurchase(session, catalog)

      let subscription: Stripe.Subscription | null = null
      if (purchase.purchaseType === PURCHASE_TYPES.BONO_MENSUAL) {
        const subscriptionId = stripeObjectId(session.subscription)
        if (!subscriptionId) throw new HttpError(400, 'La sesión mensual no contiene suscripción.')
        subscription = await stripe.subscriptions.retrieve(subscriptionId)
        const validatedSubscription = validateMonthlySubscription(subscription, catalog)
        if (validatedSubscription.appUserId !== purchase.appUserId) {
          throw new HttpError(400, 'La suscripción no pertenece al comprador.')
        }
      }

      const { error } = await supabase.rpc('stripe_fulfill_checkout', {
        p_event_id: event.id,
        p_event_type: event.type,
        p_event_created: event.created,
        p_checkout_session_id: session.id,
        p_user_id: purchase.appUserId === 'guest' ? null : purchase.appUserId,
        p_is_guest: purchase.appUserId === 'guest',
        p_purchase_type: purchase.purchaseType,
        p_price_id: purchase.price.id,
        p_payment_intent_id: stripeObjectId(session.payment_intent),
        p_subscription_id: stripeObjectId(session.subscription),
        p_customer_id: stripeObjectId(session.customer),
        p_amount_total: session.amount_total,
        p_currency: session.currency,
        p_payment_status: session.payment_status,
        p_membership_month: purchase.membershipMonth,
        p_period_start: subscription ? unixSecondsToIso(subscription.current_period_start) : null,
        p_period_end: subscription ? unixSecondsToIso(subscription.current_period_end) : null,
        p_subscription_status: subscription?.status || null,
        p_cancel_at_period_end: subscription?.cancel_at_period_end || false,
        p_livemode: true,
      })
      if (error) throw new Error(`Fallo de fulfillment transaccional: ${error.message}`)

      // BUG-1: si el taller trae clase, reservar la plaza en el servidor
      // (el cliente puede no volver en el mismo navegador). Nunca falla el pago.
      try {
        const booked = await bookPaidTallerClass(supabase, {
          userId: purchase.appUserId === 'guest' ? null : purchase.appUserId,
          purchaseType: purchase.purchaseType,
          paymentStatus: session.payment_status,
          claseId: metadataClaseId(session.metadata),
        })
        if (booked !== 'skipped') console.log('bookPaidTallerClass:', booked, session.id)
      } catch (_) { /* la entrega ya está consolidada; la plaza se revisa a mano */ }
    } else if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
    } else if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
      const invoice = event.data.object as Stripe.Invoice
      if (!invoice.livemode || invoice.currency.toLowerCase() !== 'eur') {
        throw new HttpError(400, 'La factura no es una factura LIVE en EUR.')
      }
      if (event.type === 'invoice.paid' && !invoice.paid) {
        throw new HttpError(400, 'La factura todavía no está pagada.')
      }

      // Basil (2025-03-31) moved this relationship under
      // invoice.parent.subscription_details.subscription. Keep both paths because
      // webhook payloads may use a newer shape than our pinned API retrievals.
      const modernInvoice = invoice as InvoiceWithBasilParent
      const subscriptionId = stripeObjectId(invoice.subscription) || stripeObjectId(
        modernInvoice.parent?.subscription_details?.subscription,
      )
      if (!subscriptionId) throw new HttpError(400, 'La factura no está vinculada a una suscripción.')
      const subscription = await stripe.subscriptions.retrieve(subscriptionId)
      await syncSubscriptionEvent(
        supabase,
        event,
        subscription,
        catalog,
        event.type === 'invoice.paid' && subscriptionIsEntitled(subscription.status),
      )
    } else if (
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      const eventSubscription = event.data.object as Stripe.Subscription
      // Always retrieve through the client pinned to 2023-10-16. This normalises
      // period fields even when the incoming webhook uses a newer Stripe shape.
      const subscription = await stripe.subscriptions.retrieve(eventSubscription.id)
      await syncSubscriptionEvent(
        supabase,
        event,
        subscription,
        catalog,
        event.type !== 'customer.subscription.deleted' && subscriptionIsEntitled(subscription.status),
      )
    } else if (event.type === 'charge.refunded') {
      // S1: un reembolso en Stripe anula automáticamente los créditos que
      // entregó esa compra (antes se quedaban vivos para siempre).
      await applyChargeRefund(supabase, event)
    } else if (
      event.type === 'charge.dispute.created' ||
      event.type === 'charge.dispute.closed' ||
      event.type === 'charge.dispute.funds_withdrawn'
    ) {
      // Disputas: solo se registran (decide una persona; ver S1).
      const dispute = event.data.object as Stripe.Dispute
      console.warn('Disputa Stripe:', event.type, dispute.id, dispute.amount, dispute.currency)
      await supabase.from('stripe_webhook_events').insert({
        event_id: event.id,
        event_type: event.type,
        livemode: true,
        checkout_session_id: null,
        object_id: dispute.id,
      })
    }

    return jsonResponse({ received: true }, 200)
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse({ error: error.message }, error.status)
    }
    console.error('Error procesando webhook Stripe:', error)
    return jsonResponse({ error: 'No se pudo procesar el evento Stripe.' }, 500)
  }
})

async function applyChargeRefund(
  supabase: ReturnType<typeof createAdminClient>,
  event: Stripe.Event,
): Promise<void> {
  const charge = event.data.object as Stripe.Charge
  const pi = stripeObjectId(charge.payment_intent)
  const refundId =
    (charge as unknown as { refunds?: { data?: Array<{ id?: string }> } }).refunds?.data?.[0]?.id || charge.id
  const refunded = charge.amount_refunded || 0

  const { data: purchases } = await supabase
    .from('stripe_purchases')
    .select('checkout_session_id,amount_total,user_id,payment_status')
    .eq('payment_intent_id', pi || 'pi_none_')
    .eq('payment_status', 'paid')
  for (const p of purchases || []) {
    await supabase
      .from('stripe_purchases')
      .update({ refunded_at: new Date().toISOString(), refund_id: refundId })
      .eq('checkout_session_id', p.checkout_session_id)
    // Reembolso total: anular solo lo que aportaron sus packs (sin tocar
    // bonos manuales: se resta, no se recalcula).
    if ((p.amount_total || 0) > 0 && refunded >= (p.amount_total || 0)) {
      const { data: packs } = await supabase
        .from('class_credit_packs')
        .select('id,credits_remaining,user_id')
        .eq('checkout_session_id', p.checkout_session_id)
      let voided = 0
      for (const pack of packs || []) {
        voided += Number(pack.credits_remaining) || 0
      }
      if (voided > 0) {
        await supabase
          .from('class_credit_packs')
          .update({ credits_remaining: 0 })
          .eq('checkout_session_id', p.checkout_session_id)
      }
      if (voided > 0 && p.user_id) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('bonos')
          .eq('id', p.user_id)
          .maybeSingle()
        if (prof) {
          await supabase
            .from('profiles')
            .update({ bonos: Math.max(0, (Number(prof.bonos) || 0) - voided) })
            .eq('id', p.user_id)
        }
      }
    } else {
      console.warn('Reembolso parcial, revisión humana:', refundId, refunded, p.checkout_session_id)
    }
    await supabase.from('stripe_webhook_events').insert({
      event_id: `${event.id}:${p.checkout_session_id}`,
      event_type: event.type,
      livemode: true,
      checkout_session_id: p.checkout_session_id,
      object_id: charge.id,
    })
  }
  if (!purchases || purchases.length === 0) {
    console.warn('Reembolso sin compra registrada:', refundId, pi)
    await supabase.from('stripe_webhook_events').insert({
      event_id: event.id,
      event_type: event.type,
      livemode: true,
      checkout_session_id: null,
      object_id: charge.id,
    })
  }
}

async function syncSubscriptionEvent(
  supabase: ReturnType<typeof createAdminClient>,
  event: Stripe.Event,
  subscription: Stripe.Subscription,
  catalog: ValidatedCatalog,
  entitled: boolean,
): Promise<void> {
  const validated = validateMonthlySubscription(subscription, catalog)
  const customerId = stripeObjectId(subscription.customer)
  if (!customerId) throw new HttpError(400, 'La suscripción no contiene cliente.')

  const { error } = await supabase.rpc('stripe_sync_subscription', {
    p_event_id: event.id,
    p_event_type: event.type,
    p_event_created: event.created,
    p_user_id: validated.appUserId,
    p_subscription_id: subscription.id,
    p_customer_id: customerId,
    p_price_id: validated.priceId,
    p_status: subscription.status,
    p_period_start: unixSecondsToIso(subscription.current_period_start),
    p_period_end: unixSecondsToIso(subscription.current_period_end),
    p_cancel_at_period_end: subscription.cancel_at_period_end,
    p_entitled: entitled,
    p_livemode: true,
  })
  if (error) throw new Error(`Fallo al sincronizar suscripción: ${error.message}`)
}

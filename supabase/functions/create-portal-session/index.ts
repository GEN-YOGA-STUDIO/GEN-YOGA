import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import {
  HttpError,
  assertAllowedOrigin,
  assertPaymentOrigin,
  corsHeaders,
  createAdminClient,
  createStripeClient,
  getAuthenticatedUser,
  handleOptions,
  jsonResponse,
  readCorsConfig,
  readProductionConfig,
  requirePost,
  resolveReturnBaseUrl,
  safeErrorResponse,
  stripeObjectId,
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
    const config = readProductionConfig({ requirePortalConfiguration: true })
    assertPaymentOrigin(req, config)

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      throw new HttpError(400, 'El cuerpo de la solicitud no es válido.')
    }
    const sessionId = String(body.session_id || '').trim()
    if (sessionId && !sessionId.startsWith('cs_live_')) {
      throw new HttpError(400, 'La sesión LIVE no es válida.')
    }

    const stripe = createStripeClient(config)
    const supabase = createAdminClient(config)
    const user = await getAuthenticatedUser(req, supabase, true)

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user!.id)
      .single()

    if (profileError || !profile) {
      throw new Error('No se pudo cargar el perfil de facturación.')
    }

    let customerId = stripeObjectId(profile.stripe_customer_id)
    if (customerId && !/^cus_[A-Za-z0-9]+$/.test(customerId)) {
      throw new Error('El cliente Stripe guardado en el perfil no es válido.')
    }

    // Compatibilidad con enlaces antiguos de success.html: solo se acepta como
    // recuperación cuando el perfil todavía no tiene un Customer persistido.
    if (!customerId && sessionId) {
      const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId)
      const metadata = checkoutSession.metadata || {}
      if (
        !checkoutSession.livemode ||
        checkoutSession.client_reference_id !== user!.id ||
        metadata.app !== 'gen_yoga' ||
        metadata.environment !== 'production' ||
        metadata.app_user_id !== user!.id
      ) {
        throw new HttpError(403, 'La sesión de pago pertenece a otro usuario.')
      }

      customerId = stripeObjectId(checkoutSession.customer)
      if (!customerId || !/^cus_[A-Za-z0-9]+$/.test(customerId)) {
        throw new HttpError(400, 'La compra no tiene un cliente Stripe asociado.')
      }

      const { error: persistError } = await supabase
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user!.id)
        .is('stripe_customer_id', null)

      if (persistError) throw new Error('No se pudo guardar el cliente de facturación.')
    }

    if (!customerId) {
      throw new HttpError(409, 'Tu perfil todavía no tiene una cuenta de facturación de Stripe.')
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      configuration: config.portalConfigurationId!,
      return_url: `${resolveReturnBaseUrl(req, config)}/profile.html`,
    })
    if (!portalSession.livemode || !portalSession.url) {
      throw new Error('Stripe no devolvió un portal LIVE válido.')
    }

    return jsonResponse({ url: portalSession.url }, 200, headers)
  } catch (error) {
    return safeErrorResponse(error, headers)
  }
})

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import {
  PURCHASE_TYPES,
  HttpError,
  assertAllowedOrigin,
  assertPaymentOrigin,
  corsHeaders,
  createAdminClient,
  createStripeClient,
  getValidatedCatalog,
  handleOptions,
  jsonResponse,
  readCorsConfig,
  readProductionConfig,
  requirePost,
  safeErrorResponse,
  sha256Hex,
  stripeObjectId,
  validateCheckoutPurchase,
} from "../_shared/stripe-production.ts"

const PERSON_NAME_PATTERN = /^[\p{L}][\p{L}\p{M}]*(?:[ .'’·-][\p{L}][\p{L}\p{M}]*)*$/u

function normalizePersonName(
  value: unknown,
  fieldLabel: string,
  maxLength: number,
  required: boolean,
): string {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `${fieldLabel} es obligatorio.`)
    return ''
  }
  if (typeof value !== 'string') {
    throw new HttpError(400, `${fieldLabel} no es válido.`)
  }
  if (/[\p{Cc}\p{Cf}<>&]/u.test(value)) {
    throw new HttpError(400, `${fieldLabel} contiene caracteres no permitidos.`)
  }

  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ')
  if (!normalized) {
    if (required) throw new HttpError(400, `${fieldLabel} es obligatorio.`)
    return ''
  }
  if ([...normalized].length > maxLength) {
    throw new HttpError(400, `${fieldLabel} no puede superar ${maxLength} caracteres.`)
  }
  if (!PERSON_NAME_PATTERN.test(normalized)) {
    throw new HttpError(
      400,
      `${fieldLabel} solo puede contener letras, espacios, apóstrofes, puntos y guiones.`,
    )
  }

  return normalized
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

    const sessionId = String(body.session_id || '').trim()
    const classId = Number(body.clase_id)
    if (!sessionId.startsWith('cs_live_')) throw new HttpError(400, 'La sesión LIVE no es válida.')
    if (!Number.isSafeInteger(classId) || classId <= 0) throw new HttpError(400, 'La clase seleccionada no es válida.')

    const stripe = createStripeClient(config)
    const supabase = createAdminClient(config)
    const catalog = await getValidatedCatalog(stripe, config)

    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['line_items'] })
    const purchase = validateCheckoutPurchase(session, catalog)
    if (purchase.appUserId !== 'guest' || purchase.purchaseType !== PURCHASE_TYPES.CLASE_SUELTA) {
      throw new HttpError(403, 'Esta sesión no corresponde a una clase suelta de invitado.')
    }

    const stripeNameParts = String(session.customer_details?.name || '').trim().split(/\s+/u).filter(Boolean)
    const requestedName = body.nombre
    const requestedLastName = body.apellidos
    const rawName = requestedName === undefined || requestedName === null || requestedName === ''
      ? (stripeNameParts.shift() || '')
      : requestedName
    const rawLastName = requestedLastName === undefined || requestedLastName === null || requestedLastName === ''
      ? stripeNameParts.join(' ')
      : requestedLastName
    const nombre = normalizePersonName(rawName, 'El nombre', 80, true)
    const apellidos = normalizePersonName(rawLastName, 'El campo «apellidos»', 120, false)

    const { error: registerError } = await supabase.rpc('stripe_register_guest_checkout', {
      p_checkout_session_id: session.id,
      p_price_id: purchase.price.id,
      p_payment_intent_id: stripeObjectId(session.payment_intent),
      p_customer_id: stripeObjectId(session.customer),
      p_amount_total: session.amount_total,
      p_currency: session.currency,
      p_payment_status: session.payment_status,
      p_livemode: session.livemode,
    })
    if (registerError) throw new Error(`No se pudo registrar la compra verificada: ${registerError.message}`)

    // The client-provided email is deliberately ignored. This deterministic identity
    // makes one paid Checkout Session equivalent to exactly one guest account.
    const sessionHash = await sha256Hex(session.id)
    const guestEmail = `guest_${sessionHash.slice(0, 32)}@genyoga.es`

    let guestUserId: string | null = null
    const { data: existingProfile, error: existingError } = await supabase
      .from('profiles')
      .select('id, rol')
      .eq('email', guestEmail)
      .maybeSingle()
    if (existingError) throw new Error('No se pudo comprobar la identidad temporal.')

    if (existingProfile) {
      if (existingProfile.rol !== 'cliente_temporal') {
        throw new HttpError(409, 'La identidad temporal de esta compra no es válida.')
      }
      guestUserId = existingProfile.id
    } else {
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email: guestEmail,
        email_confirm: true,
        user_metadata: { nombre, apellidos, checkout_session_id: session.id },
      })

      if (authError || !authData.user) {
        // A concurrent retry may have created the deterministic profile first.
        const { data: concurrentProfile } = await supabase
          .from('profiles')
          .select('id, rol')
          .eq('email', guestEmail)
          .maybeSingle()
        if (!concurrentProfile || concurrentProfile.rol !== 'cliente_temporal') {
          throw new Error('No se pudo crear la identidad temporal de la reserva.')
        }
        guestUserId = concurrentProfile.id
      } else {
        guestUserId = authData.user.id
        const { error: profileError } = await supabase.from('profiles').upsert({
          id: guestUserId,
          email: guestEmail,
          nombre,
          apellidos,
          rol: 'cliente_temporal',
          bonos: 0,
        })
        if (profileError) {
          await supabase.auth.admin.deleteUser(guestUserId)
          throw new Error('No se pudo crear el perfil temporal de la reserva.')
        }
      }
    }

    const { data: redemption, error: redemptionError } = await supabase.rpc(
      'stripe_redeem_guest_checkout',
      {
        p_checkout_session_id: session.id,
        p_guest_user_id: guestUserId,
        p_clase_id: classId,
      },
    )

    if (redemptionError) {
      if (/full|capacity|aforo/i.test(redemptionError.message || '')) {
        throw new HttpError(409, 'La clase seleccionada ya está completa.')
      }
      if (/already been redeemed|already.*redeem/i.test(redemptionError.message || '')) {
        throw new HttpError(409, 'Esta compra ya ha sido utilizada para otra reserva.')
      }
      if (/class not found/i.test(redemptionError.message || '')) {
        throw new HttpError(404, 'No se encontró la clase seleccionada.')
      }
      if (/booking deadline|too close|too late/i.test(redemptionError.message || '')) {
        throw new HttpError(409, 'La clase está demasiado próxima y ya no admite reservas.')
      }
      throw new Error(`No se pudo completar el canje: ${redemptionError.message}`)
    }

    return jsonResponse({
      success: true,
      alreadyRedeemed: !!redemption?.already_redeemed,
    }, 200, headers)
  } catch (error) {
    return safeErrorResponse(error, headers)
  }
})

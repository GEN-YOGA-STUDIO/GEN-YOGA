import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import {
  HttpError,
  assertAllowedOrigin,
  corsHeaders,
  createAdminClient,
  createStripeClient,
  getAuthenticatedUser,
  getRequestOrigin,
  handleOptions,
  isUuid,
  jsonResponse,
  readCorsConfig,
  readProductionConfig,
  requirePost,
  stripeObjectId,
} from "../_shared/stripe-production.ts"

const DELETE_CONFIRMATION = 'DELETE_ACCOUNT'
const TERMINATED_SUBSCRIPTION_STATUSES = new Set(['canceled', 'incomplete_expired'])
const MAX_CHECKOUT_SESSION_PAGES = 10
const RECENT_CHECKOUT_WINDOW_SECONDS = 26 * 60 * 60

type DeletionClaim = {
  supabase: ReturnType<typeof createAdminClient>
  userId: string
  requestId: string
}

type CheckoutSessionLike = {
  id: string
  status?: string | null
  client_reference_id?: string | null
  metadata?: Record<string, string> | null
  customer?: string | { id: string } | null
  customer_email?: string | null
  customer_details?: { email?: string | null } | null
}

function assertAccountDeletionOrigin(
  req: Request,
  config: { paymentAllowedOrigins: ReadonlySet<string> },
): void {
  const origin = getRequestOrigin(req)
  if (!origin || !config.paymentAllowedOrigins.has(origin)) {
    throw new HttpError(403, 'La eliminación de cuentas solo está disponible en la web de producción.')
  }
}

type AuthLookupError = {
  code?: string
  message?: string
  status?: number
}

function isAuthUserNotFound(error: unknown): boolean {
  const authError = error as AuthLookupError | null
  return authError?.status === 404 ||
    authError?.code === 'user_not_found' ||
    /user not found/i.test(authError?.message || '')
}

function accountErrorResponse(
  error: unknown,
  headers: Record<string, string>,
): Response {
  if (error instanceof HttpError) {
    return jsonResponse({ error: error.message }, error.status, headers)
  }
  console.error('Error interno al eliminar una cuenta:', error)
  return jsonResponse({ error: 'No se pudo completar la eliminación de la cuenta.' }, 500, headers)
}

function normaliseEmail(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().toLowerCase()
}

function addStripeId(
  values: Set<string>,
  value: unknown,
  pattern: RegExp,
  label: string,
): void {
  if (value === undefined || value === null || value === '') return
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`${label} almacenado no es válido.`)
  }
  values.add(value)
}

function checkoutBelongsToUser(
  session: CheckoutSessionLike,
  targetUserId: string,
  customerIds: ReadonlySet<string>,
  targetEmails: ReadonlySet<string>,
): boolean {
  const explicitUserIds = [session.client_reference_id, session.metadata?.app_user_id]
    .filter((value): value is string => typeof value === 'string' && !!value)
  if (explicitUserIds.length) return explicitUserIds.includes(targetUserId)

  const customerId = stripeObjectId(session.customer)
  if (customerId) return customerIds.has(customerId)

  const sessionEmail = normaliseEmail(
    session.customer_details?.email || session.customer_email,
  )
  return !!sessionEmail && targetEmails.has(sessionEmail)
}

async function visitCheckoutSessions(
  stripe: ReturnType<typeof createStripeClient>,
  status: 'open' | 'complete',
  createdAfter: number | null,
  visitor: (session: CheckoutSessionLike) => Promise<void> | void,
): Promise<void> {
  let startingAfter: string | undefined
  for (let pageIndex = 0; pageIndex < MAX_CHECKOUT_SESSION_PAGES; pageIndex += 1) {
    const page = await stripe.checkout.sessions.list({
      status,
      limit: 100,
      ...(createdAfter ? { created: { gte: createdAfter } } : {}),
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    for (const session of page.data) await visitor(session)
    if (!page.has_more) return
    const lastSession = page.data[page.data.length - 1]
    if (!lastSession) throw new Error('Stripe devolvió una página de Checkout vacía.')
    startingAfter = lastSession.id
  }
  throw new HttpError(409, 'Hay demasiadas sesiones de pago abiertas o recientes. Requiere revisión manual.')
}

async function closeOpenCheckoutsAndAssertNoPendingPayment(
  stripe: ReturnType<typeof createStripeClient>,
  targetUserId: string,
  knownCheckoutSessionIds: ReadonlySet<string>,
  customerIds: ReadonlySet<string>,
  targetEmails: ReadonlySet<string>,
): Promise<void> {
  const assertKnownIfComplete = (session: {
    id: string
    status?: string | null
  }): void => {
    if (session.status === 'complete' && !knownCheckoutSessionIds.has(session.id)) {
      throw new HttpError(
        409,
        'Hay un pago recién completado que todavía se está procesando. Espera unos segundos antes de eliminar la cuenta.',
      )
    }
  }

  await visitCheckoutSessions(stripe, 'open', null, async (session) => {
    if (!checkoutBelongsToUser(session, targetUserId, customerIds, targetEmails)) return
    try {
      await stripe.checkout.sessions.expire(session.id)
    } catch {
      const currentSession = await stripe.checkout.sessions.retrieve(session.id)
      if (currentSession.status === 'expired') return
      assertKnownIfComplete(currentSession)
      if (currentSession.status !== 'complete') {
        throw new Error('No se pudo cerrar una sesión de pago abierta.')
      }
    }
  })

  const recentCutoff = Math.floor(Date.now() / 1000) - RECENT_CHECKOUT_WINDOW_SECONDS
  await visitCheckoutSessions(stripe, 'complete', recentCutoff, (session) => {
    if (checkoutBelongsToUser(session, targetUserId, customerIds, targetEmails)) {
      assertKnownIfComplete(session)
    }
  })
}

async function ensureSubscriptionsAreTerminated(
  stripe: ReturnType<typeof createStripeClient>,
  targetUserId: string,
  targetEmails: readonly string[],
  customerIds: Set<string>,
  subscriptionIds: Set<string>,
  localSubscriptionStatus: unknown,
): Promise<void> {
  const checkedSubscriptions = new Set<string>()

  const inspectSubscription = (subscription: {
    id?: string
    livemode?: boolean
    status?: string
    customer?: string | { id: string } | null
  }): void => {
    if (!subscription.id || !subscription.livemode || !subscription.status) {
      throw new Error('Stripe devolvió una suscripción no válida.')
    }
    checkedSubscriptions.add(subscription.id)
    const customerId = stripeObjectId(subscription.customer)
    if (customerId) addStripeId(customerIds, customerId, /^cus_[A-Za-z0-9]+$/, 'El cliente Stripe')
    if (!TERMINATED_SUBSCRIPTION_STATUSES.has(subscription.status)) {
      throw new HttpError(
        409,
        'La cuenta tiene una suscripción de Stripe sin terminar. Cancélala y espera a que finalice antes de eliminar la cuenta.',
      )
    }
  }

  // The metadata lookup catches a Checkout completed in Stripe even if its
  // webhook has not yet persisted the Customer/Subscription in Supabase.
  const metadataSubscriptions = await stripe.subscriptions.search({
    query: `metadata['app_user_id']:'${targetUserId}'`,
    limit: 100,
  })
  if (metadataSubscriptions.has_more) {
    throw new HttpError(409, 'Hay demasiadas suscripciones asociadas. Requiere revisión manual antes de eliminar.')
  }
  for (const subscription of metadataSubscriptions.data) inspectSubscription(subscription)

  // A Customer can exist before the webhook has updated the local profile.
  // Email lookup closes that gap without trusting browser-provided Stripe ids.
  for (const targetEmail of targetEmails) {
    const emailCustomers = await stripe.customers.list({ email: targetEmail, limit: 100 })
    if (emailCustomers.has_more) {
      throw new HttpError(409, 'Hay demasiados clientes de facturación asociados. Requiere revisión manual.')
    }
    for (const customer of emailCustomers.data) {
      addStripeId(customerIds, customer.id, /^cus_[A-Za-z0-9]+$/, 'El cliente Stripe')
    }
  }

  for (const customerId of customerIds) {
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 100,
    })
    if (subscriptions.has_more) {
      throw new HttpError(409, 'Hay demasiadas suscripciones asociadas. Requiere revisión manual antes de eliminar.')
    }
    for (const subscription of subscriptions.data) inspectSubscription(subscription)
  }

  for (const subscriptionId of subscriptionIds) {
    if (checkedSubscriptions.has(subscriptionId)) continue
    inspectSubscription(await stripe.subscriptions.retrieve(subscriptionId))
  }

  const status = typeof localSubscriptionStatus === 'string'
    ? localSubscriptionStatus.trim().toLowerCase()
    : ''
  if (
    status &&
    !TERMINATED_SUBSCRIPTION_STATUSES.has(status) &&
    checkedSubscriptions.size === 0
  ) {
    throw new HttpError(
      409,
      'La cuenta conserva un estado de suscripción sin identificadores verificables. Requiere revisión manual.',
    )
  }
}

serve(async (req) => {
  let headers: Record<string, string> = {}
  let deletionClaim: DeletionClaim | null = null
  let profileDeleted = false
  try {
    const corsConfig = readCorsConfig()
    headers = corsHeaders(req, corsConfig)
    const preflight = handleOptions(req, corsConfig)
    if (preflight) return preflight

    assertAllowedOrigin(req, corsConfig)
    requirePost(req)
    const config = readProductionConfig()
    // Account deletion is destructive and must never run from certification.
    assertAccountDeletionOrigin(req, config)

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      throw new HttpError(400, 'El cuerpo de la solicitud no es válido.')
    }
    if (body.confirmation !== DELETE_CONFIRMATION) {
      throw new HttpError(400, 'Falta la confirmación explícita de eliminación.')
    }

    const supabase = createAdminClient(config)
    const actor = await getAuthenticatedUser(req, supabase, true)
    const requestedTargetId = typeof body.target_user_id === 'string'
      ? body.target_user_id.trim()
      : ''
    const targetUserId = requestedTargetId || actor!.id
    if (!isUuid(targetUserId)) throw new HttpError(400, 'El usuario seleccionado no es válido.')

    const { data: actorProfile, error: actorProfileError } = await supabase
      .from('profiles')
      .select('rol')
      .eq('id', actor!.id)
      .maybeSingle()
    if (actorProfileError) throw new Error('No se pudo comprobar el rol del solicitante.')

    const deletingSelf = targetUserId === actor!.id
    const actorIsAdmin = String(actorProfile?.rol || '').trim().toLowerCase() === 'admin'
    if (!deletingSelf && !actorIsAdmin) {
      throw new HttpError(403, 'No tienes permiso para eliminar esta cuenta.')
    }

    const { data: targetProfile, error: targetProfileError } = await supabase
      .from('profiles')
      .select('id, email, rol, stripe_customer_id, stripe_subscription_id, stripe_subscription_status')
      .eq('id', targetUserId)
      .maybeSingle()
    if (targetProfileError) throw new Error('No se pudo cargar la cuenta que se va a eliminar.')

    let targetAuthUser = deletingSelf ? actor : null
    if (!deletingSelf) {
      const { data: targetAuthData, error: targetAuthError } = await supabase.auth.admin
        .getUserById(targetUserId)
      if (targetAuthError && !isAuthUserNotFound(targetAuthError)) {
        throw new Error('No se pudo comprobar la identidad de Auth del usuario.')
      }
      targetAuthUser = targetAuthData?.user || null
    }
    if (!targetProfile && !targetAuthUser) throw new HttpError(404, 'La cuenta ya no existe.')

    if (String(targetProfile?.rol || '').trim().toLowerCase() === 'admin') {
      const { count: remainingAdminCount, error: adminCountError } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .ilike('rol', 'admin')
        .neq('id', targetUserId)
      if (adminCountError || remainingAdminCount === null) {
        throw new Error('No se pudo comprobar el número de administradores.')
      }
      if (remainingAdminCount === 0) {
        throw new HttpError(409, 'No se puede eliminar la última cuenta administradora.')
      }
    }

    const confirmationEmails = new Set([
      normaliseEmail(targetAuthUser?.email),
      normaliseEmail(targetProfile?.email),
    ].filter(Boolean))
    const confirmationEmail = normaliseEmail(body.confirmation_email)
    if (!confirmationEmail || !confirmationEmails.has(confirmationEmail)) {
      throw new HttpError(400, 'El correo de confirmación no coincide con la cuenta seleccionada.')
    }

    if (targetProfile) {
      const requestId = crypto.randomUUID()
      const { data: requestedAt, error: claimError } = await supabase.rpc('claim_account_deletion', {
        p_user_id: targetUserId,
        p_request_id: requestId,
      })
      if (claimError) {
        if (/already in progress/i.test(claimError.message || '')) {
          throw new HttpError(409, 'Ya hay una eliminación de esta cuenta en curso.')
        }
        if (/last administrator/i.test(claimError.message || '')) {
          throw new HttpError(409, 'No se puede eliminar la última cuenta administradora.')
        }
        throw new Error(`No se pudo bloquear la cuenta para eliminarla: ${claimError.message}`)
      }
      if (!requestedAt) throw new Error('No se pudo activar el bloqueo de eliminación.')
      deletionClaim = { supabase, userId: targetUserId, requestId }
    }

    const [customerResult, subscriptionResult, purchaseResult] = await Promise.all([
      supabase.from('stripe_customers').select('customer_id').eq('user_id', targetUserId).maybeSingle(),
      supabase.from('stripe_subscriptions').select('subscription_id, customer_id, status').eq('user_id', targetUserId),
      supabase.from('stripe_purchases').select('checkout_session_id, subscription_id, customer_id').eq('user_id', targetUserId),
    ])
    if (customerResult.error) throw new Error('No se pudo comprobar el cliente de facturación.')
    if (subscriptionResult.error) throw new Error('No se pudieron comprobar las suscripciones locales.')
    if (purchaseResult.error) throw new Error('No se pudo comprobar el historial de compras.')

    const customerIds = new Set<string>()
    const subscriptionIds = new Set<string>()
    const knownCheckoutSessionIds = new Set<string>()
    addStripeId(customerIds, targetProfile?.stripe_customer_id, /^cus_[A-Za-z0-9]+$/, 'El cliente Stripe')
    addStripeId(customerIds, customerResult.data?.customer_id, /^cus_[A-Za-z0-9]+$/, 'El cliente Stripe')
    addStripeId(subscriptionIds, targetProfile?.stripe_subscription_id, /^sub_[A-Za-z0-9]+$/, 'La suscripción Stripe')
    for (const row of subscriptionResult.data || []) {
      addStripeId(customerIds, row.customer_id, /^cus_[A-Za-z0-9]+$/, 'El cliente Stripe')
      addStripeId(subscriptionIds, row.subscription_id, /^sub_[A-Za-z0-9]+$/, 'La suscripción Stripe')
    }
    for (const row of purchaseResult.data || []) {
      if (typeof row.checkout_session_id === 'string' && row.checkout_session_id.startsWith('cs_live_')) {
        knownCheckoutSessionIds.add(row.checkout_session_id)
      }
      addStripeId(customerIds, row.customer_id, /^cus_[A-Za-z0-9]+$/, 'El cliente Stripe')
      addStripeId(subscriptionIds, row.subscription_id, /^sub_[A-Za-z0-9]+$/, 'La suscripción Stripe')
    }

    const stripe = createStripeClient(config)
    const stripeLookupEmails = [...new Set([
      targetAuthUser?.email,
      targetProfile?.email,
    ].filter((email): email is string => typeof email === 'string' && !!email.trim()).map((email) => email.trim()))]
    const normalisedStripeLookupEmails = new Set(stripeLookupEmails.map(normaliseEmail))
    await closeOpenCheckoutsAndAssertNoPendingPayment(
      stripe,
      targetUserId,
      knownCheckoutSessionIds,
      customerIds,
      normalisedStripeLookupEmails,
    )
    await ensureSubscriptionsAreTerminated(
      stripe,
      targetUserId,
      stripeLookupEmails,
      customerIds,
      subscriptionIds,
      targetProfile?.stripe_subscription_status,
    )
    // Repeat immediately before destructive database writes. Checkout also
    // rechecks the tombstone after creating a session, closing both race paths.
    await closeOpenCheckoutsAndAssertNoPendingPayment(
      stripe,
      targetUserId,
      knownCheckoutSessionIds,
      customerIds,
      normalisedStripeLookupEmails,
    )

    if (deletionClaim) {
      const { data: ownedClaim, error: claimReadError } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', targetUserId)
        .eq('account_deletion_pending', true)
        .eq('account_deletion_request_id', deletionClaim.requestId)
        .maybeSingle()
      if (claimReadError || !ownedClaim) throw new Error('Se perdió el bloqueo exclusivo de eliminación.')
    }

    if (targetProfile) {
      if (!deletionClaim) throw new Error('Falta el bloqueo exclusivo de eliminación.')
      const { data: finalized, error: finalizeError } = await supabase.rpc(
        'finalize_account_deletion',
        {
          p_user_id: targetUserId,
          p_request_id: deletionClaim.requestId,
        },
      )
      if (finalizeError || finalized !== true) {
        throw new Error(`No se pudo finalizar la eliminación transaccional: ${finalizeError?.message || 'resultado inválido'}`)
      }
      profileDeleted = true
    }

    if (targetAuthUser) {
      const { error: authDeleteError } = await supabase.auth.admin.deleteUser(targetUserId, false)
      if (authDeleteError && !isAuthUserNotFound(authDeleteError)) {
        throw new Error(`No se pudo eliminar la identidad de Auth: ${authDeleteError.message}`)
      }
    }

    return jsonResponse({ success: true, deleted_self: deletingSelf }, 200, headers)
  } catch (error) {
    if (deletionClaim && !profileDeleted) {
      const { error: releaseError } = await deletionClaim.supabase.rpc('release_account_deletion', {
        p_user_id: deletionClaim.userId,
        p_request_id: deletionClaim.requestId,
      })
      if (releaseError) console.error('No se pudo liberar el bloqueo de eliminación:', releaseError)
    }
    return accountErrorResponse(error, headers)
  }
})

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"
import Stripe from "https://esm.sh/stripe@14.22.0?target=deno"

// Conciliación Stripe <-> BD (S6). SOLO LECTURA: no modifica nada.
// verify_jwt = true (puerta) + rol admin comprobado dentro.
// Uso: botón "Conciliar" del dashboard (admin) o schedule futuro.

function cors(req: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': req.headers.get('origin') || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  }
}

serve(async (req: Request) => {
  const headers = cors(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  const deny = (code: number, msg: string) =>
    new Response(JSON.stringify({ ok: false, error: msg }), { status: code, headers: { ...headers, 'Content-Type': 'application/json' } });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') || ''
    if (!supabaseUrl || !serviceKey || !stripeKey) return deny(500, 'Falta configuración del servidor.')
    const admin = createClient(supabaseUrl, serviceKey)
    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' })

    // Solo admin (la puerta verify_jwt ya exige JWT válido).
    const authHeader = req.headers.get('authorization') || ''
    const token = (authHeader.match(/^Bearer\s+(.+)$/i) || [])[1] || ''
    if (!token || token.startsWith('sb_publishable_') || token.startsWith('sb_anon_')) {
      return deny(401, 'Sesión de usuario no válida.')
    }
    const { data: udata, error: uerr } = await admin.auth.getUser(token)
    if (uerr || !udata.user) return deny(401, 'Sesión de usuario no válida.')
    const { data: prof } = await admin.from('profiles').select('rol').eq('id', udata.user.id).maybeSingle()
    if (String(prof?.rol || '').toLowerCase() !== 'admin') return deny(403, 'Solo administración.')

    // Sesiones cobradas en Stripe (paginado).
    const stripePaid = new Map<string, { total: number; type: string | null; created: number }>()
    let startingAfter: string | undefined = undefined
    for (let page = 0; page < 10; page++) {
      const list = await stripe.checkout.sessions.list({ status: 'complete', limit: 100, starting_after: startingAfter })
      for (const s of list.data) {
        if (s.payment_status === 'paid' && s.id.startsWith('cs_live_')) {
          stripePaid.set(s.id, { total: s.amount_total || 0, type: (s.metadata || {}).purchase_type || null, created: s.created })
        }
      }
      if (!list.has_more || !list.data.length) break
      startingAfter = list.data[list.data.length - 1].id
    }

    // Compras registradas en BD.
    const { data: rows } = await admin.from('stripe_purchases')
      .select('checkout_session_id,amount_total,payment_status,purchase_type,refunded_at')
    const dbBySession = new Map((rows || []).map((r) => [r.checkout_session_id, r]))

    const paidNoRow = [...stripePaid.entries()]
      .filter(([id]) => !dbBySession.has(id))
      .map(([id, s]) => ({ session: id, total: s.total, type: s.type, created: s.created }))
    const rowNoStripe = [...dbBySession.entries()]
      .filter(([id]) => id && !stripePaid.has(id))
      .map(([id, r]) => ({ session: id, total: (r as { amount_total: number }).amount_total, type: (r as { purchase_type: string }).purchase_type }))
    const refunded = await stripe.refunds.list({ limit: 20 })
    const refundsUnvoided: Array<Record<string, unknown>> = []
    for (const rf of refunded.data) {
      const pi = typeof rf.payment_intent === 'string' ? rf.payment_intent : rf.payment_intent?.id
      if (!pi) continue
      const { data: purch } = await admin.from('stripe_purchases')
        .select('checkout_session_id,amount_total')
        .eq('payment_intent_id', pi)
        .eq('payment_status', 'paid')
      for (const p of purch || []) {
        if (!p) continue
        const already = (p as { refunded_at?: string }).refunded_at
        if (!already) {
          refundsUnvoided.push({ refund: rf.id, amount: rf.amount, session: (p as { checkout_session_id: string }).checkout_session_id })
        }
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      stripe_paid: stripePaid.size,
      db_rows: dbBySession.size,
      paid_sin_fila: paidNoRow,
      filas_sin_stripe: rowNoStripe,
      reembolsos_sin_anular: refundsUnvoided,
    }), { headers: { ...headers, 'Content-Type': 'application/json' } })
  } catch (e) {
    console.error('reconcile-stripe:', (e as Error).message)
    return new Response(JSON.stringify({ ok: false, error: 'No se pudo conciliar.' }), { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } })
  }
})

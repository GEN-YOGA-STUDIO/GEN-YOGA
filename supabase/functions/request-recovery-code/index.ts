import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"

// Genera y envía por email un código de recuperación de 6 dígitos.
// Responde SIEMPRE {ok:true} exista o no la cuenta (anti-enumeración).
// verify_jwt = false: lo llaman usuarios deslogueados.

function cors(req: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': req.headers.get('origin') || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  }
}

const CODE_TTL_MIN = 15
const MAX_CODES_PER_HOUR = 3

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function isAliasEmail(email: string): boolean {
  const e = email.toLowerCase()
  return e.startsWith('movil.') || e.startsWith('telefono.') || e.endsWith('@genyoga.studio')
}

// Los comodines de LIKE (%, _) en el identificador coincidirían con cualquier
// cuenta: se escapan para que la búsqueda sea literal.
function escapeLike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

serve(async (req: Request) => {
  const headers = cors(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'method' }), { status: 405, headers: { ...headers, 'Content-Type': 'application/json' } })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const rawId = String(body.identifier || '').trim().slice(0, 254)
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const resendKey = (Deno.env.get('RESEND_API_KEY') || '').trim()
    const admin = createClient(supabaseUrl, serviceKey)

    const finish = () => new Response(JSON.stringify({ ok: true }), { headers: { ...headers, 'Content-Type': 'application/json' } })
    if (!rawId) return finish()

    // Localizar cuenta: mismo criterio que el flujo anterior (profiles y auth).
    const clean = rawId.toLowerCase()
    const digits = clean.replace(/\D/g, '')
    let userId: string | null = null
    let deliveryEmail = ''
    if (!clean.includes('@') && digits.length >= 9) {
      const phone9 = digits.slice(-9)
      const { data } = await admin.from('profiles')
        .select('id,email')
        .or(`telefono.ilike.%${phone9},email.in.(movil.${phone9}@genyoga.studio,telefono.${phone9}@genyoga.studio)`)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (data) {
        userId = data.id
        if (data.email && !isAliasEmail(data.email)) deliveryEmail = data.email
      }
    } else if (clean.includes('@')) {
      const { data } = await admin.from('profiles')
        .select('id,email')
        .ilike('email', escapeLike(clean))
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (data) {
        userId = data.id
        if (data.email && !isAliasEmail(data.email)) deliveryEmail = data.email
      }
      if (!userId) {
        const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
        const found = (listed?.users || []).find((u) => (u.email || '').toLowerCase() === clean)
        if (found) {
          userId = found.id
          if (found.email && !isAliasEmail(found.email)) deliveryEmail = found.email
        }
      }
    }
    if (!userId || !deliveryEmail || !resendKey) return finish()

    // Freno: máximo 3 códigos/hora por cuenta.
    const since = new Date(Date.now() - 3600_000).toISOString()
    const { count } = await admin.from('password_reset_codes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId).gte('created_at', since)
    if ((count || 0) >= MAX_CODES_PER_HOUR) return finish()

    const code = String(Math.floor(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296) * 900000))
    const { error: insErr } = await admin.from('password_reset_codes').insert({
      user_id: userId,
      code_hash: await sha256Hex(`gen-rec:${userId}:${code}`),
      expires_at: new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString(),
    })
    if (insErr) {
      console.error('request-recovery-code insert:', insErr.message)
      return finish()
    }

    const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#3c2a21">
      <h2 style="color:#795244">Recupera tu acceso a GEN Yoga</h2>
      <p>Usa este código en la web (caduca en ${CODE_TTL_MIN} minutos):</p>
      <p style="font-size:34px;font-weight:bold;letter-spacing:8px;text-align:center;background:#f3ece1;border-radius:12px;padding:16px">${code}</p>
      <p style="font-size:12px;color:#795244">Si no lo has pedido tú, ignora este correo: tu contraseña sigue intacta.</p></div>`
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'GEN Yoga <hola@genyoga.studio>', to: [deliveryEmail], subject: 'Tu código de recuperación - GEN Yoga', html }),
    })
    if (!res.ok) console.error('request-recovery-code resend:', await res.text().catch(() => '?'))
    return finish()
  } catch (e) {
    console.error('request-recovery-code:', (e as Error).message)
    return new Response(JSON.stringify({ ok: true }), { headers: { ...headers, 'Content-Type': 'application/json' } })
  }
})

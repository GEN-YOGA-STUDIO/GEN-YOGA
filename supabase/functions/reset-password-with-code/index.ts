import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"

// Verifica el código de un solo uso y fija la nueva contraseña.
// Todos los fallos devuelven el MISMO mensaje genérico (anti-enumeración).
// verify_jwt = false: lo llaman usuarios deslogueados.

function cors(req: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': req.headers.get('origin') || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  }
}

const GENERIC_FAIL = 'Código incorrecto o caducado. Pide uno nuevo e inténtalo de nuevo.'
const MAX_ATTEMPTS = 5

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

serve(async (req: Request) => {
  const headers = cors(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  const deny = () => new Response(JSON.stringify({ ok: false, error: GENERIC_FAIL }), { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'method' }), { status: 405, headers: { ...headers, 'Content-Type': 'application/json' } })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const rawId = String(body.identifier || '').trim().slice(0, 254)
    const code = String(body.code || '').trim()
    const pwd = String(body.newPassword || '')
    if (!rawId || !/^\d{6}$/.test(code) || pwd.length < 6 || pwd.length > 72) return deny()

    const admin = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '')
    const clean = rawId.toLowerCase()
    const digits = clean.replace(/\D/g, '')
    let userId: string | null = null
    if (!clean.includes('@') && digits.length >= 9) {
      const phone9 = digits.slice(-9)
      const { data } = await admin.from('profiles')
        .select('id')
        .or(`telefono.ilike.%${phone9},email.in.(movil.${phone9}@genyoga.studio,telefono.${phone9}@genyoga.studio)`)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (data) userId = data.id
    } else if (clean.includes('@')) {
      const { data } = await admin.from('profiles')
        .select('id').ilike('email', clean)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (data) userId = data.id
      if (!userId) {
        const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
        userId = (listed?.users || []).find((u) => (u.email || '').toLowerCase() === clean)?.id || null
      }
    }
    if (!userId) return deny()

    const { data: rows } = await admin.from('password_reset_codes')
      .select('id,code_hash,expires_at,attempts,used_at')
      .eq('user_id', userId).is('used_at', null).gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false }).limit(1)
    const row = (rows || [])[0]
    if (!row) return deny()

    const attempts = (row.attempts || 0) + 1
    await admin.from('password_reset_codes').update({ attempts }).eq('id', row.id)
    if (attempts > MAX_ATTEMPTS) {
      await admin.from('password_reset_codes').update({ used_at: new Date().toISOString() }).eq('id', row.id)
      return deny()
    }
    if (row.code_hash !== (await sha256Hex(`gen-rec:${userId}:${code}`))) return deny()

    await admin.from('password_reset_codes').update({ used_at: new Date().toISOString() }).eq('id', row.id)
    const { error: updErr } = await admin.auth.admin.updateUserById(userId, { password: pwd })
    if (updErr) {
      console.error('reset-password-with-code update:', updErr.message)
      return deny()
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { ...headers, 'Content-Type': 'application/json' } })
  } catch (e) {
    console.error('reset-password-with-code:', (e as Error).message)
    return new Response(JSON.stringify({ ok: false, error: GENERIC_FAIL }), { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } })
  }
})

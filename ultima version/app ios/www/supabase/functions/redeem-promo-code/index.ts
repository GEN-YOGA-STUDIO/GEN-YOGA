import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import {
  HttpError,
  assertAllowedOrigin,
  corsHeaders,
  createAdminClient,
  getAuthenticatedUser,
  handleOptions,
  jsonResponse,
  readCorsConfig,
  readProductionConfig,
  requirePost,
  safeErrorResponse,
} from "../_shared/stripe-production.ts"

function normalizePromoCode(raw: unknown): string {
  if (!raw || typeof raw !== 'string') return ''
  return raw.trim().toUpperCase().replace(/\s+/g, '')
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
    const supabase = createAdminClient(config)

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      throw new HttpError(400, 'El cuerpo de la solicitud no es un JSON válido.')
    }

    const action = String(body.action || 'redeem').trim()

    // 1. Rama de Administración: admin_set_promo_50
    if (action === 'admin_set_promo_50') {
      const caller = await getAuthenticatedUser(req, supabase, true)
      if (!caller?.id) {
        throw new HttpError(401, 'Debes iniciar sesión para realizar esta acción.')
      }

      const { data: callerProfile, error: callerError } = await supabase
        .from('profiles')
        .select('rol')
        .eq('id', caller.id)
        .single()

      if (callerError || (callerProfile?.rol || '').toLowerCase().trim() !== 'admin') {
        throw new HttpError(403, 'Solo los administradores pueden modificar el estado promocional.')
      }

      const targetUserId = String(body.target_user_id || body.p_user_id || body.userId || '').trim()
      if (!targetUserId) {
        throw new HttpError(400, 'Falta el identificador del usuario a modificar.')
      }

      const active = body.active === true || body.p_active === true

      // Intentar primero RPC de base de datos
      try {
        const { error: rpcErr } = await supabase.rpc('admin_set_promo_50', {
          p_user_id: targetUserId,
          p_active: active,
        })
        if (!rpcErr) {
          return jsonResponse({ success: true }, 200, headers)
        }
      } catch (_) {}

      // Fallback con service role
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          descuento_promo_50_activo: active,
          codigo_promo_canjeado: active ? 'GEN YOGA' : undefined,
          codigo_promo_usado: active ? false : undefined,
          codigo_promo_fecha_canje: active ? new Date().toISOString() : undefined,
        })
        .eq('id', targetUserId)

      if (updateError) {
        throw new Error(`Error al actualizar estado promocional: ${updateError.message}`)
      }

      return jsonResponse({ success: true }, 200, headers)
    }

    // 2. Rama de Usuario: Canjear código promocional
    const rawCode = String(body.code || body.p_codigo || body.codigo || '').trim()
    const normalized = normalizePromoCode(rawCode)

    if (normalized !== 'GENYOGA') {
      throw new HttpError(400, 'El código promocional introducido no es válido o ha caducado.')
    }

    const user = await getAuthenticatedUser(req, supabase, true)
    if (!user?.id) {
      throw new HttpError(401, 'Debes iniciar sesión para canjear un código promocional.')
    }

    // Intentar primero mediante RPC
    try {
      const { error: rpcError } = await supabase.rpc('canjear_codigo_promocional', {
        p_codigo: 'GEN YOGA',
      })

      if (!rpcError) {
        return jsonResponse({
          success: true,
          message: '¡Código GEN YOGA aplicado con éxito! Tienes un 50% de descuento en tu primera reserva.',
        }, 200, headers)
      }
    } catch (_) {
      // Continuar al fallback seguro
    }

    // Fallback seguro mediante service role
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, codigo_promo_usado, descuento_promo_50_activo, codigo_promo_canjeado')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      throw new HttpError(404, 'No se pudo encontrar el perfil del usuario.')
    }

    if (profile.codigo_promo_usado) {
      throw new HttpError(400, 'Ya has disfrutado de una promoción de bienvenida anteriormente.')
    }

    if (profile.descuento_promo_50_activo || profile.codigo_promo_canjeado) {
      throw new HttpError(400, 'Ya tienes activo el código promocional GEN YOGA en tu perfil.')
    }

    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        descuento_promo_50_activo: true,
        codigo_promo_canjeado: 'GEN YOGA',
        codigo_promo_fecha_canje: new Date().toISOString(),
      })
      .eq('id', user.id)

    if (updateError) {
      throw new Error(`Error al aplicar el código promocional: ${updateError.message}`)
    }

    return jsonResponse({
      success: true,
      message: '¡Código GEN YOGA aplicado con éxito! Tienes un 50% de descuento en tu primera reserva.',
    }, 200, headers)
  } catch (error) {
    return safeErrorResponse(error, headers)
  }
})

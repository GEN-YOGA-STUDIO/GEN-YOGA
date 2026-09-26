import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import {
  HttpError,
  assertAllowedOrigin,
  corsHeaders,
  handleOptions,
  readCorsConfig,
  requirePost,
  safeErrorResponse,
} from "../_shared/stripe-production.ts"

// La promoción del 50% (código GENYOGA) se retiró en octubre: el endpoint se
// mantiene desplegado para responder 410 a cualquier canje o gestión antigua.
serve(async (req) => {
  let headers: Record<string, string> = {}
  try {
    const corsConfig = readCorsConfig()
    headers = corsHeaders(req, corsConfig)
    const preflight = handleOptions(req, corsConfig)
    if (preflight) return preflight

    assertAllowedOrigin(req, corsConfig)
    requirePost(req)

    throw new HttpError(410, 'La promoción del 50% (código GENYOGA) ha finalizado.')
  } catch (error) {
    return safeErrorResponse(error, headers)
  }
})

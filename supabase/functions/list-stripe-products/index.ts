import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "https://esm.sh/stripe@14.22.0?target=deno"
import {
  corsHeaders,
  createStripeClient,
  handleOptions,
  jsonResponse,
  readCorsConfig,
  readProductionConfig,
  safeErrorResponse,
  assertAllowedOrigin
} from "../_shared/stripe-production.ts"

serve(async (req) => {
  let headers: Record<string, string> = {}
  try {
    const corsConfig = readCorsConfig()
    headers = corsHeaders(req, corsConfig)
    const preflight = handleOptions(req, corsConfig)
    if (preflight) return preflight

    assertAllowedOrigin(req, corsConfig)

    const config = readProductionConfig()
    const stripe = createStripeClient(config)

    // Consultar productos activos en la cuenta de Stripe conectada
    const [productsRes, pricesRes] = await Promise.all([
      stripe.products.list({ active: true, limit: 100 }),
      stripe.prices.list({ active: true, limit: 100 })
    ])

    const pricesByProduct: Record<string, Stripe.Price[]> = {}
    for (const pr of pricesRes.data) {
      const prodId = typeof pr.product === 'string' ? pr.product : pr.product?.id
      if (prodId) {
        if (!pricesByProduct[prodId]) pricesByProduct[prodId] = []
        pricesByProduct[prodId].push(pr)
      }
    }

    const items = productsRes.data.map((prod) => {
      const prodPrices = pricesByProduct[prod.id] || []
      // Priorizar default_price si existe, o el precio activo más reciente
      let mainPrice: Stripe.Price | null = null
      if (prod.default_price) {
        const defId = typeof prod.default_price === 'string' ? prod.default_price : prod.default_price.id
        mainPrice = prodPrices.find(p => p.id === defId) || null
      }
      if (!mainPrice && prodPrices.length > 0) {
        mainPrice = prodPrices[0]
      }

      const amountCents = mainPrice?.unit_amount || 0
      const amountEur = (amountCents / 100).toFixed(2).replace('.', ',')
      const formatted = `${amountEur} €`

      return {
        id: prod.id,
        name: prod.name,
        description: prod.description || '',
        active: prod.active,
        price_id: mainPrice?.id || null,
        unit_amount: amountCents,
        currency: mainPrice?.currency || 'eur',
        formatted_price: formatted,
        recurring: !!mainPrice?.recurring,
        lookup_key: mainPrice?.lookup_key || prod.id,
        metadata: prod.metadata || {}
      }
    })

    // Ordenar alfabéticamente por nombre
    items.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))

    return jsonResponse({
      ok: true,
      count: items.length,
      products: items
    }, 200, headers)
  } catch (error) {
    return safeErrorResponse(error, headers)
  }
})

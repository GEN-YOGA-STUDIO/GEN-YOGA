import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "https://esm.sh/stripe@14.22.0?target=deno"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '*'
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  }
}

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders })
  }

  try {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')?.trim()
    if (!stripeKey) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'STRIPE_SECRET_KEY no está configurada en Supabase.'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient(),
    })

    // Consultar productos y precios activos en tiempo real desde Stripe
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
      let mainPrice: Stripe.Price | null = null
      if (prod.default_price) {
        const defId = typeof prod.default_price === 'string' ? prod.default_price : prod.default_price.id
        mainPrice = prodPrices.find(p => p.id === defId) || null
      }
      if (!mainPrice && prodPrices.length > 0) {
        mainPrice = prodPrices[0]
      }

      const amountCents = mainPrice?.unit_amount || 0
      const formatted = prodPrices.length > 1
        ? `${prodPrices.length} precios`
        : `${(amountCents / 100).toFixed(2).replace('.', ',')} €`

      return {
        id: prod.id,
        name: prod.name,
        description: prod.description || '',
        active: prod.active,
        price_id: mainPrice?.id || null,
        unit_amount: amountCents,
        currency: mainPrice?.currency || 'eur',
        formatted_price: formatted,
        price: {
          id: mainPrice?.id || null,
          unit_amount: amountCents,
          currency: mainPrice?.currency || 'eur',
          formatted: formatted
        },
        prices_count: prodPrices.length,
        recurring: !!mainPrice?.recurring,
        lookup_key: mainPrice?.lookup_key || prod.id,
        metadata: prod.metadata || {}
      }
    })

    // Ordenar alfabéticamente por nombre en español
    items.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))

    // Sincronizar en segundo plano con public.stripe_productos si el cliente Supabase está disponible
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
      if (supabaseUrl && serviceKey && items.length > 0) {
        const supabase = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false }
        })
        await supabase.from('stripe_productos').upsert(
          items.map(it => ({
            id: it.id,
            nombre: it.name,
            descripcion: it.description,
            precio_formateado: it.formatted_price,
            unit_amount: it.unit_amount,
            currency: it.currency,
            price_id: it.price_id,
            categoria: 'General - Services',
            activo: it.active,
            updated_at: new Date().toISOString()
          })),
          { onConflict: 'id' }
        )
      }
    } catch (syncErr) {
      console.warn('Advertencia al sincronizar stripe_productos en Edge Function:', syncErr)
    }

    return new Response(JSON.stringify({
      ok: true,
      count: items.length,
      products: items
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Error en list-stripe-products:', error)
    return new Response(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : 'Error inesperado al listar productos de Stripe.'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

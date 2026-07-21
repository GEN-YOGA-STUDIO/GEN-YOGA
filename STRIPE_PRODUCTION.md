# Stripe en producción

Esta aplicación crea las sesiones de Stripe Checkout desde Supabase Edge
Functions. Las claves secretas nunca deben añadirse al HTML, al repositorio ni a
una aplicación móvil. El frontend no necesita una clave publicable de Stripe.

## 1. Preparar Stripe en modo live

En el Dashboard de Stripe, desactiva el modo de prueba y comprueba que la cuenta
puede aceptar cobros reales. Crea o selecciona estos Prices activos:

- `STRIPE_PRICE_CLASE_SUELTA`: pago único de 15 EUR.
- `STRIPE_PRICE_BONO_MENSUAL`: suscripción recurrente de 90 EUR al mes.

Configura también el Customer Portal en modo live si se va a ofrecer al cliente
la gestión de su suscripción y sus facturas.

## 2. Configurar secretos en Supabase

El proyecto enlazado es `jkjifmrrlyncuwpjhxvk`. En Supabase Dashboard abre
**Edge Functions > Secrets** y configura las ocho variables documentadas en
`supabase/functions/.env.example`:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PORTAL_CONFIGURATION`
- `STRIPE_PRICE_CLASE_SUELTA`
- `STRIPE_PRICE_BONO_MENSUAL`
- `SITE_URL`
- `ALLOWED_ORIGINS`
- `PAYMENT_ALLOWED_ORIGINS`

`SITE_URL` debe ser la base HTTPS pública exacta que contiene `success.html`,
`cancel.html` y `profile.html`, sin barra final. Para el despliegue actual es
`https://genyoga.studio`. No hay que copiar
`SUPABASE_SERVICE_ROLE_KEY`: Supabase la proporciona a las Edge Functions.

`ALLOWED_ORIGINS` es una lista separada por comas con los demás orígenes HTTPS
desde los que se publica el mismo frontend. No debe contener rutas: para GitHub
Pages se autoriza el origen de la cuenta, no `/GEN-YOGA`. En producción usa:

```text
https://www.genyoga.studio,https://jaime312.github.io
```

El origen de `SITE_URL` se permite siempre de forma automática. No uses `*` ni
añadas dominios que no controlas.

`PAYMENT_ALLOWED_ORIGINS` determina desde qué orígenes se pueden crear o consultar pagos LIVE y abrir Customer Portal. En v6.2 debe ser exactamente:

```text
https://genyoga.studio,https://www.genyoga.studio,https://jaime312.github.io
```

La navegación entre páginas de ambos entornos se mantiene 100% separada (sin saltos de dominio), y ambas webs (producción y certificación en GitHub) procesan pagos en el entorno real de Stripe. La función valida que los orígenes pertenezcan a la lista blanca fijada en código.

Como alternativa al Dashboard, crea localmente
`supabase/functions/.env.production.local` a partir del ejemplo y ejecuta:

```powershell
npx supabase@latest login
npx supabase@latest link --project-ref jkjifmrrlyncuwpjhxvk
npx supabase@latest secrets set --env-file supabase/functions/.env.production.local --project-ref jkjifmrrlyncuwpjhxvk
```

El archivo local queda excluido por `.gitignore`. No pases valores secretos como
argumentos de consola, ya que podrían quedar en el historial.

## 3. Ejecutar la migración y desplegar

Después de revisar la migración
`supabase/migrations/202607200001_stripe_production.sql`, aplícala al proyecto
enlazado antes de activar los cobros. La migración crea las tablas privadas de
idempotencia, compras, clientes y suscripciones, junto con las RPC atómicas que
utilizan las Edge Functions; no debe conceder acceso público mediante RLS.

```powershell
npx supabase@latest db push --linked
$stripeFunctions = @(
  'create-checkout-session',
  'get-checkout-session',
  'book-guest-class',
  'create-portal-session',
  'stripe-webhook'
)
foreach ($stripeFunction in $stripeFunctions) {
  npx supabase@latest functions deploy $stripeFunction --project-ref jkjifmrrlyncuwpjhxvk
}
```

`supabase/config.toml` deja sin verificación JWT únicamente las funciones que el
flujo actual necesita invocar como invitado y el webhook externo. Esto no elimina
la obligación de validar dentro de cada función la firma, el pago, el Price y la
propiedad del recurso.

## 4. Registrar el webhook live

En **Stripe Dashboard > Developers > Webhooks**, en modo live, registra este
endpoint exacto:

```text
https://jkjifmrrlyncuwpjhxvk.supabase.co/functions/v1/stripe-webhook
```

Selecciona únicamente estos eventos:

- `checkout.session.completed`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Copia el signing secret generado por ese endpoint en
`STRIPE_WEBHOOK_SECRET`. El secreto live es distinto del secreto de pruebas. La
función debe rechazar cualquier petición sin una firma válida.

## 5. Comprobación antes de abrir al público

1. Publica también `success.html`, `cancel.html` y `profile.html` bajo
   `SITE_URL` y verifica que todos los retornos usan HTTPS.
2. Realiza con una tarjeta propia una compra real de clase suelta.
3. Comprueba en Stripe que el pago está completado y en Supabase que se concede
   exactamente un bono, incluso al reenviar el mismo evento desde Stripe.
4. Completa una suscripción mensual y comprueba cliente, suscripción y fecha de
   acceso en Supabase.
5. Prueba cancelación, renovación e impago y confirma que el estado local se
   sincroniza mediante los eventos configurados.
6. Abre Customer Portal y comprueba que vuelve a `SITE_URL`.
7. Reembolsa las compras reales de validación desde Stripe Dashboard y verifica
   el resultado antes de habilitar los botones para clientes.
8. Revisa los logs de Stripe Webhooks y Supabase Edge Functions; no continúes si
   hay eventos fallidos, duplicados o Prices desconocidos.

Mantén separados los secretos y Prices de test y live. Para volver a probar sin
dinero real, usa otro proyecto/entorno de Supabase con las credenciales de prueba;
no intercambies modos en el entorno de producción.

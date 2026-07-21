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
desde los que se publica exactamente el frontend de producción. En producción
usa únicamente el dominio `www` alternativo:

```text
https://www.genyoga.studio
```

El origen de `SITE_URL` se permite siempre de forma automática. No uses `*`, no
añadas GitHub Pages y no autorices dominios de certificación en el proyecto de
producción.

`PAYMENT_ALLOWED_ORIGINS` determina desde qué orígenes se pueden crear o consultar pagos LIVE y abrir Customer Portal. Debe contener únicamente los hostnames productivos:

```text
https://genyoga.studio,https://www.genyoga.studio
```

GitHub Pages y cualquier web de certificación deben quedar fuera de los pagos LIVE. El origen del navegador no incluye la ruta del repositorio, por lo que `jaime312.github.io/Q19-CERT` no se puede aislar de otros repositorios mediante CORS. Una certificación funcional requiere otro proyecto Supabase, Stripe TEST, Prices y webhook de prueba, preferiblemente bajo un hostname propio como `cert.genyoga.studio`.

Todos los retornos de Checkout y Customer Portal se construyen con el `SITE_URL` canónico. Nunca se refleja el encabezado `Origin`, ni se usan rutas `/GEN-YOGA` o `/Q19-CERT` para sesiones LIVE.

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

Después de revisar todas las migraciones de `supabase/migrations`, aplícalas en
orden al proyecto enlazado antes de activar los cobros. Crean las tablas privadas
de Stripe, las RPC atómicas de compras, reservas de consultas y saldos, y el
bloqueo transaccional usado durante la eliminación de cuentas. No se debe
conceder escritura pública directa sobre esas tablas mediante RLS.

```powershell
npx supabase@latest db push --linked
$stripeFunctions = @(
  'create-checkout-session',
  'get-checkout-session',
  'book-guest-class',
  'create-portal-session',
  'create-kiosk-user',
  'delete-account',
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

`delete-account` mantiene `verify_jwt = true` y vuelve a validar el token dentro
de la función. Solo permite borrar la cuenta propia o, si el perfil solicitante
es administrador, otra cuenta. Antes de eliminar datos consulta Stripe y bloquea
la operación mientras exista una suscripción que no esté terminada. Al comenzar,
marca el perfil con un identificador exclusivo de eliminación; mientras esa marca
exista, `create-checkout-session` rechaza nuevos pagos y vuelve a comprobarla
después de crear cada sesión, expirando la sesión si detecta una carrera. La
función de borrado también expira Checkouts abiertos y espera si existe un pago
recién completado cuyo webhook todavía no se ha consolidado.

La migración `202607210003_account_deletion_guard.sql` instala además un trigger
en `profiles`. Si un webhook intenta conceder bonos, saldos o renovar el plan
mensual mientras la cuenta está marcada para borrado, la transacción falla y el
webhook responde con error para que Stripe lo reintente. Si la eliminación no se
completa, la función libera la marca con el mismo identificador exclusivo. Por
eso esta migración debe desplegarse antes que las versiones nuevas de
`create-checkout-session` y `delete-account`. La misma RPC serializa el borrado
de administradores y evita en base de datos que dos solicitudes concurrentes
eliminen entre ambas la última cuenta administradora.

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

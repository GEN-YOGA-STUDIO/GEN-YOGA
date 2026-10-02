# Fallos pendientes para la IA (autogenerado)

Generado: 2026-10-02T07:51:39.383Z. Lo regenera cada `check:nightly` / `check:cert`.

## 🔴 3 fallo(s) pendientes (1 alta severidad)

Orden: alta severidad primero. Reglas: cambios mínimos; si tocas .html/.js/.css replica en `ultima version/` (+ `app */www`); no toques el espejo de cert; no escribas secretos; verifica cada fix antes de darlo por cerrado.

### PROD-01 [high] [produccion] backend · fn list-stripe-products

- Detalle: no desplegada (404)
- Dónde: https://jkjifmrrlyncuwpjhxvk.supabase.co/functions/v1/list-stripe-products
- Mirar: `supabase/functions/`, `supabase/migrations/`
- Repro:
  1. Repetir la petición REST/Function indicada con la clave pública de clases.html
  2. Tablas privadas: 401/403 esperado; 404 = tabla o función ausente
- Pista: Desplegar la function: `supabase functions deploy list-stripe-products` (requiere acceso Supabase; no tocar código web). El frontal tiene fallback, impacto bajo pero deriva real.
- Verificar: `npm run check:nightly` (acepta PROD_BASE_URL local para iterar)

### PROD-02 [medium] [produccion] contenido · clases: calendario

- Detalle: "Ver horario" no abre (talleres)
- Dónde: https://genyoga.studio/clases.html
- Mirar: `clases.html`, `tarifas.html`, `maestros.html`, `index.html`, `public-calendar.js`
- Repro:
  1. Abrir la página indicada en móvil 390px
  2. Reproducir el paso indicado con la consola abierta
- Pista: Semana actual vacía es NORMAL en talleres (usar SEMANA SIGUIENTE). Si el panel se atasca tras ver otros modos, mirar estado mode/teacher en `public-calendar.js` (applyOpenOptions/close). Captura en el artefacto.
- Verificar: `npm run check:nightly` (acepta PROD_BASE_URL local para iterar)

### PROD-03 [medium] [produccion] contenido · clases: tarjeta

- Detalle: power-vinyasa no abre calendario
- Dónde: https://genyoga.studio/clases.html
- Mirar: `clases.html`, `tarifas.html`, `maestros.html`, `index.html`, `public-calendar.js`
- Repro:
  1. Abrir la página indicada en móvil 390px
  2. Reproducir el paso indicado con la consola abierta
- Pista: Semana actual vacía es NORMAL en talleres (usar SEMANA SIGUIENTE). Si el panel se atasca tras ver otros modos, mirar estado mode/teacher en `public-calendar.js` (applyOpenOptions/close). Captura en el artefacto.
- Verificar: `npm run check:nightly` (acepta PROD_BASE_URL local para iterar)

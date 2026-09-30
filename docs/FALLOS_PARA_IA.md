# Fallos pendientes para la IA (autogenerado)

Generado: 2026-09-30T17:22:10.324Z. Lo regenera cada `check:nightly` / `check:cert`.

## 🔴 6 fallo(s) pendientes (3 alta severidad)

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

### CERT-02 [high] [certificacion] auth · JS limpio

- Detalle: tagOnlineBadge is not defined | https://gen-yoga-studio.github.io/Q19-CERT/profile.html:22196 | ReferenceError: tagOnlineBadge is not defined
    at https://gen-yoga-studio.github.io/Q19-CERT/profile.html:22196:32
    at Array.forEach (<anonymous>)
    at https://gen-yoga-studio.github.io/Q19-CERT/p
- Dónde: https://gen-yoga-studio.github.io/Q19-CERT/profile.html
- Mirar: `profile.html:22196`, `profile.html:22132`, `profile.html:22110`
- Repro:
  1. Abrir https://gen-yoga-studio.github.io/Q19-CERT/profile.html
  2. Login con el usuario de pruebas (email visible; contraseña en secreto GEN_YOGA_TEST_PASSWORD)
  3. Navegar la vista indicada y observar el error
- Evidencia: `tagOnlineBadge is not defined | https://gen-yoga-studio.github.io/Q19-CERT/profile.html:22196 | ReferenceError: tagOnlineBadge is not defined
    at https://gen-yoga-studio.github.io/Q19-CERT/profile.html:22196:32
    at`
- Captura: `nightly-reports/img/auth-1790783346898.png` (artefacto CI)
- Pista: Variable indefinida en un render: abrir el primer fichero:línea de sospechosos y revisar la rama que la usa (suele ser un renombro a medias). Replicar el fix en `ultima version/` y `app */www`.
- Verificar: `npm run check:cert` (acepta PROD_BASE_URL local para iterar)

### CERT-03 [high] [certificacion] cliente · JS limpio

- Detalle: tagOnlineBadge is not defined | https://gen-yoga-studio.github.io/Q19-CERT/profile.html:22196 | ReferenceError: tagOnlineBadge is not defined
    at https://gen-yoga-studio.github.io/Q19-CERT/profile.html:22196:32
    at Array.forEach (<anonymous>)
    at https://gen-yoga-studio.github.io/Q19-CERT/p
- Dónde: https://gen-yoga-studio.github.io/Q19-CERT/profile.html
- Mirar: `profile.html:22196`, `profile.html:22132`, `profile.html:22110`, `tarifas.html`
- Repro:
  1. Abrir https://gen-yoga-studio.github.io/Q19-CERT/profile.html
  2. Login con el usuario de pruebas (contraseña en secreto GEN_YOGA_TEST_PASSWORD)
  3. Ejercer la acción indicada y CANCELAR el diálogo sin confirmar
- Evidencia: `tagOnlineBadge is not defined | https://gen-yoga-studio.github.io/Q19-CERT/profile.html:22196 | ReferenceError: tagOnlineBadge is not defined
    at https://gen-yoga-studio.github.io/Q19-CERT/profile.html:22196:32
    at`
- Captura: `nightly-reports/img/cliente-1790783387456.png` (artefacto CI)
- Pista: Variable indefinida en un render: abrir el primer fichero:línea de sospechosos y revisar la rama que la usa (suele ser un renombro a medias). Replicar el fix en `ultima version/` y `app */www`.
- Verificar: `npm run check:cert` (acepta PROD_BASE_URL local para iterar)

### PROD-04 [medium] [produccion] contenido · clases: calendario

- Detalle: "Ver horario" no abre (talleres)
- Dónde: https://genyoga.studio/clases.html
- Mirar: `clases.html`, `tarifas.html`, `maestros.html`, `index.html`, `public-calendar.js`
- Repro:
  1. Abrir la página indicada en móvil 390px
  2. Reproducir el paso indicado con la consola abierta
- Pista: Semana actual vacía es NORMAL en talleres (usar SEMANA SIGUIENTE). Si el panel se atasca tras ver otros modos, mirar estado mode/teacher en `public-calendar.js` (applyOpenOptions/close). Captura en el artefacto.
- Verificar: `npm run check:nightly` (acepta PROD_BASE_URL local para iterar)

### PROD-05 [medium] [produccion] contenido · clases: tarjeta

- Detalle: power-vinyasa no abre calendario
- Dónde: https://genyoga.studio/clases.html
- Mirar: `clases.html`, `tarifas.html`, `maestros.html`, `index.html`, `public-calendar.js`
- Repro:
  1. Abrir la página indicada en móvil 390px
  2. Reproducir el paso indicado con la consola abierta
- Pista: Semana actual vacía es NORMAL en talleres (usar SEMANA SIGUIENTE). Si el panel se atasca tras ver otros modos, mirar estado mode/teacher en `public-calendar.js` (applyOpenOptions/close). Captura en el artefacto.
- Verificar: `npm run check:nightly` (acepta PROD_BASE_URL local para iterar)

### CERT-06 [medium] [certificacion] disponibilidad · /sitemap.xml

- Detalle: HTTP 404
- Dónde: https://gen-yoga-studio.github.io/Q19-CERT/sitemap.xml
- Mirar: `CNAME`, `sitemap.xml`, `.github/workflows/deploy-pages.yml`
- Repro:
  1. Abrir la URL indicada en un navegador
  2. Debe responder HTTP 200 en <15s
- Pista: El build debe copiar `sitemap.xml` al artefacto (build-cert-web ya lo hace; el legacy no). Nada que tocar en código si el espejo nuevo lo incluye.
- Verificar: `npm run check:cert` (acepta PROD_BASE_URL local para iterar)

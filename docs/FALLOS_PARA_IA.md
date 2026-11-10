# Fallos pendientes para la IA (autogenerado)

Generado: 2026-11-05T12:15:22.884Z. Lo regenera cada `check:nightly` / `check:cert`.

## 🔴 1 fallo(s) pendientes (0 alta severidad)

Orden: alta severidad primero. Reglas: cambios mínimos; si tocas .html/.js/.css replica en `ultima version/` (+ `app */www`); no toques el espejo de cert; no escribas secretos; verifica cada fix antes de darlo por cerrado.

### CERT-01 [medium] [certificacion] contenido · index: idioma

- Detalle: no conmuta (en=es es=es)
- Dónde: https://gen-yoga-studio.github.io/GEN-YOGA-CERT/index.html
- Mirar: `clases.html`, `tarifas.html`, `maestros.html`, `index.html`, `public-calendar.js`
- Repro:
  1. Abrir la página indicada en móvil 390px
  2. Reproducir el paso indicado con la consola abierta
- Captura: `img\contenido-index__idioma-1793880353495.png` (artefacto CI)
- Pista: Reproducir el clic con los pasos de abajo; revisar consola + captura del artefacto. Suele ser cableado (onclick), timing o contenido dinámico vacío.
- Verificar: `npm run check:cert` (acepta PROD_BASE_URL local para iterar)

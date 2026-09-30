# Bucle nocturno: detectar → autorreportar → autocorregir

```
01:30 UTC  nightly-health  →  genyoga.studio + usuario de pruebas
                                        │
                     ┌──────────────────┴──────────────────┐
                     │ verde                               │ rojo
                     │ (nada)                              ▼
                     │                    nightly-action.json + capturas
                     │                              issue `ai-fix` con Prompt para OpenCode
                     │                                        │
                     │                        ┌─────────────┴──────────────┐
                     │                        │ AUTOFIX_ENABLED=true       │ no
                     │                        │ + clave LLM                ▼
                     │                        ▼                    humano pega el
                     │               nightly-autofix:               prompt en local
                     │               opencode run → verifica →
                     │               PR (revisión humana)
```

## Piezas

| Pieza | Qué hace |
|---|---|
| `scripts/check-nightly-production.mjs` (`npm run check:nightly` / `npm run check:cert` con `CERT_MODE=1`) | ~160 checks (sectores: landing, clases, tarifas, maestros, perfil, retorno): disponibilidad, backend, privacidad, **mapa de clics de la landing** (oferta, historia, 8 navegaciones, footer, WhatsApp, idioma), contenido sin errores JS, login, **todas las acciones de cliente hasta el punto sin retorno** (registro, recuperación, 5 vistas, reservar/cancelar yoga-consulta-taller, editar perfil, guía de bonos, rol, logout, los 15 botones de compra), rendimiento. En cert: autodetecta su Supabase desde sus páginas, exige manifiesto + aislamiento (sección Z), tolera functions LIVE ausentes y datos de prueba vacíos. Reintento único anti-flaky, captura PNG por fallo, stack con fichero:línea, y `nightly-reports/{nightly,cert}-action.json` (fallos con severidad, sospechosos, repro, evidencia). |
| `scripts/nightly-issue-body.mjs` | Convierte `{nightly,cert}-action.json` en cuerpo de issue agent-ready + bloque `Prompt para OpenCode` (con `CERT_MODE=1` apunta a cert y prohíbe tocar el espejo). |
| `.github/workflows/nightly-health.yml` | Cron 01:30 UTC + manual. Sube `nightly-report`, crea/actualiza el issue (`producción`, `ai-fix`). |
| `.github/workflows/cert-health.yml` | **Puerta pre-producción**: tras cada Deploy Cert (espera a Pages) + 02:15 UTC + manual (input `base_url`). Valida el espejo (`CERT_BASE_URL` o Q19-CERT). Issue `cert` + `ai-fix` si la versión no pasa. |
| `.github/workflows/nightly-autofix.yml` | Al etiquetar `ai-fix` (o manual): ejecuta `opencode run`, verifica con `check:nightly` (o `check:cert` si el issue es `cert`) y abre PR. Un intento por issue (`autofix-intentado`), nunca toca `main`. |

## Puerta pre-producción (cert)

```
push a main → Deploy Cert → espejo (Q19-CERT / GEN-YOGA-CERT)
                                    │
02:15 UTC + tras deploy + manual → cert-health (`npm run check:cert`)
                                    │
                    ┌───────────────┴───────────────┐
                    │ verde → publica con           │ rojo → issue `cert`+`ai-fix`
                    │ `npm run publicar`            │ (autofix verifica con check:cert)
```

Base: input `base_url` → variable `CERT_BASE_URL` → Q19-CERT.
El cert necesita al usuario `prueba@prueba.com` en su Supabase; sin él, el
login falla con la pista en el propio informe. `npm run publicar` solo con
cert en verde.

## Activar el autofix (una vez)

1. Variable de repositorio `AUTOFIX_ENABLED=true` (Settings → Secrets and variables → Actions → Variables).
2. Secreto `ANTHROPIC_API_KEY` (o `OPENAI_API_KEY` / `GEMINI_API_KEY`).
3. Sin esto el workflow comenta instrucciones y termina en verde: el issue sigue trayendo el prompt listo para `opencode run` en local.

## Reglas del agente

Solo lectura + login/logout con el usuario de pruebas; 0 cargos (checkout interceptado);
cambios mínimos; replicar fixes web en `ultima version/` (fuente del deploy de Pages)
y en `app android/www` + `app ios/www`; verificación obligatoria con `npm run check:nightly`.

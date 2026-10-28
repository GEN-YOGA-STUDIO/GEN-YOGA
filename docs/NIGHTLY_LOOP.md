# Bucle nocturno: detectar → explicar → planificar → aplicar (solo si se activa)

```
01:30 UTC  nightly-health  →  genyoga.studio + usuario de pruebas
                                        │
                    ┌───────────────────┴────────────────────┐
                    │ verde                                │ rojo
                    │                                      ▼
                    │                    nightly-action.json + capturas + Step Summary
                    │                              issue `ai-fix` actualizado
                    │                                        │
                    │                        ┌───────────────┴──────────────┐
                    │                        │ AUTOFIX_ENABLED=true         │ no
                    │                        │ + clave LLM                  ▼
                    │                        ▼                       humano pega el
                    │               nightly-autofix:                 prompt en local
                    │               opencode run → verifica →
                    │               PR (revisión humana)
                    │
                    └─► análisis + plan-mejoras.json/md
                              │
                              ▼
                    issue «🧭 Plan de mejoras» (etiqueta plan-mejoras)
                              │
                 ┌────────────┴─────────────┐
                 │ revisar                  │ activar a propósito
                 ▼                          ▼
          nada (solo lectura)      etiqueta `aplicar-mejoras`
                                   o workflow_dispatch
                                            │
                                            ▼
                                  apply-improvements:
                                  OpenCode → verifica → PR
```

> **Doble vía redundante al autofix**: `nightly-health` y `cert-health` despachan
> `nightly-autofix` por **dos caminos a la vez** — (1) `actions.createWorkflowDispatch`
> (API, la única vía exenta de la supresión de eventos del `GITHUB_TOKEN`) y (2) el
> trigger `workflow_run` del propio autofix (`conclusion == failure`). Son
> intencionadamente redundantes: si uno falla, el otro cierra el bucle, y la etiqueta
> `autofix-intentado` del gate **deduplica** (un solo intento por fallo).

## Piezas

| Pieza | Qué hace |
|---|---|
| `scripts/check-nightly-production.mjs` (`npm run check:nightly` / `npm run check:cert` con `CERT_MODE=1`) | ~249 checks (sectores: landing, clases, tarifas, maestros, perfil, retorno): disponibilidad, SSL/TLS, backend, privacidad, **mapa de clics de la landing**, contenido sin errores JS ni tokens corruptos, **integridad de imágenes en vivo**, **SEO y sitemaps**, **seguridad** (Open Redirect, limpieza de tokens), **consistencia de datos Supabase**, login, **acciones de cliente hasta el punto sin retorno**, los 15 botones de compra y rendimiento. Integra las suites extendidas y la simulación de personas. En cert: autodetecta su Supabase, exige manifiesto + aislamiento (sección Z), tolera functions LIVE ausentes y datos vacíos. Reintento único anti-flaky, un solo juego de listeners por página, captura PNG por fallo y `nightly-reports/{nightly,cert}-YYYY-MM-DD-action.json` (además del `-action.json` fijo). |
| `scripts/check-extended.mjs` (`npm run check:extended`) | Suites nuevas: **a11y** (contraste, nombres accesibles, alt, etiquetas, tamaño de fuente, foco), **enlaces** (404 real, enlaces internos), **seo-plus** (JSON-LD, canonical, og:image), **pwa** (manifest, iconos, theme-color), **datos-vivos** (Supabase pintado sin fallback), **i18n-live** (ES↔EN real) y **entrega** (compresión/caché). Los fallos llevan `meta.severity` y `kind` para que el plan no confunda un texto de 9px con una caída de pagos. |
| `scripts/personas-simulation.mjs` (`npm run personas` / `personas:full`) | Cuatro recorridos reales: Lucía (móvil, Instagram), Marta (escritora, login/reserva/perfil), Carmen (teclado/baja visión) y Dani (3G lento, con `--full`). Miden objetivo, pasos, toques, tiempo, bloqueos y **fricción 0-100**. Solo lectura: todos los diálogos se cancelan antes de escribir. `SKIP_PERSONAS=1` omite el bloque; `PERSONAS_FULL=0` omite la red lenta. |
| `scripts/nightly-intelligence.mjs` | Motor de precisión: **firma estable** de fallos (suite + check + detalle normalizado), **clasificación de avisos** (dato de prueba ≠ defecto ≠ infraestructura ≠ flaky), **salud funcional vs experiencia** explicable, cobertura de suites y **plan de mejoras** con IDs `M01…`, prioridad P1/P2/P3 y `autoApplicable`/`requires`. |
| `scripts/nightly-step-summary.mjs` (`npm run nightly:summary`) | Panel enriquecido en `$GITHUB_STEP_SUMMARY`: métricas, salud explicable, cobertura, personas, desglose por suites, fallos con severidad y avisos. |
| `scripts/analizar-informe-diario.mjs` (`npm run analizar:diario` / `npm run analizar:cert`) | Compara hoy con el histórico (tasa, TTFB, páginas, avisos nuevos/recurrentes, SSL) y usa `nightly-intelligence` para escribir `plan-mejoras.json` + `.md`. Ya no calcula un score opaco: cada punto perdido se explica. |
| `scripts/plan-issue.mjs` (`npm run plan:issue`) | Convierte el plan en el issue «🧭 Plan de mejoras» (producción o cert). Lleva un bloque oculto con el plan compacto: el workflow de aplicación lo lee del propio issue, sin depender de artefactos de otra ejecución. |
| `scripts/mejoras.mjs` (`npm run mejoras` / `mejoras:aplicar` / `mejoras:estado`) | Revisa, aplica o inspecciona el plan. `aplicar` exige `--activar`; solo toca propuestas `autoApplicable`; prohíbe checkout/reset/stash/revert; no hace commit salvo `--pr` con árbol limpio; verifica al final. |
| `scripts/nightly-issue-body.mjs` | Convierte `{nightly,cert}-action.json` en cuerpo de issue agent-ready. La firma incluye el **detalle normalizado**, no solo suite+check: un cambio real en el mismo check vuelve a disparar el autofix. |
| `scripts/nightly-notify.mjs` | Notificación inmediata opcional via Webhook (`ALERT_WEBHOOK_URL`, `DISCORD_WEBHOOK_URL` o `SLACK_WEBHOOK_URL`) ante fallos o recuperación. |
| `.github/workflows/nightly-health.yml` | Cron 01:30 UTC + manual (con input `base_url`). Sube `nightly-report`, publica Step Summary + Análisis Diario, crea/actualiza el issue del plan (`plan-mejoras`, `producción`) y el issue de fallos (`producción`, `ai-fix`) con disparo automático de `nightly-autofix` por doble vía redundante. |
| `.github/workflows/cert-health.yml` | **Puerta pre-producción**: tras cada Deploy Cert (espera a Pages) + 02:15 UTC + manual. Valida el espejo, publica Step Summary + Análisis Diario, crea/actualiza el plan de cert y el issue `cert` + `ai-fix` si la versión no pasa. |
| `.github/workflows/apply-improvements.yml` | **Aplicación explícita del plan**: se activa con la etiqueta `aplicar-mejoras` en el issue del plan o con `workflow_dispatch` (`issue_number`, `ids`, `max`). Verifica permisos del actor, ejecuta OpenCode sobre los IDs auto-aplicables, pasa la suite completa y abre PR. Nunca se dispara solo desde el chequeo nocturno. |
| `.github/workflows/deploy-pages.yml` | Despliegue manual a producción (`npm run publicar`) con **puerta de calidad**: exige el último `cert-health` **en verde y del mismo commit (`head_sha == github.sha`)** que se va a publicar; bloquea runs en curso o rojos, o verdes de otro SHA. Bypass consciente con el input `force_deploy`. |
| `.github/workflows/nightly-autofix.yml` | Al fallar la salud o etiquetar `ai-fix` (o manual): ejecuta `opencode run`, verifica con `check:nightly` (o `check:cert` si el issue es `cert`) y abre PR. Un intento por issue (`autofix-intentado`), nunca toca `main`. |

## Puerta pre-producción automatizada (cert)

```
push a main → Deploy Cert → espejo (Q19-CERT / GEN-YOGA-CERT)
                                    │
02:15 UTC + tras deploy + manual → cert-health (`npm run check:cert`)
                                    │
                    ┌───────────────┴───────────────┐
                    │ verde → autoriza              │ rojo → issue `cert`+`ai-fix`
                    │ `Deploy Web to Pages`         │ (bloquea deploy-pages salvo force_deploy)
```

Base: input `base_url` → variable `CERT_BASE_URL` → Q19-CERT.
El cert necesita al usuario `prueba@prueba.com` en su Supabase; sin él, el
login falla con la pista en el propio informe. El workflow `deploy-pages.yml`
incorpora una **puerta de calidad automatizada** con la filosofía *"cert valida
un SHA concreto; publicar otro SHA es publicar sin validar"* (F7 de la
auditoría), que comprueba **tres cosas** sobre el último run de `cert-health`:

1. **Está completado y en verde** — si el run está todavía `in_progress`/en cola
   (`conclusion: null`) el bloqueo avisa explícitamente de que está *en curso*
   (distinto de "rojo"): espera a que termine.
2. **Es del mismo commit que se va a publicar** — `latest.head_sha == github.sha`.
   Un verde de un commit anterior ya no autoriza: si llegó un push nuevo después
   del último cert verde, el despliegue queda bloqueado hasta validar ese SHA
   (relanza `cert-health` sobre el commit o forza).
3. **Excepciones a propósito**: sin ejecuciones previas de `cert-health` → se
   permite (bootstrap), y un error de API → se permite (no se bloquea un deploy
   por una caída transitoria de GitHub).

Bypass consciente en cualquier caso: el input `force_deploy: true`
(`npm run publicar` con la casilla, o `gh workflow run deploy-pages.yml -f force_deploy=true`).

## Deduplicación inteligente por firma de fallos

Tanto `nightly-health` como `cert-health` calculan una firma hash (`failure-signature`) basada en la combinación de fallos detectados **y su detalle normalizado** (URLs, fechas, rutas y números se sustituyen por marcadores). Así, un cambio real en el mismo check —otro error de consola, otra causa— genera una firma nueva, mientras que el mismo fallo repetido no cambia:
- **Misma firma que la pasada anterior**: El issue existente actualiza su cuerpo para reflejar fecha y run actual, pero **no añade comentarios repetitivos gigantes** (solo un aviso conciso de persistencia) y **no relanza autofix** si ya fue intentado (`autofix-intentado`), eliminando bucles y ruido.
- **Firma diferente (nuevos fallos o resolución parcial)**: Se documenta el cambio en un comentario detallado, se retira `autofix-intentado` y se relanza `nightly-autofix` para que la IA actúe sobre la nueva causa raíz.

## Plan de mejoras: revisar siempre, aplicar solo a propósito

Cada pasada escribe `nightly-reports/plan-mejoras.json` y `.md` (o `plan-mejoras-cert.*`). El plan separa:

- **Salud funcional** (caídas, pagos, auth, backend, SSL, cobertura, rendimiento): 75% del score.
- **Salud de experiencia** (a11y, SEO, PWA, i18n, entrega, fricción de personas): 25%.
- **Avisos de datos de prueba** pesan muy poco; `fallback`/infra pesan más. Un `manifest.json` pendiente de desplegar es aviso, no fallo.
- **Cobertura**: si una suite no se ejecutó, el plan lo marca como P1. Un verde con cobertura incompleta no es un verde.
- **Personas**: un recorrido bloqueado es un fallo funcional y fuerza `CRÍTICO`; la fricción y los hallazgos a11y pesan en experiencia.

Propuestas con `autoApplicable: true` son cambios de código web verificables. Las `manual` requieren Supabase/Stripe, un despliegue o datos de prueba y la IA no las toca.

### Aplicar en local

```bash
npm run mejoras                              # ver el plan (no toca código)
npm run mejoras:aplicar -- --solo M01,M02    # aplica esos IDs (exige --activar; el script npm ya lo añade)
npm run mejoras:aplicar -- --max 3           # hasta 3 auto-aplicables
npm run mejoras:aplicar -- --dry-run --solo M01   # ver el prompt sin ejecutar
npm run mejoras -- estado                    # último plan + último intento
```

`aplicar` prohíbe `git checkout/reset/stash/clean/revert`, no hace commit/push salvo `--pr` con árbol limpio y verifica con la suite completa. Si la verificación falla, deja los cambios en el working tree para revisión y devuelve código 1.

### Aplicar desde GitHub

1. El issue «🧭 Plan de mejoras» (etiqueta `plan-mejoras`) se actualiza cada noche.
2. Añade la etiqueta **`aplicar-mejoras`** al issue, o lanza `apply-improvements` manualmente con `ids`.
3. El workflow comprueba que quien activa tiene permiso `write`, ejecuta OpenCode solo sobre IDs auto-aplicables, pasa `check:nightly`/`check:cert` y abre PR.
4. La etiqueta se retira al empezar; no hay reintentos automáticos. Si quieres reintentar, vuelve a ponerla.

Nada de esto ocurre en el cron: el chequeo nocturno solo detecta, explica y propone.

## Detección temprana y prevención de cascadas (Smoke Gate)

Antes de lanzar el navegador Playwright y evaluar ~200 comprobaciones, el proceso realiza un **Smoke Check** rápido contra la URL base (`BASE/`). Si la web está caída, inaccesible por DNS o devuelve 404 (p. ej. Pages aún sin publicar):
- Aborta de inmediato en <2 segundos con una única incidencia clara de infraestructura.
- Evita 25 minutos de runner colgado y más de 40 falsos positivos en cascada.

## Consideraciones de cron en GitHub Actions

Los triggers programados (`schedule`) de GitHub Actions no son de tiempo real estricto: pueden sufrir retrasos en cola de minutos (habitualmente +10-20 min) o incluso horas en picos globales de GitHub. El sistema está diseñado de forma idempotente para que los chequeos no se solapen gracias a los grupos de `concurrency`.

**Retrasos reales observados (F10)**: en la ventana auditada (2026-10-01 → 10-08) el
cron de 01:30Z se ejecutó un día a las **07:29Z (+6 h)** y otro a las 04:02Z (+2 h 32);
el de cert (02:15Z) llegó a las 04:08Z. Consecuencias prácticas:

- El "chequeo nocturno" puede correr **después de un deploy del día** (o saltarse el
  estado de la mañana): un verde/rojo no siempre describe la última versión publicada.
  Por eso la puerta de `deploy-pages` compara **SHA, no horas**: lo que importa es que
  el commit que se publica sea exactamente el que cert validó.
- Un retraso grande no es por sí un fallo del sistema; los grupos `concurrency`
  (uno por workflow, `cancel-in-progress: false`) evitan que un cron atrasado se
  solape con un lanzamiento manual.

## Activar el autofix (una vez)

Checklist de settings del repo (estado verificado el 2026-10-08 con `gh variable list` / `gh secret list` / `gh label list`):

- [x] Variable de repositorio `AUTOFIX_ENABLED=true` (Settings → Secrets and variables → Actions → Variables). *(Creada 2026-10-08)*.
- [x] Etiqueta `autofix-intentado` en el repositorio para control de intentos. *(Creada; el gate la añade al issue en cada intento y los health workflows la retiran ante una regresión)*.
- [ ] **Secreto LLM — único paso que falta**: `ANTHROPIC_API_KEY` (o `OPENAI_API_KEY` / `GEMINI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY`), en Settings → Secrets and variables → Actions. *(Sin clave, la puerta deja el aviso y termina en verde; el bucle queda abierto a medias.)*
- [ ] (Opcional) Secreto `ALERT_WEBHOOK_URL` o `DISCORD_WEBHOOK_URL`/`SLACK_WEBHOOK_URL` para recibir alertas en el móvil o canal de chat.
- [ ] (Opcional) Secretos `GEN_YOGA_TEST_EMAIL` / `GEN_YOGA_TEST_PASSWORD` (sin ellos se usan los valores por defecto `prueba@prueba.com` / `prueba`).

Sin secretos LLM el workflow comenta instrucciones (una sola vez por issue) y termina en verde: el issue sigue trayendo el prompt listo para `opencode run` en local.

## Disparo automático cerrado

Los workflows `nightly-health` y `cert-health` disparan `nightly-autofix` por
**dos vías redundantes** (doble cierre del bucle):

1. **`actions.createWorkflowDispatch` (API de GitHub Actions)** — requiere
   `permissions: actions: write` en el health workflow. Es la única vía exenta de
   la supresión de GitHub sobre eventos originados con el `GITHUB_TOKEN`, que es
   exactamente por lo que el trigger `issues: [labeled]` nunca creó runs: el issue
   lo abre el propio bot.
2. **Trigger `workflow_run`** dentro de `nightly-autofix`
   (`workflows: ["Chequeo nocturno de producción (genyoga.studio)", "Validación de
   certificación (pre-producción)"]`, `types: [completed]` + `conclusion == failure`).
   No hay `github.event.issue` en este evento: el autofix resuelve el issue abierto
   por su **marcador oculto** en el cuerpo (`<!-- nightly-issue -->` /
   `<!-- cert-issue -->`, con el título exacto de reserva) según qué workflow falló.

**Deduplicación**: aunque lleguen las dos vías (o alguien etiquete `ai-fix` a mano),
el gate `autofix-intentado` garantiza **un solo intento por fallo** — la etiqueta se
añade al empezar el intento y los health workflows solo la retiran cuando cambia la
firma de fallos (regresión nueva), nunca en cada run rojo repetido. El trigger
`issues: [labeled]` se conserva como vía para etiquetas puestas **a mano** (esos
sí generan runs; los del bot no).

Si ya existía un issue previo, actualizan su cuerpo con los fallos vigentes y reactivan el intento.

## Reglas del agente

Solo lectura + login/logout con el usuario de pruebas; 0 cargos (checkout interceptado);
cambios mínimos; replicar fixes web en `ultima version/` (fuente del deploy de Pages)
y en `app android/www` + `app ios/www`; verificación obligatoria con `npm run check:nightly`.

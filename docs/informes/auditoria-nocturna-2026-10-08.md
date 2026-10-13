# Auditoría del proceso nocturno de GitHub — 2026-10-08

**Alcance**: análisis de solo lectura sobre `main` (`HEAD = 2394236`) de los workflows
nocturnos (`nightly-health.yml`, `cert-health.yml`, `nightly-autofix.yml`), los issues #5–#8,
los logs de Actions (`gh run view --log[-failed]`), artefactos, secretos/variables y los
scripts `nightly-issue-body.mjs` / `check-nightly-production.mjs`.
No se ha hecho commit, push ni edición de workflows/docs de loop (zona del AGENTE B).

---

## 1. Resumen ejecutivo

1. Los 6 fallos de `cert-health` de hoy (runs 32–37) **no son flaky**: son un único fallo
   determinista repetido 6 veces (`[cliente] reserva yoga: diálogo inesperado o ausente`).
   Causa raíz: el checker contrastaba el **texto literal** de un diálogo de UI y la app/página
   de cert mostró «Confirmar Sesión Gratuita» en vez de «Confirmar Reserva…». Se arregló
   ampliando el regex (`2394236`), no la app → el run 38 pasó a verde.
2. El bucle de autofix está roto por **tres causas independientes**: (a) el trigger
   `issues: labeled` **nunca** llega a crear runs porque el issue lo crea `github-actions[bot]`
   con `GITHUB_TOKEN` (supresión documentada por GitHub); (b) en `HEAD` **ninguno** de los dos
   health workflows despacha `nightly-autofix`; (c) faltan `AUTOFIX_ENABLED` y cualquier clave LLM.
   Resultado: **0 runs de autofix** desde su creación.
3. Ruido alto: 20 runs en rojo → 5 de infra → 15 reales → **solo 6 causas raíz distintas**
   (2,5 runs rojos por causa). Hoy, 1 causa generó 1 issue y **6 comentarios duplicados**
   (~12 KB repetidos) más ~36 min de runner.
4. El dedup por título funciona a medias: aguanta 6 rojos sin abrir 6 issues, pero **no
   actualiza el cuerpo en `HEAD`** (el prompt del issue queda con los fallos del primer run)
   y solo mira los **20 issues abiertos más recientes**.
5. Calidad del informe: el issue **no dice cuántos checks pasaron** (`action.json` solo lleva
   `failed`/`high`), la severidad es **por suite** (todo lo de `cliente` = `high`) y promete
   «capturas en `img/`» que **no están** en el artefacto (`screenshot: null`).
6. La «puerta pre-producción» es **disciplina humana**: hoy hubo 6 deploys en rojo seguidos y
   el único `Deploy Web to GitHub Pages` se lanzó a las 12:53Z, *después* del verde de las 12:11Z.
   Nada lo automatiza.
7. Duraciones estables (~5,7 min mediana) y timeouts holgados (20/30 min); el problema no es
   velocidad ni capacidad, es **señal**.

---

## 2. Evidencia por hallazgo

### H1 — cert-health 32–37: fallo único determinista, no flaky (causa raíz conocida)

Los 6 runs fallan en el **mismo check**, con el **mismo detalle**, en builds distintos
(17.6.1 → 17.7.0):

```
❌ [cliente] reserva yoga: diálogo inesperado o ausente: "?
Confirmar Sesión Gratuita
¿Quieres reservar tu plaza para esta Sesión Introductoria Gratuita (0 €)"
⛔ cert: 1 fallo(s) en https://gen-yoga-studio.github.io/GEN-YOGA-CERT. Informe en nightly-reports/cert-2026-10-08.md
##[error]Process completed with exit code 1.
```

| Run | ID | Hora (UTC) | Versión test | Commit |
|---|---|---|---|---|
| 32 | 37742873812 | 07:20:57 | 17.6.1 | `7b37abd` |
| 33 | 37747494426 | 08:05:03 | 17.6.2 | `4c78a82` |
| 34 | 37750898553 | 08:35:55 | 17.6.3 | `034a758` |
| 35 | 37758602984 | 09:43:17 | 17.6.4 | `7ebdd84` |
| 36 | 37761929054 | 10:12:22 | 17.6.5 | `2a62605` |
| 37 | 37763527474 | 10:26:55 | 17.7.0 | `a5660d1` |
| 38 ✅ | 37775176111 | 12:11:55 | 17.7.0+fix | `2394236` |

- **No es espera de Pages ni login**: el paso «Esperar publicación en Pages» termina bien
  («✅ Nuevo build publicado.») y el fallo ocurre en «Validar cert como un cliente».
- **Run 38 pasó** porque `2394236` (12:11Z) cambió el checker, no la app:
  `- if (/Confirmar Reserva|Clase Completa|…/i.test(dlg))` →
  `+ if (/Confirmar|Reserva|Gratuit|gratis|Introductori|…|plaza/i.test(dlg))`.
  Log del run 38: `✅ [cliente] reserva yoga: diálogo correcto ("? Confirmar Sesión Gratuita ¿Quieres reservar tu plaza para ")`.
- **Por qué cert falló y producción no**: la madrugada, producción (run 11, 01:43Z) vio
  `✅ [cliente] reserva yoga: diálogo correcto ("? Confirmar Reserva ¿Quieres reservar tu plaza usando tu Bon")`,
  mientras cert (07:20Z) veía «Sesión Gratuita». El texto del diálogo existe en el repo desde
  `1cdb9fb` (09-28, v17.0) y el check `reserva yoga` desde `cb3c9ae` (09-30); pasaba en cert el
  06-10 09:27Z y 09:54Z. Es decir: **diferencia de build/dato entre entornos + aserción por copy**.
- **Veredicto**: regresión real de la *expectativa* (no del producto), determinista 6/6,
  ya mitigada en el checker. Queda el riesgo de que cualquier cambio de copy o de datos
  vuelva a romperlo (ver F4).

Comparativa con los fallos nocturnos antiguos de `nightly-health` (runs 2–5) e issue #5:
el fallo era también único y determinista, pero **sí era defecto real de producto**:
`❌ [backend] fn list-stripe-products: no desplegada (404)` repetido las 3 noches
(01:10, 01:41, 01:46Z) hasta `c2bfbf4`. Mismo patrón de ruido (1 causa → 3 rojos → 3 comentarios).

### H2 — Issues #5–#8: cuerpo bueno, comentarios duplicados, cierres desiguales

| Issue | Creado | Cerrado | Cuerpo | Comentarios | Patrón |
|---|---|---|---|---|---|
| #5 producción | 10-01 07:15Z | 10-03 15:53Z (manual) | 2.968 B | 5 | 3 cuerpos idénticos + **2 comentarios de cierre manual a 2 s** |
| #6 cert | 10-02 02:52Z | 10-03 15:52Z (manual) | **28.369 B / 44 fallos** | 5 | 3 duplicados + 2 cierres manuales a 3 s |
| #7 cert | 10-06 08:01Z | 10-06 09:33Z (auto) | 2.965 B | 1 | ✅ ejemplo correcto |
| #8 cert | 10-08 07:27Z | 10-08 12:17Z (auto) | 2.385 B | 6 | **6 cuerpos idénticos** (12.097 B) + cierre verde |

- **Dedup**: funcionó a medias: 6 rojos → 1 issue (#8), pero en `HEAD` el paso duplicado **solo
  comenta**; el cuerpo del issue (que es lo que leería el agente) se queda con el **primer** run.
- **Cuerpos**: `#6` con 44 fallos es ruido puro: 8 son `HTTP 404` de las mismas páginas porque
  el sitio cert **no estaba publicado**; una sola causa raíz multiplicada por checks en cascada.
- **Prompt para OpenCode**: bien estructurado (base, commit, versión, severidad, sospechosos,
  repro, reglas, comando de verificación), pero (a) no incluye el total de checks,
  (b) no da el comando de descarga del artefacto, (c) dice textual
  *«o deja que el workflow `nightly-autofix` lo ejecute solo»* → **falso hoy** (0 runs).
- **Cierres**: los automáticos (`✅ … recuperada en verde` + `state: closed`) son limpios;
  los manuales de #5/#6 dejaron 2 comentarios redundantes cada uno.
- Ningún issue abierto ahora mismo (0 abiertos) → el estado final es correcto.

### H3 — El trigger `issues: labeled` existe pero sus runs están suprimidos

```
$ gh api "repos/GEN-YOGA-STUDIO/GEN-YOGA/actions/runs?event=issues"  → total_count: 0
$ gh api ".../actions/workflows/nightly-autofix.yml/runs"           → total_count: 0
$ gh api ".../issues/8/timeline"
  {"actor":"github-actions[bot]","created_at":"2026-10-08T07:27:37Z","event":"labeled","label":"ai-fix"}
  {"actor":"github-actions[bot]","created_at":"2026-10-08T07:27:37Z","event":"labeled","label":"cert"}
```

El evento `labeled` **sí se emite** al crear el issue con etiquetas (2 segundos después de
abrirlo), pero GitHub **no crea runs** de eventos originados con `GITHUB_TOKEN`
(«with the exception of `workflow_dispatch` and `repository_dispatch`»). El issue lo crea
`github-actions[bot]` desde `nightly-health`/`cert-health` → supresión total.

### H4 — En `HEAD` nadie despacha el autofix (y faltan activaciones)

- `git show HEAD:.github/workflows/nightly-health.yml | grep createWorkflowDispatch` → **vacío**.
  Ídem `cert-health.yml`. El despacho manual existe **solo en el working tree en preparación**
  de B (versión sin commitear), no en `main`.
- `gh secret list` → solo `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD`,
  `APP_STORE_CONNECT_PRIVATE_KEY`, `CERT_REPO_TOKEN`, `PLAY_SERVICE_ACCOUNT_JSON`.
  **No hay `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`** (ni `GEN_YOGA_TEST_*`,
  ni webhooks de alerta).
- `gh variable list` → solo `CERT_BASE_URL`. **No existe `AUTOFIX_ENABLED`**.
- La puerta del propio workflow lo dice: `if [ "${{ vars.AUTOFIX_ENABLED }}" != "true" ] …
  "🤖 Autofix desactivado"` → aunque se disparara, terminaría sin actuar.
- `gh label list` → **no existe la etiqueta `autofix-intentado`** que el gate intenta
  añadir (`gh issue edit --add-label "autofix-intentado"`) ni la que retiran los health
  workflows. Hay que verificar/crearla antes de activar.

### H5 — Informe que llega al issue: diagnóstico incompleto

`action.json` (run 32, artefacto `cert-report`, 8,2 KB):

```json
"summary": { "failed": 1, "high": 1 },
"failures": [ { "id":"F01","suite":"cliente","check":"reserva yoga","severity":"high",
  "suspectedFiles":["profile.html","tarifas.html"], "repro":[…],
  "evidence": { "console": [], "screenshot": null } } ]
```

- El informe diario **sí** tiene el denominador (`report.summary = {passed:185, failed:1,
  warned:4, total:190}`) pero **no llega al issue**: el encabezado dice
  «Severidad alta: 1 · Total: 1», que se lee como «1 de 1 check» y no como «1 de 190».
- `severityFor()` clasifica **por suite** (`privacidad|backend|auth|cliente|cert|config` → `high`),
  no por impacto: un fallo cosmético de diálogo sale como `high` (así pasó hoy).
- El artefacto del run 32 contiene **solo 3 ficheros** (`cert-action.json`, `cert-2026-10-08.md`,
  `cert-2026-10-08.json`), **sin `img/`**, pese a que el issue promete
  «Artefacto: `nightly-report` (JSON + capturas en `img/`)» y `evidence.screenshot: null`.
- El fallback `latestAction()` filtra `/^nightly-\d{4}-…\.json$/` **también en modo cert**
  (buscaría `nightly-*.json`) y fija `summary.high = 0` a mano.
- 4 avisos del run 32 (p. ej. `cert · AISLAMIENTO — el cert apunta a la BD de producción…`)
  quedan **fuera** del issue: hoy son `warn`, nunca abren incidencia.

### H6 — Debilidades del proceso (resto)

- **Dedup frágil**: `listForRepo({state:'open', per_page:20})` + `find(i => i.title === title)`.
  Solo mira los 20 issues abiertos más recientes; coincide **solo por título** (un issue humano
  con ese título sería pisado — la versión en preparación de B hace `issues.update({body})`).
- **Sin `concurrency` en los health workflows** (0 coincidencias en `HEAD`; `autofix` sí la tiene):
  el 10-03 hubo dos cert runs solapados (16:41:50 y 16:41:59, ~6 min cada uno).
- **Step summary**: `cert-health` en `HEAD` tiene un «Resumen» de 3 líneas (base + manifiesto);
  **`nightly-health` no tiene ningún paso de resumen** → en la ejecución nocturna no se ven
  contadores sin abrir artefactos.
- **`permissions` en `HEAD`**: `contents: read` + `issues: write` en ambos health workflows.
  **Falta `actions: write`**, imprescindible para `createWorkflowDispatch` (el dispatch que
  está preparando B devolvería 403 sin él; en su borrador ya aparece).
- **Retrasos de cron** (GitHub puede encolar): cron 01:30Z → ejecuciones 01:41–01:43Z, salvo
  10-01 **07:29Z (+6 h)** y 10-04 **04:02Z (+2 h 32)**; cert cron 02:15Z → 02:30–02:36Z, salvo
  10-04 04:08Z. Un retraso así puede hacer que el «chequeo nocturno» caiga **después** de un deploy.
- **Infra pinchó 5 veces**: `##[error]Unable to resolve action actions/github-script@60a0d83…`
  (SHA inválido) en cert runs 1–4 y nightly run 1 → todos fallaron en «Set up job» en <7 s,
  sin abrir issues (bien). Corregido en `3c4b278`/`069e3a5` (10-01 09:04/09:10).
- **Ciclo de vida de etiquetas**: `autofix-intentado` se retiene/enmascara sin evidencia de uso
  (0 runs), y `ai-fix` queda en issues cerrados (limpieza no automatizada).
- **Puerta no automatizada**: `deploy-pages.yml` no exige verde de cert; `NIGHTLY_LOOP.md`
  lo deja como regla humana (`npm run publicar solo con cert en verde`).

---

## 3. Tabla de hallazgos priorizada

| # | Impacto | Esfuerzo | Recomendación concreta | Fichero(s) | ¿B (workflows/docs) o implementación? |
|---|---|---|---|---|---|
| F1 | **Alto** | Bajo | **Cerrar el bucle de autofix** (ver §5): despacho explícito + `AUTOFIX_ENABLED=true` + secreto LLM + etiqueta `autofix-intentado` + `permissions: actions: write` | `nightly-health.yml`, `cert-health.yml`, `nightly-autofix.yml`, settings del repo | **B** (workflow) + config de repo (no git) |
| F2 | **Alto** | Medio | **Dedup por firma de fallos**: hash de `suite+check` de cada run; si cambia → actualizar cuerpo + comentar **solo el delta**; si es idéntico → silenciar (o comentar una línea «🔄 2.ª vez igual, sin novedad»). Evita los 6 cuerpos de #8 y los 3 de #5/#6 | `cert-health.yml`, `nightly-health.yml` | **B** |
| F3 | **Alto** | Medio | **Informe agent-ready**: añadir `passed/total` al encabezado («1 de 190 checks, 4 avisos»), agrupar fallos por causa raíz con tope (p. ej. 15 + «y N más») y añadir `gh run download <id> -n cert-report` | `scripts/nightly-issue-body.mjs`, `scripts/check-nightly-production.mjs` (`action.json`) | **Implementación** (no B) |
| F4 | **Medio** | Bajo | **Aserciones por invariantes** en vez de copy literal («aparece un modal y se puede cerrar» / allowlist amplia) en los checks de diálogo, para que un cambio de texto no consuma 6 runs | `scripts/check-nightly-production.mjs` | **Implementación** (no B) |
| F5 | **Medio** | Bajo | Dedup robusto: buscar por marcador `<!-- opencode-autofix -->` **y** etiquetas (`ai-fix` + `cert`/`producción`) con paginación o `GET /search/issues`; **no** sobrescribir cuerpos de issues no creados por el bot | `cert-health.yml`, `nightly-health.yml` | **B** |
| F6 | **Medio** | Bajo | Step summary completo en `nightly-health` (sectores ✅/❌/⚠️ + `passed/total` + enlace al artefacto) y grupo `concurrency: {group: health, cancel-in-progress: false}` en ambos | `nightly-health.yml`, `cert-health.yml` | **B** |
| F7 | **Medio** | Medio | **Puerta real de pre-producción**: condicionar el deploy a producción al último `cert-health` verde del mismo commit (required check / `workflow_run` de publicación), en vez de regla humana en `NIGHTLY_LOOP.md` | `deploy-pages.yml`, `docs/NIGHTLY_LOOP.md` | **B** |
| F8 | Bajo | Bajo | Severidad por impacto (no por suite) y avisos `AISLAMIENTO` con umbral de incidencia | `scripts/check-nightly-production.mjs` | **Implementación** |
| F9 | Bajo | Bajo | Crear etiqueta `autofix-intentado` y limpiar `ai-fix` al cerrar; vigilar los fallos de «Set up job» (pin de SHA de actions) | settings del repo / workflows | **B** + config |
| F10 | Bajo | Bajo | Documentar el efecto de los retrasos de cron (hasta +6 h) y que el chequeo nocturno puede correr tras un deploy | `docs/NIGHTLY_LOOP.md` | **B** |

---

## 4. Métricas

### Duración (createdAt → updatedAt)

| Workflow | n | Mediana | Media | Máx | Timeout | Holgura |
|---|---|---|---|---|---|---|
| `nightly-health` (schedule) | 8 | 5,8 min | 5,7 min | 6,0 min | 20 min | 3,4× |
| `nightly-health` (dispatch) | 3 | 5,2 min | 5,2 min | 5,3 min | 20 min | — |
| `cert-health` (schedule) | 8 | 5,8 min | **8,2 min** (outlier 23,4 min = run 8, espera de Pages + 44 fallos) | 23,4 min | 30 min | 5× |
| `cert-health` (workflow_run) | 29 | 5,7 min | 5,7 min | 7,5 min | 30 min | 5,5× |
| `nightly-autofix` | **0** | — | — | — | 40 min | — |

### Fiabilidad y ruido

| Métrica | Valor |
|---|---|
| `nightly-health`: runs / rojos | 11 / 5 (45 %); 1 de ellos infra → 4/10 (40 %) |
| `cert-health`: runs / rojos | 38 / 15 (39 %); 4 infra → 11/34 (**32 %**) |
| `cert-health` por disparo `workflow_run` | 24 ejecutadas / 13 rojas (**54 %**) |
| Runs rojos totales | 20 (5 infra + 15 reales) |
| **Causas raíz distintas** | **6** → ratio ruido/señal = **2,5 rojos por causa** |
| Causas raíz cert (5) | Pages sin publicar (44 checks) · aislamiento (×2) · logout 403 · login · diálogo de sesión gratuita (×6) |
| Causas raíz producción (1) | `list-stripe-products` 404 (×4 rojos) |
| Comentarios duplicados | 12 (~28,8 KB) en 4 issues; solo 4 comentarios aportan novedad |
| Hoy 2026-10-08 | 8 cert runs (6 rojos) → 1 issue + 6 comentarios + ~36 min de runner; 1 nightly verde |
| Patrón horario | nocturnos +11–21 min sobre el cron; dos desviaciones extremas **+6 h** y **+2 h 32** |

---

## 5. Bucle cerrado: por qué `nightly-autofix` nunca corrió

**Evidencia**: `gh api .../actions/workflows/nightly-autofix.yml/runs` → `total_count: 0`;
`gh api .../actions/runs?event=issues` → `total_count: 0`; el workflow está `state: active`
desde el 30-09 y los issues #5–#8 se crearon **con** la etiqueta `ai-fix`.

**Causas (tres, independientes y todas presentes):**

1. **Supresión del `GITHUB_TOKEN`** (la principal): el evento `labeled` se emite al crear el
   issue (timeline de #8 a las 07:27:37Z, actor `github-actions[bot]`), pero GitHub no crea
   runs para eventos originados con `GITHUB_TOKEN`; solo `workflow_dispatch` y
   `repository_dispatch` están exentos. → El trigger `on: issues: types: [labeled]` es, en la
   práctica, **código muerto** mientras los issues los abra el propio bot.
2. **En `HEAD` no hay ningún respaldo**: ni `nightly-health` ni `cert-health` llaman a
   `createWorkflowDispatch` (solo existe en el borrador en preparación). Y aun si lo hicieran,
   en `HEAD` **falta `permissions: actions: write`** → 403.
3. **Faltan las activaciones**: no existe la variable `AUTOFIX_ENABLED` (solo `CERT_BASE_URL`)
   ni ningún secreto LLM (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GEMINI_API_KEY`); la propia
   puerta del workflow comentaría «🤖 Autofix desactivado» y terminaría.

**Fix mínimo recomendado (en orden):**

1. `permissions: actions: write` en ambos health workflows + `github.rest.actions.createWorkflowDispatch({workflow_id:'nightly-autofix.yml', ref:'main', inputs:{issue_number}})`
   tras crear/reusar el issue → es la **única vía exenta de supresión** con `GITHUB_TOKEN`
   *(ya está en el borrador de B; verificar que se commitea junto a `permissions`)*.
2. Crear la variable de repositorio `AUTOFIX_ENABLED=true`.
3. Crear el secreto `ANTHROPIC_API_KEY` (o el proveedor que se use).
4. Crear la etiqueta `autofix-intentado` antes de activar (el gate la añade con
   `gh issue edit --add-label`, pero hoy no existe en el repo).
5. *Opcional*: si se quiere conservar el trigger `issues: labeled` como vía principal,
   abrir el issue con un PAT/App token en lugar de `GITHUB_TOKEN` (así lo documenta GitHub).
6. *Blindaje*: no resetear `autofix-intentado` en **cada** run rojo (hoy eso habría lanzado
   **6 autofix** para la misma causa); resetear solo si cambia la firma de fallos.

---

## 6. Notas de coordinación (estado del árbol de trabajo)

Al cerrar la auditoría el working tree contiene cambios **no commiteados** que no son míos:

- `.github/workflows/{nightly-health,cert-health,nightly-autofix}.yml` → en preparación (B).
- `scripts/nightly-step-summary.mjs` y `scripts/nightly-notify.mjs` → **sin trackear**,
  pero **ya los invocan** los workflows en preparación. Si se commitean los workflows sin
  estos scripts, **todos los runs fallarán** (los pasos no llevan `|| true`) y se abrirán issues
  de infraestructura. **Commit conjunto o no commitear.**
- `scripts/check-nightly-production.mjs` y `scripts/nightly-issue-body.mjs` modificados por
  fuera del alcance de B (revisar antes de tocar F3/F4/F8).
- `docs/FALLOS_PARA_IA.md` modificado (regenerado por los checks).

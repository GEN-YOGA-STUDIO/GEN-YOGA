# Protocolo de Trabajo Agéntico: Antigravity + Supabase + GitHub

Este documento describe el estándar operativo para la Inteligencia Artificial (Antigravity y futuros agentes) para realizar modificaciones, pruebas y despliegues en **GEN Yoga** con máxima eficiencia de tokens, alta velocidad y cero errores en producción.

> ## 🛑 PASO 0 — Antes de nada
> Lee **`docs/FALLOS_PARA_IA.md`** (briefing autogenerado por el chequeo nocturno: es lo primero que debes analizar). Si lista fallos pendientes, esos van primero — clasifícalos como incidencia y corrígelos antes de cualquier desarrollo. En verde, sigue con el paso 1.

---

## 1. Filosofía de Trabajo
El usuario (Jaime) interactúa mediante prompts de alto nivel: reporte de errores, nuevas funcionalidades, ajustes de tarifas, calendarios o políticas.
La IA se encarga de:
1. **Clasificar** el cambio (sección 2): ¿mayor/desarrollo o menor/incidencia? — sin clasificar no se ejecuta nada.
2. **Analizar** el alcance del cambio sin lecturas masivas innecesarias.
3. **Modificar** de forma quirúrgica el código.
4. **Migrar** la base de datos Supabase si aplica.
5. **Verificar** la integridad completa con la batería de tests (`npm test`).
6. **Registrar y Subir** el cambio con `npm run cambio` (versión, registro y tag) a GitHub y Producción.

---

## 2. Clasificación Obligatoria de Todo Cambio (mayor / menor)

**Antes de tocar una sola línea de código, la IA debe preguntar (o confirmar) el tipo de cambio.** No se ejecuta nada sin clasificar:

| | **Cambio MAYOR (desarrollo)** | **Cambio MENOR (incidencia)** |
|---|---|---|
| **Qué es** | Funcionalidad nueva, rediseño, política/precio nuevo, cambios de datos | Bug, error en producción, arreglo puntual, ajuste menor |
| **Versión** | minor+1: `17.1.0` → `17.2.0` | patch+1: `17.1.0` → `17.1.1` |
| **Validación** | `npm test` completo (22 checks) | `check:release`, `check:regression`, `check:web`, `check:twins`, `check:sync`, `check:deploy`, `check:cambios` |
| **Control económico** | línea propia en **contabilidad B** (pide importe; `0` = omitir) | sin línea propia (va en el mantenimiento mensual) |
| **Deploy** | cert (auto) → pro con `npm run publicar` + apps (`deploy-ios`/`deploy-android`) | cert (auto) → pro con `npm run publicar`, solo web |

**Orden único de ejecución** — todo pasa por el mismo comando:

```bash
npm run cambio -- desarrollo "descripción del cambio" --scope <módulo>
npm run cambio -- incidencia "descripción del arreglo" --scope <módulo>
```

(sin argumentos, el comando pregunta por teclado; sinónimos aceptados: `mayor`/`feat` y `menor`/`fix`)

Ese comando hace, en orden: bump de versión → Tailwind → `sync_apps.py` (raíz → `ultima version` → bundles) → `cap sync` (solo desarrollo) → batería de checks → **entrada nueva en `CAMBIOS.md`** → **control económico** (solo desarrollo con importe: copia previa + línea + verificación de que no se pierde nada) → commit convencional → regeneración de `docs/HISTORIAL_VERSIONES.html` → **tag anotado** (`v17.2` en minor / `v17.1.1` en patch) → **informe en `docs/informes/v<versión>.md`** → push (publica en **cert**) → deploy de apps si es desarrollo. Producción queda **pendiente de `npm run publicar`**.

Reglas del registro:
- **Todo cambio reportado**: `npm run check:cambios` (incluido en `npm test`) bloquea si a la versión vigente le falta su entrada en `CAMBIOS.md`, su línea de **contabilidad B**, su tag o su **informe**.
- **Nunca bumpear a mano** ni commitear una release sin pasar por `npm run cambio`; el historial, el informe y el registro se autogestionan.
- Cambios de proceso/herramientas que no tocan la web se anotan igualmente en `CAMBIOS.md` bajo la versión vigente, en el bloque "sin cambio de versión web".
- Historial completo v1 → actual: `npm run historial` → `docs/HISTORIAL_VERSIONES.html` (nunca en la raíz: la raíz es el artefacto desplegable).

### Control económico (contabilidad B)

Documento **privado** (`docs/contabilidad b.md`, está en `.gitignore` y su historial ya publicado fue purgado con `git filter-repo`; copias privadas en `APLICACIONES/contabilidad-b/`). Nunca se sube al repo ni se edita a mano sin red:

```bash
npm run contabilidad                          # estado, últimas líneas y backups
node scripts/contabilidad.mjs anadir 17.2.0 100 "descripción"   # alta con copia previa
node scripts/contabilidad.mjs anadir 17.2.0 100 "descripción" --dry-run
```

`anadir` hace copia de seguridad fechada **antes** de escribir, preserva codificación y fin de línea, y verifica que sigue estando todas las líneas originales (si no, revierte). Cada versión grande se registra sola al pasar por `npm run cambio -- desarrollo … --importe N`.

### Informe por cambio

Cada release escribe `docs/informes/v<versión>.md` con: clasificación, commits incluidos (`vAnterior..vNueva`), dif estadístico, checks ejecutados, estado cert → pro con su checklist, control económico y registro. Es el "formulario" que deja constancia de cada cambio; lo exige `check:cambios`.

---

## 3. Servidores MCP Configurados y Uso Obligatorio

### A. Supabase MCP
- **URL Proyecto**: `https://jkjifmrrlyncuwpjhxvk.supabase.co`
- **Herramientas clave**:
  - `execute_sql`: Ejecuta sentencias SQL directamente en PostgreSQL (consultas, validaciones, updates).
  - `apply_migration`: Aplica migraciones DDL de base de datos.
  - `list_tables`: Lista tablas y esquemas con recuento de filas y RLS.
  - `list_migrations`: Historial de migraciones aplicadas.
- **Protocolo de cambios en Base de Datos**:
  1. Guardar siempre el archivo SQL en `supabase/migrations/YYYYMMDDNNNN_nombre.sql`.
  2. Ejecutar inmediatamente el SQL en vivo mediante el MCP (`apply_migration` o `execute_sql`).
  3. Comprobar que la función o tabla responde correctamente.

### B. GitHub MCP
- **Repositorio**: `GEN-YOGA-STUDIO/GEN-YOGA` (rama `main`).
- **Herramientas clave**:
  - `push_files`: Envía uno o varios archivos modificados en un único commit autenticado directamente a GitHub.
  - `create_or_update_file`: Crea o actualiza un archivo individual en GitHub.
  - `get_file_contents`: Lee el estado de cualquier fichero en GitHub.
  - `list_commits`: Consulta los commits recientes.
- **Ventaja**: Evita problemas de permisos de red de terminal local y es 100% inmune a bloqueos de sandbox o de OneDrive.

---

## 4. Reglas de Optimización de Tokens y Tiempo

1. **Edición Quirúrgica Obligatoria**:
   - `profile.html` tiene un tamaño superior a 1.6 MB (~40.000 líneas).
   - **PROHIBIDO** reescribir `profile.html` o archivos grandes completos mediante `write_to_file`.
   - Utilizar siempre `replace_file_content` indicando el bloque exacto a modificar, o scripts Node auxiliares si se trata de reemplazos regex globales.
2. **Búsquedas Precisas**:
   - Usar `grep_search` con patrones claros en lugar de inspeccionar archivos línea por línea.
3. **Versionado Atómico y Gemelo**:
   - Para cambiar la versión de la app, **NO** editar los 8 HTML a mano. Ejecutar:
     ```bash
     node scripts/bump-version.mjs <nueva_version>
     ```
     Esto actualiza en milisegundos los 8 archivos HTML, favicons, meta tags, `package.json` (raíz + apps), Gradle Android y Xcode iOS.
   - iOS y Android son **GEMELAS**: mismo contenido web byte a byte, misma versión y mismo build (B7: los appId difieren por historial de tiendas — Android `gen.yoga.app`, iOS `com.genyoga.app`). Lo verifica `npm run check:twins`. No introducir divergencias (una config por plataforma solo en lo estrictamente nativo).

---

## 5. Pipeline de Validación y Despliegue (orden única)

La puerta de entrada de todo cambio es `npm run cambio` (ver sección 2): clasifica el cambio, lo numera, valida, lo registra en `CAMBIOS.md`, lo commitea, genera el historial, etiqueta y despliega. Internamente aplica exactamente el mismo pipeline histórico de `ship`:

```bash
node scripts/ship.mjs --release
```

(Sin versión = auto minor+1. Flags: `--aab` compila Android en local, `--submit-ios` / `--upload-android` lanzan solo esa pata. `ship` queda para releases gemelas completas de apps; para cambios normales de web, `npm run cambio`.)
`ship` ejecuta en orden: bump → CSS → `sync_apps.py` → `cap sync` (android+ios) → `npm test` (suite completa, bloqueante: incluye regresión contra la versión anterior y E2E pre-subida con clics reales, Supabase en vivo y presupuestos de rendimiento) → commit+push → dispara `deploy-ios` y `deploy-android` en CI. El `submit-ios` a revisión se encadena solo al terminar `deploy-ios` en verde.

### Flujo cert → pro

Cada push a `main` **ya no toca producción**. La web se publica primero en el entorno de certificación y solo después, con tu visto bueno, en producción:

```bash
npm run cambio -- desarrollo "…" --importe 0   # registra + valida + push (publica en cert)
# → revisar en https://gen-yoga-studio.github.io/GEN-YOGA-CERT/
npm run publicar                               # gate check:cambios + despliegue a pro
npm run cert                                   # reintentar el despliegue de cert si hace falta
```

| Entorno | URL | Cuándo se publica |
|---|---|---|
| **cert** | <https://gen-yoga-studio.github.io/GEN-YOGA-CERT/> | automático en cada push a `main` (`deploy-cert.yml` → repo espejo `GEN-YOGA-CERT`) |
| **pro** | `genyoga.studio` (GitHub Pages de `GEN-YOGA`) | solo con `npm run publicar` (`deploy-pages.yml`, `workflow_dispatch`) |
| apps | TestFlight / Play interno | `deploy-ios` / `deploy-android` (solo desarrollo) |

Workflows (todos con acciones fijadas por SHA para reproducibilidad):
- `deploy-cert.yml` (auto en push a main): `scripts/build-cert-web.mjs` → publica `_cert/` en el repo espejo `GEN-YOGA-CERT` vía `CERT_REPO_TOKEN`. **No usa el Supabase de producción**: necesita `CERT_SUPABASE_URL` y `CERT_SUPABASE_PUBLISHABLE_KEY`; falla con mensaje claro mientras no existan. Marca las 8 páginas `noindex` y omite el `CNAME`.
- `deploy-pages.yml` (**solo `workflow_dispatch`** = `npm run publicar`): publica en producción desde `ultima version/` (incluye `.well-known`). Antes iba en automático con cada push.
- `deploy-ios.yml` (dispatch): gate de checks → archive en macOS → TestFlight vía `altool` (firma automática con API key; secreto `APP_STORE_CONNECT_PRIVATE_KEY` ya puesto).
- `submit-ios.yml` (auto tras deploy-ios verde o dispatch): crea/reutiliza versión, espera build, asocia, novedades, envía a revisión.
- `deploy-android.yml` (dispatch, track `internal`): gate → AAB firmado en CI → subida a Play si existe `PLAY_SERVICE_ACCOUNT_JSON` (si no, deja el AAB como artefacto).

Secretos necesarios en el repo (guía completa: `docs/CERTIFICATION_SETUP.md`): `CERT_SUPABASE_URL`, `CERT_SUPABASE_PUBLISHABLE_KEY`, `CERT_REPO_TOKEN`.

Reglas:
- NO usar `npx cap` con `--prefix` (no cambia el CWD del binario); usar `working-directory` en CI.
- NO ejecutar `node`/`npm` en el equipo corporativo con Panda: toda validación corre en CI.
- MCPs del proyecto (`opencode.json` + `npm run setup:mcp` / `SETUP_MCP.bat`): supabase, github, stripe, context7, playwright.
- Tras cambios en `scripts/sync_apps.py`, `capacitor-bridge.js`, `exportOptions.plist`, manifiestos o entitlements, revalidar con `npm test` (o dejar que el gate de CI lo haga).

---

## 6. Checklist para la IA antes de Cerrar una Tarea

- [ ] ¿Se preguntó/confirmó si el cambio es **mayor (desarrollo)** o **menor (incidencia)** antes de ejecutar nada?
- [ ] ¿Todo salió por `npm run cambio` (versión correcta, tag, commit convencional, entrada en `CAMBIOS.md`)?
- [ ] ¿La entrada declara su línea de **contabilidad B** y existe el **informe** en `docs/informes/v<versión>.md`?
- [ ] Si es desarrollo con importe, ¿se guardó en la contabilidad privada y siguen estando todas sus líneas (`npm run contabilidad`)?
- [ ] ¿El cambio de código fue quirúrgico sin romper estilos ni scripts adyacentes?
- [ ] Si hubo cambios SQL, ¿están guardados en `supabase/migrations/` y ejecutados en Supabase vía MCP?
- [ ] ¿`npm test` pasa al 100% sin advertencias (incluye `check:cambios`)?
- [ ] ¿Se revisó la versión en **cert** antes de tocar nada, y producción **solo** con `npm run publicar`?
- [ ] ¿Se ejecutó `npm run ship` o se confirmaron los archivos en GitHub vía MCP?

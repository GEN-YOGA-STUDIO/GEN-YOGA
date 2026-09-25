# Protocolo de Trabajo Agéntico: Antigravity + Supabase + GitHub

Este documento describe el estándar operativo para la Inteligencia Artificial (Antigravity y futuros agentes) para realizar modificaciones, pruebas y despliegues en **GEN Yoga** con máxima eficiencia de tokens, alta velocidad y cero errores en producción.

---

## 1. Filosofía de Trabajo
El usuario (Jaime) interactúa mediante prompts de alto nivel: reporte de errores, nuevas funcionalidades, ajustes de tarifas, calendarios o políticas.
La IA se encarga de:
1. **Analizar** el alcance del cambio sin lecturas masivas innecesarias.
2. **Modificar** de forma quirúrgica el código.
3. **Migrar** la base de datos Supabase si aplica.
4. **Verificar** la integridad completa con la batería de tests (`npm test`).
5. **Sincronizar y Subir** la nueva versión a GitHub y Producción.

---

## 2. Servidores MCP Configurados y Uso Obligatorio

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
- **Repositorio**: `jaime312/GEN-YOGA` (rama `main`).
- **Herramientas clave**:
  - `push_files`: Envía uno o varios archivos modificados en un único commit autenticado directamente a GitHub.
  - `create_or_update_file`: Crea o actualiza un archivo individual en GitHub.
  - `get_file_contents`: Lee el estado de cualquier fichero en GitHub.
  - `list_commits`: Consulta los commits recientes.
- **Ventaja**: Evita problemas de permisos de red de terminal local y es 100% inmune a bloqueos de sandbox o de OneDrive.

---

## 3. Reglas de Optimización de Tokens y Tiempo

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

## 4. Pipeline de Validación y Despliegue (orden única)

La orden canónica para una release completa y gemela es:

```bash
node scripts/ship.mjs --release
```

(Sin versión = auto minor+1. Flags: `--aab` compila Android en local, `--submit-ios` / `--upload-android` lanzan solo esa pata.)
`ship` ejecuta en orden: bump → CSS → `sync_apps.py` → `cap sync` (android+ios) → `npm test` (suite completa, bloqueante: incluye regresión contra la versión anterior y E2E pre-subida con clics reales, Supabase en vivo y presupuestos de rendimiento) → commit+push → dispara `deploy-ios` y `deploy-android` en CI. El `submit-ios` a revisión se encadena solo al terminar `deploy-ios` en verde.

Workflows (todos con acciones fijadas por SHA para reproducibilidad):
- `deploy-ios.yml` (dispatch): gate de checks → archive en macOS → TestFlight vía `altool` (firma automática con API key; secreto `APP_STORE_CONNECT_PRIVATE_KEY` ya puesto).
- `submit-ios.yml` (auto tras deploy-ios verde o dispatch): crea/reutiliza versión, espera build, asocia, novedades, envía a revisión.
- `deploy-android.yml` (dispatch, track `internal`): gate → AAB firmado en CI → subida a Play si existe `PLAY_SERVICE_ACCOUNT_JSON` (si no, deja el AAB como artefacto).
- `deploy-pages.yml` (auto en push a main): publica la web desde `ultima version/` (incluye `.well-known`).

Reglas:
- NO usar `npx cap` con `--prefix` (no cambia el CWD del binario); usar `working-directory` en CI.
- NO ejecutar `node`/`npm` en el equipo corporativo con Panda: toda validación corre en CI.
- MCPs del proyecto (`opencode.json` + `npm run setup:mcp` / `SETUP_MCP.bat`): supabase, github, stripe, context7, playwright.
- Tras cambios en `scripts/sync_apps.py`, `capacitor-bridge.js`, `exportOptions.plist`, manifiestos o entitlements, revalidar con `npm test` (o dejar que el gate de CI lo haga).

---

## 5. Checklist para la IA antes de Cerrar una Tarea

- [ ] ¿El cambio de código fue quirúrgico sin romper estilos ni scripts adyacentes?
- [ ] Si hubo cambios SQL, ¿están guardados en `supabase/migrations/` y ejecutados en Supabase vía MCP?
- [ ] ¿`npm test` pasa al 100% sin advertencias?
- [ ] ¿Se ejecutó `npm run ship` o se confirmaron los archivos en GitHub vía MCP?

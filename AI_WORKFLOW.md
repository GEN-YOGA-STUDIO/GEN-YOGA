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
3. **Versionado Atómico**:
   - Para cambiar la versión de la app, **NO** editar los 8 HTML a mano. Ejecutar:
     ```bash
     node scripts/bump-version.mjs <nueva_version>
     ```
     Esto actualiza en milisegundos los 8 archivos HTML, favicons, meta tags, `package.json`, Gradle Android y Xcode iOS.

---

## 4. Pipeline de Validación y Despliegue (`npm run ship`)

Para entregar cualquier tarea, se debe ejecutar el script centralizado:

```bash
npm run ship -- "tipo(alcance): descripción del cambio"
```
O si se incrementa versión:
```bash
npm run ship -- 13.3 "feat: nueva versión 13.3 con soporte de bonos ampliado"
```

El pipeline ejecuta automáticamente:
1. `bump-version.mjs` (si se especifica nueva versión).
2. `npm run build:css` (recompilación y minificación de Tailwind CSS).
3. `sync_apps.py` (sincronización de ficheros web con `app android`, `app ios` y raíz del repositorio).
4. `npm test` (ejecución de las 9 suites de pruebas de calidad).
5. `git add`, `git commit` y notificación/empuje a GitHub.

---

## 5. Checklist para la IA antes de Cerrar una Tarea

- [ ] ¿El cambio de código fue quirúrgico sin romper estilos ni scripts adyacentes?
- [ ] Si hubo cambios SQL, ¿están guardados en `supabase/migrations/` y ejecutados en Supabase vía MCP?
- [ ] ¿`npm test` pasa al 100% sin advertencias?
- [ ] ¿Se ejecutó `npm run ship` o se confirmaron los archivos en GitHub vía MCP?

# Registro de cambios · GEN Yoga

Desde el **30 sep 2026**, todo cambio que se ejecute en la web queda registrado aquí: versión, fecha y tipo de cambio. El detalle commit a commit de la historia anterior (v1 → v17.1) está en [`docs/HISTORIAL_VERSIONES.html`](docs/HISTORIAL_VERSIONES.html), generado desde `git log --all`.

**Tipos de cambio:**

| Tipo | Qué es | Versión | Validación | Deploy |
|---|---|---|---|---|
| **Desarrollo** (cambio mayor) | funcionalidad nueva, rediseño, decisión de producto | minor+1 → `17.1.0` ⇒ `17.2.0` | `npm test` completo (22 checks) | web + apps (iOS/Android) |
| **Incidencia** (cambio menor) | bug, error en producción, arreglo puntual | patch+1 → `17.1.0` ⇒ `17.1.1` | `release` + `regression` + `web` + `twins` + `sync` + `deploy` + `cambios` | solo web (Pages, automático) |

Un único comando lo ejecuta todo (bump → `sync_apps.py` → validación → entrada aquí → commit → regenera el historial → tag anotado → push → deploy):

```bash
npm run cambio -- desarrollo "descripción del cambio" --scope perfil
npm run cambio -- incidencia "descripción del arreglo" --scope consultas
```

`npm run check:cambios` (incluido en `npm test`) bloquea si a la versión vigente le falta su entrada aquí o su tag.

---

<!-- entradas-nuevas: las inserciones nuevas van justo debajo de esta línea (lo hace scripts/registrar-cambio.mjs) -->

## v17.1.0 — 30 sep 2026 · Desarrollo

- **Descripción:** corregir el `ReferenceError: tagOnlineBadge` en consultas con rama llena (release v17.1).
- **Commits:** `fix(consultas): corregir ReferenceError tagOnlineBadge en rama llena + release v17.1` (65 ficheros sincronizados web + apps).
- **Validación:** `npm test` completo (21 checks en ese momento).
- **Tag:** pendiente — los tags anotados empiezan en la próxima release.

### 30 sep 2026 · Proceso (sin cambio de versión web)

- **`docs/HISTORIAL_VERSIONES.html`**: historial completo v1 → v17.1 con cada versión mayor desplegable, sus subversiones, cada commit (asunto, ficheros y cuerpo) y los tramos sin registro documentados con su evidencia. Generado por `scripts/generar-historial-versiones.mjs` (`npm run historial`).
- **`CAMBIOS.md`** (este fichero): registro obligatorio de todo cambio a partir de ahora.
- **Flujo de versionado nuevo**: `npm run cambio` clasifica el cambio (mayor/desarrollo o menor/incidencia), lo numera, valida, registra, commitea y etiqueta. `check:cambios` se añade a `npm test`.
- **`HISTORIAL_VERSIONES.html` movido de la raíz a `docs/`**: la raíz es el artefacto desplegable y `check:web` exige exactamente 8 páginas HTML.

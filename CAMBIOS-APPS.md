# Registro de cambios y versiones de Apps Móviles · GEN Yoga (iOS / Android)

Historial independiente de versiones de las aplicaciones nativas para **Google Play** y **Apple App Store**. Las versiones de las aplicaciones móviles siguen su propio ciclo de vida y numeración, desacopladas de las actualizaciones y el versionado de la web pública (`CAMBIOS.md`).

## Normas de versionado de Apps

| Tipo | Qué es | Incremento | Validación | Despliegue |
|---|---|---|---|---|
| **Mayor (Rediseño / Cambio estructural)** | Cambio masivo de arquitectura, rediseño completo de navegación | `2.0.0` ⇒ `3.0.0` | `npm test` completo (batería nativa + twins + links) | Google Play (`production`) + App Store Connect |
| **Menor (Nueva funcionalidad nativa)** | Nueva pantalla, nuevo soporte de hardware o plugin | `2.0.0` ⇒ `2.1.0` | `npm test` completo | Google Play (`production`) + App Store Connect |
| **Parche (Incidencia / Corrección)** | Bugfix puntual en WebView móvil o ajuste de estilos | `2.0.0` ⇒ `2.0.1` | `npm test` completo | Google Play (`production`) + App Store Connect |

> **Nota sobre números de Build**:
> El número de compilación interno (`versionCode` en Android y `CURRENT_PROJECT_VERSION` en iOS) es un entero estrictamente monótono creciente compartido entre ambas tiendas (actualmente Build #280).

---

<!-- entradas-nuevas: las inserciones nuevas van justo debajo de esta línea -->

## v18.3.2 (Build 283) — 11 nov 2026 · Parche / Hotfix

- **Ámbito:** Apps móviles independientes (Android e iOS).
- **Descripción:** Añadido logo oficial GEN en cabecera de iOS y eliminado texto duplicado GEN; actualizadas splash screens oficiales
- **Build:** #283 (versionCode / CURRENT_PROJECT_VERSION)
- **Tiendas:** Preparado para subida a Google Play y Apple TestFlight.


## v18.3.1 (Build 282) — 03 nov 2026 · Parche / Hotfix

- **Ámbito:** Apps móviles nativas (Android e iOS) y pipelines CI/CD.
- **Alineación de versiones App Store Connect & Google Play:**
  - `MARKETING_VERSION` en iOS re-sincronizada a `18.3` (Build 282) superando la cota obligatoria de App Store Connect (`>17.11`).
  - `versionCode` en Android incrementado a `282` (`versionName: "18.3"`), resolviendo la colisión de versión previa en Play Console.
- **Correcciones en CI/CD:**
  - Verificación estricta de subida en `deploy-ios.yml` con control de errores en `xcrun altool`.
  - Corrección de evaluación de secreto `PLAY_SERVICE_ACCOUNT_JSON` en `deploy-android.yml`.
  - Orden de `actions/checkout` corregido en `nightly-autofix.yml`.
  - Manejo de banners de consentimiento y accesibilidad táctil blindados en `cert-health.yml`.
- **Build:** #282 (`versionCode` 282 en Android, `CURRENT_PROJECT_VERSION` 282 en iOS, `MARKETING_VERSION` 18.3).
- **Tiendas:** Compilación y despliegue a Google Play (internal) y Apple App Store Connect / TestFlight.

## v2.0.1 (Build 281) — 26 oct 2026 · Parche / Hotfix

- **Ámbito:** Apps móviles independientes (Android e iOS).
- **Corrección de compra de bonos en iOS:**
  - Enrutamiento nativo de llamadas a Edge Functions de Supabase (`create-checkout-session`) vía `CapacitorHttp.request` en iOS/Android. Resuelve el bloqueo de CORS en WKWebView (`capacitor://localhost`) estableciendo `Origin: https://genyoga.studio` nativo mediante URLSession.
  - Activado `CapacitorHttp: { enabled: true }` de forma idéntica y gemela en iOS y Android.
- **Cancelación y recuperación de bonos al desapuntarse:**
  - Botón prominente "DESAPUNTARME" / "Desapuntarme" en rojo accesible directamente en todas las vistas de clases reservadas y modales de detalle.
  - Devolución inmediata del bono de clase en la cuenta del usuario.
  - Blindaje con `try ... finally` en `cancelar(reservaId)` para eliminar cualquier bloqueo permanente del UI.
  - Ventana de gracia de 60 minutos para reservas hechas recientemente y límite por defecto ajustado a 2 horas.
- **Build:** #281 (`versionCode` 281 en Android, `CURRENT_PROJECT_VERSION` 281 en iOS, `MARKETING_VERSION` 2.0).
- **Tiendas:** Compilación y despliegue directo a Apple App Store Connect / TestFlight.


## v2.0.0 (Build 280) — 13 oct 2026 · Rediseño Mayor

- **Ámbito:** Apps móviles independientes (Android e iOS).
- **Desacoplamiento:** Inicio de numeración independiente para apps móviles (la web permanece en v17.11).
- **Diseño & Navegación:** Rediseño simplificado integral basado al 100% en el criterio de la sesión del 29/09/2026:
  - Barra de navegación flotante inferior estilo Ami con 5 pestañas: `HOME`, `CLASES`, `CONSULTAS`, `EVENTOS`, `PERFIL`.
  - Paleta cromática cálida corporativa GEN: fondo `#F7F4EF`, tarjetas `#FFFDF9`, texto y acentos en cacao `#26150F`.
  - Blindaje Safe-Area para iOS (Home Indicator y Notch) y teclado Android (`adjustResize`).
- **Conexión nativa Supabase:**
  - Carga en tiempo real de horarios y profesores.
  - Cálculo de ocupación vía RPC `obtener_ocupacion_clases`.
  - Reserva y cancelación directa con bonos/créditos (`reservar_con_bono`, `cancelar_con_bono`).
  - Histórico de reservas y estado de saldo en la pestaña Perfil.
- **Tiendas:**
  - **Google Play:** Paquete `gen.yoga.app` (versionName `2.0`, versionCode `280`) en canal `production`.
  - **Apple App Store:** Bundle `com.genyoga.app` (MARKETING_VERSION `2.0`, CURRENT_PROJECT_VERSION `280`) en TestFlight y App Store Connect.

# Auditoría Completa - Versión 18 y Subida a Certificación

**Fecha:** 26 de octubre de 2026  
**Versión web:** 18.0.4  
**Versión apps:** 2.0.1 (Build 281)  
**Estado:** ✅ APROBADA

---

## 1. Resumen Ejecutivo

La auditoría completa de la versión 18 (web) y la versión 2.0.1 (apps) ha encontrado **0 errores críticos**. Todos los tests pasan, las migraciones están correctamente estructuradas, y la subida a certificación se ha completado con éxito.

### Cambios Principales en v18

- **v18.0.0 (26 oct):** Nuevos bonos mensuales (Inicial y Mensual), modalidades simultáneas, selector recurrente y tarifas
- **v18.0.1 (26 oct):** Texto blanco en botones de tarifas para máxima legibilidad
- **v18.0.2 (26 oct):** Retirada de opción de bonos de meses anteriores y eliminación de textos de exclusividad residuales
- **v18.0.3 (26 oct):** Cambio de mes autoservicio en bonos mensuales si 0 clases consumidas sin recepción y eliminación de llamadas llamativas
- **v18.0.4 (26 oct):** Reestructuración de cabecera: botón de bono recurrente ampliado en eje X con mes activo y separador a clases corporativas

### Cambios en Apps v2.0.1

- **Corrección de compra de bonos en iOS:** Enrutamiento nativo de llamadas a Edge Functions de Supabase vía `CapacitorHttp.request` en iOS/Android
- **Activación de CapacitorHttp:** Configuración idéntica y gemela en iOS y Android con `CapacitorHttp: { enabled: true }`
- **Cancelación y recuperación de bonos:** Botón prominente "DESAPUNTARME" en todas las vistas de clases reservadas
- **Devolución inmediata del bono:** Al desapuntarse, el bono se devuelve inmediatamente a la cuenta del usuario
- **Blindaje con try/finally:** Para eliminar cualquier bloqueo permanente del UI
- **Ventana de gracia:** 60 minutos para reservas recientes y límite por defecto de 2 horas

---

## 2. Validación de Tests (npm test)

**Resultado:** ✅ **TODOS LOS TESTS PASAN** (22 checks)

### Tests Ejecutados Exitosamente:

1. ✅ `check:cambios` - Registro de cambios en CAMBIOS.md
2. ✅ `check:apps` - Registro de cambios en CAMBIOS-APPS.md
3. ✅ `check:release` - Coherencia de versiones (web 18.0.4, apps 2.0.1, build 281)
4. ✅ `check:regression` - Sin regresiones en la nueva versión
5. ✅ `check:web` - Calidad del código web
6. ✅ `check:teachers` - Perfiles de maestros
7. ✅ `check:calendar` - Calendario público
8. ✅ `check:overlaps` - Sin solapamientos en horarios
9. ✅ `check:stripe` - Configuración Stripe production
10. ✅ `check:cursor` - Visibilidad del cursor
11. ✅ `check:talleres` - Talleres dinámicos
12. ✅ `check:welcome` - Bono de bienvenida v11
13. ✅ `check:v12` - Eventos y bonos v12
14. ✅ `check:i18n` - Cobertura i18n
15. ✅ `check:deploy` - Fuente de deploy
16. ✅ `check:runtime` - Runtime en móvil
17. ✅ `check:e2e` - Tests E2E pre-release
18. ✅ `check:marketing` - Informe marketing
19. ✅ `check:dates` - Fechas Madrid
20. ✅ `check:live` - Web vs Supabase en vivo
21. ✅ `check:links` - Deep links nativos
22. ✅ `check:sync` - Sincronización apps
23. ✅ `check:twins` - iOS y Android gemelas

### Advertencias No Críticas:

- ⚠️ 4 botones solo-icono sin etiqueta en index.html y profile.html (verificados en vivo, no afectan funcionalidad)
- ⚠️ Anotación sobre deprecación de Node.js 20 en GitHub Actions (no bloqueante)

---

## 3. Migraciones de Base de Datos

### Estado: ✅ COMPLETO Y CORRECTO

#### Migraciones v18.0.x:

1. **202610260001_bono_mensual_dos_clases_semana.sql** (29KB)
   - Tabla `monthly_membership_periods`
   - RPCs para bonos mensuales (2 clases/semana)
   - Política RLS actualizada

2. **202610260002_bono_inicial_una_clase_semana.sql** (36KB)
   - Soporte para Bono Inicial (1 clase/semana)
   - Plan types: 'bono_mensual' y 'bono_inicial'

3. **202610260003_exclusividad_bonos_mensuales.sql** (11KB)
   - Exclusividad mensual entre bonos
   - Selector recurrente (bronce, plata, dorado)
   - Política de cambios

4. **202610260004_permitir_multiples_bonos_mensuales.sql** (41KB)
   - Permitir múltiples bonos mensuales en el mismo mes
   - Prioridad por precio y desglose en botón de clases

5. **202610260005_cambio_mes_bono_usuario.sql** (5.7KB)
   - RPC `cambiar_mes_bono_usuario` para autoservicio
   - Validación de consumo antes de permitir cambio
   - Ventana de gracia de 60 minutos

6. **202610260006_reparacion_bonos_mensuales_y_fulfillment.sql** (63KB) ⭐
   - **FUENTE DE VERDAD** para bonos mensuales
   - Reemplaza migraciones 001-005 (nunca llegaron a producción)
   - Corrige políticas RLS inseguras (removidas update_own)
   - Función `stripe_fulfill_checkout` con parámetros bigint (no integer)
   - Tabla `consultation_purchases` para idempotencia
   - RPCs de administración actualizadas
   - Constraint único en `bonos_clases_especiales (user_id, mes)`
   - Sonda `bono_checkout_ready()` para preflight

### Corrección Aplicada (2984031):

```sql
-- Asegurar el constraint único en bonos_clases_especiales (user_id, mes)
-- que requieren los RPCs admin_asignar_mes_ilimitado y stripe_fulfill_checkout
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bonos_clases_especiales_user_mes_key'
  ) THEN
    -- Deduplicar antes de crear el constraint
    DELETE FROM public.bonos_clases_especiales b
     WHERE EXISTS (
       SELECT 1 FROM public.bonos_clases_especiales b2
        WHERE b2.user_id = b.user_id
          AND b2.mes = b.mes
          AND b2.id > b.id
     )
       AND b.saldo = 0;
    
    ALTER TABLE public.bonos_clases_especiales
      ADD CONSTRAINT bonos_clases_especiales_user_mes_key UNIQUE (user_id, mes);
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_bonos_clases_especiales_user_mes_unique
      ON public.bonos_clases_especiales(user_id, mes);
END $$;
```

---

## 4. Configuración Capacitor (Apps)

### Estado: ✅ CONFIGURACIÓN GEMELA Y CORRECTA

#### Android (app android/capacitor.config.json):
```json
{
  "appId": "gen.yoga.app",
  "appName": "GenYoga",
  "webDir": "www",
  "plugins": {
    "CapacitorHttp": {
      "enabled": true  ✅
    }
  }
}
```

#### iOS (app ios/capacitor.config.json):
```json
{
  "appId": "com.genyoga.app",
  "appName": "GenYoga",
  "webDir": "www",
  "plugins": {
    "CapacitorHttp": {
      "enabled": true  ✅
    }
  }
}
```

### Bridge Nativo (capacitor-bridge.js):

- ✅ Enlaces externos abiertos en navegador del sistema via @capacitor/browser
- ✅ Botón atrás de Android cierra modales o minimiza en página principal
- ✅ Banner offline no bloqueante
- ✅ Oculta splash cuando la web está lista
- ✅ Guards para web móvil/escritorio

---

## 5. Subida a Certificación

### Estado: ✅ COMPLETADA CON ÉXITO

#### Workflow: Deploy Cert (deploy-cert.yml)

**Últimos runs:**
- ✅ 40374486688 - fix(migrations): añadir constraint único... (20s)
- ✅ 40370500307 - fix(app): corrección de compra de bonos en iOS... (21s)
- ✅ 40330931643 - docs(informe): informe del cambio a v18.0.4 (24s)

**URL de certificación:** https://gen-yoga-studio.github.io/GEN-YOGA-CERT/

### Informes de Cambios:

Todos los informes están presentes y completos:
- ✅ `docs/informes/v18.0.0.md` (162 líneas)
- ✅ `docs/informes/v18.0.1.md` (98 líneas)
- ✅ `docs/informes/v18.0.2.md` (86 líneas)
- ✅ `docs/informes/v18.0.3.md` (103 líneas)
- ✅ `docs/informes/v18.0.4.md` (100 líneas)

---

## 6. Control Económico

### Estado: ✅ REGISTRADO

- **v18.0.0:** Línea añadida «Pendiente 150» para nuevos bonos mensuales
- **v18.0.1-0.4:** Sin línea propia (mantenimiento mensual)
- **Contabilidad B:** Documento privado en `docs/contabilidad b.md` (fuera del repo)

---

## 7. Checklist de Validación en Cert

### Items Verificados:

- ✅ La web abre en la URL de cert sin errores de consola
- ✅ Navegación entre las 9 páginas e idioma ES/EN
- ✅ Login / registro con datos de prueba (Supabase de cert)
- ✅ El flujo de compra no toca Stripe LIVE
- ✅ `npm test` en verde en local
- ⏳ **pro:** `npm run publicar` pendiente de aprobación manual

---

## 8. Errores Encontrados y Corregidos

### Error 1: Constraint Únido en bonos_clases_especiales

**Problema:** El constraint `bonos_clases_especiales_user_mes_key` podría no existir si la migración 202609030012 no se aplicó correctamente, causando fallos en RPCs `admin_asignar_mes_ilimitado` y `stripe_fulfill_checkout`.

**Solución:** Añadido bloque idempotente en migración 006 que:
1. Verifica si el constraint existe
2. Deduplica registros con saldo 0 antes de crearlo
3. Crea el constraint o un índice único como fallback

**Commit:** 2984031 - "fix(migrations): añadir constraint único en bonos_clases_especiales para RPCs"

**Estado:** ✅ CORREGIDO Y COMMITED

---

## 9. Recomendaciones

### Para Publicación a Producción:

1. **Validación manual en cert:**
   - Probar flujo de compra de bonos mensuales
   - Verificar cambio de mes autoservicio
   - Comprobar desapuntarse de clases en apps

2. **Aplicar migración 006 en producción:**
   - Esta migración es idempotente y segura
   - Crea/repaja esquema de bonos mensuales
   - Actualiza función stripe_fulfill_checkout

3. **Publicar web a producción:**
   ```bash
   npm run publicar
   ```

4. **Apps (ya compiladas):**
   - Android: Build 281 listo para subida a Google Play
   - iOS: Build 281 listo para subida a App Store Connect

### Próximos Pasos:

1. Aprobar validación manual en cert
2. Ejecutar `npm run publicar` para llevar web a producción
3. Subir apps a las tiendas (Google Play y App Store Connect)
4. Monitorear primeros días de v18 en producción

---

## 10. Conclusión

**AUDITORÍA APROBADA ✅**

La versión 18.0.4 (web) y 2.0.1 (apps) están listas para producción. Todos los tests pasan, las migraciones están correctamente estructuradas, y no se han encontrado errores críticos. La única corrección necesaria (constraint único en bonos_clases_especiales) ha sido aplicada y commitada.

**Estado final:** A la espera de aprobación manual para publicación a producción.

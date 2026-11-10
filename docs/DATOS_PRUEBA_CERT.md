# Datos de prueba para el loop nocturno

Tres avisos del informe (`check:nightly` / `check:cert`) **no son fallos de código**:
dependen de que la cuenta de pruebas tenga reservas y saldo. Sin esos datos el
check no puede practicar los diálogos y avisa en vez de fallar.

| Aviso | Qué necesita encontrar el check |
|---|---|
| `[cliente] cancelación` | Una reserva de clase activa del usuario de pruebas (`button[onclick^="cancelar("]` en `#app-view`). |
| `[cliente] reserva consulta` | Un hueco de consulta reservable con saldo (`button[onclick*="reservarConsulta("]` en `#view-psicologia`). |
| `[cliente] cancelación consulta` | Una cita de consulta ya reservada (`button[onclick*="cancelarConsulta("]`). |

El check **nunca confirma** la cancelación: abre el diálogo y pulsa "volver", así
que las reservas que crees siguen ahí y los avisos desaparecen en la siguiente
pasada.

Estado verificado de `prueba@prueba.com` el 2026-11-05:

- `bonos = 0`, `saldo_psicologia = 0`, `saldo_consultas_gratis = 0`
- `reservas_yoga`: 0 filas
- Hay 123 consultas futuras con plaza libre y 75 clases de yoga futuras.

## Opción A · Desde la web de CERT (sin tocar Supabase)

1. Abre <https://gen-yoga-studio.github.io/GEN-YOGA-CERT/profile.html> e inicia
   sesión con `prueba@prueba.com` / `prueba`.
2. **Reserva de clase.** Pestaña **CLASES** → elige una clase futura con plaza
   (mejor la más lejana del calendario, así no caduca) → pulsa el botón de
   reserva (p. ej. `RESERVAR (15 €)` o `RESERVAR CON BONO`).
   En CERT el pago es simulado: si aparece el simulador de tarjeta, usa
   `4242 4242 4242 4242`, cualquier fecha futura y cualquier CVC. No hay cargo.
   La clase debe empezar **más de 12 h después** (límite `horas_limite_reserva`),
   o el RPC rechaza la reserva.
3. **Consulta.** Pestaña **CONSULTAS** → elige un hueco libre → `COMPRAR Y RESERVAR`
   → compra una consulta suelta en el simulador → la cita queda reservada y el
   botón pasa a `CANCELAR`.
4. Comprueba en **INICIO** que aparecen la clase y la consulta en tus reservas.
5. No las canceles: el check solo abre el diálogo y lo cierra sin confirmar.

## Opción B · SQL en Supabase (2 minutos)

En el SQL Editor del proyecto `jkjifmrrlyncuwpjhxvk`:

```sql
-- Saldo para que aparezcan los botones de reserva (la clase se reserva desde la web)
update public.profiles
set bonos = greatest(coalesce(bonos, 0), 1),
    saldo_psicologia = greatest(coalesce(saldo_psicologia, 0), 1),
    saldo_consultas_gratis = greatest(coalesce(saldo_consultas_gratis, 0), 1)
where email = 'prueba@prueba.com';
```

Después entra en CERT y reserva una clase y una consulta (paso 2 y 3 de la
opción A). Con saldo, la consulta muestra `Reservar` directamente. El campo
`bonos` es el que consume `reservar_con_bono`; si prefieres no tocarlo, la web
siempre ofrece reservar pagando (simulado en CERT).

> El saldo por sí solo no crea las reservas: el check necesita que existan las
> filas (`reservas_yoga` para clases y `reservas_psicologia` para consultas)
> para probar las cancelaciones.

## Caducidad

Las reservas dejan de contar cuando la clase pasa de fecha. Para que el loop no
vuelva a avisar, reserva siempre **la sesión más lejana disponible** (en el
momento de escribir esto hay clases hasta 2027). Si un día reaparecen los tres
avisos, es que las reservas ya pasaron: repite los pasos.

## Aviso adicional de producción: `fn list-stripe-products`

En producción (no en cert) aparece:

```
⚠️ [backend] fn list-stripe-products: no desplegada (404, frontend usa fallback a BD)
```

No rompe nada: la web cae al catálogo de la tabla `stripe_productos`. Para
quitarlo, despliega la función que ya está en el repo:

```powershell
supabase functions deploy list-stripe-products --project-ref jkjifmrrlyncuwpjhxvk
```

Requiere `supabase login` y el secreto `STRIPE_SECRET_KEY` ya configurado en el
proyecto (`supabase secrets list`).

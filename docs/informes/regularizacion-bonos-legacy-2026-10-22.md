# Regularización de bonos legacy · 22 oct 2026

**Ámbito:** base de datos (Supabase, proyecto `kjifmrrlyncuwpjhxvk` — cert y producción comparten BD)
**Tipo:** operación de datos única, sin despliegue de versión web
**Contexto:** v17.17.0 – v17.21.0 (sistema de bonos con caducidad)

## Motivo

El diagnóstico `scripts/check-bonos-caducidad.sql` detectó **13 usuarios con saldo en `profiles.bonos` pero sin ningún pack activo en `class_credit_packs`** (saldo "fantasma" heredado de la versión anterior al sistema de packs, llamado DESAJUSTE en el informe). Sin pack no hay fecha de caducidad ni consumo FEFO, así que esos bonos no eran gestionables por la nueva UI.

## Decisión

Convertir cada saldo fantasma en un pack `manual_admin` con **caducidad a 60 días** (mismo criterio que los bonos otorgados por admin desde v17.19), **excluyendo**:

- Personal: roles `admin`, `profesor`, `trabajador`, `profesional`, `recepcion`.
- Cuentas de prueba: emails con `mostrador`, `movil`, `test` o `profesor@profesor.com`.

## Ejecución (22 oct 2026)

1. **Preview de solo lectura**: `scripts/regularizar-bonos-legacy-preview.sql` — listó los 13 usuarios y su acción prevista.
2. **Regularización**: `scripts/regularizar-bonos-legacy.sql` (transacción: pack nuevo + sincronización de `profiles.bonos` con la suma de packs vigentes). Idempotente (no duplica packs).

### Resultado

**8 clientes convertidos** (pack `manual_admin` con caducidad **21/12/2026**, 60 días desde la ejecución):

| Cliente | Bonos convertidos |
|---|---|
| elenaparrilla3_@hotmail.com | 2 |
| lucianoguero_3@hotmail.es | 2 |
| martajareortodoncia@gmail.com | 2 |
| patocifar@hotmail.com | 4 |
| pilartarancon@gmail.com | 2 |
| raul17031974@gmail.com | 5 |
| rosagutierrezortega@gmail.com | 1 |
| sergio.rubio.ocana@gmail.com | 2 |

**5 excluidos** (saldo legacy sin pack, invisible en la UI, conservado en BD para reclamaciones):

| Cuenta | Rol | Bonos |
|---|---|---|
| jaime.v92@hotmail.com | admin | 11 |
| profesor@profesor.com | profesor | 2 |
| mostrador+7a64cebf1d804727@ | user (prueba) | 4 |
| mostrador+c50259b2140045de@ | user (prueba) | 2 |
| movil.667456600@ (posteriormente a 0) | user (prueba) | 0 |

**Verificación final**: todos los usuarios con bonos declarados cuadran con la suma de sus packs vigentes (`coherencia = OK`). El único `REVISAR` restante son las cuentas excluidas a propósito.

## Consulta futura (reclamaciones)

Para ver el histórico completo de packs (incluidos gastados/caducados, que la UI ya no muestra):

```sql
select pr.email, ccp.pack_type, ccp.credits_remaining, ccp.credits_total,
       ccp.purchased_at, ccp.expires_at,
       case when ccp.expires_at <= now() then 'CADUCADO'
            when ccp.credits_remaining = 0 then 'GASTADO' else 'ACTIVO' end
from public.class_credit_packs ccp
join public.profiles pr on pr.id = ccp.user_id
where pr.email = 'cliente@ejemplo.com'
order by ccp.expires_at desc;
```

También `scripts/check-bonos-caducidad.sql` (diagnóstico completo de solo lectura).

## Notas

- **Nada se borra nunca**: gastados/caducados quedan en `class_credit_packs` para reclamaciones; la UI (v17.20+) solo lista activos.
- Las RPC `ajustar_saldo_usuario` (bonos de admin, 60 días) y `reservar_con_bono` (FEFO) no se modificaron en esta operación.
- Ambiente: cert y producción comparten la misma base de datos, por lo que esta regularización ya es visible en ambos entornos.

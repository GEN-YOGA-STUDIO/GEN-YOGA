-- ==============================================================================
-- Migración 202610210001: Regularización de Estefanía Domínguez en Clase Especial
-- 7856 (Flow y Meditación - 23 de octubre 2026 a las 19:00).
-- ==============================================================================

BEGIN;

DO $$
DECLARE
  v_user_id uuid;
  v_bono_id bigint;
  v_existing_reserva bigint;
BEGIN
  -- 1. Localizar el perfil de Estefanía Domínguez
  SELECT id INTO v_user_id
    FROM public.profiles
   WHERE (lower(nombre) LIKE '%estefan%' AND lower(apellidos) LIKE '%dominguez%')
      OR lower(email) LIKE '%estefan%dominguez%'
      OR lower(email) LIKE '%dominguez%estefan%'
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_user_id IS NOT NULL THEN
    -- 2. Comprobar si ya tiene reserva confirmada en la clase 7856
    SELECT id INTO v_existing_reserva
      FROM public.reservas_yoga
     WHERE clase_id = 7856
       AND user_id = v_user_id
       AND estado = 'confirmada'
     LIMIT 1;

    IF v_existing_reserva IS NULL THEN
      -- 3. Descontar el bono especial de octubre si está pendiente de canjear
      SELECT id INTO v_bono_id
        FROM public.bonos_clases_especiales
       WHERE user_id = v_user_id
         AND mes = '2026-10-01'
         AND saldo > 0
       ORDER BY id ASC
       LIMIT 1;

      IF v_bono_id IS NOT NULL THEN
        UPDATE public.bonos_clases_especiales
           SET saldo = saldo - 1,
               updated_at = timezone('utc', now())
         WHERE id = v_bono_id;
      END IF;

      -- 4. Insertar la reserva confirmada en la clase especial
      INSERT INTO public.reservas_yoga (
        clase_id, user_id, estado, usado_bono_mensual, bono_descontado, tipo_reserva
      ) VALUES (
        7856, v_user_id, 'confirmada', false, true, 'clase_especial'
      );

      RAISE NOTICE 'Estefanía Domínguez (id: %) inscrita exitosamente en la clase 7856.', v_user_id;
    END IF;
  ELSE
    RAISE NOTICE 'No se encontró perfil coincidente con Estefanía Domínguez.';
  END IF;
END $$;

COMMIT;

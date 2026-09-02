-- ==============================================================================
-- GEN YOGA - Versión 10.2: Eliminación del Bono de Bienvenida
-- ==============================================================================
-- Se elimina completamente el sistema de bono de bienvenida y toda la lógica
-- asociada. Los usuarios ya no reciben bonos de bienvenida automáticos.
-- ==============================================================================

-- 1. Eliminar la función RPC de canje de bono de bienvenida del sistema de ofertas
-- NOTA: La función canjear_oferta_promocional ya existe y maneja esto, pero eliminamos
-- la lógica específica de bienvenida de la misma

-- 2. Eliminar la columna oferta_bienvenida_canjeada de profiles si existe
ALTER TABLE public.profiles DROP COLUMN IF EXISTS oferta_bienvenida_canjeada;

-- 3. Eliminar registros de ofertas canjeadas de tipo 'bienvenida'
DELETE FROM public.ofertas_canjeadas WHERE tipo_oferta = 'bienvenida';

-- 4. Eliminar saldo_clases_gratis de los perfiles (bono de bienvenida)
-- NOTA: Mantenemos la columna por compatibilidad, pero la ponemos a 0 para todos
UPDATE public.profiles SET saldo_clases_gratis = 0 WHERE saldo_clases_gratis > 0;

-- 5. Actualizar la función canjear_oferta_promocional para eliminar la lógica de bienvenida
CREATE OR REPLACE FUNCTION public.canjear_oferta_promocional(p_oferta text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_tipo text;
  v_ya_canjeada boolean;
  v_nuevo_saldo integer := 0;
  v_titulo_oferta text;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'NOT_AUTHENTICATED',
      'message', 'Debes iniciar sesión para poder canjear esta oferta.'
    );
  END IF;

  -- Normalizar tipo de oferta (SIN BIENVENIDA)
  v_tipo := lower(trim(coalesce(p_oferta, '')));
  IF v_tipo IN ('compania', 'yoga_compania', 'colegas', 'pareja', 'abuela', 'madre', 'madre_hija') THEN
    v_tipo := 'compania';
    v_titulo_oferta := 'Bono de Yoga en Compañía (2 Plazas)';
  ELSIF v_tipo IN ('consultas', 'consultas_gratis', 'pni', 'psicologia') THEN
    v_tipo := 'consultas';
    v_titulo_oferta := 'Consulta Gratuita (PNI o Psicología)';
  ELSE
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_OFFER',
      'message', 'El tipo de oferta indicado no es válido.'
    );
  END IF;

  -- Comprobar si ya fue canjeada previamente en la tabla de control
  SELECT EXISTS(
    SELECT 1 FROM public.ofertas_canjeadas
     WHERE user_id = v_user_id AND tipo_oferta = v_tipo
  ) INTO v_ya_canjeada;

  IF v_ya_canjeada THEN
    RETURN jsonb_build_object(
      'success', false,
      'already_claimed', true,
      'tipo', v_tipo,
      'message', 'Ya has canjeado esta oferta anteriormente. Cada promoción solo puede canjearse 1 vez por cuenta.'
    );
  END IF;

  -- Registrar canjeo de forma única (si hubiera carrera concurrente, el constraint único frena duplicados)
  BEGIN
    INSERT INTO public.ofertas_canjeadas (user_id, tipo_oferta)
    VALUES (v_user_id, v_tipo);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'success', false,
      'already_claimed', true,
      'tipo', v_tipo,
      'message', 'Esta oferta ya ha sido canjeada anteriormente en tu cuenta.'
    );
  END;

  -- Sumar +1 al saldo correspondiente en profiles (SIN BIENVENIDA)
  IF v_tipo = 'compania' THEN
    UPDATE public.profiles
       SET saldo_yoga_compania = coalesce(saldo_yoga_compania, 0) + 1,
           oferta_compania_canjeada = true
     WHERE id = v_user_id
 RETURNING saldo_yoga_compania INTO v_nuevo_saldo;
  ELSIF v_tipo = 'consultas' THEN
    UPDATE public.profiles
       SET saldo_consultas_gratis = coalesce(saldo_consultas_gratis, 0) + 1,
           oferta_consultas_canjeada = true
     WHERE id = v_user_id
 RETURNING saldo_consultas_gratis INTO v_nuevo_saldo;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'tipo', v_tipo,
    'titulo', v_titulo_oferta,
    'nuevo_saldo', coalesce(v_nuevo_saldo, 1),
    'message', '¡Oferta canjeada con éxito! Se ha añadido ' || v_titulo_oferta || ' a tu cuenta.'
  );
END;
$$;

-- Permisos de ejecución de la RPC
REVOKE ALL ON FUNCTION public.canjear_oferta_promocional(text) FROM public;
GRANT EXECUTE ON FUNCTION public.canjear_oferta_promocional(text) TO authenticated, anon;

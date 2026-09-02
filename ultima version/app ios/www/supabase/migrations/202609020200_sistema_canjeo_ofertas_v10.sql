-- ==============================================================================
-- GEN YOGA - Versión 10.0: Sistema de Bonos por Canjeo de Ofertas (Anti-Abuso)
-- ==============================================================================
-- 1. Los nuevos usuarios ya no reciben bonos de forma automática al registrarse.
--    El perfil se crea con saldos a 0 (perfil limpio).
-- 2. Los bonos promocionales se obtienen exclusivamente canjeando ofertas voluntariamente.
-- 3. Cada oferta solo puede canjearse 1 única vez por usuario (garantizado por constraint único).
-- ==============================================================================

-- 1. Tabla para registrar los canjeos de ofertas promocionales
CREATE TABLE IF NOT EXISTS public.ofertas_canjeadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tipo_oferta text NOT NULL,
  canjeado_el timestamptz NOT NULL DEFAULT clock_timestamp(),
  metadata jsonb DEFAULT '{}'::jsonb,
  CONSTRAINT uq_user_oferta UNIQUE (user_id, tipo_oferta)
);

CREATE INDEX IF NOT EXISTS idx_ofertas_canjeadas_user ON public.ofertas_canjeadas(user_id);
CREATE INDEX IF NOT EXISTS idx_ofertas_canjeadas_tipo ON public.ofertas_canjeadas(tipo_oferta);

-- Habilitar RLS en ofertas_canjeadas
ALTER TABLE public.ofertas_canjeadas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Los usuarios pueden consultar sus propias ofertas canjeadas" ON public.ofertas_canjeadas;
CREATE POLICY "Los usuarios pueden consultar sus propias ofertas canjeadas"
  ON public.ofertas_canjeadas
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Administradores pueden ver todas las ofertas canjeadas" ON public.ofertas_canjeadas;
CREATE POLICY "Administradores pueden ver todas las ofertas canjeadas"
  ON public.ofertas_canjeadas
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND lower(trim(coalesce(rol, ''))) IN ('admin', 'trabajador')
    )
  );

-- 2. Asegurar columnas de auditoría en public.profiles (opcional para indexación rápida)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS oferta_bienvenida_canjeada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS oferta_compania_canjeada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS oferta_consultas_canjeada boolean NOT NULL DEFAULT false;

-- 3. Actualizar trigger global de creación de perfiles tras registro en auth.users
--    IMPORTANTE: Nuevos usuarios ahora nacen con 0 bonos en todos sus saldos.
CREATE OR REPLACE FUNCTION public.crear_perfil_nuevo_usuario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_nombre text;
  v_apellidos text;
  v_telefono text;
  v_fecha_nacimiento date;
  v_notas text;
  v_auth_method text;
BEGIN
  v_nombre := coalesce(
    nullif(trim(new.raw_user_meta_data->>'nombre'), ''),
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    split_part(coalesce(new.email, ''), '@', 1),
    'Alumno'
  );
  v_apellidos := coalesce(nullif(trim(new.raw_user_meta_data->>'apellidos'), ''), '');
  v_telefono := nullif(trim(coalesce(new.phone, new.raw_user_meta_data->>'telefono', '')), '');
  v_notas := coalesce(new.raw_user_meta_data->>'notas', '');
  v_auth_method := coalesce(new.raw_app_meta_data->>'provider', 'email');

  BEGIN
    v_fecha_nacimiento := (new.raw_user_meta_data->>'fecha_nacimiento')::date;
  EXCEPTION WHEN OTHERS THEN
    v_fecha_nacimiento := null;
  END;

  IF length(v_nombre) > 80 OR v_nombre ~ '[[:cntrl:]<>&]' THEN
    v_nombre := 'Alumno';
  END IF;
  IF length(v_apellidos) > 120 OR v_apellidos ~ '[[:cntrl:]<>&]' THEN
    v_apellidos := '';
  END IF;

  INSERT INTO public.profiles (
    id,
    nombre,
    apellidos,
    email,
    telefono,
    fecha_nacimiento,
    notas,
    auth_method,
    rol,
    bonos,
    saldo_clases_gratis,
    saldo_consultas_gratis,
    saldo_yoga_compania
  )
  VALUES (
    new.id,
    v_nombre,
    v_apellidos,
    lower(trim(coalesce(new.email, ''))),
    nullif(v_telefono, ''),
    v_fecha_nacimiento,
    v_notas,
    v_auth_method,
    'cliente',
    0,
    0, -- v10.0: Comienza en 0 bonos
    0, -- v10.0: Comienza en 0 consultas
    0  -- v10.0: Comienza en 0 bonos compañía
  )
  ON CONFLICT (id) DO UPDATE
  SET nombre = CASE
        WHEN nullif(trim(coalesce(profiles.nombre, '')), '') IS NULL THEN excluded.nombre
        ELSE profiles.nombre
      END,
      apellidos = CASE
        WHEN nullif(trim(coalesce(profiles.apellidos, '')), '') IS NULL THEN excluded.apellidos
        ELSE profiles.apellidos
      END,
      email = excluded.email,
      telefono = coalesce(nullif(excluded.telefono, ''), profiles.telefono),
      fecha_nacimiento = coalesce(excluded.fecha_nacimiento, profiles.fecha_nacimiento),
      notas = CASE WHEN length(coalesce(excluded.notas, '')) > 0 THEN excluded.notas ELSE profiles.notas END,
      auth_method = coalesce(nullif(excluded.auth_method, ''), profiles.auth_method);

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS zz_gen_yoga_profile_after_signup ON auth.users;
CREATE TRIGGER zz_gen_yoga_profile_after_signup
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.crear_perfil_nuevo_usuario();

-- 4. Actualizar admin_crear_cliente_mostrador para que clientes nuevos inicien con 0 saldos
CREATE OR REPLACE FUNCTION public.admin_crear_cliente_mostrador(
  p_nombre text,
  p_apellidos text DEFAULT '',
  p_fecha_nacimiento date DEFAULT null,
  p_telefono text DEFAULT null,
  p_email text DEFAULT null,
  p_notas text DEFAULT null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_nombre text;
  v_apellidos text;
  v_telefono text;
  v_notas text;
  v_email text;
  v_profile_id uuid := gen_random_uuid();
  v_nuevo_cliente public.profiles%ROWTYPE;
BEGIN
  SELECT lower(trim(coalesce(rol, ''))) INTO v_caller_role
    FROM public.profiles
   WHERE id = v_caller_id;

  IF v_caller_role NOT IN ('admin', 'trabajador', 'profesor', 'profesional') THEN
    RAISE EXCEPTION 'Permisos insuficientes para crear clientes.' USING errcode = '42501';
  END IF;

  v_nombre := regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_apellidos := regexp_replace(trim(coalesce(p_apellidos, '')), '\s+', ' ', 'g');
  v_telefono := regexp_replace(trim(coalesce(p_telefono, '')), '[^0-9+]', '', 'g');
  v_notas := trim(coalesce(p_notas, ''));
  v_email := lower(trim(coalesce(p_email, '')));

  IF length(v_nombre) < 1 THEN
    RAISE EXCEPTION 'El nombre es obligatorio.' USING errcode = '22023';
  END IF;

  IF length(v_email) < 3 OR v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    v_email := 'mostrador+' || substr(md5(v_profile_id::text || clock_timestamp()::text), 1, 16) || '@genyoga.studio';
  END IF;

  INSERT INTO public.profiles (
    id,
    email,
    nombre,
    apellidos,
    fecha_nacimiento,
    telefono,
    notas,
    rol,
    bonos,
    saldo_clases_gratis,
    saldo_consultas_gratis,
    saldo_yoga_compania
  ) VALUES (
    v_profile_id,
    v_email,
    v_nombre,
    v_apellidos,
    p_fecha_nacimiento,
    nullif(v_telefono, ''),
    v_notas,
    'cliente',
    0,
    0,
    0,
    0
  )
  ON CONFLICT (id) DO UPDATE
  SET nombre = excluded.nombre,
      apellidos = excluded.apellidos,
      notas = excluded.notas,
      telefono = coalesce(excluded.telefono, profiles.telefono),
      fecha_nacimiento = coalesce(excluded.fecha_nacimiento, profiles.fecha_nacimiento)
  RETURNING * INTO v_nuevo_cliente;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_nuevo_cliente.id,
    'nombre', v_nuevo_cliente.nombre,
    'apellidos', v_nuevo_cliente.apellidos,
    'email', v_nuevo_cliente.email,
    'telefono', v_nuevo_cliente.telefono,
    'bonos', v_nuevo_cliente.bonos,
    'saldo_clases_gratis', v_nuevo_cliente.saldo_clases_gratis,
    'saldo_consultas_gratis', v_nuevo_cliente.saldo_consultas_gratis,
    'saldo_yoga_compania', v_nuevo_cliente.saldo_yoga_compania
  );
END;
$$;

-- 5. RPC Atómica para Canjear Ofertas Promocionales (con protección anti-abuso)
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

  -- Normalizar tipo de oferta
  v_tipo := lower(trim(coalesce(p_oferta, '')));
  IF v_tipo IN ('bienvenida', 'clases_gratis', 'intro', 'prueba', 'gratis') THEN
    v_tipo := 'bienvenida';
    v_titulo_oferta := 'Bono de Bienvenida (1 Clase Gratis)';
  ELSIF v_tipo IN ('compania', 'yoga_compania', 'colegas', 'pareja', 'abuela', 'madre', 'madre_hija') THEN
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

  -- Sumar +1 al saldo correspondiente en profiles
  IF v_tipo = 'bienvenida' THEN
    UPDATE public.profiles
       SET saldo_clases_gratis = coalesce(saldo_clases_gratis, 0) + 1,
           oferta_bienvenida_canjeada = true
     WHERE id = v_user_id
 RETURNING saldo_clases_gratis INTO v_nuevo_saldo;
  ELSIF v_tipo = 'compania' THEN
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

-- 6. RPC para consultar el estado de ofertas canjeadas de un usuario autenticado
CREATE OR REPLACE FUNCTION public.obtener_mis_ofertas_canjeadas()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_canjeadas jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT coalesce(jsonb_agg(tipo_oferta), '[]'::jsonb)
    INTO v_canjeadas
    FROM public.ofertas_canjeadas
   WHERE user_id = v_user_id;

  RETURN v_canjeadas;
END;
$$;

REVOKE ALL ON FUNCTION public.obtener_mis_ofertas_canjeadas() FROM public;
GRANT EXECUTE ON FUNCTION public.obtener_mis_ofertas_canjeadas() TO authenticated, anon;

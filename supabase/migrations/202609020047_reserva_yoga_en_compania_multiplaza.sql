-- Migration 202609020047: Sistema Integral de Reserva Multi-plaza con Bono Yoga en Compañía
-- ==============================================================================
-- Permite canjear el Bono de Yoga en Compañía en cualquiera de las 4 modalidades,
-- bloqueando 2, 3 o 4 plazas con nombres y apellidos obligatorios de acompañantes.
-- ==============================================================================

-- 1. Añadir columna num_plazas_reservadas y acompanantes en reservas_yoga si no existen
alter table public.reservas_yoga
  add column if not exists num_plazas_reservadas integer not null default 1,
  add column if not exists acompanantes jsonb default '[]'::jsonb;

-- 2. Función RPC para reservar con Bono de Yoga en Compañía Multi-plaza
create or replace function public.reservar_yoga_compania_multiplaza(
  p_clase_id bigint,
  p_modalidad text,
  p_num_plazas integer,
  p_acompanantes jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_actor_nombre text;
  v_actor_apellidos text;
  v_saldo_compania integer;
  v_capacity integer;
  v_occupied integer;
  v_class_name text;
  v_class_type text;
  v_class_active boolean;
  v_teacher_id bigint;
  v_teacher_name text;
  v_starts_at timestamptz;
  v_modalidad_norm text;
  v_reserva_id bigint;
  v_plazas_requeridas integer;
  v_style_valid boolean := false;
begin
  if v_actor_id is null then
    raise exception 'Debes iniciar sesión para reservar.' using errcode = '42501';
  end if;

  if p_clase_id is null or p_clase_id <= 0 then
    raise exception 'Clase inválida.' using errcode = '22023';
  end if;

  -- Normalizar modalidad
  v_modalidad_norm := lower(trim(coalesce(p_modalidad, '')));
  if v_modalidad_norm in ('colegas', 'amigos') then
    v_modalidad_norm := 'colegas';
  elsif v_modalidad_norm in ('pareja') then
    v_modalidad_norm := 'pareja';
  elsif v_modalidad_norm in ('abuela', 'madre') then
    v_modalidad_norm := 'abuela';
  elsif v_modalidad_norm in ('hijo', 'hija') then
    v_modalidad_norm := 'hijo';
  else
    raise exception 'Modalidad de Yoga en compañía no válida: %', p_modalidad using errcode = '22023';
  end if;

  -- Validar plazas requeridas
  if v_modalidad_norm = 'colegas' then
    if p_num_plazas not in (3, 4) then
      raise exception 'La modalidad Yoga con colegas requiere bloquear 3 o 4 plazas.' using errcode = '22023';
    end if;
    v_plazas_requeridas := p_num_plazas;
  else
    v_plazas_requeridas := 2;
  end if;

  -- Comprobar perfil del usuario y saldo de compañía
  select lower(trim(coalesce(rol, ''))),
         coalesce(nombre, ''),
         coalesce(apellidos, ''),
         coalesce(saldo_yoga_compania, 0)
    into v_actor_role, v_actor_nombre, v_actor_apellidos, v_saldo_compania
    from public.profiles
   where id = v_actor_id
     and coalesce(activo, true)
   for update;

  if not found then
    raise exception 'Perfil no encontrado.' using errcode = 'P0002';
  end if;

  if v_actor_role <> 'admin' and v_saldo_compania < 1 then
    raise exception 'No dispones de saldo en tu Bono de Yoga en compañía.' using errcode = 'P0001';
  end if;

  -- Comprobar clase y bloquear fila
  select coalesce(c.capacidad_max, 0),
         coalesce(c.ocupadas, 0),
         coalesce(c.nombre, ''),
         lower(trim(coalesce(c.tipo_clase, ''))),
         coalesce(c.activa, true),
         c.profesor_id,
         c.fecha_inicio,
         concat_ws(' ', p.nombre, p.apellidos)
    into v_capacity, v_occupied, v_class_name, v_class_type, v_class_active,
         v_teacher_id, v_starts_at, v_teacher_name
    from public.clases c
    left join public.profesionales p on p.id = c.profesor_id
   where c.id = p_clase_id
   for update;

  if not found or not v_class_active or v_class_type not in ('yoga', 'taller') then
    raise exception 'La clase no está disponible para reservas.' using errcode = 'P0002';
  end if;

  -- Validar capacidad libre suficiente
  if (v_capacity - v_occupied) < v_plazas_requeridas then
    raise exception 'No hay suficientes plazas libres en esta clase (disponibles: %, necesarias: %).',
      (v_capacity - v_occupied), v_plazas_requeridas using errcode = 'P0001';
  end if;

  -- Validar que el usuario no esté ya inscrito en esta clase
  if exists (
    select 1 from public.reservas_yoga
     where clase_id = p_clase_id
       and user_id = v_actor_id
       and estado = 'confirmada'
  ) then
    raise exception 'Ya tienes una reserva confirmada en esta clase.' using errcode = '23505';
  end if;

  -- Insertar la reserva principal
  insert into public.reservas_yoga (
    clase_id,
    user_id,
    estado,
    saldo_gratis_descontado,
    welcome_companion_modality,
    bono_descontado,
    usado_bono_mensual,
    num_plazas_reservadas,
    acompanantes,
    notas
  ) values (
    p_clase_id,
    v_actor_id,
    'confirmada',
    true,
    v_modalidad_norm,
    false,
    false,
    v_plazas_requeridas,
    coalesce(p_acompanantes, '[]'::jsonb),
    concat_ws(' · ', 'Bono Yoga en Compañía', upper(v_modalidad_norm), concat(v_plazas_requeridas, ' plazas'))
  )
  returning id into v_reserva_id;

  -- Actualizar plazas ocupadas en la clase
  update public.clases
     set ocupadas = ocupadas + v_plazas_requeridas
   where id = p_clase_id;

  -- Consumir el bono de Yoga en compañía
  if v_actor_role <> 'admin' then
    update public.profiles
       set saldo_yoga_compania = greatest(0, saldo_yoga_compania - 1)
     where id = v_actor_id;

    -- Sincronizar tabla privada si existiera registro
    update private.welcome_companion_bonuses
       set credits_remaining = 0,
           updated_at = now()
     where profile_id = v_actor_id;
  end if;

  return jsonb_build_object(
    'reserva_id', v_reserva_id,
    'clase_id', p_clase_id,
    'modalidad', v_modalidad_norm,
    'num_plazas', v_plazas_requeridas,
    'saldo_restante', case when v_actor_role = 'admin' then v_saldo_compania else greatest(0, v_saldo_compania - 1) end
  );
end;
$function$;

revoke all on function public.reservar_yoga_compania_multiplaza(bigint, text, integer, jsonb)
  from public, anon;
grant execute on function public.reservar_yoga_compania_multiplaza(bigint, text, integer, jsonb)
  to authenticated, service_role;

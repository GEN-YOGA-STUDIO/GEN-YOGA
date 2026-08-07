-- Migration to support booking dynamic/virtual consultation slots.
-- Creates an RPC to atomically insert the classes record (as security definer) and make the booking.

create or replace function public.reservar_consulta_virtual(
  p_tipo text,
  p_profesor_id bigint,
  p_fecha_inicio timestamptz,
  p_user_id uuid,
  p_cobrar_saldo boolean default true
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_clase_id bigint;
  v_nombre_clase text;
  v_duracion integer := 60;
  v_fecha_fin timestamptz;
begin
  -- 1. Validation of type
  if p_tipo is null or p_tipo not in ('psicologia', 'nutricion') then
    raise exception 'invalid consultation type';
  end if;
  if p_profesor_id is null or p_user_id is null or p_fecha_inicio is null then
    raise exception 'invalid parameters';
  end if;

  -- Verify the slot is in the future
  if p_fecha_inicio <= now() then
    raise exception 'consultation slot must be in the future';
  end if;

  -- 2. Check if an active slot already exists at this exact date/time/professor
  select id into v_clase_id
    from public.clases
   where profesor_id = p_profesor_id
     and tipo_clase = p_tipo
     and fecha_inicio = p_fecha_inicio
     and activa = true
   limit 1;

  if v_clase_id is null then
    -- 3. Create the class row
    v_nombre_clase := case when p_tipo = 'psicologia' then 'Consulta Psicología' else 'Consulta Nutrición' end;
    v_fecha_fin := p_fecha_inicio + interval '60 minutes';

    insert into public.clases (
      nombre,
      fecha_inicio,
      fecha_fin,
      capacidad_max,
      profesor_id,
      tipo_clase,
      duracion_minutos,
      activa
    ) values (
      v_nombre_clase,
      p_fecha_inicio,
      v_fecha_fin,
      1,
      p_profesor_id,
      p_tipo,
      v_duracion,
      true
    ) returning id into v_clase_id;
  end if;

  -- 4. Call reservar_consulta_atomica to perform the actual booking
  perform public.reservar_consulta_atomica(
    p_tipo,
    v_clase_id,
    p_user_id,
    p_cobrar_saldo
  );

  return v_clase_id;
end;
$$;

revoke all on function public.reservar_consulta_virtual(text, bigint, timestamptz, uuid, boolean) from public, anon;
grant execute on function public.reservar_consulta_virtual(text, bigint, timestamptz, uuid, boolean) to authenticated;

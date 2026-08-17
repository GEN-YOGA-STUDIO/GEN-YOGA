begin;

-- Los huecos públicos de consulta se generan en el cliente y solo se
-- materializan en public.clases al reservar. La validación autoritativa vive
-- aquí para impedir que una llamada directa al RPC cree horas no publicadas.
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
set search_path = pg_catalog, public
as $function$
declare
  v_clase_id bigint;
  v_nombre_clase text;
  v_fecha_fin timestamptz;
  v_professional_identity text;
  v_local_start timestamp without time zone;
  v_local_weekday integer;
  v_local_time time without time zone;
  v_allowed_start_times constant time without time zone[] := array[
    '09:30'::time,
    '10:30'::time,
    '11:30'::time,
    '12:30'::time,
    '13:30'::time,
    '17:00'::time,
    '18:00'::time,
    '19:00'::time,
    '20:00'::time
  ];
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if p_tipo is null or p_tipo not in ('psicologia', 'nutricion') then
    raise exception 'invalid consultation type';
  end if;
  if p_profesor_id is null or p_user_id is null or p_fecha_inicio is null then
    raise exception 'invalid parameters';
  end if;
  if p_fecha_inicio <= now() then
    raise exception 'consultation slot must be in the future';
  end if;

  select lower(concat_ws(
    ' ',
    coalesce(professional.nombre, ''),
    coalesce(professional.apellidos, ''),
    coalesce(professional.email, '')
  ))
    into v_professional_identity
    from public.profesionales as professional
   where professional.id = p_profesor_id
     and professional.visible_publico is true;
  if not found then
    raise exception 'consultation professional not found';
  end if;

  v_local_start := p_fecha_inicio at time zone 'Europe/Madrid';
  v_local_weekday := extract(isodow from v_local_start)::integer;
  v_local_time := v_local_start::time;

  if v_professional_identity like '%miriam%' then
    if p_tipo <> 'psicologia'
      or v_local_weekday not in (2, 3)
      or not (v_local_time = any(v_allowed_start_times)) then
      raise exception 'Miriam is not available at the requested time';
    end if;
  elsif v_professional_identity like '%isabel%' then
    if p_tipo <> 'psicologia'
      or v_local_weekday not in (2, 4)
      or not (v_local_time = any(v_allowed_start_times)) then
      raise exception 'Isabel is not available at the requested time';
    end if;
  end if;

  -- Serializa dos reservas simultáneas del mismo profesional y hora para no
  -- materializar dos filas de clase equivalentes antes del control de aforo.
  perform pg_advisory_xact_lock(
    hashtextextended(p_profesor_id::text || ':' || p_fecha_inicio::text, 0)
  );

  select class.id
    into v_clase_id
    from public.clases as class
   where class.profesor_id = p_profesor_id
     and lower(coalesce(class.tipo_clase, '')) = p_tipo
     and class.fecha_inicio = p_fecha_inicio
     and class.activa is true
   order by class.id
   limit 1;

  if v_clase_id is null then
    v_nombre_clase := case
      when p_tipo = 'psicologia' and v_professional_identity like '%isabel%'
        then 'Consulta PNI / Psicología'
      when p_tipo = 'psicologia' then 'Consulta Psicología'
      else 'Consulta Nutrición'
    end;
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
      60,
      true
    ) returning id into v_clase_id;
  end if;

  perform public.reservar_consulta_atomica(
    p_tipo,
    v_clase_id,
    p_user_id,
    p_cobrar_saldo
  );

  return v_clase_id;
end;
$function$;

revoke all on function public.reservar_consulta_virtual(text, bigint, timestamptz, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.reservar_consulta_virtual(text, bigint, timestamptz, uuid, boolean)
  to authenticated;

comment on function public.reservar_consulta_virtual(text, bigint, timestamptz, uuid, boolean)
  is 'Materializes and books an allowed virtual consultation slot. Miriam: Tuesday/Wednesday; Isabel: Tuesday/Thursday; 09:30-14:30 and 17:00-21:00 Europe/Madrid.';

notify pgrst, 'reload schema';

commit;

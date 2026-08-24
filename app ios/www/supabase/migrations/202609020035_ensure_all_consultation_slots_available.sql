-- ============================================================================
-- Migration 202609020035: Ensure All Consultation Slots Available & Assignable
-- ============================================================================
-- Asegura que las consultas de Miriam (Martes y Miércoles) e Isabel (Martes y Jueves)
-- en sus 4 turnos matinales (09:30, 10:30, 11:30, 12:30) y 4 turnos vespertinos
-- (17:00, 18:00, 19:00, 20:00) y Silvia (Viernes alternos 15:00, 16:30, 18:00)
-- puedan reservarse de forma virtual y asignarse manualmente por staff/admin sin errores.
-- ============================================================================

begin;

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
  v_duracion integer := 60;
  v_fecha_fin timestamptz;
  v_professional_identity text;
  v_local_start timestamp without time zone;
  v_local_weekday integer;
  v_local_time time without time zone;
  v_standard_start_times constant time without time zone[] := array[
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
  v_silvia_start_times constant time without time zone[] := array[
    '15:00'::time,
    '16:30'::time,
    '18:00'::time
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
    if v_local_weekday not in (2, 3)
      or not (v_local_time = any(v_standard_start_times)) then
      raise exception 'Miriam is not available at the requested time';
    end if;
  elsif v_professional_identity like '%isabel%' then
    if v_local_weekday not in (2, 4)
      or not (v_local_time = any(v_standard_start_times)) then
      raise exception 'Isabel is not available at the requested time';
    end if;
  elsif v_professional_identity like '%silvia%' then
    if p_tipo <> 'nutricion'
      or v_local_weekday <> 5
      or mod(v_local_start::date - date '2026-06-19', 14) <> 0
      or not (v_local_time = any(v_silvia_start_times)) then
      raise exception 'Silvia is not available at the requested time';
    end if;
    v_duracion := 90;
  end if;

  -- Evita materializar dos clases equivalentes ante reservas simultáneas.
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
      when v_professional_identity like '%silvia%' then 'Consulta Ayurveda'
      when v_professional_identity like '%isabel%' and p_tipo = 'nutricion' then 'Consulta PNI / Nutrición Clínica'
      when v_professional_identity like '%isabel%' then 'Consulta PNI / Psicología'
      when v_professional_identity like '%miriam%' and p_tipo = 'nutricion' then 'Consulta Alimentación Consciente'
      when p_tipo = 'psicologia' then 'Consulta Psicología'
      else 'Consulta Nutrición'
    end;
    v_fecha_fin := p_fecha_inicio + make_interval(mins => v_duracion);

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

  perform public.reservar_consulta_atomica(
    p_tipo,
    v_clase_id,
    p_user_id,
    p_cobrar_saldo
  );

  return v_clase_id;
end;
$function$;

revoke all on function public.reservar_consulta_virtual(text, bigint, timestamptz, uuid, boolean) from public, anon;
grant execute on function public.reservar_consulta_virtual(text, bigint, timestamptz, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';

commit;

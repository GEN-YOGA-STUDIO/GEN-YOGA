begin;

alter table public.reservas_yoga
  add column if not exists num_plazas integer not null default 1,
  add column if not exists num_plazas_reservadas integer not null default 1,
  add column if not exists acompanantes jsonb not null default '[]'::jsonb,
  add column if not exists welcome_companion_modality text;

alter table public.clases
  add column if not exists companion_modality text;

create or replace function public.reservar_yoga_compania_multiplaza(
  p_clase_id bigint,
  p_modalidad text default 'pareja',
  p_num_plazas integer default 2,
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
  v_saldo_compania integer;
  v_capacity integer;
  v_occupied integer;
  v_class_type text;
  v_class_active boolean;
  v_class_modality text;
  v_modalidad_norm text;
  v_plazas_requeridas integer;
  v_reserva_id bigint;
  v_acompanantes jsonb := coalesce(p_acompanantes, '[]'::jsonb);
begin
  if v_actor_id is null then
    raise exception 'Debes iniciar sesion para reservar.' using errcode = '42501';
  end if;

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
    raise exception 'Modalidad de Yoga en compania no valida.' using errcode = '22023';
  end if;

  if v_modalidad_norm = 'colegas' then
    if p_num_plazas not in (3, 4) then
      raise exception 'Yoga con colegas requiere 3 o 4 plazas en total.' using errcode = '22023';
    end if;
    v_plazas_requeridas := p_num_plazas;
  else
    v_plazas_requeridas := 2;
  end if;

  if jsonb_typeof(v_acompanantes) <> 'array'
     or jsonb_array_length(v_acompanantes) <> v_plazas_requeridas - 1 then
    raise exception 'Debes registrar un nombre y apellidos por cada acompanante.' using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(v_acompanantes) as companion(value)
     where jsonb_typeof(companion.value) <> 'string'
        or length(trim(companion.value #>> '{}')) < 3
        or position(' ' in trim(companion.value #>> '{}')) = 0
  ) then
    raise exception 'Cada acompanante debe tener nombre y apellidos.' using errcode = '22023';
  end if;

  select lower(trim(coalesce(rol, ''))), coalesce(saldo_yoga_compania, 0)
    into v_actor_role, v_saldo_compania
    from public.profiles
   where id = v_actor_id and coalesce(activo, true)
   for update;
  if not found then
    raise exception 'Perfil no encontrado.' using errcode = 'P0002';
  end if;
  if v_actor_role <> 'admin' and v_saldo_compania < 1 then
    raise exception 'No dispones de saldo en tu Bono de Yoga en compania.' using errcode = 'P0001';
  end if;

  select coalesce(c.capacidad_max, 0), coalesce(c.tipo_clase, ''),
         coalesce(c.activa, true), lower(trim(coalesce(c.companion_modality, '')))
    into v_capacity, v_class_type, v_class_active, v_class_modality
    from public.clases as c
   where c.id = p_clase_id
   for update;
  if not found or not v_class_active or lower(trim(v_class_type)) <> 'yoga' then
    raise exception 'La clase no esta disponible para reservas de compania.' using errcode = 'P0002';
  end if;
  if v_class_modality <> v_modalidad_norm
     and not (v_class_modality = 'abuela' and v_modalidad_norm = 'abuela') then
    raise exception 'Esta clase no esta clasificada para la modalidad elegida.' using errcode = 'P0001';
  end if;

  select coalesce(sum(
    case
      when jsonb_typeof(coalesce(r.acompanantes, '[]'::jsonb)) = 'array'
           and jsonb_array_length(coalesce(r.acompanantes, '[]'::jsonb)) > 0
        then greatest(coalesce(r.num_plazas_reservadas, 1), coalesce(r.num_plazas, 1),
                      jsonb_array_length(r.acompanantes) + 1)
      else coalesce(r.num_plazas_reservadas, r.num_plazas, 1)
    end
  ), 0)::integer
    into v_occupied
    from public.reservas_yoga as r
   where r.clase_id = p_clase_id and r.estado = 'confirmada';

  if v_occupied + v_plazas_requeridas > v_capacity then
    raise exception 'No hay suficientes plazas libres en esta clase.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.reservas_yoga
     where clase_id = p_clase_id and user_id = v_actor_id and estado = 'confirmada'
  ) then
    raise exception 'Ya tienes una reserva confirmada en esta clase.' using errcode = '23505';
  end if;

  insert into public.reservas_yoga (
    clase_id, user_id, estado, saldo_gratis_descontado,
    welcome_companion_modality, bono_descontado, usado_bono_mensual,
    num_plazas_reservadas, acompanantes, notas
  ) values (
    p_clase_id, v_actor_id, 'confirmada', true,
    v_modalidad_norm, false, false, v_plazas_requeridas, v_acompanantes,
    concat('Bono Yoga en Compania ', upper(v_modalidad_norm), ' (', v_plazas_requeridas, ' plazas)')
  ) returning id into v_reserva_id;

  if v_actor_role <> 'admin' then
    update public.profiles
       set saldo_yoga_compania = greatest(0, coalesce(saldo_yoga_compania, 0) - 1)
     where id = v_actor_id;
    update private.welcome_companion_bonuses
       set credits_remaining = 0, updated_at = now()
     where profile_id = v_actor_id;
  end if;

  return jsonb_build_object(
    'reserva_id', v_reserva_id,
    'clase_id', p_clase_id,
    'modalidad', v_modalidad_norm,
    'num_plazas', v_plazas_requeridas,
    'saldo_restante', case when v_actor_role = 'admin' then v_saldo_compania
      else greatest(0, v_saldo_compania - 1) end
  );
end;
$function$;

revoke all on function public.reservar_yoga_compania_multiplaza(bigint, text, integer, jsonb)
  from public, anon;
grant execute on function public.reservar_yoga_compania_multiplaza(bigint, text, integer, jsonb)
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

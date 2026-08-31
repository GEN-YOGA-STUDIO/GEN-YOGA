-- ============================================================================
-- Migration 202609020009: Consultation Slots Flow & Isabel Canonical Reconfig
-- ============================================================================

begin;

-- 1. Asegurar registro canónico de ISABEL en profesionales (isarodriguez.pni@gmail.com)
insert into public.profesionales (
  nombre,
  apellidos,
  email,
  especialidad,
  descripcion,
  foto_url,
  color,
  visible_publico
) values (
  'Isabel',
  'Rodríguez',
  'isarodriguez.pni@gmail.com',
  'Psiconeuroinmunología Clínica (PNI) | consultas, psicologia, nutricion',
  'LUGAR DE NACIMIENTO: Albacete (España)

TITULACIONES:
Especialista en Psiconeuroinmunología Clínica (PNI)
Grado en Nutrición Humana y Dietética
Formación en Salud Digestiva, Microbiota e Inmunonutrición
Especialización en Regulación Hormonal y Estrés Crónico

SOBRE MÍ:
Acompaño a las personas hacia el equilibrio integral de su organismo a través de la nutrición clínica, la modulación del estilo de vida y la gestión del estrés, integrando el conocimiento científico con una mirada cercana, humana y personalizada.
La Psiconeuroinmunología Clínica nos permite entender cómo interactúan la mente, el sistema nervioso, el sistema inmunitario y el sistema endocrino, abordando el origen profundo de los desequilibrios para recuperar la vitalidad y el bienestar.

TE ACOMPAÑO:
Optimización del sistema inmunitario
Salud digestiva y microbiota
Regulación metabólica y hormonal
Gestión del estrés y la inflamación crónica
Mejora de la composición corporal y hábitos de vida saludables

ME DEFINE:
"Comprender el cuerpo como un todo interconectado es la clave para acompañar a cada persona a recuperar su equilibrio y bienestar duradero."',
  null,
  '#8f6b2d',
  true
)
on conflict (email) do update
set
  nombre = excluded.nombre,
  apellidos = coalesce(nullif(excluded.apellidos, ''), public.profesionales.apellidos),
  especialidad = excluded.especialidad,
  descripcion = excluded.descripcion,
  color = excluded.color,
  visible_publico = true;

-- 2. Asegurar que en profiles el correo isarodriguez.pni@gmail.com tenga rol profesor
update public.profiles
set rol = 'profesor',
    nombre = coalesce(nullif(trim(nombre), ''), 'Isabel'),
    apellidos = coalesce(nullif(trim(apellidos), ''), 'Rodríguez')
where lower(trim(email)) = 'isarodriguez.pni@gmail.com';

-- 3. Reasignar cualquier clase o consulta de duplicados anteriores al ID canónico de Isabel
do $$
declare
  v_canon_isabel_id bigint;
  v_dup_id bigint;
begin
  select id into v_canon_isabel_id
  from public.profesionales
  where lower(trim(email)) = 'isarodriguez.pni@gmail.com';

  if v_canon_isabel_id is not null then
    for v_dup_id in
      select id from public.profesionales
      where lower(trim(email)) in ('isabel@genyoga.es', 'isabel_profesora@genyoga.studio')
        and id <> v_canon_isabel_id
    loop
      update public.clases set profesor_id = v_canon_isabel_id where profesor_id = v_dup_id;
      delete from public.profesionales where id = v_dup_id;
    end loop;
  end if;
end $$;

-- 4. RPC para que Staff/Admin asigne directamente un paciente a un hueco de consulta
create or replace function public.admin_asignar_consulta_paciente(
  p_tipo text,
  p_clase_id bigint,
  p_user_id uuid,
  p_cobrar_saldo boolean default false,
  p_notas text default null
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_actor_email text;
  v_reservation_id bigint;
begin
  if v_actor_id is null then
    raise exception 'authentication required';
  end if;

  select lower(coalesce(rol, '')), lower(nullif(trim(email), ''))
    into v_actor_role, v_actor_email
    from public.profiles
   where id = v_actor_id;

  if not found or v_actor_role not in ('admin', 'profesor', 'trabajador', 'profesional') then
    raise exception 'unauthorized: staff or admin role required';
  end if;

  -- Ejecutar la reserva atómica
  v_reservation_id := public.reservar_consulta_atomica(
    p_tipo,
    p_clase_id,
    p_user_id,
    p_cobrar_saldo
  );

  -- Actualizar notas si se proporcionaron
  if p_notas is not null and trim(p_notas) <> '' then
    if p_tipo = 'psicologia' then
      update public.reservas_psicologia
         set notas = p_notas
       where id = v_reservation_id;
    else
      update public.reservas_nutricion
         set notas = p_notas
       where id = v_reservation_id;
    end if;
  end if;

  return v_reservation_id;
end;
$$;

revoke all on function public.admin_asignar_consulta_paciente(text, bigint, uuid, boolean, text) from public, anon;
grant execute on function public.admin_asignar_consulta_paciente(text, bigint, uuid, boolean, text) to authenticated;

notify pgrst, 'reload schema';

commit;

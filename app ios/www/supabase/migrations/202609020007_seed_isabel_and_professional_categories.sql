-- ============================================================================
-- Migration 202609020007: Seed Isabel and Standardize Professional Categories
-- ============================================================================

-- 1. Ensure all core professionals exist and have standardized specialties & category tags

-- Isabel
insert into public.profesionales (
  nombre,
  apellidos,
  email,
  especialidad,
  descripcion,
  foto_url,
  color
) values (
  'Isabel',
  '',
  'isabel@genyoga.es',
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
  '#8f6b2d'
)
on conflict (email) do update
set
  nombre = excluded.nombre,
  especialidad = excluded.especialidad,
  descripcion = excluded.descripcion,
  color = excluded.color;

-- Miriam
update public.profesionales
set especialidad = 'Psicoterapia, Nutrición y Talleres | consultas, psicologia, nutricion, talleres'
where lower(trim(email)) in ('miriam@respirapsicologia.es', 'miriam_profesora@genyoga.studio')
   or lower(trim(nombre)) like '%miriam%';

-- Silvia
update public.profesionales
set especialidad = 'Hatha & Iyengar Yoga, Ayurveda | clases, consultas, nutricion'
where lower(trim(email)) in ('silvia@genyoga.es', 'silvia_profesora@genyoga.studio')
   or lower(trim(nombre)) like '%silvia%';

-- Ángel Javier
update public.profesionales
set especialidad = 'Yoga para hombres & Yoga para Todos | clases'
where lower(trim(email)) in ('angel@genyoga.es', 'angel_profesor@genyoga.studio')
   or lower(trim(nombre)) like '%angel%'
   or lower(trim(nombre)) like '%ángel%';

-- Yanira
update public.profesionales
set especialidad = 'Vinyasa & Restaurativa | clases, talleres'
where lower(trim(email)) in ('yanira@genyoga.es')
   or lower(trim(nombre)) like '%yanira%';

-- 2. Enhanced function to promote user to teacher with custom categories
create or replace function public.admin_promover_usuario_profesor(
  p_user_id uuid,
  p_especialidad text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_admin_role text;
  v_profile record;
  v_especialidad_final text;
begin
  select lower(trim(coalesce(rol, ''))) into v_admin_role
  from public.profiles
  where id = auth.uid();

  if v_admin_role <> 'admin' then
    raise exception 'only administrators can promote users to teachers' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'invalid target profile' using errcode = '22023';
  end if;

  select id, nombre, apellidos, email, avatar_url,
         lower(trim(coalesce(rol, ''))) as rol,
         coalesce(account_deletion_pending, false) as account_deletion_pending
    into v_profile
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'target profile not found' using errcode = 'P0002';
  end if;
  if v_profile.account_deletion_pending then
    raise exception 'target account deletion is pending' using errcode = '55000';
  end if;
  if coalesce(trim(v_profile.email), '') = '' then
    raise exception 'target profile has no email' using errcode = '22023';
  end if;

  v_especialidad_final := coalesce(nullif(trim(p_especialidad), ''), 'Yoga | clases');

  if not exists (
    select 1
    from public.profesionales
    where lower(trim(email)) = lower(trim(v_profile.email))
  ) then
    insert into public.profesionales (
      nombre,
      apellidos,
      email,
      foto_url,
      especialidad
    ) values (
      coalesce(nullif(trim(v_profile.nombre), ''), 'Profesional'),
      coalesce(v_profile.apellidos, ''),
      trim(v_profile.email),
      v_profile.avatar_url,
      v_especialidad_final
    );
  else
    update public.profesionales
    set especialidad = v_especialidad_final
    where lower(trim(email)) = lower(trim(v_profile.email));
  end if;

  update public.profiles
  set rol = 'profesor'
  where id = p_user_id;
end;
$$;

revoke all on function public.admin_promover_usuario_profesor(uuid, text) from public, anon;
grant execute on function public.admin_promover_usuario_profesor(uuid, text) to authenticated;

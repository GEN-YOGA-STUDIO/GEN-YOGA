-- Migration to automatically sync profile changes to public.profesionales
-- when a user is given a staff/teacher role.
-- Also drops the legacy trigger and function that were causing duplicate records.

-- Drop legacy trigger and function
drop trigger if exists on_profile_role_sync on public.profiles;
drop function if exists public.sync_profile_to_profesionales();

create or replace function public.sync_profile_to_profesional()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_matched_id int;
  v_clean_email text;
begin
  -- Only execute if the role is a staff role and email is valid
  if new.rol in ('profesor', 'trabajador', 'profesional') and new.email is not null and trim(new.email) <> '' then
    v_clean_email := lower(trim(new.email));

    -- 1. Check if email already exists in profesionales
    if not exists (
      select 1 from public.profesionales
      where lower(trim(email)) = v_clean_email
    ) then
      -- 2. Check if a professional exists with matching name
      select id into v_matched_id
      from public.profesionales
      where (
        -- Match full first name or the first word of first name
        lower(trim(coalesce(nombre, ''))) = lower(trim(coalesce(new.nombre, '')))
        or (
          length(trim(coalesce(nombre, ''))) > 2
          and lower(split_part(trim(coalesce(nombre, '')), ' ', 1)) = lower(split_part(trim(coalesce(new.nombre, '')), ' ', 1))
        )
      )
      and (
        -- Match last name strictly, or if the professional record has no last name
        lower(trim(coalesce(apellidos, ''))) = lower(trim(coalesce(new.apellidos, '')))
        or coalesce(trim(apellidos), '') = ''
      )
      order by 
        (lower(trim(coalesce(apellidos, ''))) = lower(trim(coalesce(new.apellidos, '')))) desc, -- prefer strict last name match
        (lower(trim(coalesce(nombre, ''))) = lower(trim(coalesce(new.nombre, '')))) desc, -- prefer strict first name match
        id
      limit 1;

      if v_matched_id is not null then
        -- 3. Link them by updating the email on the existing professional record
        update public.profesionales
        set email = trim(new.email)
        where id = v_matched_id;
      else
        -- 4. Create a new professional record if none match by name
        insert into public.profesionales (
          nombre,
          apellidos,
          email,
          foto_url,
          especialidad
        ) values (
          coalesce(nullif(trim(new.nombre), ''), 'Profesional'),
          coalesce(new.apellidos, ''),
          trim(new.email),
          null,
          'General'
        );
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_profile_to_profesional on public.profiles;
create trigger trg_sync_profile_to_profesional
after insert or update of rol, email, nombre, apellidos on public.profiles
for each row
execute function public.sync_profile_to_profesional();

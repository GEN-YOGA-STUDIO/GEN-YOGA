-- Migration 202609020040: Actualizar funcion actualizar_mi_perfil para soportar telefono movil

create or replace function public.actualizar_mi_perfil(
  p_nombre text,
  p_apellidos text default '',
  p_fecha_nacimiento date default null,
  p_telefono text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $func$
declare
  v_nombre text;
  v_apellidos text;
  v_telefono text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  v_nombre := regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_apellidos := regexp_replace(trim(coalesce(p_apellidos, '')), '\s+', ' ', 'g');
  v_telefono := regexp_replace(trim(coalesce(p_telefono, '')), '[^0-9+]', '', 'g');

  if length(v_nombre) < 1 or length(v_nombre) > 80 or v_nombre ~ '[[:cntrl:]<>&]' then
    raise exception 'invalid first name' using errcode = '22023';
  end if;
  if length(v_apellidos) > 120 or v_apellidos ~ '[[:cntrl:]<>&]' then
    raise exception 'invalid last name' using errcode = '22023';
  end if;

  update public.profiles
  set nombre = v_nombre,
      apellidos = v_apellidos,
      fecha_nacimiento = coalesce(p_fecha_nacimiento, fecha_nacimiento),
      telefono = coalesce(nullif(v_telefono, ''), telefono)
  where id = auth.uid()
    and not coalesce(account_deletion_pending, false);

  if not found then
    raise exception 'profile not found or deletion pending' using errcode = 'P0002';
  end if;
end;
$func$;

-- Sobrecarga para compatibilidad previa de firmas de 3 argumentos
create or replace function public.actualizar_mi_perfil(
  p_nombre text,
  p_apellidos text,
  p_fecha_nacimiento date
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $func$
begin
  perform public.actualizar_mi_perfil(p_nombre, p_apellidos, p_fecha_nacimiento, null);
end;
$func$;

revoke all on function public.actualizar_mi_perfil(text, text, date, text) from public, anon;
grant execute on function public.actualizar_mi_perfil(text, text, date, text) to authenticated;

revoke all on function public.actualizar_mi_perfil(text, text, date) from public, anon;
grant execute on function public.actualizar_mi_perfil(text, text, date) to authenticated;

notify pgrst, 'reload schema';

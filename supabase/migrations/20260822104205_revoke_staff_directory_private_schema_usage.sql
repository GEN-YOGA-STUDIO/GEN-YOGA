-- La vista guarda la referencia interna a la función; sus lectores no
-- necesitan acceso directo al esquema privado.
begin;

revoke all on schema private
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;

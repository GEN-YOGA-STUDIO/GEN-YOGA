-- 202609020047: las sesiones introductorias de consultas admiten 10 plazas.
--
-- El trigger trg_enforce_capacidad_max fuerza capacidad 1 en toda clase de
-- psicología/nutrición (consultas individuales). Las sesiones introductorias
-- de consultas son grupales y gratuitas: deben admitir 10 plazas. Se amplía
-- la regla: si la clase de consulta es gratuita (es_gratuita = true) se
-- permite hasta 10 plazas (por defecto 10); el resto de consultas sigue en 1.

create or replace function public.enforce_capacidad_max_rules()
returns trigger
language plpgsql
as $$
begin
  if lower(btrim(coalesce(new.tipo_clase, 'yoga'))) in ('yoga', 'taller', 'especial', '')
     or new.tipo_clase is null
     or lower(btrim(coalesce(new.tipo_clase, ''))) not in ('psicologia', 'nutricion') then
    if new.capacidad_max is null or new.capacidad_max <> 10 then
      new.capacidad_max := 10;
    end if;
  elsif lower(btrim(coalesce(new.tipo_clase, ''))) in ('psicologia', 'nutricion') then
    if new.es_gratuita is true then
      -- Sesión introductoria grupal: hasta 10 plazas.
      if new.capacidad_max is null or new.capacidad_max < 1 or new.capacidad_max > 10 then
        new.capacidad_max := 10;
      end if;
    else
      new.capacidad_max := 1;
    end if;
  end if;
  return new;
end;
$$;

-- Aplicar la nueva capacidad a las sesiones introductorias existentes.
update public.clases
   set capacidad_max = 10,
       updated_at = now()
 where lower(btrim(coalesce(tipo_clase, ''))) in ('psicologia', 'nutricion')
   and es_gratuita is true
   and coalesce(capacidad_max, 0) <> 10;

notify pgrst, 'reload schema';

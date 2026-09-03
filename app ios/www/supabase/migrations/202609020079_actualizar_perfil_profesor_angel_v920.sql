-- ==============================================================================
-- Migración 202609020079: Actualizar perfil oficial del profesor Ángel Javier
-- Versión: 9.20
-- ==============================================================================

DO $$
DECLARE
  v_prof_id bigint;
BEGIN
  -- 1. Localizar ficha canónica de Ángel en public.profesionales (ID 13 o email canónico)
  SELECT id INTO v_prof_id
    FROM public.profesionales
   WHERE id = 13
      OR lower(trim(email)) = 'angeljavier.yoga@gmail.com'
   ORDER BY (id = 13) DESC, id ASC
   LIMIT 1;

  IF v_prof_id IS NOT NULL THEN
    UPDATE public.profesionales
       SET descripcion = $angel$SOBRE MÍ:
Los últimos 6 años me dedico al estudio y la práctica de Yoga. Centrándome en la profundidad del trabajo físico y en los beneficios que procura a todos los niveles.
Siempre como estudiante, trato de compartir las enseñanzas que recibo y lo que aprendo de mi experiencia.

TITULACIONES:
Mi formación es constante y está basada en el autoestudio y la práctica, en recibir clases e intensivos de profesores con larga trayectoria —anatomía, asana, filosofía y todo lo necesario para mi desarrollo en el camino del yoga—.

ÁMBITOS DE SESIÓN:
La práctica se basa en el ajuste preciso y la correcta alineación del cuerpo. Adaptando la postura a las condiciones de cada alumno o alumna para encontrar los efectos y beneficios de asana. Trabajamos en la comprensión de las acciones y en sentir lo que hacemos y, así, abrirnos a la posibilidad de una mejor relación interna a partir del conocimiento propio surgido de la práctica.$angel$
     WHERE id = v_prof_id;
  END IF;

  -- 2. Asegurar que cualquier registro visible asociado a Ángel refleje la descripción oficial
  UPDATE public.profesionales
     SET descripcion = $angel$SOBRE MÍ:
Los últimos 6 años me dedico al estudio y la práctica de Yoga. Centrándome en la profundidad del trabajo físico y en los beneficios que procura a todos los niveles.
Siempre como estudiante, trato de compartir las enseñanzas que recibo y lo que aprendo de mi experiencia.

TITULACIONES:
Mi formación es constante y está basada en el autoestudio y la práctica, en recibir clases e intensivos de profesores con larga trayectoria —anatomía, asana, filosofía y todo lo necesario para mi desarrollo en el camino del yoga—.

ÁMBITOS DE SESIÓN:
La práctica se basa en el ajuste preciso y la correcta alineación del cuerpo. Adaptando la postura a las condiciones de cada alumno o alumna para encontrar los efectos y beneficios de asana. Trabajamos en la comprensión de las acciones y en sentir lo que hacemos y, así, abrirnos a la posibilidad de una mejor relación interna a partir del conocimiento propio surgido de la práctica.$angel$
   WHERE (lower(trim(email)) IN ('angeljavier.yoga@gmail.com', 'angel_profesor@genyoga.studio', 'angel@genyoga.es')
          OR translate(lower(nombre), 'áéíóúüñ', 'aeiouun') LIKE '%angel%')
     AND visible_publico = true;

  RAISE NOTICE 'Perfil de Ángel Javier actualizado con éxito en public.profesionales para v9.20';
END $$;

NOTIFY pgrst, 'reload schema';

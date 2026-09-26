-- Migration 202609260005: Configuración de Grupos de Miriam (Autoayuda y Terapéutico) como Consultas con aforo máx. 7
-- 1. Capacidad máxima: 7 personas (perímetro sala, Manu).
-- 2. Tipo de clase: 'psicologia' (tipo de consulta con Miriam Alfaro).
-- 3. Categoría en tipos_clases: 'consulta_grupal' / especialidad 'psicologia'.
-- 4. Textos oficiales detallados facilitados por Manu.

BEGIN;

-- 1. Actualizar tipos_clases
UPDATE public.tipos_clases
SET capacidad_predeterminada = 7,
    duracion_predeterminada = 120,
    especialidad = 'psicologia',
    categoria = 'consulta_grupal',
    color = '#8B5CF6',
    icono = 'ph-users-three',
    activo = true
WHERE id IN (65, 66);

-- 2. Actualizar sesiones de Grupo de Autoayuda (id 65)
UPDATE public.clases
SET tipo_clase = 'psicologia',
    capacidad_max = 7,
    duracion_minutos = 120,
    profesor_id = 10,
    descripcion = '🌱 Grupos de Autoayuda: espacios grupales centrados en una temática concreta y con un objetivo compartido. Desde nuestras experiencias, aprenderemos a comprender lo que nos ocurre y encontrar recursos para transitar ese proceso acompañados/as (2 h, 30 €/sesión, máx. 7 personas).'
WHERE tipo_clase_id = 65;

-- 3. Actualizar sesiones de Grupo Terapéutico (id 66)
UPDATE public.clases
SET tipo_clase = 'psicologia',
    capacidad_max = 7,
    duracion_minutos = 120,
    profesor_id = 10,
    descripcion = '🫂 Grupos Terapéuticos: grupos cerrados y continuados, con un número reducido de personas, donde se construye un espacio de confianza y vínculo. A lo largo del proceso iremos abordando diferentes aspectos: emociones, autoestima, relaciones, límites, historia personal, pérdidas, cambios vitales... Cuidamos la intimidad, la seguridad y los vínculos que se generen (2 h, 30 €/sesión, máx. 7 personas).'
WHERE tipo_clase_id = 66;

COMMIT;

-- ============================================================================
-- Migration 202609020031: Sync Canonical Teacher Photos in Profesionales Table
-- ============================================================================
-- Actualiza las rutas canonicales de foto_url para los 5 maestros y profesionales:
--   1. Ángel Javier: img/maestro-angel-recortado.webp
--   2. Silvia: img/maestra-silvia-recortada.webp
--   3. Miriam: img/maestra-miriam-recortada.webp
--   4. Isabel: img/maestra-isabel-recortada.webp
--   5. Yanira: img/maestra-yanira-recortada.webp
-- ============================================================================

begin;

-- 1. Ángel Javier
update public.profesionales
   set foto_url = 'img/maestro-angel-recortado.webp'
 where lower(email) like '%angel%'
    or lower(nombre) like '%ángel%'
    or lower(nombre) like '%angel%';

-- 2. Silvia
update public.profesionales
   set foto_url = 'img/maestra-silvia-recortada.webp'
 where lower(email) like '%silvia%'
    or lower(email) like '%sil-hada%'
    or lower(nombre) like '%silvia%';

-- 3. Miriam
update public.profesionales
   set foto_url = 'img/maestra-miriam-recortada.webp'
 where lower(email) like '%miriam%'
    or lower(email) like '%respira%'
    or lower(nombre) like '%miriam%';

-- 4. Isabel
update public.profesionales
   set foto_url = 'img/maestra-isabel-recortada.webp'
 where lower(email) like '%isabel%'
    or lower(email) like '%isarodriguez%'
    or lower(nombre) like '%isabel%';

-- 5. Yanira
update public.profesionales
   set foto_url = 'img/maestra-yanira-recortada.webp'
 where lower(email) like '%yanira%'
    or lower(nombre) like '%yanira%';

commit;

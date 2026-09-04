import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFile(path.join(root, rel), 'utf8');

console.log('--- Verificando Funcionalidad de Productos en Consultas (Stripe Online y Pago en Local) ---');

// 1. Verificación de la Migración SQL v12.15
const migration = await read('supabase/migrations/202609040001_v12_15_producto_contratado_consultas_online_y_local.sql');

assert.match(migration, /ALTER TABLE public\.reservas_psicologia[\s\S]*?ADD COLUMN IF NOT EXISTS producto_contratado text/i,
  'reservas_psicologia debe tener la columna producto_contratado');
assert.match(migration, /ALTER TABLE public\.reservas_psicologia[\s\S]*?ADD COLUMN IF NOT EXISTS stripe_lookup_key text/i,
  'reservas_psicologia debe tener la columna stripe_lookup_key');
assert.match(migration, /ALTER TABLE public\.reservas_psicologia[\s\S]*?ADD COLUMN IF NOT EXISTS origen_pago text DEFAULT 'online'/i,
  'reservas_psicologia debe tener la columna origen_pago');
assert.match(migration, /ALTER TABLE public\.reservas_psicologia[\s\S]*?ADD COLUMN IF NOT EXISTS notas text DEFAULT ''/i,
  'reservas_psicologia debe tener la columna notas');

assert.match(migration, /ALTER TABLE public\.reservas_nutricion[\s\S]*?ADD COLUMN IF NOT EXISTS producto_contratado text/i,
  'reservas_nutricion debe tener la columna producto_contratado');
assert.match(migration, /ALTER TABLE public\.reservas_nutricion[\s\S]*?ADD COLUMN IF NOT EXISTS stripe_lookup_key text/i,
  'reservas_nutricion debe tener la columna stripe_lookup_key');
assert.match(migration, /ALTER TABLE public\.reservas_nutricion[\s\S]*?ADD COLUMN IF NOT EXISTS origen_pago text DEFAULT 'online'/i,
  'reservas_nutricion debe tener la columna origen_pago');
assert.match(migration, /ALTER TABLE public\.reservas_nutricion[\s\S]*?ADD COLUMN IF NOT EXISTS notas text DEFAULT ''/i,
  'reservas_nutricion debe tener la columna notas');

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.reservar_consulta_atomica\([\s\S]*?p_producto_contratado text DEFAULT NULL[\s\S]*?p_stripe_lookup_key text DEFAULT NULL[\s\S]*?p_origen_pago text DEFAULT 'online'[\s\S]*?p_notas text DEFAULT NULL/i,
  'reservar_consulta_atomica debe admitir parámetros de producto, lookup, origen y notas');

assert.match(migration, /UPDATE public\.clases[\s\S]*?metodo_pago\s*=\s*COALESCE\(NULLIF\(v_effective_producto/i,
  'reservar_consulta_atomica debe sincronizar metodo_pago en public.clases');

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.reservar_consulta_virtual\([\s\S]*?p_producto_contratado text DEFAULT NULL/i,
  'reservar_consulta_virtual debe admitir producto_contratado');

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.admin_asignar_consulta_paciente\([\s\S]*?p_producto_contratado text DEFAULT NULL/i,
  'admin_asignar_consulta_paciente debe admitir producto_contratado');

console.log('  ✅ Migración SQL v12.15 verificada correctamente');

// 2. Verificación de profile.html
const profile = await read('profile.html');

assert.ok(profile.includes('function getProductosStripeProfesional'), 'profile.html debe definir getProductosStripeProfesional');
assert.ok(profile.includes('function obtenerDetalleProductoConsulta'), 'profile.html debe definir obtenerDetalleProductoConsulta');

// Comprobar catálogo por profesional
assert.ok(profile.includes('miriam_psico_individual_1a'), 'Debe incluir tarifa de 1ª sesión de Miriam');
assert.ok(profile.includes('miriam_psico_pareja_1a'), 'Debe incluir terapia de pareja de Miriam');
assert.ok(profile.includes('isabel_pni_1a'), 'Debe incluir 1ª consulta PNI de Isabel');
assert.ok(profile.includes('isabel_pni_sig'), 'Debe incluir seguimiento PNI de Isabel');
assert.ok(profile.includes('silvia_ayurveda_1a'), 'Debe incluir consulta Ayurveda de Silvia');

// Comprobar modal de asignación admin
assert.ok(profile.includes('id="swal-consulta-producto"'), 'Modal de asignación de consulta debe tener el selector swal-consulta-producto');
assert.ok(profile.includes('Producto / Tarifa Stripe pagada en el local'), 'Modal debe indicar explícitamente la tarifa pagada en el local');
assert.ok(profile.includes('lookupKey: selectedKey'), 'Modal debe extraer lookupKey seleccionado');
assert.ok(profile.includes('productoTitle: selectedTitle'), 'Modal debe extraer productoTitle seleccionado');

// Comprobar asignación y guardado
assert.ok(profile.includes("p_origen_pago: 'local'"), "asignarClienteAConsulta debe pasar origen_pago: 'local'");
assert.ok(profile.includes('metodo_pago: productoTitle'), 'asignarClienteAConsulta debe persistir metodo_pago en clases');

// Comprobar post-checkout auto-reserva
assert.ok(profile.includes("p_origen_pago: 'online'"), "Post-checkout debe marcar origen_pago: 'online'");
assert.ok(profile.includes('pendingData.producto_contratado'), 'Post-checkout debe preservar producto_contratado');

// Comprobar visualización de tags en paneles y calendarios
assert.ok(profile.includes('Pago en local:'), 'Debe mostrar badge de Pago en local');
assert.ok(profile.includes('Pagado online:'), 'Debe mostrar badge de Pagado online');
assert.ok(profile.includes('tagOnlineBadge'), 'Debe renderizar tag de consulta pagada online cuando el hueco está ocupado');

console.log('  ✅ profile.html verificado correctamente con todas las funcionalidades solicitadas');

console.log('\n🎉 ¡Todas las pruebas de asignación y tags de productos en consultas han pasado con éxito!');

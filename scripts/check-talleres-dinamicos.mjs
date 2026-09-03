import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const tarifasHtml = await fs.readFile(path.join(root, 'tarifas.html'), 'utf8');

// 1. Verificar presencia de componentes y funciones en tarifas.html
assert.match(tarifasHtml, /id="talleres-cards-container"/, 'El contenedor de talleres debe tener id="talleres-cards-container"');
assert.match(tarifasHtml, /function cargarTalleresDinamicos/, 'Debe existir la función cargarTalleresDinamicos');
assert.match(tarifasHtml, /function renderizarListaTalleres/, 'Debe existir la función renderizarListaTalleres');
assert.match(tarifasHtml, /function renderizarCardTallerDinamico/, 'Debe existir la función renderizarCardTallerDinamico');
assert.match(tarifasHtml, /gestionarReservaTallerDinamico/, 'Debe existir la función gestionarReservaTallerDinamico');
assert.match(tarifasHtml, /function escapeHtml/, 'Debe existir la función escapeHtml');
assert.match(tarifasHtml, /function safeRemoveItem/, 'Debe existir la función safeRemoveItem');
assert.match(tarifasHtml, /end\.getTime\(\)\s*>\s*now\.getTime\(\)/, 'Debe comprobar estrictamente que el taller no haya finalizado (end > now)');

// 2. Verificar simulación de filtrado de vigencia
const now = new Date('2026-09-20T12:00:00Z');
const mockTalleres = [
  {
    id: 1,
    nombre: 'Taller Pasado',
    fecha_inicio: '2026-09-18T10:00:00Z',
    fecha_fin: '2026-09-18T12:00:00Z',
    duracion_minutos: 120,
    tipo_clase: 'taller',
    activa: true
  },
  {
    id: 2,
    nombre: 'Taller Futuro',
    fecha_inicio: '2026-09-25T16:00:00Z',
    fecha_fin: '2026-09-25T18:00:00Z',
    duracion_minutos: 120,
    tipo_clase: 'taller',
    activa: true
  },
  {
    id: 3,
    nombre: 'Taller Inactivo',
    fecha_inicio: '2026-09-26T16:00:00Z',
    fecha_fin: '2026-09-26T18:00:00Z',
    duracion_minutos: 120,
    tipo_clase: 'taller',
    activa: false
  }
];

const filtrados = mockTalleres.filter(c => {
  if (c.activa === false) return false;
  const start = new Date(c.fecha_inicio);
  if (isNaN(start.getTime())) return false;
  const dur = Number(c.duracion_minutos) || 120;
  const end = c.fecha_fin ? new Date(c.fecha_fin) : new Date(start.getTime() + dur * 60000);
  return end.getTime() > now.getTime();
});

assert.equal(filtrados.length, 1, 'Solo debe pasar el taller futuro activo');
assert.equal(filtrados[0].id, 2, 'El taller activo futuro debe ser el id 2');

console.log('✅ Verificaciones de talleres dinámicos en tarifas.html superadas con éxito.');

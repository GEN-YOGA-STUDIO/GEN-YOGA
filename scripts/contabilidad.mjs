#!/usr/bin/env node
/**
 * scripts/contabilidad.mjs — Control económico (contabilidad B) con red de seguridad.
 *
 * El documento de contabilidad es privado: vive fuera del repositorio (en
 * .gitignore) y aquí solo se toca con doble garantía:
 *   1. Copia de seguridad fechada en ../contabilidad-b/ ANTES de escribir.
 *   2. Verificación de que nada se pierde: tras escribir, todas las líneas
 *      originales deben seguir presentes; si no, se restaura desde memoria.
 *   3. Se preserva la codificación y el fin de línea originales del fichero.
 *
 * Uso:
 *   node scripts/contabilidad.mjs estado
 *   node scripts/contabilidad.mjs anadir <version> <importe> <descripcion> [--dry-run]
 *   node scripts/contabilidad.mjs comprobar
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUTA = process.env.CONTABILIDAD_RUTA || path.join(root, 'docs', 'contabilidad b.md');
const DIR_BACKUP = process.env.CONTABILIDAD_BACKUP || path.resolve(root, '..', 'contabilidad-b');

const SECCION = '### Cambios mayores web app';
const SECCION_SIGUIENTE = '### Cambios mayores outlook';
const MARCA = '# CONTABILIDAD B';

/* --------------------------------------------------------------- codificación */
function leerPreservando() {
  if (!fs.existsSync(RUTA)) {
    throw new Error(`No existe ${RUTA}: sin control económico no se registra el cambio.`);
  }
  const buf = fs.readFileSync(RUTA);
  const comoUtf8 = buf.toString('utf8');
  const esUtf8 = Buffer.from(comoUtf8, 'utf8').equals(buf);
  const texto = esUtf8 ? comoUtf8 : buf.toString('latin1');
  const eol = texto.includes('\r\n') ? '\r\n' : '\n';
  if (!texto.includes(MARCA)) {
    throw new Error(`${path.basename(RUTA)} no parece la contabilidad B (falta la cabecera «${MARCA}»).`);
  }
  return { texto, codificacion: esUtf8 ? 'utf8' : 'latin1', eol, bytes: buf.length };
}

function hashear(t) {
  return createHash('sha256').update(t, 'utf8').digest('hex').slice(0, 12);
}

function hacerBackup(original) {
  fs.mkdirSync(DIR_BACKUP, { recursive: true });
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const sello = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const destino = path.join(DIR_BACKUP, `contabilidad-b-${sello}.md`);
  fs.writeFileSync(destino, original, 'latin1'); // bytes idénticos sea cual sea la codificación
  fs.writeFileSync(path.join(DIR_BACKUP, 'contabilidad-b-actual.md'), original, 'latin1');
  return destino;
}

/* --------------------------------------------------------------- construcción */
function construirLinea(version, importe, descripcion) {
  const imp = Number(importe);
  if (!Number.isFinite(imp) || imp < 0) throw new Error(`Importe inválido: ${importe}`);
  if (!descripcion.trim()) throw new Error('Falta la descripción para la contabilidad.');
  const estado = imp === 0 ? 'Sin importe' : `Pendiente ${imp}`;
  return `actualización ${version} -> ${descripcion.trim()} -> ${estado}`;
}

function insertarLinea(texto, linea, eol) {
  if (texto.includes(linea)) throw new Error('Esa línea ya está en la contabilidad.');
  const version = linea.match(/^actualización (\S+)/)?.[1];
  if (version && new RegExp(`^actualización ${version.replace(/\./g, '\\.')}\\b`, 'm').test(texto)) {
    throw new Error(`La versión ${version} ya tiene línea en la contabilidad.`);
  }

  let salida;
  const iSig = texto.indexOf(SECCION_SIGUIENTE);
  const iSec = texto.indexOf(SECCION);
  if (iSec === -1) throw new Error(`Falta la sección «${SECCION}» en la contabilidad.`);
  if (iSig > iSec) {
    // antes de la sección siguiente, respetando la línea en blanco que la precede
    salida = texto.slice(0, iSig) + linea + eol + eol + texto.slice(iSig);
  } else {
    const finLinea = texto.indexOf('\n', iSec);
    salida = texto.slice(0, finLinea + 1) + eol + linea + eol + texto.slice(finLinea + 1);
  }
  return salida;
}

/* -------------------------------------------------------------- comprobaciones */
function verificar(original, nuevo, linea) {
  const fallos = [];
  if (!nuevo.includes(linea)) fallos.push('la línea nueva no está en el fichero');
  const lineas = original.split(/\r?\n/).filter((l) => l.trim());
  for (const l of lineas) {
    if (!nuevo.includes(l)) { fallos.push(`se ha perdido la línea: ${l.slice(0, 70)}`); break; }
  }
  if (nuevo.length < original.length) {
    fallos.push(`el fichero ha encogido (${original.length} → ${nuevo.length} caracteres)`);
  }
  return fallos;
}

/* ----------------------------------------------------------------- operaciones */
export function estado() {
  const { texto, codificacion, eol, bytes } = leerPreservando();
  const lineas = texto.split(/\r?\n/);
  const conImporte = lineas.filter((l) => /^actualizaci[oó]n /.test(l));
  console.log(`Fichero : ${RUTA}`);
  console.log(`Tamaño  : ${bytes} bytes · codificación ${codificacion} · fin de línea ${JSON.stringify(eol)}`);
  console.log(`Líneas  : ${lineas.length} (${conImporte.length} de versión)`);
  console.log(`SHA     : ${hashear(texto)}`);
  const backups = fs.existsSync(DIR_BACKUP)
    ? fs.readdirSync(DIR_BACKUP).filter((f) => f.endsWith('.md')).sort()
    : [];
  console.log(`Backups : ${backups.length} en ${DIR_BACKUP}`);
  console.log('\nÚltimas líneas de versión:');
  for (const l of conImporte.slice(-5)) console.log(`  · ${l}`);
}

export function comprobar() {
  const { texto } = leerPreservando();
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim());
  const vacio = lineas.length === 0;
  console.log(vacio ? '❌ vacío' : `✅ contabilidad legible: ${lineas.length} líneas no vacías, ${hashear(texto)}`);
  return !vacio;
}

export function anadir(version, importe, descripcion, { dryRun = false } = {}) {
  const antes = leerPreservando();
  const linea = construirLinea(version, importe, descripcion);
  const despues = insertarLinea(antes.texto, linea, antes.eol);

  const fallos = verificar(antes.texto, despues, linea);
  if (fallos.length) {
    throw new Error('La operación habría perdido contenido, así que NO se escribe:\n  - ' + fallos.join('\n  - '));
  }

  if (dryRun) {
    console.log(`\n[dry-run] Se añadiría tras «${SECCION}»:`);
    console.log(`  ${linea}`);
    return { linea, escrito: false };
  }

  const backup = hacerBackup(antes.texto);
  console.log(`\n Backup previo: ${backup}`);

  try {
    fs.writeFileSync(RUTA, despues, antes.codificacion);
    const relectura = leerPreservando();
    const fallos2 = verificar(antes.texto, relectura.texto, linea);
    if (fallos2.length || !relectura.texto.includes(linea)) {
      throw new Error(fallos2.join('; ') || 'la línea no aparece tras releer');
    }
  } catch (e) {
    fs.writeFileSync(RUTA, antes.texto, antes.codificacion); // rollback
    throw new Error(`Se revierte el original: ${e.message}`);
  }

  console.log(`✅ Contabilidad actualizada (${hashear(antes.texto)} → ${hashear(leerPreservando().texto)})`);
  console.log(`   ${linea}`);
  return { linea, escrito: true, backup };
}

/* ------------------------------------------------------------------------ CLI */
const esCLI = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esCLI) {
  const [cmd, version, importe, ...resto] = process.argv.slice(2);
  const dryRun = process.argv.includes('--dry-run');
  try {
    if (cmd === 'estado') estado();
    else if (cmd === 'comprobar') comprobar();
    else if (cmd === 'anadir') anadir(version, importe, resto.join(' ').replace(/ --dry-run$/, ''), { dryRun });
    else {
      console.error('Uso: node scripts/contabilidad.mjs <estado|comprobar|anadir <version> <importe> <desc>>');
      process.exit(1);
    }
  } catch (e) {
    console.error(`\n❌ ${e.message}`);
    process.exit(1);
  }
}

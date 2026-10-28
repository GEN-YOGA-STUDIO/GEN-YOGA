#!/usr/bin/env node
// scripts/ciclo-nocturno.mjs
// Orquestador del ciclo nocturno completo de GEN Yoga:
// 1. Ejecuta la batería completa de salud (producción o cert).
// 2. Analiza evolutivos y calcula el Health Score de inteligencia diaria.
// 3. Genera el resumen visual para el equipo.
// 4. Emite el diagnóstico matutino (notificación / plan de acción para el día).
//
// Uso:
//   node scripts/ciclo-nocturno.mjs
//   node scripts/ciclo-nocturno.mjs --cert
//   node scripts/ciclo-nocturno.mjs --notify

import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const isCert = process.argv.includes('--cert') || process.env.CERT_MODE === '1';
const doNotify = process.argv.includes('--notify');
const envName = isCert ? 'Certificación' : 'Producción';
const prefix = isCert ? 'cert' : 'nightly';
const root = process.cwd();
const reportsDir = path.join(root, 'nightly-reports');

console.log(`\n======================================================`);
console.log(`🌙 INICIANDO CICLO NOCTURNO DE ${envName.toUpperCase()}`);
console.log(`======================================================`);
console.log(`Hora de inicio: ${new Date().toISOString()}`);
console.log(`Entorno: ${envName}`);
console.log(`Base URL: ${process.env.PROD_BASE_URL || (isCert ? 'https://gen-yoga-studio.github.io/GEN-YOGA-CERT' : 'https://genyoga.studio')}`);

function run(cmd, args = [], env = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, {
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    p.on('close', (code) => resolve(code));
  });
}

async function main() {
  const t0 = Date.now();

  // 1. Ejecutar el chequeo de salud
  console.log(`\n--- [1/4] Ejecución de batería de salud (${prefix}) ---`);
  const checkArgs = ['scripts/check-nightly-production.mjs'];
  if (isCert) checkArgs.push('--cert');
  const checkCode = await run('node', checkArgs);

  // 2. Ejecutar análisis diario de inteligencia + plan de mejoras
  console.log(`\n--- [2/4] Análisis inteligente diario, salud explicable y plan de mejoras ---`);
  const analArgs = ['scripts/analizar-informe-diario.mjs'];
  if (isCert) analArgs.push('--cert');
  await run('node', analArgs);

  // 3. Generar Step Summary
  console.log(`\n--- [3/4] Resumen estructurado del informe ---`);
  const summaryArgs = ['scripts/nightly-step-summary.mjs'];
  if (isCert) summaryArgs.push('nightly-reports/cert-action.json');
  await run('node', summaryArgs);

  // 4. Mostrar el plan accionable (sin aplicarlo)
  console.log(`\n--- [4/4] Plan de mejoras (revisión, no aplicación) ---`);
  const planFile = path.join(reportsDir, isCert ? 'plan-mejoras-cert.json' : 'plan-mejoras.json');
  let plan = null;
  if (existsSync(planFile)) {
    try { plan = JSON.parse(readFileSync(planFile, 'utf8')); } catch {}
  }
  if (plan) {
    console.log(`Salud ${plan.health?.score}/100 (${plan.health?.grade}) · ${plan.summary.total} propuesta(s) · ${plan.summary.auto} auto-aplicables`);
    for (const it of plan.items.slice(0, 5)) {
      console.log(`  • ${it.id} [${it.priority}] ${it.autoApplicable ? 'auto' : 'manual'} · ${it.title}`);
    }
    if (plan.items.length > 5) console.log(`  … y ${plan.items.length - 5} más en nightly-reports/${isCert ? 'plan-mejoras-cert' : 'plan-mejoras'}.md`);
    if (plan.summary.auto) {
      console.log(`\n👉 Para aplicar (explícito): npm run mejoras:aplicar -- --solo ${plan.items.find((i) => i.autoApplicable)?.id || 'M01'}`);
      console.log(`   O añade la etiqueta 'aplicar-mejoras' al issue del plan en GitHub.`);
    }
  } else {
    console.log('Sin plan generado (revisa el análisis diario).');
  }

  const durMin = ((Date.now() - t0) / 1000 / 60).toFixed(1);

  // Cargar métricas del análisis diario si existen
  const actionFile = path.join(reportsDir, `${prefix}-action.json`);
  let actionData = null;
  if (existsSync(actionFile)) {
    try { actionData = JSON.parse(readFileSync(actionFile, 'utf8')); } catch {}
  }

  console.log(`\n======================================================`);
  if (checkCode === 0) {
    console.log(`☀️ DIAGNÓSTICO MATUTINO: SISTEMA EN VERDE (OK)`);
    console.log(`======================================================`);
    console.log(`✅ Todas las comprobaciones han pasado con éxito (${durMin} min).`);
    if (actionData?.summary) {
      console.log(`- Checks ejecutados: ${actionData.summary.total}`);
      console.log(`- Superados: ${actionData.summary.passed}`);
      console.log(`- Avisos informativos: ${actionData.summary.warned}`);
    }
    if (plan?.health) {
      console.log(`- Salud: ${plan.health.score}/100 (${plan.health.grade}) · funcional ${plan.health.functionalScore} · experiencia ${plan.health.experienceScore}`);
      if (plan.health.personas) console.log(`- Personas: ${plan.health.personas.passed}/${plan.health.personas.total} limpias · fricción ${plan.health.personas.friction}/100`);
    }
    if (plan?.summary?.total) {
      console.log(`- Mejoras pendientes (no aplicadas): ${plan.summary.total} · ${plan.summary.auto} auto-aplicables`);
      console.log(`  Revisa nightly-reports/${isCert ? 'plan-mejoras-cert' : 'plan-mejoras'}.md`);
    }
    console.log(`\n🎉 El estudio y la plataforma web/apps están 100% listos para abrir por la mañana.`);

    if (doNotify || process.env.ALERT_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL) {
      console.log(`\n📡 Enviando notificación matutina verde...`);
      await run('node', ['scripts/nightly-notify.mjs', 'success']);
    }
  } else {
    console.log(`⚠️ DIAGNÓSTICO MATUTINO: ATENCIÓN REQUERIDA (FALLOS DETECTADOS)`);
    console.log(`======================================================`);
    console.log(`❌ Se detectaron fallos durante la pasada nocturna (${durMin} min).`);
    if (actionData) {
      console.log(`- Fallos totales: ${actionData.summary?.failed || 0} (${actionData.summary?.high || 0} de alta severidad)`);
      console.log(`\n📋 Fallos a revisar a primera hora:`);
      for (const f of actionData.failures || []) {
        console.log(`  • [${f.severity?.toUpperCase() || 'MED'}] ${f.suite} · ${f.check}: ${f.detail}`);
        if (f.suspectedFiles?.length) console.log(`    Sospechosos: ${f.suspectedFiles.join(', ')}`);
      }
    }
    console.log(`\n👉 Guía de acción para la mañana:`);
    console.log(`   1. Ver detalle completo en docs/FALLOS_PARA_IA.md y nightly-reports/${isCert ? 'plan-mejoras-cert' : 'plan-mejoras'}.md`);
    console.log(`   2. Para autolimpiar/corregir: ejecutar 'npm run mejoras:aplicar -- --solo M01' o revisar el PR automático de nightly-autofix.`);
    console.log(`   3. Verificar solución con: npm run ${isCert ? 'check:cert' : 'check:nightly'}`);

    if (doNotify || process.env.ALERT_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL) {
      console.log(`\n📡 Enviando alerta matutina con detalle de incidencias...`);
      await run('node', ['scripts/nightly-notify.mjs', 'failure']);
    }
  }
  console.log(`======================================================\n`);
  process.exit(checkCode);
}

main().catch((err) => {
  console.error('Error fatal en el ciclo nocturno:', err);
  process.exit(1);
});

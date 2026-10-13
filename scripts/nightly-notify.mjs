// scripts/nightly-notify.mjs
// Envía una notificación webhook opcional (Discord / Slack / Telegram / webhook genérico)
// cuando el chequeo nocturno o la validación de cert finalizan.
//
// Configuración:
//   Secreto de repositorio ALERT_WEBHOOK_URL (o DISCORD_WEBHOOK_URL / SLACK_WEBHOOK_URL).
//   Si no está configurado, termina en verde sin hacer nada (totalmente opcional).
//
// Uso: node scripts/nightly-notify.mjs [success|failure] [archivo-action.json]
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const webhookUrl = process.env.ALERT_WEBHOOK_URL
  || process.env.DISCORD_WEBHOOK_URL
  || process.env.SLACK_WEBHOOK_URL;

if (!webhookUrl) {
  console.log('ℹ️ Sin webhook configurado (ALERT_WEBHOOK_URL / DISCORD_WEBHOOK_URL). Notificación omitida.');
  process.exit(0);
}

const explicitStatus = process.argv[2];
const root = process.cwd();
const reportsDir = path.join(root, 'nightly-reports');

function findAction() {
  const argFile = process.argv[3];
  if (argFile) {
    try { return JSON.parse(readFileSync(path.resolve(argFile), 'utf8')); } catch {}
  }
  for (const name of ['cert-action.json', 'nightly-action.json']) {
    try { return JSON.parse(readFileSync(path.join(reportsDir, name), 'utf8')); } catch {}
  }
  return null;
}

const action = findAction();
const failed = action ? (action.summary?.failed ?? action.failures?.length ?? 0) : (explicitStatus === 'failure' ? 1 : 0);
const high = action ? (action.summary?.high ?? 0) : 0;
const isCert = action?.env === 'certificacion' || /cert/i.test(process.argv[3] || '');
const envLabel = isCert ? 'Certificación' : 'Producción';
const base = action?.base || (isCert ? 'https://gen-yoga-studio.github.io/GEN-YOGA-CERT' : 'https://genyoga.studio');
const runUrl = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : '';

const title = failed === 0
  ? `🟢 GEN Yoga [${envLabel}]: Salud Verificada`
  : `🔴 GEN Yoga [${envLabel}]: ${failed} Fallo(s) Detectado(s)${high > 0 ? ` (${high} alta severidad)` : ''}`;

const failList = (action?.failures || []).slice(0, 5).map((f) => `• [${f.severity}] ${f.suite} · ${f.check}: ${String(f.detail).slice(0, 100)}`).join('\n');

let payload;
if (webhookUrl.includes('discord.com/api/webhooks')) {
  payload = {
    embeds: [{
      title,
      description: failed === 0
        ? `Todas las comprobaciones contra **${base}** han pasado con éxito.`
        : `Se han detectado fallos en **${base}**:\n\n${failList || 'Revisar reporte en GitHub Actions.'}`,
      color: failed === 0 ? 0x22c55e : 0xef4444,
      fields: [
        { name: 'Entorno', value: envLabel, inline: true },
        { name: 'Fallos', value: String(failed), inline: true },
        ...(runUrl ? [{ name: 'Ejecución en GitHub', value: `[Ver Run en Actions](${runUrl})`, inline: false }] : []),
      ],
      timestamp: new Date().toISOString(),
    }],
  };
} else if (webhookUrl.includes('hooks.slack.com')) {
  payload = {
    text: `${title}\nBase: ${base}\n${failed > 0 ? `Fallos:\n${failList}\n` : ''}${runUrl ? `<${runUrl}|Ver ejecución en GitHub Actions>` : ''}`,
  };
} else {
  // Webhook genérico
  payload = {
    event: 'nightly-check',
    env: envLabel,
    base,
    failed,
    high,
    title,
    runUrl,
    failures: (action?.failures || []).slice(0, 10),
    timestamp: new Date().toISOString(),
  };
}

try {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: ctrl.signal,
  });
  clearTimeout(timer);
  if (res.ok) {
    console.log(`✅ Notificación enviada al webhook (${res.status}).`);
  } else {
    console.log(`⚠️ Webhook respondió HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  }
} catch (err) {
  console.log(`⚠️ No se pudo enviar la notificación webhook: ${err.message}`);
}

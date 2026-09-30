#!/bin/bash
# scripts/push-genyoga.sh — Sube `main` + tags a GEN-YOGA-STUDIO/GEN-YOGA usando el
# token de GEN Yoga (NO el de jaime312). El token se lee de un fichero local que
# nunca entra al repo (`.gh-genyoga-token`, ignorado en .gitignore).
#
# Uso:
#   1) pega el token dentro de .gh-genyoga-token (sin espacios ni saltos de línea)
#   2) bash scripts/push-genyoga.sh
#
# Verifica antes: quién es el token y si tiene escritura; si no, no intenta el push.
set -euo pipefail
cd "$(dirname "$0")/.."

TOKEN_FILE="${1:-.gh-genyoga-token}"
if [ ! -f "$TOKEN_FILE" ]; then
  echo "❌ Falta $TOKEN_FILE — guarda ahí el token de GEN Yoga (solo el token, nada más)."
  exit 1
fi
TOKEN="$(tr -d '\n\r \t' < "$TOKEN_FILE")"
if [ -z "$TOKEN" ]; then
  echo "❌ $TOKEN_FILE está vacío."
  exit 1
fi

echo "→ Verificando el token contra la API de GitHub…"
WHO_JSON="$(curl -s -H "Authorization: bearer $TOKEN" https://api.github.com/user)"
WHO="$(printf '%s' "$WHO_JSON" | python3 -c 'import sys,json
try:
  d=json.load(sys.stdin); print(d.get("login") or d.get("message","?"))
except Exception: print("?")')"
echo "  autenticado como: $WHO"

PERM="$(curl -s -H "Authorization: bearer $TOKEN" https://api.github.com/repos/GEN-YOGA-STUDIO/GEN-YOGA | python3 -c 'import sys,json
try:
  d=json.load(sys.stdin); print(d.get("permissions",{}).get("push"))
except Exception: print("?")')"
echo "  permiso de push sobre GEN-YOGA: $PERM"
if [ "$PERM" != "True" ]; then
  echo "❌ El token no tiene escritura sobre GEN-YOGA-STUDIO/GEN-YOGA."
  echo "   Revisa: Resource owner = GEN-YOGA-STUDIO · Contents: Read and write · Workflows: Read and write."
  exit 1
fi

echo "→ git push origin main --follow-tags"
# El token va en la URL SOLO para este comando (no se guarda en .git/config ni en el helper).
git push "https://x-access-token:${TOKEN}@github.com/GEN-YOGA-STUDIO/GEN-YOGA.git" main --follow-tags

echo "✅ Push completado. Run de Deploy Cert en curso (o recién terminado):"
GH_TOKEN="$TOKEN" gh run list -R GEN-YOGA-STUDIO/GEN-YOGA --workflow=deploy-cert.yml --limit 5 2>/dev/null \
  || curl -s -H "Authorization: bearer $TOKEN" "https://api.github.com/repos/GEN-YOGA-STUDIO/GEN-YOGA/actions/workflows/deploy-cert.yml/runs?per_page=5" \
     | python3 -c 'import sys,json
try:
  d=json.load(sys.stdin)
  for r in d.get("workflow_runs",[]):
    print(f"  {r.get(\"status\")}/{r.get(\"conclusion\")} {r.get(\"head_sha\",\"\")[:7]} {r.get(\"created_at\")}")
except Exception as e: print("  (no se pudo consultar el run:", e, ")")'

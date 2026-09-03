#!/bin/bash
set -e

SRC="/Users/jaimetrabajo/Library/CloudStorage/OneDrive-MadridDigital/APLICACIONES/gen_yoga_app/ultima version"
TMP="/tmp/gen_yoga_deploy"

echo "======================================================"
echo "🛡️  EJECUTANDO CONTROL DE CALIDAD EN VIDA REAL (SUPABASE + FRONTEND)"
echo "======================================================"

cd "$SRC"
python3 "$SRC/scripts/run-all-verifications.py"

echo "🚀 Desplegando GEN Yoga verificado a GitHub y Producción..."

if [ ! -d "$TMP/.git" ]; then
    rm -rf "$TMP"
    git clone https://github.com/jaime312/GEN-YOGA.git "$TMP"
    cd "$TMP"
else
    cd "$TMP"
    git fetch origin
    git reset --hard origin/main
fi

echo "1. Sincronizando ficheros verificados..."
cat "$SRC/package.json" > ./package.json
cat "$SRC/index.html" > ./index.html
cat "$SRC/clases.html" > ./clases.html
cat "$SRC/tarifas.html" > ./tarifas.html
cat "$SRC/profile.html" > ./profile.html
cat "$SRC/maestros.html" > ./maestros.html
cat "$SRC/success.html" > ./success.html
cat "$SRC/cancel.html" > ./cancel.html
cat "$SRC/politica-privacidad.html" > ./politica-privacidad.html
cat "$SRC/public-calendar.js" > ./public-calendar.js
cat "$SRC/i18n.js" > ./i18n.js

mkdir -p ./scripts
cat "$SRC/scripts/run-all-verifications.py" > ./scripts/run-all-verifications.py
chmod +x ./scripts/run-all-verifications.py
[ -f "$SRC/scripts/sync_apps.py" ] && cat "$SRC/scripts/sync_apps.py" > ./scripts/sync_apps.py
[ -f "$SRC/scripts/bump-version.mjs" ] && cat "$SRC/scripts/bump-version.mjs" > ./scripts/bump-version.mjs

mkdir -p ./supabase/migrations
cp -r "$SRC/supabase/migrations/"* ./supabase/migrations/

echo "2. Preparando commit..."
git add package.json index.html clases.html tarifas.html profile.html maestros.html success.html cancel.html politica-privacidad.html public-calendar.js i18n.js scripts/ supabase/

COMMIT_MSG="${1:-feat(v7.55): registro flexible con email o telefono como usuario principal, guia completa de bonos y control de calidad total}"
git commit -m "$COMMIT_MSG" || echo "Sin cambios para commitear."

echo "3. Pushing a origin main..."
git push origin main

echo ""
echo "🎉 ¡Control de calidad en vida real superado y despliegue completado con éxito en Producción!"

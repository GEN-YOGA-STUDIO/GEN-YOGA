#!/bin/bash
set -e

SRC="/Users/jaimetrabajo/Library/CloudStorage/OneDrive-MadridDigital/APLICACIONES/gen_yoga_app/ultima version"
TMP="/tmp/gen_yoga_deploy"

echo "🚀 Desplegando GEN Yoga v8.00 a GitHub y Producción..."

if [ ! -d "$TMP/.git" ]; then
    rm -rf "$TMP"
    git clone https://github.com/jaime312/GEN-YOGA.git "$TMP"
fi

cd "$TMP"
git fetch origin
git reset --hard origin/main

echo "1. Copiando ficheros actualizados v8.00..."
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

mkdir -p ./supabase/migrations
cp -r "$SRC/supabase/migrations/"* ./supabase/migrations/

echo "2. Añadiendo cambios y haciendo commit v8.00..."
git add package.json index.html clases.html tarifas.html profile.html maestros.html success.html cancel.html politica-privacidad.html public-calendar.js i18n.js supabase/migrations/
git commit -m "feat(v8.00): eliminacion de consultas de nutricion y estado en construccion" || echo "Sin cambios"

echo "3. Pushing a origin main..."
git push origin main

echo ""
echo "🎉 ¡Despliegue de la versión 8.00 completado con éxito en GitHub y Producción!"



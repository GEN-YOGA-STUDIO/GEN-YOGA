#!/bin/bash
set -e

SRC="/Users/jaimetrabajo/Library/CloudStorage/OneDrive-MadridDigital/APLICACIONES/gen_yoga_app/ultima version"
TMP="/tmp/gen_yoga_deploy"

echo "🚀 Desplegando GEN Yoga v7.5..."

rm -rf "$TMP"
git clone https://github.com/jaime312/GEN-YOGA.git "$TMP"

cd "$TMP"
cp "$SRC/package.json" .
cp "$SRC/index.html" .
cp "$SRC/clases.html" .
cp "$SRC/tarifas.html" .
cp "$SRC/profile.html" .
cp "$SRC/maestros.html" .
cp "$SRC/success.html" .
cp "$SRC/cancel.html" .
cp "$SRC/politica-privacidad.html" .
cp "$SRC/public-calendar.js" .

mkdir -p supabase/migrations
cp "$SRC"/supabase/migrations/*.sql supabase/migrations/

git add -A
git commit -m "feat(v7.5): version 7.5 en produccion, Power Vinyasa Clase Abierta, flujo sesion introductoria y eliminacion con reembolso"
git push origin main

echo "🎉 ¡Despliegue de la versión 7.5 completado con éxito en GitHub!"

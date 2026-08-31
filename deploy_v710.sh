#!/bin/bash
set -e

SRC="/Users/jaimetrabajo/Library/CloudStorage/OneDrive-MadridDigital/APLICACIONES/gen_yoga_app/ultima version"
TMP="/tmp/gen_yoga_deploy"

echo "🚀 Desplegando GEN Yoga v7.10 a GitHub y Producción..."

if [ ! -d "$TMP/.git" ]; then
    rm -rf "$TMP"
    git clone https://github.com/jaime312/GEN-YOGA.git "$TMP"
fi

cd "$TMP"

echo "1. Copiando ficheros actualizados v7.10..."
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

mkdir -p ./supabase/migrations
[ -f "$SRC/supabase/migrations/202609020035_fix_reservar_con_bono_signature_and_unlimited_sync.sql" ] && cat "$SRC/supabase/migrations/202609020035_fix_reservar_con_bono_signature_and_unlimited_sync.sql" > ./supabase/migrations/202609020035_fix_reservar_con_bono_signature_and_unlimited_sync.sql
[ -f "$SRC/supabase/migrations/202609020036_merge_yanira_teacher_accounts.sql" ] && cat "$SRC/supabase/migrations/202609020036_merge_yanira_teacher_accounts.sql" > ./supabase/migrations/202609020036_merge_yanira_teacher_accounts.sql
[ -f "$SRC/supabase/migrations/202609020037_admin_eliminar_clase_con_reembolso.sql" ] && cat "$SRC/supabase/migrations/202609020037_admin_eliminar_clase_con_reembolso.sql" > ./supabase/migrations/202609020037_admin_eliminar_clase_con_reembolso.sql
[ -f "$SRC/supabase/migrations/202609020038_rename_yanira_open_classes_september.sql" ] && cat "$SRC/supabase/migrations/202609020038_rename_yanira_open_classes_september.sql" > ./supabase/migrations/202609020038_rename_yanira_open_classes_september.sql
[ -f "$SRC/supabase/migrations/202609020039_enforce_free_and_normal_yoga_class_booking_rules.sql" ] && cat "$SRC/supabase/migrations/202609020039_enforce_free_and_normal_yoga_class_booking_rules.sql" > ./supabase/migrations/202609020039_enforce_free_and_normal_yoga_class_booking_rules.sql

echo "2. Añadiendo cambios y haciendo commit v7.10..."
git add package.json index.html clases.html tarifas.html profile.html maestros.html success.html cancel.html politica-privacidad.html public-calendar.js supabase/migrations/
git commit -m "fix(v7.10): restaurar carga de asistencias, visualizacion de clases y gestion de alumnos para administradores y profesores"

echo "3. Pushing a origin main..."
git push origin main

echo ""
echo "🎉 ¡Despliegue de la versión 7.10 completado con éxito en GitHub y Producción!"

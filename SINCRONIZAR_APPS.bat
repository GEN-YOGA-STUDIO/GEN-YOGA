@echo off
chcp 65001 > nul
echo ======================================================
echo 🔄 SINCRONIZANDO CAMBIOS A WEB, ANDROID E IOS...
echo ======================================================
python scripts\sync_apps.py
echo.
echo ✅ ¡Sincronización terminada!
pause

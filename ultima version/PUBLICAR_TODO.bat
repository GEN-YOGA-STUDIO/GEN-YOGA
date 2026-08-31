@echo off
chcp 65001 > nul
echo ======================================================
echo 🚀 PUBLICACIÓN AUTOMÁTICA (WEB + ANDROID + APPLE)
echo ======================================================
echo.
set /p VERSION="Introduce nueva versión (ej: 6.43) o pulsa ENTER para mantener: "
set /p MSG="Mensaje de los cambios (o pulsa ENTER): "

if "%MSG%"=="" set MSG=Actualización automática multiplataforma

python scripts\deploy_all.py "%VERSION%" "" "%MSG%"
echo.
pause

@echo off
chcp 65001 >nul
title BASCULA-ERP - Respaldo de base de datos
echo.
echo  ============================================
echo    BASCULA-ERP  -  Respaldo de base de datos
echo  ============================================
echo.
cd /d "%~dp0backend"
node scripts\backup-db.cjs
echo.
if %errorlevel%==0 (
    echo  [OK] Respaldo completado correctamente.
) else (
    echo  [ERROR] El respaldo fallo. Revisa el mensaje de arriba.
)
echo.
REM Si se ejecuta manualmente (doble clic) espera una tecla; el programador de
REM tareas pasa el argumento /auto para no quedarse esperando.
if not "%1"=="/auto" pause

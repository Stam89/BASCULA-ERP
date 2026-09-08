@echo off
chcp 65001 >nul
title BASCULA-ERP - Respaldo local (retencion 7 dias)
echo.
echo  =====================================================
echo    BASCULA-ERP  -  Respaldo local (retencion 7 dias)
echo  =====================================================
echo.
echo  Crea un volcado de la base (pg_dump) en backend\backups
echo  y conserva SOLO los ultimos 7 dias. Es independiente del
echo  respaldo en OneDrive (que guarda 30 copias por cantidad).
echo.
cd /d "%~dp0backend"
node scripts\backup-db-7dias.cjs
echo.
if %errorlevel%==0 (
    echo  [OK] Respaldo local completado.
) else (
    echo  [ERROR] El respaldo fallo. Revisa el mensaje de arriba.
)
echo.
REM Doble clic: espera una tecla. El Programador de tareas debe pasar /auto
REM para no quedarse esperando:
REM   schtasks /Create /SC DAILY /ST 20:30 /TN "BASCULA-ERP Respaldo 7 dias" ^
REM     /TR "\"%~dp0RESPALDO-BD-7DIAS.bat\" /auto" /RL LIMITED /F
if not "%1"=="/auto" pause

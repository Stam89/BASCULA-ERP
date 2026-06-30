@echo off
title BASCULA ERP - Iniciando...
color 0A

echo.
echo  =============================================
echo       BASCULA ERP - Iniciando sistema...
echo  =============================================
echo.

:: Verificar si ya hay algo corriendo en los puertos
netstat -ano | find ":4000" | find "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo  [OK] Backend ya esta corriendo en puerto 4000
) else (
    echo  [>>] Iniciando Backend...
    start "BASCULA-ERP Backend" /min cmd /k "cd /d "%~dp0backend" && npm run dev"
    timeout /t 4 /nobreak >nul
    echo  [OK] Backend iniciado
)

netstat -ano | find ":5173" | find "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo  [OK] Frontend ya esta corriendo en puerto 5173
) else (
    echo  [>>] Iniciando Frontend...
    start "BASCULA-ERP Frontend" /min cmd /k "cd /d "%~dp0web-admin" && npm run dev"
    timeout /t 5 /nobreak >nul
    echo  [OK] Frontend iniciado
)

echo.
echo  [>>] Abriendo navegador...
timeout /t 2 /nobreak >nul
start "" "http://localhost:5173"

echo.
echo  =============================================
echo   Sistema listo en: http://localhost:5173
echo
echo   Para cerrar el sistema, cierra las ventanas
echo   minimizadas en la barra de tareas.
echo  =============================================
echo.
pause

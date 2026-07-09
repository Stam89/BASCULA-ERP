@echo off
chcp 65001 >nul
title BASCULA-ERP - Servidor en red local
color 0A
echo.
echo  ==================================================
echo    BASCULA-ERP  -  Iniciando servidor en red local
echo  ==================================================
echo.
echo  Preparando la aplicacion... (esto tarda ~1 minuto)
echo.

REM 1) Compilar la app web
cd /d "%~dp0web-admin"
echo  [1/3] Compilando la aplicacion web...
call npm run build
if errorlevel 1 goto :error

REM 2) Compilar el backend
cd /d "%~dp0backend"
echo  [2/3] Compilando el servidor...
call npm run build
if errorlevel 1 goto :error

REM 3) Mostrar las direcciones de red de este equipo
echo.
echo  [3/3] Direcciones para entrar desde otras PC o tablets:
echo  ------------------------------------------------------
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    for /f "tokens=* delims= " %%b in ("%%a") do echo        http://%%b:4000
)
echo  ------------------------------------------------------
echo  En este mismo equipo: http://localhost:4000
echo.
echo  Deja esta ventana ABIERTA mientras usan el sistema.
echo  Para apagar el servidor, cierra esta ventana.
echo.

REM 4) Iniciar el servidor (sirve la web y la API en el puerto 4000)
call npm start
goto :end

:error
echo.
echo  [ERROR] Fallo la preparacion. Revisa el mensaje de arriba.
pause

:end

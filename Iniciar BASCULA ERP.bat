@echo off
chcp 65001 >nul
title BASCULA ERP
color 0A
echo ================================================
echo            INICIANDO BASCULA ERP
echo ================================================
echo.
echo  Espera unos segundos, se abrira solo en el
echo  navegador. NO cierres esta ventana mientras
echo  uses la aplicacion.
echo.
echo ================================================
echo.

echo [1/4] Actualizando la base de datos...
cd /d "%~dp0backend"
call npm run db:migrate

echo.
echo [2/4] Preparando la pagina web...
cd /d "%~dp0web-admin"
call npm run build

echo.
echo [3/4] Compilando el servidor...
cd /d "%~dp0backend"
call npm run build

echo.
echo [4/4] Encendiendo el servidor...
echo.
echo  ^>^> La aplicacion se abrira en el navegador.
echo  ^>^> Si no se abre sola, entra a:  http://localhost:4000
echo.

REM Abre el navegador despues de 6 segundos (mientras el servidor arranca)
start "" cmd /c "timeout /t 6 >nul & start http://localhost:4000"

REM Arranca el servidor COMPILADO (estable, sin modo desarrollo/watch).
REM Esta ventana queda encendida mientras uses la app.
cd /d "%~dp0backend"
call npm start

echo.
echo El servidor se detuvo. Puedes cerrar esta ventana.
pause

@echo off
REM ============================================================
REM  BASCULA-ERP - Inicia el servidor de la aplicacion
REM  Doble clic y listo. Deja esta ventana abierta mientras usas
REM  la app. Para apagar el servidor, cierra esta ventana.
REM ============================================================
title BASCULA-ERP Servidor (puerto 4000)
cd /d "%~dp0backend"
echo Iniciando BASCULA-ERP en http://localhost:4000 ...
echo.
"C:\Program Files\nodejs\npm.cmd" start
pause

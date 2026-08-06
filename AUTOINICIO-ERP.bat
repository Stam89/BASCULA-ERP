@echo off
REM ============================================================
REM  BASCULA-ERP - Autoinicio robusto (lo usa el Programador de
REM  tareas al iniciar sesion).
REM  1) Espera a que OneDrive tenga listos los archivos.
REM  2) Si el servidor ya corre, no hace nada (evita duplicados).
REM  3) Si no corre, lo levanta minimizado.
REM ============================================================
set PROYECTO=C:\Users\Usuario\OneDrive\Documentos\GitHub\BASCULA-ERP
set INTENTOS=0

:esperar
if exist "%PROYECTO%\backend\dist\server.js" goto listo
set /a INTENTOS+=1
if %INTENTOS% GEQ 36 goto fallo
timeout /t 5 /nobreak >nul
goto esperar

:listo
REM Si ya responde el puerto 4000, salir sin hacer nada
curl -s -o NUL --max-time 3 http://localhost:4000/ && exit /b 0
cd /d "%PROYECTO%\backend"
start "BASCULA-ERP Servidor" /min "C:\Program Files\nodejs\node.exe" dist/server.js
exit /b 0

:fallo
exit /b 1

@echo off
chcp 65001 >nul
title Verificar BASCULA ERP
echo ============================================
echo   VERIFICANDO BASCULA ERP...
echo ============================================
echo.
echo Este chequeo no modifica datos. Revisa configuracion,
echo migraciones, indices criticos, inventario y tickets.
echo.

cd /d "%~dp0backend"
call npm run preflight
set CHECK_EXIT=%ERRORLEVEL%

echo.
echo ============================================
if "%CHECK_EXIT%"=="0" (
  echo   Verificacion OK. Puedes trabajar.
) else (
  echo   ATENCION: NO OPERAR TODAVIA.
  echo   Corrige los errores mostrados arriba.
)
echo ============================================
echo.
pause
exit /b %CHECK_EXIT%

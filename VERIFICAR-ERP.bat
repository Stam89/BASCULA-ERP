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

echo.
echo ============================================
echo   Verificacion terminada.
echo ============================================
echo.
pause

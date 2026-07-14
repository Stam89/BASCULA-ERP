@echo off
chcp 65001 >nul
title Actualizar base de datos - BASCULA ERP
echo ============================================
echo   ACTUALIZANDO LA BASE DE DATOS...
echo ============================================
echo.

cd /d "%~dp0backend"
call npm run db:migrate

echo.
echo ============================================
echo   Listo. Ya puedes cerrar esta ventana.
echo ============================================
echo.
pause

@echo off
chcp 65001 >nul
title BASCULA-ERP - Importar tickets de la bascula
echo.
echo  ==================================================
echo    Importar tickets de la app de bascula (Firebase)
echo  ==================================================
echo.
cd /d "%~dp0backend"
node scripts\import-from-firebase.cjs
echo.
pause

@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar-sistema.ps1"
if errorlevel 1 (
  echo.
  echo No se pudo abrir BASCULA ERP. Revisa el mensaje anterior.
  pause
)

@echo off
chcp 65001 >nul
title BASCULA-ERP - Instalar respaldo automatico
echo.
echo  ==================================================
echo    BASCULA-ERP  -  Instalar respaldo automatico
echo  ==================================================
echo.
echo  Esto programa un respaldo diario de la base de datos
echo  a las 8:00 PM. Los respaldos se guardan en OneDrive
echo  (carpeta BASCULA-ERP-Backups) y se suben a la nube.
echo.
echo  La PC debe estar encendida a esa hora. Si no lo esta,
echo  el respaldo se ejecutara la proxima vez que enciendas.
echo.
pause

schtasks /Create /SC DAILY /ST 20:00 /TN "BASCULA-ERP Respaldo" ^
  /TR "\"%~dp0RESPALDO-BASCULA.bat\" /auto" /RL LIMITED /F

echo.
if %errorlevel%==0 (
    echo  [OK] Respaldo automatico programado a las 8:00 PM cada dia.
    echo       Para cambiar la hora, vuelve a ejecutar este archivo
    echo       o usa el Programador de tareas de Windows.
) else (
    echo  [ERROR] No se pudo programar la tarea.
    echo          Intenta ejecutar este archivo como Administrador
    echo          (clic derecho ^> Ejecutar como administrador).
)
echo.
pause

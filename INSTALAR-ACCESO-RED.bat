@echo off
chcp 65001 >nul
title BASCULA-ERP - Permitir acceso desde la red
echo.
echo  ==================================================
echo    BASCULA-ERP  -  Permitir acceso desde la red
echo  ==================================================
echo.
echo  Esto abre el puerto 4000 en el Firewall de Windows
echo  para que otras computadoras y tablets de la red puedan
echo  entrar al sistema. Se ejecuta UNA SOLA VEZ.
echo.
echo  Requiere permisos de Administrador.
echo.
pause

netsh advfirewall firewall delete rule name="BASCULA-ERP" >nul 2>&1
netsh advfirewall firewall add rule name="BASCULA-ERP" dir=in action=allow protocol=TCP localport=4000

echo.
if %errorlevel%==0 (
    echo  [OK] Listo. Las demas PC ya pueden entrar por la red.
    echo       Ahora inicia el sistema con INICIAR-EN-RED.bat
) else (
    echo  [ERROR] No se pudo abrir el puerto.
    echo          Cierra esta ventana y vuelve a intentarlo con
    echo          clic derecho ^> Ejecutar como administrador.
)
echo.
pause

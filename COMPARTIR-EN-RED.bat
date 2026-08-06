@echo off
REM ============================================================
REM  BASCULA-ERP - Permitir acceso desde OTRAS computadoras
REM  de la misma red (Wi-Fi / cable al mismo router).
REM
REM  IMPORTANTE: clic derecho -> "Ejecutar como administrador"
REM  Solo necesitas correrlo UNA VEZ en esta computadora.
REM ============================================================
echo Creando regla de firewall para el puerto 4000...
netsh advfirewall firewall add rule name="BASCULA-ERP (puerto 4000)" dir=in action=allow protocol=TCP localport=4000
echo.
echo ============================================================
echo  Listo. Esta computadora ya comparte la app en la red.
echo.
echo  Tu IP en esta red es alguna de estas:
ipconfig | findstr /C:"IPv4"
echo.
echo  En la OTRA computadora (conectada al mismo Wi-Fi/router)
echo  abre el navegador y entra a:
echo.
echo      http://TU-IP:4000
echo.
echo  Ejemplo: si arriba dice 192.168.1.50, entra a
echo      http://192.168.1.50:4000
echo ============================================================
pause

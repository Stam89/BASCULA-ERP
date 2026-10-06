@echo off
chcp 65001 >nul
title BASCULA-ERP - Instalar vigilante del servidor
echo.
echo  ==================================================
echo    BASCULA-ERP  -  Vigilante del servidor
echo  ==================================================
echo.
echo  Crea una tarea que revisa cada minuto si el ERP responde
echo  y, si se cayo, lo levanta solo y oculto (sin ventana).
echo  No necesita permisos de Administrador. Se puede repetir
echo  las veces que haga falta (reemplaza la tarea anterior).
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
 "$v = Join-Path '%~dp0backend\scripts' 'vigilante-erp.vbs';" ^
 "$a = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('//B //Nologo \"' + $v + '\"');" ^
 "$t1 = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME;" ^
 "$t2 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650);" ^
 "$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 3);" ^
 "Register-ScheduledTask -TaskName 'BASCULA-ERP Vigilante' -Action $a -Trigger @($t1,$t2) -Settings $s -Description 'Levanta el ERP si no responde' -Force | Out-Null; Write-Host '  [OK] Vigilante instalado.'"
if %errorlevel% neq 0 echo  [ERROR] No se pudo instalar el vigilante.
echo.
if not "%1"=="/auto" pause

# BASCULA-ERP · Vigilante del servidor
# Lo ejecuta el Programador de tareas cada minuto (y al iniciar sesión). Si el ERP
# NO responde en http://127.0.0.1:4000/health, lo levanta OCULTO (sin ventana que
# alguien pueda cerrar por error). Si está sano, no hace nada.
# Instalar / reinstalar: doble clic en INSTALAR-VIGILANTE-ERP.bat
$ErrorActionPreference = "SilentlyContinue"
$backend = Split-Path -Parent $PSScriptRoot            # ...\backend
$logs = Join-Path $backend "logs"
$bitacora = Join-Path $logs "vigilante.log"
New-Item -ItemType Directory -Force -Path $logs | Out-Null

function Escribir($m) {
  $linea = "{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $m
  Add-Content -Path $bitacora -Value $linea -Encoding UTF8
  # Bitácora acotada: si pasa de ~200 KB se queda con las últimas 300 líneas.
  if ((Get-Item $bitacora).Length -gt 200KB) { Get-Content $bitacora -Tail 300 | Set-Content $bitacora -Encoding UTF8 }
}
function Vivo {
  try { return (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:4000/health" -TimeoutSec 5).StatusCode -eq 200 } catch { return $false }
}

if (Vivo) { exit 0 }

# ¿Hay un servidor arrancando justo ahora? Darle tiempo (tarda ~10 s en estar listo).
$procs = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match "dist[\/]server\.js" })
$joven = $procs | Where-Object { $_.CreationDate -and ((Get-Date) - $_.CreationDate).TotalSeconds -lt 90 }
if ($joven) { exit 0 }

Start-Sleep -Seconds 8           # segunda comprobación: evita falsos positivos
if (Vivo) { exit 0 }

if (-not (Test-Path (Join-Path $backend "dist\server.js"))) {
  Escribir "ERROR: no existe backend\dist\server.js (falta compilar: npm run build)."
  exit 1
}
# Colgado: hay proceso viejo pero no responde -> se cierra antes de relanzar.
foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force; Escribir "Proceso colgado cerrado (PID $($p.ProcessId))." }
Start-Sleep -Seconds 2

# Guarda el motivo de la caída: server-err.log se reescribe al relanzar, así que se copia antes a un historial
# acotado (auditoría 2026-11-19: ~50 caídas sin rastro).
$err = Join-Path $logs "server-err.log"
if ((Test-Path $err) -and (Get-Item $err).Length -gt 0) {
  $hist = Join-Path $logs "server-err-historial.log"
  Add-Content -Path $hist -Value ("===== Caída detectada {0:yyyy-MM-dd HH:mm:ss} =====" -f (Get-Date)) -Encoding UTF8
  Get-Content $err -Tail 80 -Encoding UTF8 | Add-Content -Path $hist -Encoding UTF8
  if ((Get-Item $hist).Length -gt 500KB) { Get-Content $hist -Tail 2000 -Encoding UTF8 | Set-Content $hist -Encoding UTF8 }
}
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = "C:\Program Files\nodejs\node.exe" }
$nuevo = Start-Process -FilePath $node -ArgumentList "dist/server.js" -WorkingDirectory $backend -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logs "server-out.log") -RedirectStandardError (Join-Path $logs "server-err.log") -PassThru
Start-Sleep -Seconds 12
if (Vivo) { Escribir "ERP estaba caído: se levantó solo (PID $($nuevo.Id))." } else { Escribir "ERP se lanzó (PID $($nuevo.Id)) pero aún no responde; se revisa en el próximo minuto." }

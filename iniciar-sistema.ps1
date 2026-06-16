$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $root "backend"
$webDir = Join-Path $root "web-admin"
$logs = Join-Path $root "logs"
$nodeDir = "C:\Program Files\nodejs"
$npmCmd = Join-Path $nodeDir "npm.cmd"
$nodeCmd = Join-Path $nodeDir "node.exe"
$databaseUrl = $env:DATABASE_URL

if ([string]::IsNullOrWhiteSpace($databaseUrl)) {
  $databaseUrl = "postgres://postgres:postgres@localhost:5432/bascula_erp"
}

New-Item -ItemType Directory -Force -Path $logs | Out-Null

function Write-Step($message) {
  Write-Host ""
  Write-Host "== $message" -ForegroundColor Cyan
}

function Test-HttpOk($url) {
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Test-BackendOk {
  try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:4000/health" -TimeoutSec 3
    return $response.ok -eq $true
  } catch {
    return $false
  }
}

function Wait-Until($name, [scriptblock]$condition, $seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    if (& $condition) {
      Write-Host "$name listo." -ForegroundColor Green
      return $true
    }
    Start-Sleep -Seconds 1
  }
  Write-Host "$name no respondio a tiempo." -ForegroundColor Yellow
  return $false
}

function Test-PostgresConnection {
  Push-Location $backendDir
  try {
    $script = "const { Client } = require('pg'); const c = new Client({ connectionString: process.env.DATABASE_URL }); c.connect().then(() => c.query('select 1')).then(() => c.end()).then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });"
    $env:DATABASE_URL = $databaseUrl
    & $nodeCmd -e $script *> (Join-Path $logs "postgres-check.log")
    return $LASTEXITCODE -eq 0
  } finally {
    Pop-Location
  }
}

function Try-StartPostgresService {
  $services = @(Get-Service -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -like "postgres*" -or $_.DisplayName -like "PostgreSQL*"
  })

  if ($services.Count -eq 0) {
    Write-Host "No encontre un servicio de PostgreSQL instalado." -ForegroundColor Yellow
    return
  }

  foreach ($service in $services) {
    if ($service.Status -ne "Running") {
      try {
        Write-Host "Iniciando servicio $($service.DisplayName)..."
        Start-Service -Name $service.Name
      } catch {
        Write-Host "No pude iniciar $($service.DisplayName): $($_.Exception.Message)" -ForegroundColor Yellow
      }
    }
  }
}

function Start-NpmApp($name, $workingDirectory, $arguments, $stdout, $stderr) {
  Write-Host "Iniciando $name..."
  $envPath = "$nodeDir;$env:Path"
  $command = "`$env:Path='$envPath'; `$env:DATABASE_URL='$databaseUrl'; & '$npmCmd' $arguments"
  Start-Process -WindowStyle Hidden -FilePath powershell.exe `
    -WorkingDirectory $workingDirectory `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $command) `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr
}

Write-Step "Revisando Node.js"
if (!(Test-Path $npmCmd) -or !(Test-Path $nodeCmd)) {
  throw "No encontre Node.js en $nodeDir. Instala Node.js LTS o corrige la ruta."
}
Write-Host "Node.js encontrado." -ForegroundColor Green

Write-Step "Revisando PostgreSQL"
if (!(Test-PostgresConnection)) {
  Try-StartPostgresService
  Start-Sleep -Seconds 3
}

if (!(Test-PostgresConnection)) {
  Write-Host "No pude conectar a PostgreSQL con:" -ForegroundColor Red
  Write-Host $databaseUrl -ForegroundColor Red
  Write-Host "Abre PostgreSQL o revisa la clave/servicio. Log: $logs\postgres-check.log" -ForegroundColor Yellow
  exit 1
}
Write-Host "Base de datos conectada." -ForegroundColor Green

Write-Step "Iniciando backend"
if (Test-BackendOk) {
  Write-Host "Backend ya estaba activo." -ForegroundColor Green
} else {
  Start-NpmApp "backend" $backendDir "run dev" (Join-Path $logs "backend.log") (Join-Path $logs "backend.err.log")
  Wait-Until "Backend" { Test-BackendOk } 35 | Out-Null
}

Write-Step "Iniciando panel web"
if (Test-HttpOk "http://127.0.0.1:5173/") {
  Write-Host "Panel web ya estaba activo." -ForegroundColor Green
} else {
  Start-NpmApp "panel web" $webDir "run dev -- --host 127.0.0.1" (Join-Path $logs "web.log") (Join-Path $logs "web.err.log")
  Wait-Until "Panel web" { Test-HttpOk "http://127.0.0.1:5173/" } 35 | Out-Null
}

Write-Step "Abriendo sistema"
$panelUrl = "http://127.0.0.1:5173/"
Start-Process $panelUrl

Write-Host ""
Write-Host "Sistema listo." -ForegroundColor Green
Write-Host "Panel web: $panelUrl"
Write-Host "Backend: http://127.0.0.1:4000/health"
Write-Host "Logs: $logs"
Write-Host ""

<#
Start VEIL for a demo on Windows: frees ports 8000 and 3000, builds the web console, then opens two windows
(backend log and frontend log) so you can watch what happens, and waits until the backend answers.

  .\scripts\start.ps1            # Gemma on (waits for it to load)
  .\scripts\start.ps1 -Fast      # rules only: instant, repeatable agent demo
  .\scripts\start.ps1 -NoBuild   # skip "npm run build" when nothing in frontend/ changed
  .\scripts\start.ps1 -BackendOnly   # just the backend window (enough for the extension and the MCP server)

Run it from anywhere; it finds the repo root itself. Stop everything with .\scripts\stop.ps1.
#>
param(
    [switch]$Fast,
    [switch]$NoBuild,
    [switch]$BackendOnly
)

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "VEIL: starting from $root" -ForegroundColor Cyan

$ports = if ($BackendOnly) { @(8000) } else { @(8000, 3000) }
foreach ($port in $ports) {
    $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) {
        $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
        Write-Host ("Port {0} is in use by {1} (pid {2}); stopping it." -f $port, $process.ProcessName, $listener.OwningProcess) -ForegroundColor Yellow
        Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}

if (-not (Test-Path ".venv\Scripts\python.exe")) {
    Write-Host "No Python environment found. Run these once, then start again:" -ForegroundColor Red
    Write-Host "  python -m venv .venv"
    Write-Host "  .\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt"
    exit 1
}
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created .env from .env.example." -ForegroundColor Yellow
}

$gemma = if ($Fast) { "false" } else { "true" }

if (-not $NoBuild -and -not $BackendOnly) {
    Push-Location frontend
    if (-not (Test-Path "node_modules")) {
        Write-Host "Installing frontend packages (first run only)..." -ForegroundColor Cyan
        npm install
        if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Host "npm install failed." -ForegroundColor Red; exit 1 }
    }
    Write-Host "Building the web console..." -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Host "Frontend build failed; see the output above." -ForegroundColor Red; exit 1 }
    Pop-Location
}

$backend = "Set-Location '$root'; `$host.UI.RawUI.WindowTitle = 'VEIL backend (port 8000)'; `$env:GEMMA_ENABLED = '$gemma'; .\.venv\Scripts\python.exe -m uvicorn backend.main:app --port 8000"
$frontend = "Set-Location '$root\frontend'; `$host.UI.RawUI.WindowTitle = 'VEIL frontend (port 3000)'; npm run start"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backend
if (-not $BackendOnly) { Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontend }

Write-Host "Waiting for the backend..." -ForegroundColor Cyan
$deadline = (Get-Date).AddMinutes(4)
$health = $null
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    try { $health = Invoke-RestMethod -Uri "http://localhost:8000/health" -TimeoutSec 5 } catch { continue }
    if ($Fast -or $health.gemma_status -eq "loaded" -or $health.gemma_status -eq "failed") { break }
    Write-Host ("  Gemma: {0}" -f $health.gemma_status)
}

if ($null -eq $health) {
    Write-Host "The backend did not answer. Look at the 'VEIL backend' window for the error." -ForegroundColor Red
    exit 1
}
Write-Host ("Backend ready. Gemma: {0}. Agent: {1}." -f $health.gemma_status, $health.agent.provider) -ForegroundColor Green
if ($health.gemma_status -eq "failed") {
    Write-Host "Gemma failed to load, so VEIL runs rules-only. The backend window shows why." -ForegroundColor Yellow
}
Write-Host ""
if ($BackendOnly) {
    Write-Host "Backend only: use the VEIL browser extension or the MCP server. Logs are in the 'VEIL backend' window."
} else {
    Write-Host "Open:  http://localhost:3000/agent   (live demo, press R)"
    Write-Host "       http://localhost:3000/lab     (Firewall lab)"
    Write-Host "Demo page for the extension: http://localhost:3000/demo/aurora-x2.html"
}
if (-not $Fast) {
    Write-Host "Tip: run  .\.venv\Scripts\python.exe scripts\warm_cache.py  once so Gemma answers for the demo come from the cache."
}

<#
Stop whatever is serving VEIL on ports 8000 (backend) and 3000 (web console).
  .\scripts\stop.ps1
#>
foreach ($port in 8000, 3000) {
    $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $listeners) { Write-Host "Port $port is already free."; continue }
    foreach ($listener in $listeners) {
        $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
        Write-Host ("Stopping {0} (pid {1}) on port {2}." -f $process.ProcessName, $listener.OwningProcess, $port)
        Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}

<#
  Stops the TaskFlow API and UI that start.ps1 launched. Safe to run when nothing is running.
  Data is never touched: the database and backups stay on E:\FormEngine\data.
#>
$pidFile = 'E:\FormEngine\data\run\pids.json'

function Stop-Tree([int]$id) {
  if ($id -le 0) { return }
  Get-CimInstance Win32_Process -Filter "ParentProcessId=$id" -ErrorAction SilentlyContinue | ForEach-Object { Stop-Tree $_.ProcessId }
  Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
}

if (Test-Path $pidFile) {
  $p = Get-Content $pidFile -Raw | ConvertFrom-Json
  Stop-Tree $p.api
  Stop-Tree $p.web
  Remove-Item $pidFile -ErrorAction SilentlyContinue
}

# Anything still holding the ports (e.g. started by hand) that is clearly ours.
Get-Process TaskFlow.Api -ErrorAction SilentlyContinue | Stop-Process -Force
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'taskflow.web' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Start-Sleep 1
$left = Get-NetTCPConnection -LocalPort 5062, 5174 -State Listen -ErrorAction SilentlyContinue
if ($left) { Write-Warning "Ports still in use: $($left.LocalPort -join ', ')" } else { Write-Host 'TaskFlow stopped.' }

<#
  Starts TaskFlow (API on http://localhost:5062, UI on http://localhost:5174). Everything stays on E:.

    .\taskflow\scripts\start.ps1             # development servers (Vite dev + API)
    .\taskflow\scripts\start.ps1 -Preview    # serve the production build (builds it first)

  Logs:  E:\FormEngine\data\logs      Process ids: E:\FormEngine\data\run\pids.json
  Stop:  .\taskflow\scripts\stop.ps1
#>
param([switch]$Preview, [switch]$NoOpen)

$ErrorActionPreference = 'Stop'
. E:\FormEngine\env.ps1
$root = 'E:\FormEngine\taskflow'
$logs = 'E:\FormEngine\data\logs'
$run = 'E:\FormEngine\data\run'
New-Item -ItemType Directory -Force $logs, $run | Out-Null

foreach ($port in 5062, 5174) {
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $port is already in use. Run .\taskflow\scripts\stop.ps1 first (or check what is using it)."
  }
}

# 1. Build the API (a no-op when nothing changed). Migrations are applied by the API itself on start-up.
#    Take a safety copy of the database first when it exists, so an upgrade can always be undone.
$db = 'E:\FormEngine\data\taskflow.db'
if (Test-Path $db) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $bk = "E:\FormEngine\data\backups\startup-$stamp"
  # Only the first start of the day takes a file-level copy, to keep the backups folder tidy.
  $today = Get-ChildItem 'E:\FormEngine\data\backups' -Directory -Filter "startup-$(Get-Date -Format 'yyyyMMdd')-*" -ErrorAction SilentlyContinue
  if (-not $today) {
    New-Item -ItemType Directory -Force $bk | Out-Null
    foreach ($f in 'taskflow.db', 'taskflow.db-wal', 'taskflow.db-shm') {
      if (Test-Path "E:\FormEngine\data\$f") { Copy-Item "E:\FormEngine\data\$f" $bk }
    }
    Write-Host "Database copied to $bk"
  }
}
Write-Host 'Building API...'
dotnet build "$root\api\TaskFlow.Api" --nologo -v q | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'API build failed.' }

# 2. Build the UI when previewing.
if ($Preview) {
  Write-Host 'Building UI...'
  Push-Location "$root\web"
  npm run build 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'UI build failed.' }
  Pop-Location
}

# 3. Start both servers hidden, logging to E:.
$api = Start-Process dotnet -ArgumentList 'run', '--no-build', '--launch-profile', 'http', '--project', "$root\api\TaskFlow.Api" `
  -PassThru -WindowStyle Hidden -RedirectStandardOutput "$logs\api.out.log" -RedirectStandardError "$logs\api.err.log"
$webArgs = if ($Preview) { "$root\web\node_modules\vite\bin\vite.js", 'preview' } else { "$root\web\node_modules\vite\bin\vite.js" }
$web = Start-Process node -ArgumentList $webArgs -WorkingDirectory "$root\web" `
  -PassThru -WindowStyle Hidden -RedirectStandardOutput "$logs\web.out.log" -RedirectStandardError "$logs\web.err.log"
@{ api = $api.Id; web = $web.Id; started = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content "$run\pids.json"

# 4. Wait until the UI can reach the API.
$up = $false
for ($i = 0; $i -lt 60; $i++) {
  try { Invoke-RestMethod http://localhost:5174/api/about -TimeoutSec 2 | Out-Null; $up = $true; break } catch { Start-Sleep 1 }
}
if (-not $up) { throw "TaskFlow did not start. See $logs\api.err.log and $logs\web.err.log" }

Write-Host ''
Write-Host 'TaskFlow is running:  http://localhost:5174' -ForegroundColor Green
Write-Host "Database: $db"
Write-Host 'Stop with:  .\taskflow\scripts\stop.ps1'
if (-not $NoOpen) { Start-Process 'http://localhost:5174' }

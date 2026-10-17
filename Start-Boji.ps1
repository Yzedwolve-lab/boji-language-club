$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodeExecutable = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $nodeExecutable)) { throw 'Install Node.js 22 or later, then run this launcher again.' }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules\next\dist\bin\next'))) { throw 'Dependencies are missing. From this folder run: pnpm install --frozen-lockfile --ignore-scripts' }
$env:PATH = (Split-Path -Parent $nodeExecutable) + [IO.Path]::PathSeparator + $env:PATH
# Capture the one-time URL in memory; never display its fragment in terminal logs.
$launchJson = & $nodeExecutable 'scripts\prepare-launch.mjs'
if ($LASTEXITCODE -ne 0) { throw 'Unable to prepare AI setup. Check private-directory permissions.' }
$launch = $launchJson | ConvertFrom-Json
$launchJson = $null

function Get-BojiStatus {
  try {
    $status = Invoke-RestMethod -Uri 'http://127.0.0.1:3100/api/self-hosted/status' -TimeoutSec 1
    if ($status.mode -in @('demo', 'self_hosted') -and $status.configured -is [bool]) { return $status }
  } catch { }
  return $null
}

if (Get-BojiStatus) {
  Start-Process -FilePath $launch.url
  $launch = $null
  Write-Host 'Opened the existing Boji Club service. AI configuration is on the page.'
  exit 0
}

$buildFile = Join-Path $PSScriptRoot '.next\BUILD_ID'
$needsBuild = -not (Test-Path -LiteralPath $buildFile)
if (-not $needsBuild) {
  $buildTime = (Get-Item -LiteralPath $buildFile).LastWriteTimeUtc
  $inputs = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'src') -Recurse -File)
  $inputs += Get-Item -LiteralPath 'package.json','pnpm-lock.yaml','next.config.ts','tsconfig.json'
  $needsBuild = @($inputs | Where-Object { $_.LastWriteTimeUtc -gt $buildTime }).Count -gt 0
}
if ($needsBuild) {
  & $nodeExecutable 'node_modules\next\dist\bin\next' build
  if ($LASTEXITCODE -ne 0) { throw 'Build failed. See the output above.' }
}
# This helper owns only the process it starts. Existing services are never stopped.
$bojiProcess = Start-Process -FilePath $nodeExecutable -ArgumentList @('node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3100') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $PSScriptRoot 'boji-server.log') -RedirectStandardError (Join-Path $PSScriptRoot 'boji-server-error.log')
try {
  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if ($bojiProcess.HasExited) { throw 'Boji Club could not start. See boji-server-error.log.' }
    if (Get-BojiStatus) { $ready = $true; break }
    Start-Sleep -Milliseconds 250
  }
  if (-not $ready) { throw 'Boji Club did not become ready. Please retry the launcher.' }
  Start-Process -FilePath $launch.url
  $launch = $null
  Write-Host 'Boji Club: http://127.0.0.1:3100 | Configure AI directly on the page.'
  Write-Host 'Keep this window open. Press Ctrl+C to stop the service.'
  Wait-Process -Id $bojiProcess.Id
} finally {
  if (-not $bojiProcess.HasExited) { Stop-Process -Id $bojiProcess.Id }
}

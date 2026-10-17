param(
  [string]$DatabaseUrl = $env:BOJI_TEST_DATABASE_URL,
  [string]$DedicatedDatabaseAcknowledgement
)
$ErrorActionPreference = 'Stop'
if ($DedicatedDatabaseAcknowledgement -cne 'I_ACKNOWLEDGE_DEDICATED_LOCAL_SUPABASE') {
  throw 'Refusing to run: explicitly acknowledge a disposable, dedicated local Supabase test database.'
}
if (-not $DatabaseUrl) { throw 'BOJI_TEST_DATABASE_URL is required; no production fallback exists.' }
$databaseUri = [Uri]$DatabaseUrl
if ($databaseUri.Scheme -notin @('postgres','postgresql') -or $databaseUri.Host -notin @('localhost','127.0.0.1','[::1]')) {
  throw 'Only loopback PostgreSQL URLs are accepted. Production/remote databases are forbidden.'
}
if ($databaseUri.AbsolutePath -notin @('/postgres','/boji_test')) { throw 'Expected the dedicated local Supabase postgres or boji_test database.' }
$psqlExecutable = (Get-Command psql -ErrorAction Stop).Source
$testDirectory = $PSScriptRoot
function Invoke-TestFile([string]$Name) {
  & $psqlExecutable $DatabaseUrl -X --no-psqlrc --set ON_ERROR_STOP=1 --file (Join-Path $testDirectory $Name)
  if ($LASTEXITCODE -ne 0) { throw "Database test failed: $Name" }
}
# This runner never applies migrations to an unknown database or creates paid resources.
Invoke-TestFile 'core.sql'
Invoke-TestFile 'concurrency-setup.sql'
$testJobs = @()
try {
  foreach ($attempt in 1..8) {
    $testJobs += Start-Job -ScriptBlock {
      param($Executable,$Connection,$ClaimFile)
      & $Executable $Connection -X --no-psqlrc --set ON_ERROR_STOP=1 --file $ClaimFile
      if ($LASTEXITCODE -ne 0) { throw 'Concurrent claim failed.' }
    } -ArgumentList $psqlExecutable,$DatabaseUrl,(Join-Path $testDirectory 'concurrency-claim.sql')
  }
  $testJobs | Wait-Job -Timeout 45 | Out-Null
  if (@($testJobs | Where-Object State -ne 'Completed').Count -gt 0) { throw 'Concurrent claim jobs failed or timed out.' }
  $testJobs | Receive-Job
  Invoke-TestFile 'concurrency-verify.sql'
  Write-Output 'PASS: local database ownership/immutability/idempotency and eight concurrent claim sessions.'
} finally {
  $testJobs | Stop-Job -ErrorAction SilentlyContinue
  $testJobs | Remove-Job -Force -ErrorAction SilentlyContinue
  Invoke-TestFile 'concurrency-cleanup.sql'
}

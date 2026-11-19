param([switch]$DatabaseOnly)
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$statePath = Join-Path $PSScriptRoot '.local'
$clusterPath = Join-Path $statePath 'postgres'
$passwordPath = Join-Path $statePath 'postgres-password'
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
if (-not (Test-Path -LiteralPath (Join-Path $pgBin 'initdb.exe'))) { throw 'PostgreSQL 18 tools are required. Set pgBin to your installed PostgreSQL bin directory.' }
New-Item -ItemType Directory -Path $statePath -Force | Out-Null
if (-not (Test-Path -LiteralPath $passwordPath)) {
  if (Test-Path -LiteralPath (Join-Path $clusterPath 'PG_VERSION')) { throw 'Existing local cluster password file is missing; refusing to change its credentials.' }
  $secretBytes = [byte[]]::new(32)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($secretBytes)
  [Convert]::ToHexString($secretBytes).ToLowerInvariant() | Set-Content -LiteralPath $passwordPath -NoNewline
}
$dbPassword = (Get-Content -LiteralPath $passwordPath -Raw).Trim()
if (-not (Test-Path -LiteralPath (Join-Path $clusterPath 'PG_VERSION'))) {
  & (Join-Path $pgBin 'initdb.exe') -D $clusterPath -U wok_auth --auth-host=scram-sha-256 --auth-local=scram-sha-256 --pwfile $passwordPath --no-locale -E UTF8
  if ($LASTEXITCODE -ne 0) { throw 'Local account database initialization failed.' }
}
& (Join-Path $pgBin 'pg_ctl.exe') -D $clusterPath status *> $null
if ($LASTEXITCODE -ne 0) {
  & (Join-Path $pgBin 'pg_ctl.exe') -D $clusterPath -l (Join-Path $statePath 'postgres.log') -o '-h 127.0.0.1 -p 55440' -w start
  if ($LASTEXITCODE -ne 0) { throw 'Local account database startup failed.' }
}
$previousPgPassword = $env:PGPASSWORD
try {
  $env:PGPASSWORD = $dbPassword
  foreach ($dbName in @('wok_chop_auth_dev', 'wok_chop_auth_test')) {
    $dbExists = & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p 55440 -U wok_auth -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$dbName'"
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the task-owned local database.' }
    if ($dbExists -ne '1') {
      & (Join-Path $pgBin 'createdb.exe') -h 127.0.0.1 -p 55440 -U wok_auth $dbName
      if ($LASTEXITCODE -ne 0) { throw 'Could not create the task-owned account database.' }
    }
    $ledgerExists = & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p 55440 -U wok_auth -d $dbName -tAc "SELECT to_regclass('public.orders') IS NOT NULL"
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the local order ledger.' }
    if ($ledgerExists -eq 'f') {
      & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p 55440 -U wok_auth -d $dbName -v ON_ERROR_STOP=1 -f (Join-Path $projectPath 'packages\database\migrations\001_foundation.up.sql')
      if ($LASTEXITCODE -ne 0) { throw 'Order ledger migration failed.' }
    }
    & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p 55440 -U wok_auth -d $dbName -v ON_ERROR_STOP=1 -f (Join-Path $projectPath 'packages\database\migrations\002_customer_auth.up.sql')
    if ($LASTEXITCODE -ne 0) { throw 'Customer account migration failed.' }
    & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p 55440 -U wok_auth -d $dbName -v ON_ERROR_STOP=1 -f (Join-Path $projectPath 'packages\database\migrations\003_customer_order_history.up.sql')
    if ($LASTEXITCODE -ne 0) { throw 'Customer order history migration failed.' }
    & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p 55440 -U wok_auth -d $dbName -v ON_ERROR_STOP=1 -f (Join-Path $projectPath 'packages\database\migrations\004_restaurant_managers.up.sql')
    if ($LASTEXITCODE -ne 0) { throw 'Manager directory migration failed.' }
    & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p 55440 -U wok_auth -d $dbName -v ON_ERROR_STOP=1 -f (Join-Path $projectPath 'packages\database\migrations\005_delivery_requests.up.sql')
    if ($LASTEXITCODE -ne 0) { throw 'Delivery request migration failed.' }
  }
} finally { $env:PGPASSWORD = $previousPgPassword }
$env:AUTH_DATABASE_URL = "postgresql://wok_auth:$dbPassword@127.0.0.1:55440/wok_chop_auth_dev"
$env:AUTH_TEST_DATABASE_URL = "postgresql://wok_auth:$dbPassword@127.0.0.1:55440/wok_chop_auth_test"
$env:WEB_ORIGIN = 'http://127.0.0.1:3000'
$env:API_PORT = '4000'
Write-Host 'Local account database is ready on loopback port 55440. Connection credentials remain in ignored local state.'
if (-not $DatabaseOnly) {
  Push-Location $projectPath
  try {
    pnpm --filter @wok/api build
    if ($LASTEXITCODE -ne 0) { throw 'API build failed.' }
    pnpm --filter @wok/api start
    if ($LASTEXITCODE -ne 0) { throw 'Local restaurant API exited with an error.' }
  } finally { Pop-Location }
}

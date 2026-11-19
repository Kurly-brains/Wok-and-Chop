# Provision a separate local manager on the development workstation.
# Requires the loopback account API and database started by start-local-accounts.ps1.
$ErrorActionPreference = 'Stop'
$profileDir = Join-Path $env:LOCALAPPDATA 'WokAndChop'
$credentialsPath = Join-Path $profileDir 'local-manager.json'
$pgBin = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
$dbPasswordPath = Join-Path $PSScriptRoot '.local\postgres-password'
if (-not (Test-Path -LiteralPath $dbPasswordPath) -or -not (Test-Path -LiteralPath $pgBin)) {
  throw 'Start the local Wok & Chop account service before provisioning a manager.'
}
New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
if (-not (Test-Path -LiteralPath $credentialsPath)) {
  $secret = [byte[]]::new(32)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($secret)
  $entry = [ordered]@{ email = "manager-$([Guid]::NewGuid().ToString('N').Substring(0,12))@wokandchop.invalid"; password = [Convert]::ToBase64String($secret) }
  $stream = [System.IO.File]::Open($credentialsPath, 'CreateNew', 'Write', 'None')
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes(($entry | ConvertTo-Json))
    $stream.Write($bytes, 0, $bytes.Length)
  } finally { $stream.Dispose() }
}
$login = Get-Content -Raw -LiteralPath $credentialsPath | ConvertFrom-Json
$headers = @{ Origin = 'http://127.0.0.1:3000' }
$api = 'http://127.0.0.1:4000/v1/auth'
$body = @{ name = 'Local restaurant manager'; email = $login.email; password = $login.password }
try {
  $account = Invoke-RestMethod -Method Post -Uri "$api/register" -Headers $headers -ContentType 'application/json' -Body ($body | ConvertTo-Json)
} catch {
  if ($_.Exception.Response.StatusCode.value__ -ne 409) { throw }
  $body.Remove('name')
  $account = Invoke-RestMethod -Method Post -Uri "$api/login" -Headers $headers -ContentType 'application/json' -Body ($body | ConvertTo-Json)
}
$accountId = [Guid]::Parse($account.user.id).ToString()
$previousPassword = $env:PGPASSWORD
try {
  $env:PGPASSWORD = (Get-Content -LiteralPath $dbPasswordPath -Raw).Trim()
  & $pgBin -X -h 127.0.0.1 -p 55440 -U wok_auth -d wok_chop_auth_dev -v ON_ERROR_STOP=1 -c "INSERT INTO restaurant_managers(account_id) VALUES ('$accountId') ON CONFLICT DO NOTHING" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Manager provisioning failed.' }
} finally { $env:PGPASSWORD = $previousPassword }
Write-Host "Manager sign-in details are saved in your private Windows profile at $credentialsPath"

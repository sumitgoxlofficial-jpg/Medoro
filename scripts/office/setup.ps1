# Sets up Medoro on a Windows office computer with Docker Desktop. Run in PowerShell from the repository folder:
#
#   powershell -ExecutionPolicy Bypass -File scripts\office\setup.ps1 -Db supabase -Url https://medoro.in
#   powershell -ExecutionPolicy Bypass -File scripts\office\setup.ps1 -Db local    -Url https://medoro.in
#   add -NoTunnel to skip Cloudflare Tunnel (office network only), -Ai for the optional server voice.
#
# Same behaviour as scripts/office/setup.sh: writes .env.office (asks for what it can't generate), builds, starts and
# checks the app. Safe to run again. Guide: docs/OFFICE_SERVER.md
param(
  [ValidateSet("supabase", "local")][string]$Db,
  [string]$Url,
  [switch]$NoTunnel,
  [switch]$Ai
)
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..\..")
$EnvFile = ".env.office"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker Desktop is not installed. See docs/OFFICE_SERVER.md, step 2." }
docker info *> $null; if ($LASTEXITCODE -ne 0) { throw "Docker Desktop is not running. Start it and try again." }

function Get-Kv([string]$k) {
  if (-not (Test-Path $EnvFile)) { return "" }
  $line = Get-Content $EnvFile | Where-Object { $_ -match "^$k=" } | Select-Object -Last 1
  if (-not $line) { return "" }
  return (($line -split "=", 2)[1] -replace "\s+#.*$", "").Trim()
}
function Set-Kv([string]$k, [string]$v) {
  $lines = @(); if (Test-Path $EnvFile) { $lines = @(Get-Content $EnvFile | Where-Object { $_ -notmatch "^$k=" }) }
  $lines += "$k=$v"
  # UTF-8 without BOM, so Docker Compose reads the first key correctly.
  [IO.File]::WriteAllLines((Join-Path (Get-Location) $EnvFile), $lines, (New-Object Text.UTF8Encoding $false))
}
function New-Secret([int]$n = 40) {
  $chars = [char[]]"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  $bytes = New-Object byte[] $n; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}
function Ask([string]$k, [string]$q, [switch]$Secret) {
  if (Get-Kv $k) { return }
  if ($Secret) { $s = Read-Host $q -AsSecureString; $v = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)) }
  else { $v = Read-Host $q }
  if (-not $v) { throw "Missing $k. Add it to $EnvFile and run again." }
  Set-Kv $k $v
}

if (-not $Db) { $Db = Get-Kv "MEDORO_DB_MODE" }
if ($Db -ne "supabase" -and $Db -ne "local") { throw "Choose -Db supabase (keep current data) or -Db local (new install)." }
Set-Kv "MEDORO_DB_MODE" $Db
if ($Url) { Set-Kv "APP_URL" $Url.TrimEnd("/") }
Ask "APP_URL" "Public address, e.g. https://medoro.in"
foreach ($d in @(@("NODE_ENV", "production"), @("TZ", "Asia/Kolkata"), @("DEPLOYMENT_MODE", "cloud"))) { if (-not (Get-Kv $d[0])) { Set-Kv $d[0] $d[1] } }

if ($Db -eq "supabase") {
  Write-Host "Keeping the Supabase database. Copy these from Vercel -> Project -> Settings -> Environment Variables:"
  Ask "DATABASE_URL" "DATABASE_URL (Supabase pooler URL)" -Secret
  Ask "DIRECT_URL" "DIRECT_URL (Supabase direct URL)" -Secret
  if (-not (Get-Kv "DATABASE_MIGRATOR_URL")) { Set-Kv "DATABASE_MIGRATOR_URL" (Get-Kv "DIRECT_URL") }
  # Existing encrypted data needs the existing keys: never generate these here.
  Ask "SESSION_SECRET" "SESSION_SECRET (same as Vercel)" -Secret
  Ask "HOST_KEY" "HOST_KEY (same as Vercel; it decrypts bank, KYC, chat and transcripts)" -Secret
  Ask "CRON_SECRET" "CRON_SECRET (same as Vercel)" -Secret
} else {
  if (-not (Get-Kv "POSTGRES_PASSWORD")) { Set-Kv "POSTGRES_PASSWORD" (New-Secret 32) }
  if (-not (Get-Kv "SESSION_SECRET")) { Set-Kv "SESSION_SECRET" (New-Secret 48) }
  if (-not (Get-Kv "HOST_KEY")) { Set-Kv "HOST_KEY" (New-Secret 48); Write-Host "Generated a new HOST_KEY. Keep a copy of .env.office somewhere safe: without it encrypted data can't be read." }
  if (-not (Get-Kv "CRON_SECRET")) { Set-Kv "CRON_SECRET" (New-Secret 40) }
}

$files = @("-f", "deploy/office/compose.yml"); if ($Db -eq "local") { $files += @("-f", "deploy/office/compose.localdb.yml") }
$profiles = @()
if (-not $NoTunnel) {
  Set-Kv "TRUST_PROXY" "cloudflare"
  Ask "CLOUDFLARE_TUNNEL_TOKEN" "Cloudflare Tunnel token (Zero Trust -> Networks -> Tunnels)" -Secret
  $profiles += @("--profile", "tunnel")
}
if ($Ai) {
  if (-not (Get-Kv "AI_HR_SERVICE_TOKEN")) { Set-Kv "AI_HR_SERVICE_TOKEN" (New-Secret 48) }
  Set-Kv "AI_HR_SERVICE_URL" "http://ai-service:8090"
  $profiles += @("--profile", "ai")
}

Set-Kv "MEDORO_PROFILES" ((@($(if (-not $NoTunnel) { "tunnel" }), $(if ($Ai) { "ai" })) | Where-Object { $_ }) -join " ")
foreach ($f in ((Get-Kv "MEDORO_COMPOSE_EXTRA") -split "\s+" | Where-Object { $_ })) { $files += @("-f", $f) }
Write-Host "Building and starting (the first build takes several minutes)..."
docker compose --env-file $EnvFile @files @profiles up -d --build
if ($LASTEXITCODE -ne 0) { throw "docker compose failed." }
Write-Host "Waiting for the app..."
for ($i = 0; $i -lt 60; $i++) {
  docker compose --env-file $EnvFile @files exec -T app node -e "fetch('http://127.0.0.1:3000/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" *> $null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "Medoro is running. Local check: http://localhost:3000/api/ready"
    if (-not $NoTunnel) { Write-Host "Public address (once the tunnel's public hostname points to http://app:3000): $(Get-Kv 'APP_URL')" }
    exit 0
  }
  Start-Sleep -Seconds 5
}
throw "The app didn't become ready. Logs: docker compose $($files -join ' ') logs app --tail 100"

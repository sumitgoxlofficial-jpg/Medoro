<#
.SYNOPSIS
  Shop-LAN helper for Windows: creates a local certificate authority and an HTTPS certificate for this PC with
  openssl, writes .env with random secrets if it doesn't exist yet, and prints the addresses counters should open.
.EXAMPLE
  pwsh scripts/lan-setup.ps1 -HostName medoro.local
#>
param([string]$HostName = "medoro.local", [int]$Port = 443, [switch]$ForceCert, [switch]$TrustCA)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

$openssl = (Get-Command openssl -ErrorAction SilentlyContinue).Source
if (-not $openssl) {
  foreach ($p in "$env:ProgramFiles\Git\usr\bin\openssl.exe", "$env:ProgramFiles\OpenSSL-Win64\bin\openssl.exe") { if (Test-Path $p) { $openssl = $p; break } }
}
if (-not $openssl) { throw "openssl not found. Install Git for Windows (it includes openssl) or OpenSSL, then run this again." }
function Ossl { & $openssl @args 2>$null; if ($LASTEXITCODE) { throw "openssl $($args[0]) failed" } }

$dir = "certs"; New-Item -ItemType Directory -Force $dir | Out-Null
$short = $env:COMPUTERNAME.ToLower()
$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" -and $_.InterfaceAlias -notmatch "vEthernet|WSL|Docker|Loopback|VirtualBox|VMware" } |
  Select-Object -ExpandProperty IPAddress

if (-not (Test-Path "$dir/medoro-local-ca.key")) {
  Ossl genrsa -out "$dir/medoro-local-ca.key" 3072
  Ossl req -x509 -new -key "$dir/medoro-local-ca.key" -sha256 -days 3650 -subj "/CN=Medoro Local CA ($short)/O=Medoro shop LAN" `
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" -addext "keyUsage=critical,keyCertSign,cRLSign" -out "$dir/medoro-local-ca.crt"
  Write-Host "Created local CA: $dir/medoro-local-ca.crt"
}

if (-not (Test-Path "$dir/medoro.crt") -or $ForceCert) {
  $san = @("DNS:$HostName", "DNS:$short.local", "DNS:$short", "DNS:localhost", "IP:127.0.0.1") + ($ips | ForEach-Object { "IP:$_" })
  $sanText = $san -join ","
  Ossl genrsa -out "$dir/medoro.key" 2048
  Ossl req -new -key "$dir/medoro.key" -subj "/CN=$HostName" -out "$dir/medoro.csr"
  Set-Content -Encoding ascii "$dir/medoro.ext" "basicConstraints=CA:FALSE`nkeyUsage=critical,digitalSignature,keyEncipherment`nextendedKeyUsage=serverAuth`nsubjectAltName=$sanText"
  # 825 days is the longest validity Apple devices accept for a server certificate.
  Ossl x509 -req -in "$dir/medoro.csr" -CA "$dir/medoro-local-ca.crt" -CAkey "$dir/medoro-local-ca.key" -CAcreateserial -days 825 -sha256 -extfile "$dir/medoro.ext" -out "$dir/medoro.crt"
  Remove-Item "$dir/medoro.csr", "$dir/medoro.ext"
  Write-Host "Created server certificate for: $sanText"
}

function RandHex([int]$n) { $b = [byte[]]::new($n); [Security.Cryptography.RandomNumberGenerator]::Fill($b); -join ($b | ForEach-Object { $_.ToString("x2") }) }
if (-not (Test-Path ".env")) {
  $origin = if ($Port -eq 443) { "https://$HostName" } else { "https://${HostName}:$Port" }
  @(
    "# Written by scripts/lan-setup.ps1. Keep a copy of HOST_KEY offline: losing it makes stored secrets unreadable.",
    "POSTGRES_PASSWORD=$(RandHex 24)", "SESSION_SECRET=$(RandHex 32)", "HOST_KEY=$(RandHex 32)", "SETUP_TOKEN=$(RandHex 12)",
    "APP_URL=$origin", "MEDORO_HOST=$HostName", "MEDORO_HTTPS_PORT=$Port", "DEPLOYMENT_MODE=lan", "TRUST_PROXY=1", "TZ=Asia/Kolkata", "LOG_LEVEL=info"
  ) | Set-Content -Encoding ascii ".env"
  Write-Host "Wrote .env with new random secrets."
} else { Write-Host ".env already exists; left unchanged." }

if ($TrustCA) { certutil -addstore -f Root "$dir/medoro-local-ca.crt" | Out-Null; Write-Host "Trusted the local CA on this PC (needs an elevated prompt)." }

$suffix = if ($Port -eq 443) { "" } else { ":$Port" }
Write-Host ""
Write-Host "Start:   docker compose --profile https up -d --build"
Write-Host "Open on this PC and on counters (after trusting the CA below):"
Write-Host "  https://$HostName$suffix"
Write-Host "  https://$short.local$suffix"
$ips | ForEach-Object { Write-Host "  https://$_$suffix" }
Write-Host ""
Write-Host "Trust $dir/medoro-local-ca.crt once on every counter (never share medoro-local-ca.key):"
Write-Host "  Windows: certutil -addstore -f Root medoro-local-ca.crt   (admin prompt; or run this script with -TrustCA)"
Write-Host "  Android: Settings > Security > Encryption & credentials > Install a certificate > CA certificate"
Write-Host "First-run setup asks for SETUP_TOKEN from .env."

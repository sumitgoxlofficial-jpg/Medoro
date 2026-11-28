# Gives Naina (Medoro's AI HR assistant) her built-in voice from this Windows laptop or PC, which must stay on, like the
# WhatsApp connector. Medoro itself stays on Vercel. Run in PowerShell from the Medoro folder:
#
#   powershell -ExecutionPolicy Bypass -File scripts\voice\setup.ps1
#
# It: makes a private key (.env.voice, never committed), builds and starts the voice server in Docker, waits until the
# voice is downloaded, plays a test sentence into naina-test.wav, publishes the server over HTTPS with Tailscale Funnel,
# and prints the two values to put into Vercel. Safe to run again. Guide: docs/OFFICE_SERVER.md §10c
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..\..")
$EnvFile = ".env.voice"; $Port = 8090

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker Desktop is not installed." }
docker info *> $null; if ($LASTEXITCODE -ne 0) { throw "Docker Desktop is not running. Start it and try again." }

# 1. The private key shared with Medoro on Vercel (made once, then kept).
$token = ""
if (Test-Path $EnvFile) { $line = Get-Content $EnvFile | Where-Object { $_ -match "^AI_HR_SERVICE_TOKEN=" } | Select-Object -Last 1; if ($line) { $token = ($line -split "=", 2)[1].Trim() } }
if ($token.Length -lt 24) {
  $chars = [char[]]"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  $bytes = New-Object byte[] 48; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $token = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
  [IO.File]::WriteAllLines((Join-Path (Get-Location) $EnvFile), @("AI_HR_SERVICE_TOKEN=$token"), (New-Object Text.UTF8Encoding $false))
  Write-Host "Made a new private key in $EnvFile (keep this file; don't share it)."
}

# 2. Build and start (the first build takes a few minutes).
Write-Host "Building and starting Naina's voice server..."
docker compose --env-file $EnvFile -f deploy/voice/compose.yml up -d --build
if ($LASTEXITCODE -ne 0) { throw "docker compose failed." }

# 3. Wait until the voice is downloaded and answering.
$h = @{ Authorization = "Bearer $token" }
$ready = $false
for ($i = 0; $i -lt 120; $i++) {
  try { $r = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -Headers $h -TimeoutSec 5; if ($r.tts.ok) { $ready = $true; break } } catch { }
  Start-Sleep -Seconds 5
}
if (-not $ready) { throw "The voice didn't become ready. Logs: docker compose -f deploy/voice/compose.yml logs ai-service --tail 50" }

# 4. A test sentence you can play.
$body = @{ text = "नमस्ते! मैं नैना हूँ, मेडोरो HR की AI असिस्टेंट।" } | ConvertTo-Json
$t = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/tts" -Method Post -Headers $h -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 60
[IO.File]::WriteAllBytes((Join-Path (Get-Location) "naina-test.wav"), [Convert]::FromBase64String($t.audio_b64))
Write-Host "Naina's voice works. Listen: naina-test.wav (in the Medoro folder)."

# 5. Publish over HTTPS with Tailscale Funnel, on a port the WhatsApp connector isn't using (remembered in .env.voice).
$url = ""
if (Get-Command tailscale -ErrorAction SilentlyContinue) {
  $fport = ""
  $saved = Get-Content $EnvFile | Where-Object { $_ -match "^FUNNEL_PORT=" } | Select-Object -Last 1
  if ($saved) { $fport = ($saved -split "=", 2)[1].Trim() }
  else {
    $status = (tailscale funnel status 2>&1 | Out-String)
    foreach ($p in @("8443", "10000")) { if ($status -notmatch ":$p\b") { $fport = $p; break } }
    if ($fport) { Add-Content -Path $EnvFile -Value "FUNNEL_PORT=$fport" -Encoding ascii }
  }
  if ($fport) {
    tailscale funnel --bg --https=$fport "http://127.0.0.1:$Port" | Out-Null
    $dns = ((tailscale status --json | ConvertFrom-Json).Self.DNSName).TrimEnd(".")
    if ($dns) { $url = "https://${dns}:$fport" }
  } else { Write-Host "Tailscale Funnel ports 8443 and 10000 are both in use: publish port $Port yourself." }
}

Write-Host ""
Write-Host "Done. Now in Vercel -> medoro -> Settings -> Environment Variables (Production), add:"
if ($url) { Write-Host "  AI_HR_SERVICE_URL   = $url" } else { Write-Host "  AI_HR_SERVICE_URL   = https://<this computer's Tailscale name>:8443   (run: tailscale funnel --bg --https=8443 http://127.0.0.1:$Port)" }
Write-Host "  AI_HR_SERVICE_TOKEN = $token   (mark it Sensitive)"
Write-Host "Then Deployments -> Redeploy, and in HRMS -> AI HR Assistant -> Settings choose: Naina's voice = Medoro's built-in voice."

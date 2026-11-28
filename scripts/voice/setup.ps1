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
# Windows PowerShell 5.1 turns any stderr line of a redirected native command into an error, and with
# ErrorActionPreference=Stop that aborts the script (e.g. Docker's "Plugin ... is not valid" warning). Check exit codes only.
$ErrorActionPreference = "Continue"; docker info *> $null; $dockerOk = ($LASTEXITCODE -eq 0); $ErrorActionPreference = "Stop"
if (-not $dockerOk) { throw "Docker Desktop is not running. Start it and try again." }

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

# 3. Wait until the voice is downloaded and loaded (first start downloads ~330 MB; slow PCs can take many minutes).
$h = @{ Authorization = "Bearer $token" }
$ready = $false
Write-Host "Waiting for Naina's voice to download and load (up to 30 minutes the first time)..."
for ($i = 0; $i -lt 360; $i++) {
  try { $r = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -Headers $h -TimeoutSec 10; if ($r.tts.ok -and $r.tts.loaded) { $ready = $true; break } } catch { }
  if ($i -gt 0 -and $i % 12 -eq 0) { Write-Host ("  still loading... {0} min (progress: docker logs medoro-voice-ai-service-1 --tail 5)" -f ($i / 12)) }
  Start-Sleep -Seconds 5
}
if (-not $ready) { throw "The voice didn't become ready. Logs: docker logs medoro-voice-ai-service-1 --tail 50" }
Write-Host ("Voice loaded: {0} {1}" -f $r.tts.engine, $r.tts.voice)

# 4. A test sentence you can play (the first one on a slow PC can take a few minutes).
$body = @{ text = "नमस्ते! मैं नैना हूँ, मेडोरो HR की AI असिस्टेंट।" } | ConvertTo-Json
$sw = [Diagnostics.Stopwatch]::StartNew()
$t = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/tts" -Method Post -Headers $h -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 600
Write-Host ("Test sentence made in {0:N1} s ({1} ms of speech). A good PC takes 1-6 s; much slower means Docker needs more CPU or memory (docs/OFFICE_SERVER.md 10c)." -f $sw.Elapsed.TotalSeconds, $t.duration_ms)
[IO.File]::WriteAllBytes((Join-Path (Get-Location) "naina-test.wav"), [Convert]::FromBase64String($t.audio_b64))
Write-Host "Naina's voice works. Listen: naina-test.wav (in the Medoro folder)."

# 5. Publish over HTTPS with Tailscale Funnel, on a port the WhatsApp connector isn't using (remembered in .env.voice).
$url = ""
if (Get-Command tailscale -ErrorAction SilentlyContinue) {
  $fport = ""
  $saved = Get-Content $EnvFile | Where-Object { $_ -match "^FUNNEL_PORT=" } | Select-Object -Last 1
  if ($saved) { $fport = ($saved -split "=", 2)[1].Trim() }
  else {
    $ErrorActionPreference = "Continue"; $status = (tailscale funnel status 2>&1 | Out-String); $ErrorActionPreference = "Stop"
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
Write-Host "Then Deployments -> Redeploy, and in HRMS -> AI HR Assistant -> Settings choose: Naina's voice = Medoro's own voice (Kokoro, self-hosted)."

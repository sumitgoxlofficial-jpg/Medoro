# AI HR Assistant — deployment, operations and rollback

Nothing here deploys by itself. **Merging to `main` is a production deployment** (Vercel deploys `main` and runs
`prisma migrate deploy`), so it needs the owner's approval. The feature ships **switched off**.

## Free set-up (recommended, ₹0)

**Hosting on your own office computer:** follow [../OFFICE_SERVER.md](../OFFICE_SERVER.md). The app's built-in
scheduler then runs the AI HR Assistant every minute, so skip step 2 below (no Supabase cron or GitHub workflow).

1. Merge (owner's approval) → Vercel deploys and migrates.
2. Scheduling, free and every minute, from Supabase: open `scripts/supabase/cron-jobs.sql`, replace `<APP_URL>` and
   `<CRON_SECRET>`, and run it once in Supabase → SQL Editor (pg_cron + pg_net, both on the free plan). This replaces
   Vercel cron, GitHub Actions and cron-job.org. Page views also run the AI job. (The GitHub workflow
   `AI HR scheduler` is a fallback; it does nothing unless its secret and variable are set.)
   Note: Vercel's free Hobby plan is for non-commercial use only; see "App hosting" in HANDOVER.md for free options.
3. HRMS as super admin → **AI HR Assistant → Settings**: Voice = *On the employee's device (free)*, model *Whisper base*,
   tick *Automatic AI conversations on*, save. Tell the team first.
4. Check on one Android phone (Chrome) and one Windows PC (Chrome/Edge): open **AI conversations**, press Speak (first
   time downloads the model), and confirm a Hindi voice is installed (Android: Google TTS Hindi; Windows: Settings →
   Time & language → Speech → add Hindi).

No AI server, no API keys. Everything below about the AI host is optional (server mode).

## 0. Infrastructure status (verified 2026-11-28)

| Item | Status |
|---|---|
| Medoro app | Vercel project `medoro` (serverless, region `bom1`). Can't host Ollama/Whisper/Kokoro as persistent processes. |
| Persistent 8 GB AI host | Not found / not provided. **Not needed in the free set-up**; needed for Naina's own server voice (Kokoro-82M) and local model assist. |
| This build sandbox | 4 vCPU / 16 GB. Hugging Face and the PyTorch CPU index were opened for this work: **Kokoro-82M was downloaded, run and benchmarked here** (TEST-REPORT.md). ollama.com stays blocked, so Ollama was not run. |

Requirements for the AI host: Ubuntu 22.04/24.04, 8 GB RAM, 4 cores preferred, 20 GB free disk, systemd, a public DNS
name with HTTPS (or a private network reachable from the app), outbound access during installation to ollama.com, registry.ollama.ai, PyPI,
download.pytorch.org (+ download-r2.pytorch.org), github.com (spaCy English model) and Hugging Face (huggingface.co,
cdn-lfs.hf.co, cdn-lfs-us-1.hf.co, cas-bridge.xethub.hf.co, us.aws.cdn.hf.co, cas-server.xethub.hf.co). After
installation the service needs no internet (`HF_HUB_OFFLINE=1`).

## 1. App side (Vercel)

```bash
pnpm prisma migrate deploy        # done by vercel-build.sh on production builds
```
Environment variables (Vercel → Project → Settings → Environment Variables):

| Variable | Required | Purpose |
|---|---|---|
| `AI_HR_SERVICE_URL` | for voice / model assist | `https://ai.<your-domain>` |
| `AI_HR_SERVICE_TOKEN` | with the URL | same as `MEDORO_AI_TOKEN` on the AI host (`openssl rand -hex 32`) |
| `AI_HR_SIP_ENABLED`, `AI_HR_SIP_PROVIDER`, `AI_HR_WEBHOOK_SECRET` | no | Mode B phone calls; leave unset |
| `CRON_SECRET` | already used | the minute scheduler must call `GET /api/cron/minute` with `Authorization: Bearer $CRON_SECRET` every minute (Vercel Hobby runs only the daily cron; use an external scheduler or Vercel Pro) |

Then in the HRMS as super admin: **AI HR Assistant → Settings**, review thresholds and calling hours, tell the team,
switch on. Employees can turn AI conversations off themselves (**AI conversations** screen).

## 2. AI host

From a checkout of this repository on the host:
```bash
cd ai-service
sudo bash scripts/install.sh
```
The script (read it first; details in [KOKORO-TTS-SETUP.md](KOKORO-TTS-SETUP.md)) installs packages, Ollama bound to
127.0.0.1 with one model / one request (skip with `SKIP_OLLAMA=1`), pulls `qwen2.5:1.5b-instruct` and creates
`medoro-hr` from `Modelfile`, creates the `medoro-ai` user, reuses or creates the virtualenv, installs the pinned
CPU-only dependencies (Kokoro 0.9.4, torch 2.6.0+cpu), generates `/etc/medoro-ai.env` with a token (kept on re-runs),
downloads **Kokoro-82M and the Hindi voices hf_alpha / hf_beta once** into `/opt/medoro-ai/cache` and checks Hindi
speech offline, warms Faster-Whisper `base` int8, installs the systemd unit, enables UFW (SSH + HTTPS only), and finally
calls `/health` and `/tts`. It **no longer downloads the Piper hi_IN-priyamvada voice** (non-commercial licence). Then:
```bash
sudo cp deploy/nginx-medoro-ai.conf /etc/nginx/sites-available/medoro-ai
sudo ln -s ../sites-available/medoro-ai /etc/nginx/sites-enabled/medoro-ai
sudo certbot --nginx -d ai.<your-domain>
sudo nginx -t && sudo systemctl reload nginx
```
Verify (and record the numbers in HANDOVER.md §10–13):
```bash
TOKEN=$(sudo grep MEDORO_AI_TOKEN /etc/medoro-ai.env | cut -d= -f2)
curl -s -H "Authorization: Bearer $TOKEN" https://ai.<your-domain>/health | python3 -m json.tool
free -m; nproc; df -h /opt
```

## 3. Restart

```bash
sudo systemctl restart ollama
sudo systemctl restart medoro-ai
sudo systemctl status medoro-ai --no-pager
journalctl -u medoro-ai -n 100 --no-pager
```

## 4. Rollback

App: redeploy the previous Vercel deployment (the feature is off by default, so turning it off in Settings is the
first and quickest rollback). Database (only if the tables must go; their data is lost):
```bash
psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -1 -f scripts/rollback/20270105000000_hrms_ai_hr_assistant.down.sql
```
(Tested: rollback → `migrate deploy` → `migrate status` up to date.) AI host: `sudo systemctl disable --now medoro-ai`.

**This change has no database migration.** New settings (`kokoroVoice`, `speakingSpeed`) live in the existing
`HrSetting` row `aiHr` and have defaults, so older code ignores them.

Voice only, quickest first:
1. HRMS → AI HR Assistant → Settings → Naina's voice: **Each device's own voice** (no server audio at once), or Voice:
   **Off (text only)**.
2. AI host, keep the service but stop server speech: set `TTS_ENGINE=off` in `/etc/medoro-ai.env`, then
   `sudo systemctl restart medoro-ai` (`/tts` answers 503, the app falls back to device voices or captions).
3. Previous code on the AI host: the installer keeps the last copy in `/opt/medoro-ai/service.prev`:
   ```bash
   sudo systemctl stop medoro-ai && sudo rm -rf /opt/medoro-ai/service && sudo mv /opt/medoro-ai/service.prev /opt/medoro-ai/service && sudo systemctl start medoro-ai
   ```
   The previous (Piper) code needs `piper-tts` and a voice file; do **not** download `hi_IN-priyamvada-medium` for
   commercial use (non-commercial licence). A Piper voice you are licensed to use can be set with
   `TTS_ENGINE=piper PIPER_VOICE=/path/voice.onnx` after `pip install -r requirements-piper-rollback.txt`.
4. App code: redeploy the previous Vercel deployment; `ai-client.ts` sends `voice`/`speed`, which older AI hosts
   ignore, and the new AI host still accepts the old `{text}` request, so either side can be rolled back alone.

## 5. Monitoring and failure handling

* **AI HR Assistant → Model status**: reachability, engines, free RAM, CPU load, latency.
* Per-turn STT/LLM/TTS milliseconds are stored on every transcript line (Calls → Open).
* If the AI host is down: conversations continue as text; detection and dispatch are unaffected (attendance events
  are rows, retried each minute, never duplicated); calls nobody answers become HR follow-ups.
* Scheduler health: the existing `SystemHeartbeat` / `/api/ready`.

## 6. Troubleshooting

| Symptom | Check |
|---|---|
| "Voice isn't available" for employees | `AI_HR_SERVICE_URL`/`TOKEN` set? `/health` reachable from Vercel? token identical? |
| No conversations created | Settings switched on? within calling hours? check-in on in HRMS Settings? today a holiday/weekly off? minute scheduler running? |
| Same person contacted twice | impossible per event (unique `eventKey`); a callback creates its own event `callback:<id>` |
| `/health` llm false | `ollama list` shows `medoro-hr`? `systemctl status ollama`; RAM (`free -m`) |
| Slow STT | `WHISPER_THREADS`, CPU load; consider `base` model; keep one session at a time on 8 GB |
| Voice problems | see [TROUBLESHOOTING.md](TROUBLESHOOTING.md) |

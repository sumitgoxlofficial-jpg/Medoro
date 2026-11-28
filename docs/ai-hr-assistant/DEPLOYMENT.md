# AI HR Assistant — deployment, operations and rollback

Nothing here deploys by itself. **Merging to `main` is a production deployment** (Vercel deploys `main` and runs
`prisma migrate deploy`), so it needs the owner's approval. The feature ships **switched off**.

## Free set-up (recommended, ₹0)

1. Merge (owner's approval) → Vercel deploys and migrates.
2. GitHub → repository Settings → Secrets and variables → Actions: secret `CRON_SECRET` (same as in Vercel), variable
   `APP_URL` (e.g. `https://medoro.in`). The workflow `AI HR scheduler` then runs every 5 minutes. Page views also run it.
3. HRMS as super admin → **AI HR Assistant → Settings**: Voice = *On the employee's device (free)*, model *Whisper base*,
   tick *Automatic AI conversations on*, save. Tell the team first.
4. Check on one Android phone (Chrome) and one Windows PC (Chrome/Edge): open **AI conversations**, press Speak (first
   time downloads the model), and confirm a Hindi voice is installed (Android: Google TTS Hindi; Windows: Settings →
   Time & language → Speech → add Hindi).

No AI server, no API keys. Everything below about the AI host is optional (server mode).

## 0. Infrastructure status (verified 2026-11-28)

| Item | Status |
|---|---|
| Medoro app | Vercel project `medoro` (serverless, region `bom1`). Can't host Ollama/Whisper/Piper as persistent processes. |
| Persistent 8 GB AI host | Not found / not provided. **Not needed in the free set-up**; only for optional server mode (Piper voice, local model assist). |
| This build sandbox | 4 cores / 15 GB, but Hugging Face and ollama.com are blocked by its network policy, so models could not be downloaded or benchmarked here. |

Requirements for the AI host: Ubuntu 22.04/24.04, 8 GB RAM, 4 cores preferred, 20 GB free disk, systemd, a public DNS
name with HTTPS (or a private network reachable from the app), outbound access to ollama.com, registry.ollama.ai,
huggingface.co and PyPI during installation.

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
The script (read it first) installs packages, Ollama bound to 127.0.0.1 with one model / one request, pulls
`qwen2.5:1.5b-instruct` and creates `medoro-hr` from `Modelfile`, creates the `medoro-ai` user and virtualenv, downloads
the Piper voice and its `MODEL_CARD`, generates `/etc/medoro-ai.env` with a token, warms Faster-Whisper `small` int8,
installs the systemd unit and enables UFW (SSH + HTTPS only). Then:
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
| Hinglish read badly by the voice | Piper's Hindi voice reads romanised Hindi imperfectly; see HANDOVER limitations |

# Running Medoro on your own office computer (₹0 hosting)

Medoro runs in Docker on a computer in your office and is published at your own domain (for example
`https://medoro.in`) through a **Cloudflare Tunnel**: free, HTTPS included, no static IP, no router or firewall changes,
and no open ports. The app's built-in scheduler runs every job each minute (attendance checks, AI HR Assistant,
backups, reminders), so no Vercel, cron service or GitHub Action is needed.

What it costs: ₹0 in software. You pay only for the computer's electricity and the office internet you already have.

> Tested on 2026-11-28 (Linux, Docker 29): `scripts/office/setup.sh --db local` built and started the stack, migrations
> applied, `/api/ready` reported ready, the built-in scheduler recorded a successful run, the microphone header was
> correct on HRMS pages, the app recovered after a restart, and a backup restored cleanly.
> **Not tested:** the Cloudflare Tunnel itself (needs your Cloudflare account), Windows/Docker Desktop, and the
> Supabase variant (needs your database credentials).

## 1. The computer

| | Minimum | Better |
|---|---|---|
| CPU / RAM | 4 cores, 8 GB | 16 GB if you also run the optional AI server voice |
| Disk | SSD, 40 GB free | |
| OS | Windows 10/11 Pro, or Ubuntu 22.04/24.04 | Ubuntu (lighter, fewer forced restarts) |
| Network | wired Ethernet | |
| Power | **a UPS (inverter)**: a power cut takes Medoro offline for everyone | |

It must stay on 24×7. **Turn off sleep and hibernation.**
- Windows: Settings → System → Power → Screen and sleep → Never.
- Windows: set Active hours for updates (Settings → Windows Update → Advanced options), so it doesn't restart during work.
- Windows: Docker Desktop → Settings → General → "Start Docker Desktop when you sign in", and set Windows to sign in
  automatically after a restart.

## 2. Install Docker and get the code

**Windows:**
1. Install **Docker Desktop**. It is free for businesses under 250 employees *and* under $10 million annual revenue;
   above that it needs a paid Docker subscription. The alternative is Ubuntu with Docker Engine, free for everyone.
2. During installation, accept WSL 2.
3. Install Git for Windows.

**Ubuntu:** `sudo apt install docker.io docker-compose-v2 git`, then `sudo usermod -aG docker $USER` and log in again.

Then get the code:
```bash
git clone https://github.com/sumitgoxlofficial-jpg/Medoro.git
```
```bash
cd Medoro
```

## 3. Cloudflare Tunnel (free) — makes the office computer reachable at your domain

1. Create a free Cloudflare account.
2. Add your domain to it (Websites → Add a site → Free plan).
3. At your domain registrar, change the nameservers to the two Cloudflare gives you. This takes up to a day; your email
   records are copied automatically, but check them.
4. Cloudflare dashboard → **Zero Trust** → Networks → **Tunnels** → Create a tunnel → *Cloudflared* → name it
   `medoro-office`. Copy the **token** (the long string after `--token`). You don't need to install anything it
   suggests; Docker runs cloudflared for you.
5. In the tunnel → **Public hostname** → add:
   - Subdomain: empty, Domain: `medoro.in`, Service: `HTTP` → `app:3000`
   - optionally `www` the same way.

## 4. Choose the database

* **Keep Supabase** (`--db supabase`) if Medoro already has real data there (moving from Vercel). It stays on
  Supabase's free plan, which pauses a project only after a week of no activity (a running Medoro is active).
  You need the same `DATABASE_URL`, `DIRECT_URL`, `SESSION_SECRET`, **`HOST_KEY`** and `CRON_SECRET` as on Vercel.
  `HOST_KEY` decrypts bank accounts, KYC numbers, chat messages and AI transcripts: a different key makes them
  unreadable. The setup script refuses to invent one in this mode.
* **On this computer** (`--db local`) for a brand-new install. Everything stays in your office; then **backups are your
  job** (step 7).

## 5. Run the setup

Windows (PowerShell, in the Medoro folder):
```powershell
powershell -ExecutionPolicy Bypass -File scripts\office\setup.ps1 -Db supabase -Url https://medoro.in
```
Ubuntu:
```bash
bash scripts/office/setup.sh --db supabase --url https://medoro.in
```
It asks for what it can't generate: database URLs, keys and the tunnel token. It writes them to `.env.office`, which is
never committed; keep a copy in a password manager. Then it builds (the first time takes 5–15 minutes), starts, and
checks that Medoro is ready. Options:
- `--no-tunnel`: office network only.
- `--ai`: the optional server voice; needs about 4 GB more RAM, and is not needed for the free in-browser voice.
- `--no-build`: start what was already built.

Then copy the rest of your settings from Vercel (Project → Settings → Environment Variables) into `.env.office`:
mail, WhatsApp, Google sign-in, Razorpay, licence keys, `STAFF_*` and so on. Run the setup again with `--no-build` to
apply them.

## 6. Moving from Vercel (checklist)

1. Steps 1–5 with `--db supabase`, and test at `http://localhost:3000` on the office computer.
2. Once DNS is on Cloudflare (step 3), the public hostname sends `medoro.in` to the office computer. Remove the domain
   from the Vercel project, so Vercel stops answering for it.
3. Google sign-in, LinkedIn, DigiLocker and WhatsApp webhooks use the same domain, so nothing changes there.
4. Leave the Vercel project paused for a week as a fallback, then delete it. The Supabase cron script
   (`scripts/supabase/cron-jobs.sql`) and the GitHub `AI HR scheduler` workflow are **not needed** with the office
   server: don't run them, or the jobs run twice (harmless but wasteful).

## 7. Backups

* With Supabase: Supabase keeps the data. Also use Medoro's own encrypted backups (Settings → Backup, to Google Drive).
* With the local database: run `bash scripts/office/backup.sh` daily. It keeps 14 days in `backups/`. Schedule it:
  - Ubuntu: `crontab -e`, then add `30 2 * * * cd /path/to/Medoro && bash scripts/office/backup.sh`.
  - Windows: Task Scheduler → `bash.exe` from Git → the script.

  **Copy `backups/` off the machine** regularly (another disk, Google Drive). A disk failure, theft or fire otherwise
  loses everything.

## 8. Automatic updates (with rollback)

`scripts/office/update.sh` checks GitHub for a new version and updates safely:
1. It builds the new version while the current one keeps serving.
2. It backs up the local database.
3. It switches over and waits up to 5 minutes for `/api/ready`.
4. If the new version doesn't come up, it **switches back to the previous version by itself** and remembers that
   release, so it isn't retried every night.

Run it by hand, or schedule it nightly. Ubuntu:
```bash
crontab -e
```
Then add this line:
```text
30 3 * * * cd /path/to/Medoro && bash scripts/office/update.sh >> logs/update.log 2>&1
```
Windows: Task Scheduler → daily 03:30 → program `C:\Program Files\Git\bin\bash.exe`, arguments
`-lc "cd /c/path/to/Medoro && bash scripts/office/update.sh >> logs/update.log 2>&1"`.

It follows the branch the office copy is on (set `MEDORO_BRANCH=main` in `.env.office` to pin it).

Tested on 2026-11-28 against a simulated repository:
- With nothing new, it did nothing.
- A normal update built, backed up, switched over and was ready.
- A deliberately broken release was rolled back automatically: the previous version was serving again in about
  10 seconds after the 5-minute wait, and the next run skipped that release.

A failed attempt means a few minutes of downtime at night. Database migrations are not undone, because Medoro's
migrations are additive and the previous code keeps working with them.

## 9. "Medoro is down" alerts (free)

The GitHub workflow `Uptime` checks `APP_URL/api/ready` from outside your network every 10 minutes, and again a minute
later before alerting. To turn it on:
1. Repository Settings → Secrets and variables → Actions → Variables: set `APP_URL` (e.g. `https://medoro.in`).
2. Optional, for a phone push: set `NTFY_TOPIC` to a long random name, install the free **ntfy** app, and subscribe to
   that name.

GitHub also emails the person who last edited the workflow when a check fails.

## 10. Voice speech model from your own server (optional)

By default, employees' browsers download the speech model once from Hugging Face. To serve it from the office server
instead (faster on the office network, and not dependent on Hugging Face):
1. Download it once:
   ```bash
   bash scripts/office/fetch-speech-model.sh
   ```
   Use `whisper-small` as the argument for better Hindi.
2. HRMS → AI HR Assistant → Settings → *Speech model from: This server*.

Model status shows whether the files are present. They are served only to signed-in HRMS users. The speech runtime is
built into the Docker image.

## 10b. Naina's built-in voice (same voice for every employee, nothing to install)

Naina can speak with Medoro's own Hindi female voice instead of each phone's voice.
1. Run the setup with the AI option: `bash scripts/office/setup.sh --ai` (Windows: `-Ai`). It needs about 4 GB more RAM
   and downloads the voice once.
2. HRMS → AI HR Assistant → Settings → **Naina's voice: Medoro's built-in voice**. Model status shows when it's ready.

If Medoro itself still runs on Vercel, the office computer can provide the voice:
1. In the Cloudflare tunnel, add a public hostname, e.g. `ai.medoro.in` → `HTTP` → `ai-service:8090`.
2. In Vercel → Settings → Environment Variables, set `AI_HR_SERVICE_URL=https://ai.medoro.in` and `AI_HR_SERVICE_TOKEN`
   to the same value as `AI_HR_SERVICE_TOKEN` in `.env.office`, then redeploy.

While the office computer is off, phones use their own voice automatically.

## 10c. Naina's voice from a laptop that's already on (Medoro stays on Vercel)

For the laptop or PC that already runs the WhatsApp connector with Docker and Tailscale Funnel. Only Naina's voice runs
there (about 1 GB RAM, 70 MB download); Medoro stays on Vercel.

1. Get the code on that laptop (once): `git clone https://github.com/sumitgoxlofficial-jpg/Medoro.git`, then `cd Medoro`.
2. Run the setup:
   - Windows (PowerShell): `powershell -ExecutionPolicy Bypass -File scripts\voice\setup.ps1`
   - Mac/Linux: `bash scripts/voice/setup.sh`

   It makes a private key (`.env.voice`), builds and starts the voice server, waits for the voice to download, saves a
   test sentence to `naina-test.wav` (play it to hear Naina), opens HTTPS port 8443 with Tailscale Funnel (WhatsApp's
   address is not touched; 10000 if 8443 is taken) and prints `AI_HR_SERVICE_URL` and `AI_HR_SERVICE_TOKEN`.
3. Vercel → medoro → Settings → Environment Variables → Production: add the two values (the token as Sensitive), then
   Deployments → ⋯ → Redeploy.
4. HRMS → AI HR Assistant → Settings → **Naina's voice: Medoro's built-in voice** → Save. Model status shows the voice.

The voice server restarts by itself with Docker. While the laptop is off or asleep, phones use their own voice and
calls carry on. To update later: `git pull`, then run the setup again (same key and port are kept).

## 10d. Naina's natural voice from Google Cloud (most human, no laptop needed)

Google's Neural2 and Chirp 3 HD Hindi voices sound close to a real person and answer in under a second. Medoro sends
Google only the text of Naina's replies (which can include the employee's first name, as she greets them), never the
employee's voice. A monthly character limit in Settings keeps use inside Google's free allowance (check the current
Text-to-Speech pricing page; it has been about 1 million characters a month per voice type). Past the limit, phones use
their own voice until the 1st of the next month, so there's no surprise bill.

1. Open https://console.cloud.google.com and sign in with the Google account Medoro should use.
2. Top bar → project picker → **New project** → name `Medoro Voice` → Create, then select it.
3. **Billing** → link a billing account (Google asks for a card even for the free allowance; new accounts also get
   free trial credit).
4. **APIs & Services → Library** → search **Cloud Text-to-Speech API** → **Enable**.
5. **APIs & Services → Credentials → Create credentials → API key**. On the new key: **Edit API key → API
   restrictions → Restrict key → Cloud Text-to-Speech API → Save**. Copy the key.
6. Recommended: **Billing → Budgets & alerts → Create budget**, amount ₹100, email alerts at 50% and 100%.
7. Vercel → medoro → Settings → Environment Variables → **Production**: add `GOOGLE_TTS_API_KEY` = the key, tick
   **Sensitive** → Save → Deployments → ⋯ → **Redeploy**.
8. HRMS → AI HR Assistant → Settings → **Naina's voice: Google natural voice** → choose the **Google voice** (Chirp 3
   HD · Kore is the most natural) → keep the monthly limit at 900,000 → **Save settings**. Model status shows
   "key set" and the characters used this month.
9. Call Naina and listen. If a Chirp 3 HD voice isn't available on your account, she uses the Neural2 voice instead.

## 11. Everyday commands

Compose commands (add `-f deploy/office/compose.localdb.yml` after the first `-f` if you use the local database):
```bash
docker compose --env-file .env.office -f deploy/office/compose.yml --profile tunnel ps
```
```bash
docker compose --env-file .env.office -f deploy/office/compose.yml logs app --tail 100
```
```bash
docker compose --env-file .env.office -f deploy/office/compose.yml --profile tunnel restart
```

Update to a new version (Ubuntu; on Windows run `git pull`, then `setup.ps1` with the same `-Db`):
```bash
git pull && bash scripts/office/setup.sh
```
The `git pull && …` line rebuilds, applies migrations and restarts; the database and files are kept in Docker volumes.

## 12. What to know

* Uptime is your computer's uptime: power, internet and Windows updates. Cloudflare shows visitors an error page while
  it's off.
* The office upload speed limits how fast pages and files load for people outside the office. 20 Mbps up is plenty for
  a small team.
* Free alternatives if the office machine becomes a problem: Oracle Cloud "Always Free" runs the same Docker set-up.
  Paid: Vercel Pro (about $20/month).

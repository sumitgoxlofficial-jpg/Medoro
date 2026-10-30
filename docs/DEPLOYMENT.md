# Deployment

Medoro is one Next.js app plus PostgreSQL 16. It runs the same way everywhere; only where the database lives and
how browsers reach the app change. All modes are PostgreSQL: there is no SQLite or single-file mode.

| Choice in the setup wizard | Database | Typical install |
|---|---|---|
| Your cloud server | PostgreSQL on a VM in the customer's cloud account | `docker compose` on the VM, a reverse proxy with a public certificate |
| On-premises server | PostgreSQL on a customer-owned server | `docker compose` on the server |
| Shop LAN | PostgreSQL on the main shop PC | `docker compose --profile https` on that PC, counters join over Wi-Fi/LAN |
| Hosted PostgreSQL | A managed service (Supabase, Neon, RDS…) over TLS | Vercel + Supabase ([VERCEL_SUPABASE.md](VERCEL_SUPABASE.md)) or any app host |

The wizard records the choice on the pharmacy (shown in the app footer and to Medoro support) and refuses a
choice that contradicts `DATABASE_URL`: "Hosted PostgreSQL" with a database on the same machine, or a
self-hosted choice while `DATABASE_URL` points at a known managed service. `DEPLOYMENT_MODE` preselects it.

## Docker (any Linux/Windows/macOS host with Docker)
`Dockerfile` is multi-stage: Node 22 on Debian slim (glibc, so Prisma and argon2 use their prebuilt engines),
pnpm through corepack, and Next.js `output: "standalone"` (switched on by `NEXT_OUTPUT=standalone` in the image
build only; `pnpm build`/`next start` and Vercel are unchanged). Targets: `app` (runs as the `node` user, data
in the `/data` volume) and `migrate` (runs `prisma migrate deploy` once and exits).

`docker-compose.yml` runs:
- `db`: `postgres:16`, data in the `pgdata` volume, `pg_isready` healthcheck, no published port.
- `migrate`: waits for a healthy `db`, applies migrations, exits (`DATABASE_MIGRATOR_URL` overrides the login).
- `app`: starts only after `migrate` succeeded; port `3000` (`MEDORO_HTTP_PORT`), files in the `appdata`
  volume (`STORAGE_DIR=/data/storage`), healthcheck on `/api/ready`.
- `https` (profile `https`): Caddy on port 443 with the certificate from `scripts/lan-setup.*`.

```bash
cp .env.example .env     # or: bash scripts/lan-setup.sh   (writes .env with random secrets + certificates)
# required in .env: POSTGRES_PASSWORD (letters/digits), SESSION_SECRET and HOST_KEY (32+ chars each, different)
docker compose up -d --build                     # http://<host>:3000
docker compose --profile https up -d --build     # https://medoro.local
docker compose logs -f app                       # JSON log lines
```
Updating: pull the new source (or image), then `docker compose up -d --build`; `migrate` runs first. Behind
your own proxy set `TRUST_PROXY=1` and `APP_URL`; if the browser-facing host differs from the `Host` header the
app sees, list it in `ALLOWED_ORIGINS` (comma-separated `host[:port]`) for the CSRF checks.

Without Docker: `pnpm install && pnpm prisma migrate deploy && pnpm build && pnpm start` (Node 22), with
PostgreSQL 16 and the same environment variables.

## Shop LAN (one PC hosts, counters join)
1. On the main PC install Docker Desktop (Windows/macOS) or Docker Engine (Linux), and copy the Medoro source.
2. Give the PC a fixed address: a DHCP reservation in the router (recommended) or a static IP.
3. Create certificates and `.env`:
   - Linux/macOS: `bash scripts/lan-setup.sh --host medoro.local`
   - Windows (PowerShell 7, uses the `openssl` from Git for Windows): `pwsh scripts/lan-setup.ps1 -HostName medoro.local`

   The script makes a local certificate authority (`certs/medoro-local-ca.crt`, 10 years) and a server
   certificate (825 days, the longest Apple devices accept) for `medoro.local`, the PC's own `<name>.local`,
   `localhost` and its LAN IPs; writes `.env` with random `POSTGRES_PASSWORD`, `SESSION_SECRET`, `HOST_KEY`,
   `SETUP_TOKEN` if there is no `.env` yet; and prints the URLs. Re-run with `--force-cert` / `-ForceCert`
   after the IP changes. Keep `certs/medoro-local-ca.key` on that PC only.
4. `docker compose --profile https up -d --build`, open `https://medoro.local` and finish setup (it asks for
   `SETUP_TOKEN` from `.env`).
5. On every counter, trust `medoro-local-ca.crt` once (Windows: `certutil -addstore -f Root medoro-local-ca.crt`
   in an admin prompt; Android: Settings → Security → Install a certificate → CA certificate; macOS/iOS: open it
   and mark it trusted). Then open the URL and install the app (Chrome/Edge "Install app").

**Why HTTPS on a LAN:** production sessions use `Secure` cookies and browsers only run the offline service worker
on HTTPS or `localhost`, so plain `http://192.168.x.x:3000` is fine for a quick look on the host PC itself but
not for counters. Alternatives to the script: [mkcert](https://github.com/FiloSottile/mkcert) (`mkcert -install`,
`mkcert medoro.local <ip>`, then copy the files to `certs/medoro.crt`/`certs/medoro.key` and its root CA to the
counters) or your own internal CA.

**`medoro.local` (mDNS):** the name must be announced on the network by the host PC:
- Linux: install Avahi (`sudo apt install avahi-daemon`) and set the hostname to `medoro`
  (`sudo hostnamectl set-hostname medoro`); Avahi then answers for `medoro.local`.
- macOS: Bonjour is built in; set the Local Hostname to `medoro` in System Settings → General → Sharing.
- Windows 10/11: rename the PC to `MEDORO`. Recent builds usually answer mDNS for their own name on a network
  marked Private; if counters can't resolve `medoro.local`, install Apple's Bonjour Print Services on the host
  or use the IP address.
- Android resolves `.local` names only on recent versions and some vendors; if a tablet can't open
  `https://medoro.local`, use `https://<host-ip>` (the IP is in the certificate).

HSTS is sent on HTTPS responses; set `DISABLE_HSTS=1` while testing certificates so a mistake can't lock
browsers out for the HSTS lifetime.

## Hosted (Vercel + Supabase)
See [VERCEL_SUPABASE.md](VERCEL_SUPABASE.md). Vercel builds run `prisma migrate deploy` for production
deployments (`scripts/vercel-build.sh`); Vercel Cron calls `/api/cron/tick` daily.

## Installing on counters
- **Browser / PWA**: open the server in Chrome or Edge and choose *Install app* (Android: *Add to home screen*). Offline billing needs the site on HTTPS (or `localhost`); on a plain-HTTP LAN address browsers don't run service workers.
- **Desktop app**: installers from the *Desktop app* workflow (`desktop/`). On first start, enter the server address. Offline billing works in the Windows app (WebView2) as in Chrome; on macOS and Linux the system web views have limited service worker support, so use Chrome/Edge's installed app there if a counter must bill offline.

## Health, startup checks and monitoring
- `GET /api/health`: liveness. Process only, never touches the database. `{"status":"ok","uptime":…}`.
- `GET /api/ready`: readiness. 200 when the database answers, every migration folder shipped with the build is
  applied (none pending or failed in `_prisma_migrations`) and, in production, the required settings pass;
  otherwise 503. The body has states and counts only (`database`, `migrations`, `env`, `pendingMigrations`),
  never connection strings or values.
- **Startup migration check:** in production the server compares `prisma/migrations` with `_prisma_migrations`
  before serving and refuses to start when any are pending or failed, logging the names and the fix
  (`prisma migrate deploy`). `SKIP_MIGRATION_CHECK=1` overrides it knowingly. If the migrations folder isn't
  deployed with the build, or the database can't be reached at boot, it logs that and `/api/ready` reports it.
  The app never migrates by itself: the compose `migrate` service, `vercel-build.sh` or an operator does.
- `GET /api/metrics`: Prometheus text format, enabled only when `METRICS_TOKEN` (16+ chars) is set, and only with
  `Authorization: Bearer <METRICS_TOKEN>`. Exposes per-process API request counts by route group and status
  class, server-action outcomes, process memory/start time, whether the live-update listener is connected, and
  from the database: committed sales per pharmacy, last verified backup time, and offline queue size
  (pending/conflict). Labels use the pharmacy code only.
  ```yaml
  scrape_configs:
    - job_name: medoro
      metrics_path: /api/metrics
      authorization: { credentials: "<METRICS_TOKEN>" }
      static_configs: [{ targets: ["medoro.local:443"] }]
      scheme: https
  ```
- **Logs:** one JSON object per line on stdout/stderr (`time`, `level`, `msg`, fields). `LOG_LEVEL` =
  `debug|info|warn|error` (default `info`). Values under keys such as password, token, secret, otp, code,
  authorization, cookie, phone, mobile and email are replaced with `[redacted]` at any depth.

## Licence
The licence server is the staff console of Medoro's own deployment (`/api/license/*`). Generate its key pair with `node scripts/licence-keys.mjs`: `LICENSE_SIGNING_KEY` goes only on that deployment, `LICENSE_PUBLIC_KEY` on every pharmacy install together with `LICENSE_SERVER_URL`. An install registers on its first check-in (trial: 14 days from setup), then checks in hourly from the built-in scheduler, daily from a host cron, and when Subscription, Help or Privacy is opened. Requests are signed with the install's own token (HMAC); every answer is a licence document signed with Ed25519 and verified before it is stored. When Medoro can't be reached, the last signed licence keeps applying. After the trial or paid period there are 7 days of grace (the licence can set another number), then the app is read-only for sales, purchases, stock changes and messaging; sign-in, viewing, exports, backups and restore always work. With `LICENSE_SERVER_URL` unset (pure self-hosting, development) nothing is limited.

## Environment
See `.env.example`. Secrets go into `.env` (mode 600), Docker secrets or the host's secret store, never into the image.

- `SESSION_SECRET` (32+ random characters) signs sessions. It can be rotated; everyone signs in again.
- `HOST_KEY` (32+ random characters, different from `SESSION_SECRET`) seals stored integration secrets
  (WhatsApp, Google Drive), the backup key and authenticator secrets. **Required in production**: the app
  refuses to start without it. Keep a copy offline; losing or changing it makes those sealed values unreadable.
- Upgrading an install that ran without `HOST_KEY`: its secrets were sealed with a key derived from
  `SESSION_SECRET`. Add a new `HOST_KEY` and keep `SESSION_SECRET` unchanged; the old values still open (the
  server logs a warning). Re-seal them under `HOST_KEY` by reconnecting WhatsApp and Google Drive, re-entering
  the backup recovery kit and re-enrolling authenticators, and only then rotate `SESSION_SECRET`.
- `DATABASE_MIGRATOR_URL` (optional): login the compose `migrate` job uses instead of `DATABASE_URL`.
- Operations: `LOG_LEVEL`, `METRICS_TOKEN`, `SKIP_MIGRATION_CHECK`, `ALLOWED_ORIGINS`, `DISABLE_HSTS`,
  `TRUST_PROXY`.

### Changing HOST_KEY (e.g. upgrading from a short key)
New installs must use a `HOST_KEY` of at least 32 characters, and the app refuses to start with a shorter one.
An existing install with a shorter key upgrades like this:

1. Move the old value to `HOST_KEY_PREVIOUS` and set `HOST_KEY` to a new random value (`openssl rand -base64 48`).
   Restart. Values sealed with the old key still open through `HOST_KEY_PREVIOUS`; new values are sealed with
   `HOST_KEY`.
2. The backup key and the Google Drive token are re-sealed with the new key automatically the next time they are
   used (the next backup does both).
3. Reconnect WhatsApp and have people with an authenticator app set it up again (or keep `HOST_KEY_PREVIOUS`
   until they have). The server logs a warning while anything still opens only with the old key.
4. Then remove `HOST_KEY_PREVIOUS`.

If the old key is lost instead, the backup key can be restored from the printed recovery kit: Backup & restore
→ Encryption → *Use this kit*. Reconnect Google Drive and WhatsApp; authenticators are set up again.

# Deployment

All modes use the same signed container images (`medoro/app`, `medoro/worker`) or the Tauri desktop bundle.

## A. Customer cloud
1. The customer creates a VM (2 vCPU / 4 GB minimum) or a managed PostgreSQL 16 in **their own** cloud account, in an Indian region where possible.
2. Install Docker. `docker compose -f deploy/compose.cloud.yml up -d` (app, worker, caddy for TLS; db if not managed).
3. DNS: `pharmacy.example.in` → VM. Caddy obtains the certificate.
4. Restrict the DB port to the app's private network. No public 5432.
5. Run the setup wizard at `https://pharmacy.example.in/setup`.

## B. On-premises server
Same as A on a customer-owned server. Use an internal CA or Caddy with DNS-01 for TLS. A UPS is recommended.

## C. Shop LAN
1. Install the Medoro Host (Tauri) on the main PC. It bundles PostgreSQL and the app service, generates a local CA, and advertises itself over mDNS.
2. Counter PCs and tablets install the Medoro Client. They discover the host, pin its certificate, and pair with a one-time code.
3. A static IP or DHCP reservation for the host is recommended.

## D. Single device
Tauri app with SQLite. Backups still go to Drive. A migration wizard upgrades it to PostgreSQL later.

## Installing on counters
- **Browser / PWA**: open the server in Chrome or Edge and choose *Install app* (Android: *Add to home screen*). Offline billing needs the site on HTTPS (or `localhost`); on a plain-HTTP LAN address browsers don't run service workers.
- **Desktop app**: installers from the *Desktop app* workflow (`desktop/`). On first start, enter the server address. Offline billing works in the Windows app (WebView2) as in Chrome; on macOS and Linux the system web views have limited service worker support, so use Chrome/Edge's installed app there if a counter must bill offline.

## Health & operations
- `GET /api/health` (liveness), `/api/ready` (DB and migrations).
- Migrations: `prisma migrate deploy` runs on start; the app refuses to start if migrations are pending.
- Updates: signed releases. Customer-hosted installs pull from the release channel the owner chooses (stable or early).
- Observability: local Prometheus metrics; logs stay on the host with redaction.

## Licence
A signed JWT (Ed25519) licence is refreshed daily when online and valid offline for 30 days. After a payment failure there's a 7-day grace period, then read-only. Exports always work.

## Environment
See `.env.example`. Secrets go into the OS keystore or Docker secrets, never into the image.

- `SESSION_SECRET` (32+ random characters) signs sessions. It can be rotated; everyone signs in again.
- `HOST_KEY` (32+ random characters, different from `SESSION_SECRET`) seals stored integration secrets
  (WhatsApp, Google Drive), the backup key and authenticator secrets. **Required in production**: the app
  refuses to start without it. Keep a copy offline; losing or changing it makes those sealed values unreadable.
- Upgrading an install that ran without `HOST_KEY`: its secrets were sealed with a key derived from
  `SESSION_SECRET`. Add a new `HOST_KEY` and keep `SESSION_SECRET` unchanged; the old values still open (the
  server logs a warning). Re-seal them under `HOST_KEY` by reconnecting WhatsApp and Google Drive, re-entering
  the backup recovery kit and re-enrolling authenticators, and only then rotate `SESSION_SECRET`.

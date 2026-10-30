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
The licence server is the staff console of Medoro's own deployment (`/api/license/*`). Generate its key pair with `node scripts/licence-keys.mjs`: `LICENSE_SIGNING_KEY` goes only on that deployment, `LICENSE_PUBLIC_KEY` on every pharmacy install together with `LICENSE_SERVER_URL`. An install registers on its first check-in (trial: 14 days from setup), then checks in hourly from the built-in scheduler, daily from a host cron, and when Subscription, Help or Privacy is opened. Requests are signed with the install's own token (HMAC); every answer is a licence document signed with Ed25519 and verified before it is stored. When Medoro can't be reached, the last signed licence keeps applying. After the trial or paid period there are 7 days of grace (the licence can set another number), then the app is read-only for sales, purchases, stock changes and messaging; sign-in, viewing, exports, backups and restore always work. With `LICENSE_SERVER_URL` unset (pure self-hosting, development) nothing is limited.

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

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

## Health & operations
- `GET /api/health` (liveness), `/api/ready` (DB and migrations).
- Migrations: `prisma migrate deploy` runs on start; the app refuses to start if migrations are pending.
- Updates: signed releases. Customer-hosted installs pull from the release channel the owner chooses (stable or early).
- Observability: local Prometheus metrics; logs stay on the host with redaction.

## Licence
A signed JWT (Ed25519) licence is refreshed daily when online and valid offline for 30 days. After a payment failure there's a 7-day grace period, then read-only. Exports always work.

## Environment
See `.env.example`. Secrets go into the OS keystore or Docker secrets, never into the image.

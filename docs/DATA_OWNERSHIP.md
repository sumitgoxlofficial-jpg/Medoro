# Data Ownership

## Principle
The pharmacy owns its operational data. Medoro's software runs against a database the pharmacy controls. Medoro staff have **no standing access** to it.

## Where data lives
| Data | Location | Who can read it |
|---|---|---|
| Invoices, stock, customers, suppliers, ledger, prescriptions | Customer PostgreSQL / SQLite | Authorised pharmacy users |
| Backup files | Customer's Google Drive (encrypted before upload) | Only holders of the recovery key |
| Backup encryption key | Customer's recovery kit (offline) plus the OS keystore on the app host | Owner |
| WhatsApp access token | Server vault on the customer's app host | The app service only |
| Account, plan, licence, device count | Medoro control plane | Medoro billing and support |
| Support attachments | Only what the customer uploads to a ticket | Assigned support staff |

## Strict customer-controlled mode (default)
- No pharmacy records are sent to Medoro services.
- Analytics, reports and AI run in the customer's environment.
- Telemetry is off by default. Crash reports, if enabled, are scrubbed of invoice, patient, credential and key data on the customer's host before upload.
- Remote AI is off. Turning it on relaxes strict mode and is shown in the UI.

What strict mode enforces on the server (`isStrict(ctx)` in `src/domain/system/strict.ts`; other modules call it before sending data off the server):
| Rule | Where |
|---|---|
| Remote AI off (strict mode and remote AI exclude each other) | Privacy settings; AI module checks `isStrict` / `assertNotStrict` |
| No telemetry or crash reports, even if their toggles are on | `domain/system/telemetry.ts` (also needs `TELEMETRY_URL` / `CRASH_REPORT_URL`) |
| Customer mobile numbers masked (`98220•••36`) for every role except Owner and Manager (follows "View as") | Customer lists, customer-dues report |
| Exports include customer mobile numbers only with a recorded reason (audited) | Full JSON/CSV export; customer-dues CSV (Owner/Manager) |
| Every new customer mobile number gets a consent record, so the log shows a clear yes or no | Customer forms at the counter and in Suppliers & customers |

## Telemetry and crash reports (opt-in)
Both need the owner's toggle **and** strict mode off **and** a destination URL set on the server. The daily usage ping carries the app version, an install id that is a one-way hash, and counts rounded to buckets (branches, users, medicines, bills in the last day, devices). Crash reports carry the error type, a scrubbed message (names in quotes, numbers, emails, GSTINs, ids, URLs and tokens removed) and stack frames from the app's own code, sent from Next.js `onRequestError`. On a server with several pharmacies, crash reports go only if every pharmacy allows them.

## External services
| Service | Receives | Never receives |
|---|---|---|
| Medoro control plane | Tenant ID, plan, licence check-ins, app version, device count | Operational records |
| Meta WhatsApp Cloud API | Recipient number, invoice PDF, template params | Prescriber details, other records |
| Google Drive | Encrypted backup blobs plus a manifest (hashes, sizes) | Keys, plaintext |
| Remote AI (opt-in) | Minimised aggregates, no names or phones | Credentials, the full database |

## Customer rights in the product
- **Export:** a full JSON export, or a ZIP with one CSV per table (child rows such as sale items, payments and ledger lines in their own files), from Privacy & data. Owner only, audited, blocked for Medoro support sessions. In strict mode customer mobile numbers are masked unless the owner records a reason, which goes to the audit trail. A database-level copy is described in the `pg_dump` guide below.
- **Erasure:** removes customer personal fields. Tax invoices keep an anonymised party.
- **Exit:** after cancellation the software goes read-only after the grace period. Data stays in place and stays exportable.

## Database copy with `pg_dump`
The in-app export is for reading data in Excel or another system. To move or archive the whole database, take a PostgreSQL dump. It needs the PostgreSQL client tools of the **same or newer major version** as the server (16 for a standard install).

**1. Dump (on the app host, or any machine that can reach the database):**
```bash
# Custom format: compressed, restorable table by table. Use the same URL as DATABASE_URL.
pg_dump "postgresql://medoro:PASSWORD@127.0.0.1:5432/medoro" \
  --format=custom --no-owner --no-privileges --file=medoro-$(date +%F).dump
sha256sum medoro-*.dump > medoro-dump.sha256        # keep the hash with the file
```
Add `--schema=public` to leave out other schemas (for example, a `restore_*` test copy left by an interrupted restore). For a plain SQL file use `--format=plain --file=medoro.sql` instead.

**2. Restore into an empty database:**
```bash
createdb medoro_restored
pg_restore --dbname="postgresql://medoro:PASSWORD@127.0.0.1:5432/medoro_restored" \
  --no-owner --no-privileges --exit-on-error medoro-2026-11-01.dump
# Plain SQL dumps: psql "postgresql://…/medoro_restored" -v ON_ERROR_STOP=1 -f medoro.sql
```
The dump carries the append-only triggers, row-level security and the `_prisma_migrations` table, so `pnpm prisma migrate deploy` against the restored database reports "No pending migrations" for the same app version. Point `DATABASE_URL` at it and start the app.

**Supabase:** use the **session pooler** or direct connection string (`DIRECT_URL`, port 5432), never the transaction pooler (port 6543), and keep `sslmode=require`:
```bash
pg_dump "postgresql://postgres.PROJECTREF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres?sslmode=require" \
  --format=custom --no-owner --no-privileges --schema=public --file=medoro-supabase.dump
```
Restoring into another Supabase project: run `pg_restore` with the new project's session URL and `--schema=public`. Supabase's own roles and the `auth`/`storage` schemas are not part of Medoro's data and should not be restored over.

**3. Verify the copy** before you rely on it:
```bash
sha256sum -c medoro-dump.sha256                      # file not damaged in transit
pg_restore --list medoro-2026-11-01.dump | grep -c "TABLE DATA"   # one entry per table
psql "postgresql://…/medoro_restored" -c 'SELECT (SELECT count(*) FROM "Sale") AS sales, (SELECT count(*) FROM "Voucher") AS vouchers, (SELECT count(*) FROM "StockMovement") AS movements, (SELECT max(at) FROM "Sale") AS last_sale;'
```
Run the same query on the live database: the counts and the last sale time must match. In the restored app, open Users & branches → Audit trail → **Verify chain** to confirm the hash-chained audit log is intact.

Treat dump files like the database itself: they are **not encrypted**. Store them on encrypted disks only (or encrypt them, for example `gpg --symmetric`), and delete copies you no longer need. Encrypted, restorable app backups are described in [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md).

## Honesty rule
A deployment is described as customer-controlled only if Medoro and any undisclosed third party lack unrestricted operational access. Managed hosting by Medoro, if it's ever offered, must be labelled as Medoro-hosted.

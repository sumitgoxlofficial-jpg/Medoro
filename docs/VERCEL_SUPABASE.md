# Deploying Medoro on Vercel + Supabase

Medoro runs on Vercel (Next.js functions, region `bom1` Mumbai) with a dedicated Supabase project
(`medoro-production`, region `ap-south-1` Mumbai) used for **PostgreSQL and private file storage only**.
Sign-in stays Medoro's own (Argon2id passwords, required authenticator codes for owners and managers,
server-side sessions); Supabase Auth and `supabase-js` are not used, so no Supabase key ever reaches a browser.

## How the pieces fit
| Concern | Self-hosted | Vercel + Supabase |
|---|---|---|
| Database | PostgreSQL 16 | Supabase Postgres via the pooler (`DATABASE_URL`, transaction mode) and `DIRECT_URL` (session mode) |
| Migrations | `prisma migrate deploy` on start | `scripts/vercel-build.sh` runs them on **production** builds only, over `DIRECT_URL` |
| Supabase data API | n/a | Locked: migration `lock_data_api` enables RLS on every table and revokes the `anon`/`authenticated` roles. The app connects as the table owner, which bypasses RLS. A test fails if any table lacks RLS |
| Tenant isolation | Server-side: every query is scoped to the signed-in user's pharmacy (`ctx.tenantId`), permissions checked on the server | Same |
| Files (invoice scans, backups) | `STORAGE_DIR` on disk | Private bucket `medoro-private` (created automatically), server-side secret key |
| Daily backups | In-process timer at the pharmacy's chosen time, failed runs retried (max 3/day, 30 min apart) | Vercel Cron, 21:30 UTC (03:00 IST), `GET /api/cron/tick` with `CRON_SECRET`; once a day on Hobby, so the chosen time and same-day retries don't apply |
| Live updates | LISTEN/NOTIFY + SSE | Same over `DIRECT_URL`; functions end after 300 s and browsers reconnect automatically |
| First-run setup | Open on first visit | Locked until the visitor enters `SETUP_TOKEN` |
| New pharmacies | One per installation (setup wizard) | Also open to everyone at `/signup` when `PUBLIC_SIGNUP=1`: rate-limited per IP, pharmacy code and owner email/mobile must be unused |
| Upload size | 10 MB | 4 MB (Vercel request limit) |

## Environment variables (Vercel → Project → Settings → Environment Variables)
Set these for **Production**. Mark secrets as *Sensitive*. Never prefix a secret with `NEXT_PUBLIC_`
(the app refuses to start if a `NEXT_PUBLIC_` name looks like a secret).

| Name | Where it comes from | Secret |
|---|---|---|
| `DATABASE_URL` | Supabase → Connect → *Transaction pooler* URI, then append `?pgbouncer=true&connection_limit=1&sslmode=require` | Yes |
| `DIRECT_URL` | Supabase → Connect → *Session pooler* URI, append `?sslmode=require` | Yes |
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL | No |
| `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API Keys → *Secret key* (`sb_secret_…`) | Yes |
| `SESSION_SECRET` | 48+ random characters | Yes |
| `HOST_KEY` | 48+ random characters, different from `SESSION_SECRET`. **Keep a copy offline**: it unseals stored WhatsApp tokens and backup keys | Yes |
| `CRON_SECRET` | 32+ random characters | Yes |
| `SETUP_TOKEN` | Random; you type it once on `/setup`. Remove it after setup | Yes |
| `APP_URL` | `https://<project>.vercel.app` now, `https://medoro.in` later | No |
| `DEPLOYMENT_MODE` | `cloud` | No |
| `STRICT_CUSTOMER_MODE` | `true` | No |
| `PUBLIC_SIGNUP` | `1` to let pharmacies create their own account at `/signup` (each gets its own pharmacy, owner and 14-day trial; data stays separated per pharmacy). Leave unset for a single-pharmacy server | No |
| `STAFF_EMAIL_DOMAIN`, `STAFF_BOOTSTRAP_EMAIL` | Only if the staff console should be live. Sign up with the bootstrap email right after deploying | No |

Generate random values locally, for example `openssl rand -base64 48`.
At start-up the app checks these (names only, never values) and refuses to run if any are missing or weak.

## First deployment
1. Supabase: create project `medoro-production`, region *South Asia (Mumbai)*, strong database password (stored in your password manager).
2. Vercel: project `medoro` linked to the GitHub repo, production branch `main`, framework Next.js (settings come from `vercel.json`).
3. Add the variables above, then deploy `main`. The build log should show `prisma migrate deploy` applying all migrations.
4. Open `/setup`, enter `SETUP_TOKEN`, create the pharmacy with **synthetic data**, enrol the authenticator.
5. Remove `SETUP_TOKEN` (or change it) and redeploy.
6. In Supabase → Advisors, check there are no "RLS disabled" or exposed-table warnings.

## Rollback
- **App**: Vercel → Deployments → pick the last good deployment → *Promote to Production* (instant; no rebuild).
- **Database**: migrations are additive. Never run `prisma migrate reset` against production. To undo a bad
  data change use Medoro's own Backup & restore (test copy first), or Supabase's daily backups / point-in-time
  recovery (paid plans) to restore into a new project and switch `DATABASE_URL`/`DIRECT_URL`.
- **Secrets**: rotate in Vercel and redeploy. Rotating `HOST_KEY` makes stored WhatsApp tokens and the sealed
  backup key unreadable: reconnect WhatsApp and re-enter the recovery kit afterwards.

## Known limits on Vercel
- Hobby plan is for non-commercial use; a paid SaaS needs Vercel Pro. Hobby cron runs once a day.
- Very large backups or restores may hit the 300 s function limit.
- Preview deployments get no database variables, so they show errors past the website. Give previews a separate Supabase project before testing there.

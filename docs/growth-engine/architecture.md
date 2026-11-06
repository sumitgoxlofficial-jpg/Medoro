# Growth Intelligence: architecture

Growth Intelligence is Medoro's internal pharmacy-prospecting CRM. It lives **inside the existing staff console**
(`/staff/growth/*`), the part of Medoro that serves Medoro's own team, and never inside the pharmacy app.

## Where it sits

```
Medoro (one Next.js 15 app, one PostgreSQL)
├── Pharmacy app   /app/*      tenant data (customers, sales, stock…), merchant Google Drive backups
├── Staff console  /staff/*    Medoro's own records (staff, commission, customers, tickets)
│   └── Growth     /staff/growth/*  + JSON API /staff/api/growth/*      ← this module
└── Public hooks   /api/growth/wa/webhook · /api/growth/email/events · /api/growth/unsubscribe
```

* **Identity:** existing `StaffUser` profiles and staff sessions (Argon2id password + mandatory TOTP; separate cookie
  `medoro_staff`, path `/staff`). No new login system, no Supabase Auth. A `GrowthMember` row adds a Growth role.
* **Data:** 33 new tables in the same PostgreSQL (prefix-free names such as `PharmacyLead`, `CallSession`). None has a
  foreign key to a pharmacy (tenant) table and the code never queries one (enforced by a static test).
* **Backups/restore:** all Growth tables are classified **global** in `src/domain/system/restore.ts`, so they are never
  written into a pharmacy's backup (which goes to that merchant's Google Drive) and never touched by a pharmacy restore.
* **Row level security** is on for every Growth table, like every other Medoro table, so a hosted data API (Supabase
  `anon`/`authenticated`) reads nothing.

## Code layout

| Path | Contents |
|---|---|
| `src/staff/growth/constants.ts` | Roles, permission matrix, menu, stages, outcomes, states (client-safe) |
| `src/staff/growth/access.ts` | Actor (staff + Growth role), permission checks, lead scope, audit, timeline, outbox, action wrapper |
| `normalize.ts`, `score.ts` | Pure helpers: E.164 phones, `tel:` URIs, name keys, similarity; evidence-based score |
| `leads.ts`, `imports.ts`, `discovery.ts`, `verify.ts` | Lead CRUD/search/export, CSV/XLSX import with duplicate checks, OpenStreetMap discovery, verification and safe merge |
| `team.ts`, `distribution.ts` | Growth roles, teams, territories, targets; Lead Distribution Centre |
| `calls.ts`, `followups.ts`, `pipeline.ts` | Personal-SIM calling, call reports, follow-ups, stages, demos, conversions |
| `comms.ts`, `compliance.ts` | WhatsApp Cloud API, email, templates, campaigns, inbox, webhooks; consent, suppression, erasure, retention |
| `analytics.ts`, `ai.ts` | Dashboards and performance from live rows; labelled AI research and drafts |
| `jobs.ts`, `workers.ts` | PostgreSQL job queue, outbox, handlers |
| `api.ts` | JSON API wrapper (session, role, CSRF, rate limit, Zod) |
| `src/app/staff/(console)/growth/*` | 23 screens; `src/app/staff/growth-actions.ts` server actions |
| `src/app/staff/api/growth/*`, `src/app/api/growth/*` | JSON API; public webhooks and unsubscribe |

## Request flow

UI screens are server components that call the services with the signed-in actor; edits go through server actions
(`growth-actions.ts`) wrapped in `growthRun`, which re-reads the staff session, resolves the Growth role and turns
expected errors into messages. The JSON API uses the same services through `growthApi`. Every service checks its
permission itself (`need(a, "assign")`), and every lead read goes through `leadScope(a)`.

## Background work

`BackgroundJob` (PostgreSQL queue, `FOR UPDATE SKIP LOCKED`, exponential backoff, dead after `maxAttempts`) and
`EventOutbox` (events written in the same transaction as the change). `growthTick` runs from the existing scheduler
(`/api/cron/tick`: every minute in self-hosted installs, daily on Vercel Hobby). Long work never blocks a request
indefinitely: imports over 200 rows run as a chunked, resumable job (the request also works on it for 20 s), discovery
tries once inline and otherwise retries in the queue, campaigns send in capped batches.

## Storage domains

| Domain | Holds | Here |
|---|---|---|
| Supabase/PostgreSQL | Operational CRM data | All Growth tables |
| Merchant-owned Google Drive | A pharmacy's own bills, documents, backups | Never touched by Growth (tables excluded from tenant backups) |
| Medoro platform Drive | Internal reports, CRM exports, encrypted platform backups | **Not wired yet**: exports download to the admin's device; platform-level backups rely on the database host's backups. See implementation-report.md |

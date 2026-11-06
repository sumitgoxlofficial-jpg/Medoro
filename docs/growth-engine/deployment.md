# Deployment

## Environment variables

No new variable is required. Optional ones:

| Variable | Default | Purpose |
|---|---|---|
| `GROWTH_OSM` | `on` | `off` disables OpenStreetMap discovery |
| `OVERPASS_URL` | `https://overpass-api.de/api/interpreter` | Your own Overpass instance for heavier use |
| `GROWTH_EMAIL_WEBHOOK_SECRET` | — | ≥ 16 chars; enables `/api/growth/email/events` |
| `GROWTH_REMOTE_AI` | — | `1` allows a remote model (from `AI_MODE=remote`, `REMOTE_AI_URL/MODEL/KEY`) to reword drafts; off = rule-based, no paid API |

Reused: `DATABASE_URL`/`DIRECT_URL`, `HOST_KEY` (seals WhatsApp secrets), `SESSION_SECRET` (unsubscribe tokens),
`APP_URL` (links in emails), `MAIL_PROVIDER`/`MAIL_FROM` (+ provider keys) for email, `CRON_SECRET`.
WhatsApp credentials are entered in Growth → Integrations, not in env.

## Steps

1. **Staging first**: deploy the branch to a preview/staging environment pointing at a staging database (a Supabase
   branch or a copy). Run `pnpm prisma migrate deploy` (the Vercel build script already does on deploy). Confirm
   `/api/ready` is green.
2. Smoke test: sign in to `/staff` as a super admin → Growth intelligence; import the template CSV; distribute to a
   test employee; on a phone, open Calling workspace → CALL PHARMACY → report.
3. Production: merge, let the deploy run the migration (additive; existing features unaffected). Back up the database
   first per docs/BACKUP_AND_RECOVERY.md.
4. In **My employees**, give Growth roles to existing staff; create teams and targets.
5. Optional: Integrations → connect the WhatsApp platform number (permanent token, app secret), paste the webhook URL and
   verify token into the Meta app, subscribe to `messages` and `message_template_status_update`, Sync templates.
   Email manager → send test email → confirm the code.
6. Review Settings → Contact policy (see compliance.md about calls) before employees start calling.

## Scheduling

Growth jobs run from the existing `/api/cron/tick`. Self-hosted: every minute (in-process scheduler). Vercel: the
configured cron is daily (`30 21 * * *`), which Hobby plans allow; imports and discovery therefore do their work inline
first, and admins have "Run due jobs now" in Integrations. On Vercel Pro you can add a more frequent cron for
`/api/cron/tick` (e.g. every 10 minutes) so campaign batches and escalations run during the day.

## Limits on Vercel

Request bodies are capped at ~4.5 MB on Vercel functions: split import files above that. Discovery and import pages set
`maxDuration = 120`.

## Rollback

The migration only adds tables, so rolling back the app code leaves the tables unused and harmless. To remove the
module's data completely, drop the 33 tables listed in database-schema.md (after an export, if needed).

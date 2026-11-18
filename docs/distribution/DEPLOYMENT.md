# Deployment

## Migration
* One additive migration: `prisma/migrations/20261214000000_distribution`. It adds `Tenant.product` with default
  `'pharmacy'` (every existing tenant stays a pharmacy), creates the `Dist*` tables with append-only triggers, CHECK
  constraints and row-level security enabled. No existing data is changed or deleted.
* Applied by the existing pipeline: Vercel production builds run `prisma migrate deploy` over `DIRECT_URL`
  (`scripts/vercel-build.sh`); Docker runs the migrate job; the app refuses to start with pending migrations.
* Rollback: the new tables are independent. Reverting the code leaves them unused; dropping them is safe only after
  exporting any distributor data.

## Environment variables
No new variable is required. One optional variable:

| Variable | Default | Meaning |
|---|---|---|
| `DIST_HOSTED` | unset | On MEDORO's own hosted server (`PUBLIC_SIGNUP=1`), where each tenant's records must live in its Google Drive, distributor sign-up is **closed** and distributor records are read-only unless this is `1`. Set it only after deciding to keep distributor records on that server and updating the privacy notice. |

Everything else is shared with Pharmacy: `DATABASE_URL`, `DIRECT_URL`, `SESSION_SECRET`, `HOST_KEY`, licence and mail settings.

## Where Distribution runs
| Deployment | Distribution |
|---|---|
| Distributor's own server / LAN (Docker) | Yes. Create the distributor at `/distributor-signup` (setup gate: `SETUP_TOKEN`, or `SETUP_OPEN=1` on a private machine) |
| Distributor's own Vercel + Supabase project | Yes (same as Pharmacy's hosted mode) |
| MEDORO's shared hosted server (`PUBLIC_SIGNUP=1`) | Only with `DIST_HOSTED=1` (see above) |

## Build
`next build` runs type checking; on machines with a small default Node heap use
`NODE_OPTIONS=--max-old-space-size=6144`. Vercel's build machines are unaffected in practice; if a build there reports
"JavaScript heap out of memory", add that variable to the project's build environment.

## Rollout checklist
1. Deploy to a preview with its own database (`PREVIEW_DATABASE=1`), run `pnpm test` and the `dist` Playwright project.
2. Deploy to production; the migration applies; pharmacies are unaffected (`/app` unchanged).
3. Create the first distributor at `/distributor-signup`; the owner enrols TOTP at first sign-in.
4. Add godowns, companies/principals, suppliers, products (PTR/PTS), chemists; receive opening stock by GRN.
5. Turn the chemist portal on under Chemist portal and share the distributor code with chemists.

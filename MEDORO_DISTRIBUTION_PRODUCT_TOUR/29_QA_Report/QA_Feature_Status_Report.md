# Medoro Distribution – QA and feature-status report

Product tour production, 27 November 2026 (session clock). Demo history is dated 28 Sep – 26 Nov 2026; everything done on camera is dated 27 Nov 2026.

## 1. Test environment (production was not touched)

| Item | Value |
|---|---|
| Application | Medoro repository `sumitgoxlofficial-jpg/medoro`, branch `claude/lucid-fermi-lrqhzg`, production build (`next build` + `next start`) |
| Server | Local demo server in an isolated cloud container, `http://localhost:3000`, configured like Medoro's hosted service (`DEPLOYMENT_MODE=hosted`, `PUBLIC_SIGNUP=1`) with `DIST_HOSTED=1`, so distributor records live in the server database and the full Distribution ERP (`/dist`) is used |
| Database | Separate local PostgreSQL 16 database `medoro_distdemo` (all 93 migrations applied) |
| Email | Local HTTPS mail sink acting as the authorised test inbox for sign-up and password-reset codes. No real email was sent |
| Licence | A local licence server on the same demo machine (own key pair), so the Subscription screen shows a real 7-day Professional trial. No payment gateway; no payment made |
| Google Drive | The app's built-in test Drive (`E2E_FAKE_DRIVE=1`). Real Google sign-in is not configured on the demo server |
| E-invoice / e-way bill, GSTN filing, bank feeds, WhatsApp/SMS | Not connected (no credentials; several are not wired for Distribution at all). Shown only as their real status |
| Live website | https://medoro.in/distribution opened read-only in Parts 01, 02, 25. No account was created on production |
| Browser | Chromium (Playwright), 1920×1080 at 125 % scale, Asia/Kolkata, en-IN; staff phones are a second, phone-sized app window signed in as that employee |

Note on hosting: on medoro.in today, new distributors sign up in **Drive mode** (`DIST_DRIVE=1`, records on the distributor's devices and Google Drive, screens at `/dist/device`). This tour uses the server-database Distribution ERP (`/dist`), which is what a distributor gets on its own server/database or with `DIST_HOSTED=1`. The business workflows and rules are the same code (`src/domain/distribution/rules`), but the screens differ.

Demo account and data: see `30_Demo_Data/README.md`.

## 2. Bugs and gaps found, and what was done

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | **High (gap)** | **No supplier outstanding, ledger or payment screen in Distribution.** Supplier dues were visible only as one "Sundry creditors" total in the trial balance; suppliers could not be paid from the Distribution app (the pharmacy screens redirect distributors to `/dist`) | **Fixed** (`ffb5ca0`): `/dist/suppliers/[id]` (we owe, last purchase/payment, ledger statement with date range, recent GRNs, *Pay supplier* using the shared payment service, oldest bills first); "We owe" column and links on Companies & principals; Hindi strings; integration test `tests/integration/dist-payables.test.ts` |
| 2 | **High (gap)** | **Distributors could not reach Backup & restore.** `/app/backup` redirects a distribution tenant to `/dist`, and the Distribution menu had no backup screen, although the shared encrypted backup covers every distribution table | **Fixed** (`ffb5ca0`): `/dist/backup` renders the shared backup screen; *Backup & restore* added under System |
| 3 | Low (copy) | Sign-up verification email told distributors "…create your **pharmacy** account" | **Fixed** (`ffb5ca0`): the distributor sign-up passes the product; the email says "distributor account" |
| 4 | Low (copy) | Distributor-facing screens still use pharmacy wording: sign-in and two-step pages ("Bill faster… FEFO… Offline billing", "Trust this counter PC"), staff join flow ("Pharmacy code", "Pharmacy staff login"), plan page ("your pharmacy's name"), backup screen copy | Open (recorded as observed) |
| 5 | Low (UX) | The stock screen has no **Reserved** column; reserved packs are visible on each order's pick list and are netted in the order entry's Stock column | Open (narration describes the real behaviour) |
| 6 | Low (UX) | Sign-up errors that belong to an earlier step (e.g. "An account with this mobile number already exists") appear on the last wizard step | Open |
| 7 | Low (a11y) | Some forms have inputs without accessible labels (Companies/principals/suppliers, Territories/salesmen, the credit-note lines on the invoice) | Open |
| 8 | Info | Portal discovery shows a distributor's address from its most recently created godown | Open |

## 3. Feature status (verified on the demo server)

Legend: **Working** = demonstrated end to end on camera or in rehearsal · **Partial** = works with the limits noted · **Requires configuration** = needs external credentials · **Not available** = not in the application · **Built** = added during this project.

(filled in after recording – see section 3 table below)

## 4. Recording QA

(filled in after recording)

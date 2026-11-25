# Medoro Pharmacy – QA and feature-status report

Product tour production, 25–26 November 2026 (session clock; the demo data is dated 27 Oct – 26 Nov 2026).

## 1. Test environment (production was not touched)

| Item | Value |
|---|---|
| Application | Medoro repository `sumitgoxlofficial-jpg/medoro`, branch `claude/sharp-hawking-ycrh5a` (production build, `next start`) |
| Server | Local demo server in an isolated cloud container, `http://localhost:3000`, configured like Medoro's hosted service (`PUBLIC_SIGNUP=1`, `DEPLOYMENT_MODE=hosted`) |
| Database | Separate local PostgreSQL 16 database `medoro_demo` (all 83 migrations applied) |
| Email | Local HTTPS mail sink (`MAIL_PROVIDER=http`) acting as the authorised test inbox for sign-up and password-reset codes. No real email was sent |
| Google Drive | The app's built-in **test Drive** (`E2E_FAKE_DRIVE=1`, in server memory). Real Google sign-in is not configured on the demo server |
| WhatsApp, SMS, OCR, payments, bank AA, e-invoice | **Not connected** (no external credentials). Shown only as configuration / "not connected" screens |
| Live website | https://medoro.in was opened read-only for Parts 01, 02, 23 and 26. No account was created on production; the sign-up itself was done on the demo server |
| Browser | Chromium (Playwright), 1920×1080, Asia/Kolkata. Sales history was entered with the browser clock shifted to past dates (libfaketime), only in the demo browser |

### Demo pharmacy (all fictional)

| Field | Value |
|---|---|
| Pharmacy | Medoro Demo Pharmacy · code `MEDORO-RANCHI` |
| Owner | Demo Pharmacy Owner · owner.ranchi@demo.medoro.local · 90000 00001 |
| GSTIN | 20DEMOF0001D1ZO (fictional; Jharkhand state code 20; "DEMO" PAN) |
| Drug licence | JH-RNC-DEMO-20B-000101 / 21B-000102 (fictional) |
| Pharmacist | Demo Pharmacist · Reg. JH/DEMO/0001 |
| Address | Shop 12 (Demo Address), Main Road, Ranchi, Jharkhand 834001 |
| Branches / counters | Main Road (2 counters), Kanke Road (1 counter) |
| Team invites | Manager (email), Pharmacist (Kanke Road), Cashier (mobile) |
| Language / currency | English (Hindi shown in Part 24) · INR |

Credentials, the authenticator key, recovery codes, the Drive recovery code and the backup recovery kit exist only in the demo container's scratch area. They are never shown on screen: secure mode blurs them during recording.

### Sample data entered through the app UI

- 36 medicine/batch rows (32 medicines + 4 second batches for FEFO) with salt, strength, composition, form, manufacturer, pack, MRP, GST (5 % / 18 %), schedule (H, H1), HSN, barcode, reorder level, rack, batch, expiry, opening stock and cost. Brand and manufacturer names are invented and marked "Demo".
- 3 OTC/device items imported on camera (Part 06) and 1 medicine added by hand (Part 05).
- 4 suppliers and purchase bills (GRN) with batch, expiry, free quantity and rate, on 6 dates, plus bills entered on camera.
- 8 customers (credit limits, WhatsApp consent, 1 business customer with GSTIN) and 3 doctors.
- About 170 sales bills over 30 days (cash, UPI, card, credit; discounts; prescriber details for every Schedule H/H1 line), plus returns, expenses, a supplier payment, customer receipts and a branch transfer done on camera.

## 2. Bugs found and fixed (committed on the branch)

| # | Severity | Bug | Fix (commit) |
|---|---|---|---|
| 1 | High (UX) | **Email sign-up never showed the "Done" step.** Creating the pharmacy clears the confirmed-email cookie inside the server action, so `/signup` re-rendered as the email step. The owner saw "Sign up with email" again instead of invite codes and "Set up two-step verification". Distributor sign-up had the same defect | `fe6a9b8` – a sign-up session from the last 10 minutes keeps the wizard mounted |
| 2 | High (data isolation) | **A second pharmacy signing in on the same browser opened the first pharmacy's counter data.** It showed the other pharmacy's medicines, bills and customers, skipped its own Drive set-up, and registered the device for Drive sync under the signed-in pharmacy | `e2ba25a` – the counter checks the device database against the signed-in pharmacy's branches. It shows a notice instead of the records, and doesn't register or sync. Hindi strings added |
| 3 | Medium | Device database opens were not serialised, and a page reload could hit OPFS handles still held by the previous page's worker. The counter could then wrongly show "Set up this device", inviting a fresh start or restore | `bb808c2` – opens queued; pool install retries for ~10 s on `NoModificationAllowedError` |
| 4 | Low | Billing header advertised **"F4 hold"**, which the device counter doesn't implement | `387abc5` – hint removed |
| 5 | Low | Stock quantities read "10 **boxs**" | `387abc5` – -es plural for x/ch/sh |

Fixes 4 and 5 were made after the demo server had started. The demo server wasn't restarted for them, because a restart wipes the in-memory test Drive mid-production. Recordings made after that point still show the old "F4 hold" hint and "boxs".

## 3. Feature status (verified on the demo server)

Legend: **Working** = demonstrated end to end · **Partial** = works with the limits noted · **Not available** = not present for a hosted (Google Drive) pharmacy · **Not connected** = needs external credentials not available here.

FEATURE_TABLE_PLACEHOLDER

## 4. Other observations

- **Sign-up rate limit** ("Too many new pharmacy sign-ups from this network. Try again in 2 minutes.") triggered after the rehearsal sign-ups. That is correct behaviour. The error appears on the last wizard step, though, and the "pharmacy code is taken" error also appears there while the field is on step 1. A user has to go back four steps to fix it.
- **Onboarding has no separate fields** for state, city, financial year or tax configuration. Address is one free-text line, and GST is configured per medicine. Recorded as observed; not demonstrated as separate settings.
- **Browser crash recovery:** a force-killed browser left the device database's OPFS storage unusable in that profile ("Set up this device" with `NoModificationAllowedError`). Data on that profile could only be recovered from Drive with the Drive recovery code. Fix #3 handles the normal reload race; recovering from a hard crash still depends on the Drive copy.
- **Server-side screens for a Drive pharmacy** (Owner view, Compliance centre, Purchases/Accounts in the server menu) read Medoro's server copy, which is empty by design for Drive pharmacies. Some screens say so (Compliance); Owner view shows zeros without explanation.
- **Backup page** showed "couldn't sync with Google Drive: Invalid sqlite3* argument" for the device after the crash above. See section 3.

## 5. Recording QA

RECORDING_QA_PLACEHOLDER

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
| 6 | **High** | **Barcode scan added the wrong medicine.** Enter added the first item of the last debounced (120 ms) search. A scanner types and sends Enter faster than that, so scanning an ORS sachet added **Alprazolam (Schedule H1)**, the first item A–Z. The H1 prescription check then blocked the bill, which is how this was found | `4dd2bb6` – Enter searches the exact text in the box first |
| 7 | Medium | **F2 on the device counter opened the server POS** (`/app/pos`, Medoro's empty server copy for a Drive pharmacy), although the counter says "F2 search" | `1c3d28f` – F2 is left to the counter on counter pages |
| 8 | Medium | **Ask (built-in rules)** didn't understand "Which medicines are running low?" or "Kaunsi medicines ka stock kam hai?", and read "Which batches are expiring soon?" as a medicine name | `9fe222b` – rules extended, tests added |

Fixes 4–8 were made after the demo pharmacy's data was in place. The demo server wasn't restarted for them, because a restart wipes the in-memory test Drive (and with it the encrypted copy the counter syncs to). **The videos therefore show the build before fixes 4–8.** The narration avoids F2 on the counter and types barcodes at hand speed. Part 17 says plainly which questions the assistant didn't understand. All 8 fixes are committed, typechecked, linted and unit-tested, but have not been re-recorded.

## 3. Feature status (verified on the demo server)

Legend: **Working** = demonstrated end to end · **Partial** = works with the limits noted · **Not available** = not present for a hosted (Google Drive) pharmacy · **Not connected** = needs external credentials not available here.

| Area | Feature | Status | Notes |
|---|---|---|---|
| Registration | medoro.in → Pharmacy → Start 7-day free trial | Working | Live site shown read-only; account created on the demo server |
| | Email verification (6-digit code) | Working | Code to the demo inbox; 10-minute validity shown |
| | Google sign-up | Not connected | Google sign-in not configured on the demo server |
| | Login, two-step verification (TOTP), trusted PC 30 days | Working | |
| | Forgot password (email code, signs out every device) | Working | Full reset demonstrated |
| | Lockout after 5 failures, sign-up rate limit | Working (rate limit observed) | Lockout narrated from the product documentation; not triggered on camera |
| Onboarding | Pharmacy name, GSTIN (format check), drug licence, pharmacist, address, pharmacy code, language | Working | Validation shown |
| | State/city/financial year/tax configuration as separate settings | Not available | Address is one free-text field; GST is set per medicine |
| | Branches and counters, team invites, recovery kit, terms | Working | |
| | Drive storage set-up and recovery code | Working (test Drive) | |
| Dashboard | Sales, margin, purchases, expenses, receivables, payables, 7D/30D, sales chart, collections by mode, insights, low stock, expiry, branch performance, recent activity | Working | Sales chart always shows the last 14 days, even in the 30D view |
| Medicines | Add, edit, deactivate ("In use"), salt, schedule, HSN, GST, MRP, pack/loose, barcode, rack, reorder level | Working | Delete is by design "deactivate" (history kept). Manufacturer/HSN not in the hand-entry form (they come from import) |
| Inventory | Stock list, low-stock filter, opening-stock import with preview/validation, batches, FEFO, stock correction with reason, stock count, batch status OK/Quarantine/Recalled, branch transfer | Working | |
| | Recall notices (record verified notice, match stock) | Present, not tested | Recalls tab opened; no notice recorded (Medoro asks for notices from verified sources only) |
| Purchases | Typed supplier bill = GRN (batch, expiry, packs, free packs, rate, MRP), supplier dues, supplier payment | Working | |
| | Purchase discount per line | Not available | No discount field on the device purchase line |
| | Purchase order | Partial | Insights → order list (reviewed by the owner); no formal PO document on the counter |
| | Purchase return / supplier claims | Present, not tested end to end | Supplier tools → Claims screen shown |
| Invoice import | Distributor e-bill file (CSV/Excel/text) with column mapping and review | Working | |
| | AI scan of PDF/photo invoices (OCR) | Not connected | Server-side OCR engine (`OCR_ENGINE=remote`) not configured; not on the Drive counter |
| Billing | Search by brand, salt, barcode; Enter add; F9 complete; FEFO batch; loose units; customer by mobile; role-capped discount; GST (CGST/SGST, IGST for inter-state GSTIN); cash, UPI, card, credit; tax invoice; print / Save as PDF | Working | See bugs 6 and 7 |
| | Split payment, hold & resume cart | Not available on the device counter | Exist only on the server-mode POS |
| | WhatsApp invoice PDF | Not connected | |
| Schedule H/H1 | Prescriber, registration no., patient (H1) required before billing; printed on invoice; sales by doctor | Working | |
| | Schedule H1 register report | **Not available on the Drive counter** | Server-mode register reads Medoro's copy, empty for Drive pharmacies. Compliance gap |
| Customers | Add/edit, credit limit, GSTIN, WhatsApp consent, receive payment, remind, pay link | Working (pay link / remind need WhatsApp/payments) | |
| | Customer ledger and statement screen | Partial | Dues and receipts on Customers; bills searchable by mobile; no statement document on the counter |
| Returns | Find bill, per-line quantity (same batch), reason, condition sealed/damaged, refund cash/UPI/to account, credit note, day-end | Working | |
| Suppliers | Dues, payment voucher, pricing comparison | Working | Claims and cheques screens shown, not tested end to end; home-delivery Orders tab not tested |
| | Supplier profile, ledger and statement screen | Not available on the Drive counter | |
| Accounts | Expenses by category, cash book, bank statement import and matching, sales & profit report | Working | |
| | Day book, ledger, trial balance, P&L statement, cash flow | Not available on the Drive counter | Listed as plan features; present only in server mode |
| | Automatic bank sync | Not connected | Needs a bank / Account Aggregator partner |
| GST | MRP-inclusive tax, HSN, GSTR-1 JSON, HSN summary CSV, GSTR-3B JSON/CSV | Working | Must be reviewed by the pharmacy's CA |
| | Tally export | Not available on the Drive counter | CSV/JSON exports only |
| WhatsApp | Link by QR, auto-send invoice PDF, delivery log, refill/feedback/payment reminders, consent, STOP opt-out | Not connected (screens shown) | |
| AI assistant | Ask (built-in rules, offline): today/month sales, low stock, expiry, dues, cash | Partial | Bug 8 (fixed in code); no profit answer on the counter; "Ask AI" drawer uses the same tools; not a medical advisor |
| | Draft purchase order via AI with confirmation | Not demonstrated | Exists in the server-mode assistant |
| Offline | Counter PIN; billing with the browser offline; changes waiting; sync on reconnect | Working | Demo browser taken offline only |
| Branches | Two branches, counters, branch transfer, branch performance | Working | Owner view (consolidated) reads the server copy and shows zeros for a Drive pharmacy |
| Staff | Users list (role, branch, MFA, last active), invites, add employee, roles & permissions, view-as-role, audit trail, counter activity | Working | Invited staff did not accept their invites in this demo |
| Backup/security | Encrypted Google Drive copy, recovery code, restore, privacy controls, strict mode, export, erasure, integration health | Working (test Drive) | Real Google Drive not connected |
| Subscription | Plan page, plan features, renew/pay | Partial | Demo server isn't licensed ("Self-hosted"); trial/plan comparison shown on the live medoro.in pricing page; no payment made |
| Language | English ⇄ Hindi interface, Hindi/Hinglish questions | Working | |

## 4. Other observations

- **Sign-up rate limit** ("Too many new pharmacy sign-ups from this network. Try again in 2 minutes.") triggered after the rehearsal sign-ups. That is correct behaviour. The error appears on the last wizard step, though, and the "pharmacy code is taken" error also appears there while the field is on step 1. A user has to go back four steps to fix it.
- **Onboarding has no separate fields** for state, city, financial year or tax configuration. Address is one free-text line, and GST is configured per medicine. Recorded as observed; not demonstrated as separate settings.
- **Browser crash recovery:** a force-killed browser left the device database's OPFS storage unusable in that profile ("Set up this device" with `NoModificationAllowedError`). Data on that profile could only be recovered from Drive with the Drive recovery code. Fix #3 handles the normal reload race; recovering from a hard crash still depends on the Drive copy.
- **Server-side screens for a Drive pharmacy** (Owner view, Compliance centre, Purchases/Accounts in the server menu) read Medoro's server copy, which is empty by design for Drive pharmacies. Some screens say so (Compliance); Owner view shows zeros without explanation.
- **Backup page** showed "couldn't sync with Google Drive: Invalid sqlite3* argument" for the device after the crash above. See section 3.

## 5. Recording QA

- **38 MP4 files:** 26 chapter videos and 12 compilations (the complete tour runs 44:10). All are 1920×1080, 30 fps, H.264 (CRF 20) with AAC 160 kbps 48 kHz audio, about 1.3 GB in total.
- **Recording method:** a real Chromium window on a 1920×1080 virtual display, captured with ffmpeg (x11grab, 30 fps). Every screen is the real Medoro application; nothing is mocked up. An overlay draws a highlighted cursor, click ripples, zoom-ins and callouts.
- **Voice-over:** Microsoft neural Hindi voice (hi-IN-SwaraNeural), spoken from Devanagari text with English technical terms. Each scene runs at least as long as its narration.
- **Subtitles:** Hinglish (Roman script), burned in and also supplied as SRT, timed per scene from the same timeline as the audio.
- **Music:** a light background track synthesised for this project (royalty-free), ducked under the voice. The final mix is loudness-normalised to −16 LUFS.
- **Branding:** the official Medoro logo, colours (#0B3A78, #0A9A80, #0B5E5B) and font (IBM Plex Sans) on the intro, chapter cards, outro and thumbnails.
- **Checks done:**
  - Every scene finished without a recording error. Failed takes (wrong selectors, the barcode race, the F2 navigation) were fixed and re-recorded.
  - A contact sheet of mid-chapter frames was reviewed for all 26 parts.
  - The full tour's audio decodes cleanly, and audio/video durations differ by about 1 s over 44 minutes, so there is no drift.
  - Secrets (QR code, authenticator key, recovery codes, Drive recovery code) are blurred as they render.
- **Known limitations:**
  - The voice is synthetic (neural TTS), not a human voice artist.
  - Subtitle cue timing within a scene is proportional to text length, not word-aligned.
  - Some zooms are brief.
  - Recordings show the build before fixes 4–8 (see section 2).
- **Honesty markers in the videos:** "Demo environment · fictional data", "WhatsApp: NOT CONNECTED", "PDF / photo OCR: not connected", "test Google Drive", "No real payment made", and the QA-finding callouts for missing features.

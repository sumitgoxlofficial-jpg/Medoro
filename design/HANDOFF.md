# Handoff: Medoro — Pharmacy OS (full product)

## Overview
Medoro is an AI-assisted pharmacy management SaaS for Indian medical stores and chains. This bundle contains the high-fidelity interactive prototype for all screens, plus specs (`docs/`), the target DB schema (`prisma/schema.prisma`), `.env.example`, and CI. Build the real app from these.

## About the Design Files
The `.dc.html` files are **design references built in HTML**. They're prototypes that show the intended look and behaviour, not production code to copy. Recreate them in the target stack: Next.js App Router, React, TypeScript strict, Tailwind, shadcn/ui, Lucide, React Hook Form, Zod, TanStack Query, Recharts, Prisma, PostgreSQL. The prototype's business logic (FEFO, GST maths, validation rules, state transitions) is a **behavioural spec**. Re-implement it in server-side domain services; never trust the client.

Open any `.dc.html` in a browser (keep `support.js` and `assets/` alongside). All data is synthetic. Integrations are simulated.

## Fidelity
**High-fidelity.** Final colours, type, spacing, copy and interactions. Match them closely using shadcn/ui primitives restyled with the tokens below.

## Global layout (Medoro App)
- CSS grid: `[sidebar 232px | main minmax(0,1fr) | AI drawer 380px (when open)]`, full viewport height. Main scrolls; sidebar and drawer are fixed.
- **Below 1180 px viewport:** the sidebar collapses to 76 px (icon plus a 10.5 px label stacked) and the AI drawer becomes a fixed overlay (`box-shadow: -12px 0 32px rgba(0,0,0,.14)`).
- **Sidebar:** white, right border `#E3E6E9`. Logo mark 36 px plus the wordmark "Med" `#0B3A78` / "oro" `#0A9A80` at 18/700, pharmacy name below at 12 px `#5B636B`. Nav groups (Operations, Intelligence, Business, Engagement, System) with headings at 11 px/600 uppercase, .06em tracking, `#8A929A`. Item: 13.5 px, padding 7×12, radius 8, min-height 36, icon 18 px. Active: bg `#E1F1EF`, fg `#0B5E5B`, weight 600. Hover bg `#F0F4F4`. Footer: a "Strict customer-controlled" card (bg `#F2F9F8`, border `#CFE6E3`, radius 10) and the user avatar (32 px circle, `#EAF0FC`/`#2459C9`).
- **Header** (white, bottom border, padding 12×24, wraps): title 19/600 plus subtitle 12.5 `#5B636B`. Then a "Live sync · 3 devices" pill (bg `#E6F4EC`, fg `#1E7F4F`, pulsing 7 px dot), branch select, EN/हि segmented toggle, "View as" role select, and the "Ask AI" button (outline `#9FCFC9` → filled teal when open).
- Main padding 20×24×40, content max-width 1400.

## Screens (19 + drawer)
Each screen is one `<sc-if value="{{ is_<id> }}">` block in `Medoro App.dc.html`. The logic lives in `class Component` in the same file: `renderVals()` → `vDash/vPos/vInv/vExp/vPur/vParties/vAcc/vWa/vBak/vUsers/vAi/vMore`.

1. **Dashboard (`dash`)**: 6 KPI cards (auto-fit minmax 180 px), a 14-day sales bar chart (today `#0B5E5B`, others `#B5D9D4`, 140 px max), a collections stacked bar, AI insights (3, each with basis plus a CTA), low stock with % bars `#C27B12`, expiring ≤90 d with colour badges (≤30 red, ≤60 amber), branch performance bars `#2459C9`, last backup, recent activity. All metrics are computed from data; nothing is hard-coded except the synthetic base.
2. **Billing / POS (`pos`)**: grid `minmax(0,1fr) | 330–380 px` (sticky right column).
   - Search: 16 px, 1.5 px teal border, radius 10, F2 focus. Results dropdown up to 7, ↑↓/Enter, shows stock and the next FEFO batch, plus an Rx badge (H/H1, red outline).
   - Cart line: name, generic·strength·pack, batch `<select>` (expired and quarantined options are disabled), qty stepper (manual entry clamped to batch availability), amount, MRP·GST, remove.
   - Right column: customer select (walk-in default), **prescriber required when any Rx item is present** (red panel), totals (MRP, discount % with a role cap of 5% or 20%, taxable, CGST, SGST, round-off, grand total 26/700), payment tabs Cash/UPI/Card/Split/Credit (credit only with the permission and within the limit), Complete (F9, disabled while committing), Hold (F4), Clear, held-cart chips.
   - On commit: modal with invoice no., idempotency key, Thermal/A4 print, WhatsApp section (editable number + verify checkbox → send → queued/sent/delivered/read progress, failed with retry ≤3), thermal receipt preview (monospace, 300 px).
3. **Returns & shift (`ret`)**: pick a committed invoice → per-line return qty (≤ sold − returned) → condition (sealed restocks the same batch; damaged doesn't) → refund mode → required reason → credit note CN-xxxx + ledger + audit. Shift close: opening float + cash sales − cash expenses − cash refunds = expected; the counted amount posts the difference to Cash short/excess.
4. **Inventory (`inv`)**: search plus filter chips (All, Low, Schedule H/H1, Expiring ≤90 d), table, a right-side drawer (620 px) with details, the FEFO batch list (quarantine/release), Receive batch (validation: batch unique, future expiry, qty ≥1, cost ≤ MRP), and the append-only movement ledger. An Add-medicine modal (no AI autofill).
5. **Stock count (`count`)**: per-batch counted input → live variance and value → post adjustments as movements.
6. **Recalls (`recall`)**: notices with source/date/batches → matching stock across branches → one-click quarantine, status select, a form to record a verified notice. Never auto-generated.
7. **Expiry prevention (`exp`)**: window tabs 30/60/90/180, KPIs, per-batch projection (`sold = min(qty, floor(vel × days))`), projected loss at cost, recommendation (return if the supplier accepts and ≥20 days remain, otherwise transfer), actions, an expired-and-blocked list.
8. **Stock intelligence (`intel`)**: forecast table with policy (cover 7–30 d, safety 1–5 d). `ROP = ceil(vel × (lead + safety))`, suggestion = `target + ROP − stock` when stock ≤ ROP or < reorder level, with a "why" text. Draft PO. Supplier quote comparison. Slow and dead stock. Anomaly rules with editable thresholds and "Mark reviewed".
9. **Purchases (`pur`)**: PO list with state badges. AI scanner: upload → 4-step processing → review table (catalogue match select, batch, expiry, qty, rate, confidence badge, flags, Verified checkbox for confidence <80%) → calculated vs printed total → **Approve is disabled until there are zero flags and the totals match** → GRN posts batches, movements and the supplier payable.
10. **Suppliers & customers (`parties`)**: tabs, terms, lead time, accuracy, payables with due badges, a Record payment modal (≤ balance) → voucher. Customers: consent badge, limit, outstanding, Receive payment.
11. **Accounting & reports (`acc`)**: P&L, cash & bank, GST by slab, day book with Reverse (creates a reversal entry and dims the original), Record expense modal, 9 CSV report tiles (generated client-side in the demo; server-side or local in production).
12. **WhatsApp (`wa`)**: connection card (WABA ID, phone number ID, token "server vault", webhook verified), rotate/disconnect/connect, auto-send (consent-gated), attach PDF, templates with approval status, counters, delivery log with bounded retry.
13. **Customer messaging (`crm`)**: refill/loyalty/feedback toggles, upcoming reminders (purchase-interval basis only), campaigns (draft, opted-in audience), opt-outs.
14. **Backup & restore (`bak`)**: Drive card (scope `drive.file`), encryption card, schedule and retention, Back up now (progress stages: snapshot → encrypt → upload → verify), history with hash, test restore modal (5 steps → staging verified → owner-only promote).
15. **Sync & offline (`sync`)**: devices, offline queue with conflict resolution (partial post plus refund, or void).
16. **Users & branches (`users`)**: tabs Users / Roles (click-to-toggle matrix; Owner locked) / Branches & transfers (approve) / Audit trail.
17. **Subscription (`plan`)**: plan, entitlements, add/remove AI add-on, cancel, offline licence policy, Medoro invoices.
18. **Privacy & data (`privacy`)**: strict mode, remote AI (turning it on disables strict mode), telemetry, crash reports, retention, full export, customer erasure (blocked while a balance is outstanding), external services table.
19. **Medoro admin (`admin`)**: control-plane view. Banner: no access to pharmacy data. Health, tenants (extend trial, verify payment), billing events, tickets.
- **AI drawer**: messages (user teal bubbles; AI white cards with a tool chip `#2459C9`/`#EAF0FC` mono, result rows, basis, a confirmation panel `#FDF2E1` for write tools), suggestion chips, input, footer "Local model… Not clinical advice". Intents and tools are listed in `docs/AI_ASSISTANT.md`.

**Medoro Onboarding**: sign-in card 420 px (mobile OTP or email/password tabs) → MFA (6-digit) → wizard with a 6-segment stepper: Pharmacy (GSTIN regex `^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$`, drug licence required) → Database host (Cloud/On-prem/LAN/Single device cards plus Test connection) → Branches → Team invites → Backups and recovery kit (acknowledgement required) → Done.

**Medoro Website**: sticky nav, hero (2-column, product mini-mock), 6 feature cards, data ownership, AI section on `#0B3A78`, 4 plans (indicative prices), footer.

## Interactions & rules (must be enforced server-side)
- FEFO: earliest expiry among batches with `status = ok`, `expiry > today` and qty > 0. Exhausting a batch auto-adds the next batch as a new line.
- Money in integer paise. Line `taxable = round(net × 100 / (100 + gst))`. CGST = floor(tax / 2), SGST = remainder. Round to the rupee.
- Sale commit is atomic with an idempotency key, re-validates stock (simulated 650 ms) and blocks double submit.
- Discount cap by permission. Credit requires permission and the limit. Rx requires a prescriber.
- Everything posted is immutable: corrections are reversals, credit notes or adjustment movements. Every consequential action writes an audit event.
- Role switch ("View as") hides nav items and blocks actions per the permission matrix.
- Keyboard: F2 search, F4 hold, F9 complete, Esc closes modals, Ctrl/⌘+J toggles AI.
- Toasts: bottom centre, 3.4 s, tone colours red `#B3261E` / green `#1E7F4F` / amber `#94570A` / blue `#2459C9` / neutral `#2B3036`.

## Design tokens
- **Brand:** primary teal `#0B5E5B` (hover `#094A48`), teal tint `#E1F1EF`, teal border `#9FCFC9`/`#CFE6E3`, logo navy `#0B3A78`, logo green `#0A9A80`, blue `#2459C9` / tint `#EAF0FC`.
- **Neutrals:** bg `#F5F6F7`, surface `#FFFFFF`, subtle `#FAFBFB`, border `#E3E6E9`, row divider `#F1F3F4`, input border `#CDD2D7`, text `#1F2328`, secondary `#3D454D`, muted `#5B636B`, subtle `#6B737B`/`#8A929A`.
- **Status (bg / fg):** green `#E6F4EC`/`#1E7F4F`, amber `#FDF2E1`/`#94570A`, red `#FBEAE8`/`#B3261E`, gray `#EEF0F2`/`#4B535B`.
- **Type:** IBM Plex Sans + IBM Plex Sans Devanagari (UI), IBM Plex Mono (IDs, barcodes, receipts). Sizes 11 / 12 / 12.5 / 13 / 13.5 / 14 / 15 / 17 / 19 / 22–26 (KPI, totals). Weights 400/500/600/700. Numbers use `tabular-nums`.
- **Radius:** 6 (small buttons/inputs), 8 (buttons/inputs), 10 (cards), 14 (modals), 999 (pills).
- **Shadows:** dropdown `0 12px 32px rgba(0,0,0,.12)`, modal `0 24px 64px rgba(0,0,0,.25)`, overlay scrim `rgba(20,28,32,.45)`.
- **Spacing:** 4 / 6 / 8 / 10 / 12 / 14 / 16 / 18 / 24 gaps. Card padding 14–18. Table cells 9–10 × 14.

## State (prototype → production)
Prototype state is in memory in `Component.state` (`seed()` + `seedMore()`). In production: server state via TanStack Query, plus live updates over SSE per branch. Local UI state covers the cart (persisted per counter with crash recovery), held carts, modal and drawer state, and the AI conversation.

## Assets
- `assets/medoro-mark.png`: the M-cross mark cropped from the user's logo (`uploads/Medoro Smart Healthcare Logo.png`, also included). Production needs an SVG.
- Icons: Lucide (the prototype uses the lucide-static icon font; use `lucide-react` in production).

## Files
- `Medoro App.dc.html`: product prototype (template + logic)
- `Medoro Onboarding.dc.html`: auth and setup
- `Medoro Website.dc.html`: marketing site
- `support.js`: runtime needed to open the `.dc.html` files
- `docs/*.md`, `README.md`, `prisma/schema.prisma`, `.env.example`, `.github/workflows/ci.yml`

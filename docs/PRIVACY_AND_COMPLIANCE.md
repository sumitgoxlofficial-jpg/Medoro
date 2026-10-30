# Privacy & Compliance

> Medoro does **not** claim regulatory compliance. Each item below must be reviewed by qualified professionals (CA, pharmacy-law counsel, data-protection counsel) before launch.

## Items to review
| Area | Reference to check | Medoro design support |
|---|---|---|
| Data protection | Digital Personal Data Protection Act 2023 and Rules | Consent records, purpose limitation, erasure, export, breach workflow |
| Prescription drugs | Drugs and Cosmetics Act 1940 and Rules (Schedules H, H1, X) | Prescriber capture, H1 register report, blocked sale without details |
| Record retention | Drug rules, GST law, Income-tax law | Configurable retention (default 8 years), immutable records |
| GST invoicing | CGST Act and Rules, invoice format, HSN | Invoice fields, tax split, GST summary export |
| E-invoicing / e-way bill | Turnover thresholds | **Not integrated**. Flagged as a future requirement |
| Messaging | Meta WhatsApp Business policies, TRAI rules | Opt-in, templates, STOP handling |
| Cyber incidents | CERT-In directions | Incident runbook in SECURITY.md |

## Data minimisation
- Walk-in sales need no personal data.
- Customer profile: name and phone. Address only if delivery is used.
- Prescriber name and Rx number are stored on the sale, not on the customer profile.
- No diagnosis fields. Refill reminders use purchase intervals only.

## Consent
Records hold channel, purpose, timestamp, method (verbal at counter, form, reply) and the user who recorded it. Withdrawal takes effect immediately.

In the product: purposes are **transactional** (invoices and refill reminders) and **marketing** (offers and campaigns), each on **WhatsApp** and **SMS**, captured separately at the counter and on the customer screen. Customer flags hold the current state (`waOptIn`, `smsOptIn`, `marketingWa`, `marketingSms`); every change is appended to `ConsentRecord` (append-only) with method, source screen, user and time, and shown as consent history on the customer. `hasConsent(customer, purpose, channel)` and `consentWhere(purpose, channel)` in `src/domain/parties/consent.ts` are the single rule for sending; a WhatsApp STOP reply also stops WhatsApp marketing.

## Retention
A daily job (with a dry-run preview and "Run now" under Privacy & data) applies these rules and writes one audit event per run:
| Data | After | Action |
|---|---|---|
| Customers with no purchase or consent change | The retention setting (3, 5, 8 or 10 years; default 8) and nothing outstanding | Name, mobile and consents cleared, as with an erasure; invoices keep the anonymised party |
| WhatsApp delivery log | 1 year | Recipient number removed; invoice number and status kept |
| Sessions ended, invite/reset codes expired or used, AI confirmations | 30, 90 and 7 days | Deleted |
| Held carts; offline bills already posted or resolved | 7 and 90 days | Deleted (posted invoices stay) |
| Ended Medoro support links | 1 year | Deleted (the audit trail keeps the record) |
| Sign-in throttling counters; expired one-time codes | 30 days; 1 day | Deleted |

**Never purged:** sales and sale items, payments, credit notes, vouchers and ledger lines, GRNs, purchase orders and supplier bills, stock movements, stock-outs, transfers and counts, the audit trail and consent records. Most are append-only at the database. Keep them at least **8 years**: GST requires accounts for 72 months from the due date of the annual return (CGST Act s. 36, about 7–8 years), income-tax books up to 8 years in some cases, and the Drugs Rules require prescription and Schedule H1 registers for at least 3 years. Legal hold beyond that is the pharmacy's decision; Medoro does not delete these records.

## Schedule H1 register
Accounting & reports → H1 register (screen and CSV): every sale line of a Schedule H1, X or NDPS (narcotic) medicine with date, invoice, patient, prescriber name and registration number, Rx number, medicine, batch, expiry, quantity and the user who billed it. Patient, prescriber and registration number are entered on the bill at the counter and are required: the server refuses an H1, X or NDPS sale without the patient's name (or a selected customer) and the prescriber's name and registration number (or a doctor on file with one). Offline bills missing them become conflicts for a manager; delivery orders take the registration number when the order is saved.

## Rights handling
Access/export, correction, erasure (anonymise the party on tax records), grievance contact shown on receipts and the website. The pharmacy's grievance officer (name, email, phone) is set under Privacy & data and printed at the foot of every A4 and thermal invoice and the WhatsApp PDF; without one, the pharmacy phone is printed. Medoro's own officer on `/legal` comes from `MEDORO_GRIEVANCE_NAME`, `MEDORO_GRIEVANCE_EMAIL`, `MEDORO_GRIEVANCE_PHONE`, `MEDORO_COMPANY_NAME` and `MEDORO_COMPANY_ADDRESS`.

## Children & sensitive data
No profiling or targeting based on health. Campaigns can't be segmented by medicine category.

## AI assistant
Rules or a model on the app host by default. A remote AI provider is used only after the owner opts in, never in strict mode; customer names, phone numbers and emails are replaced with placeholders before anything is sent unless the owner allows names. The assistant can be switched off per pharmacy (owner or manager) or for the whole server (`AI_ENABLED=0`). See AI_ASSISTANT.md.

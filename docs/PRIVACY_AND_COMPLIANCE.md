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

## Rights handling
Access/export, correction, erasure (anonymise the party on tax records), grievance contact shown on receipts and the website.

## Children & sensitive data
No profiling or targeting based on health. Campaigns can't be segmented by medicine category.

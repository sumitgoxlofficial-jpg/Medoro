# Integrations: what is real

The Settings → Integrations screen (`/dist/settings`) shows the same table at runtime from `admin.ts#integrationStatus()`.

| Integration | Status | Detail |
|---|---|---|
| GSTR-1 / GSTR-3B | **Available** | JSON in the GSTN offline-tool shape from posted invoices, credit notes and GRN input tax; HSN summary CSV. Uploading/filing is done by you or your CA on the GST portal. No GSTN API filing. |
| E-invoice (IRN) | **Not wired for distribution invoices** | The shared NIC/GSP client (`src/domain/gst/einvoice.ts`, `EINVOICE_*`) works for pharmacy B2B sales. Distribution invoices do not call it yet; the invoice print shows an IRN only if one is recorded. A distributor above the e-invoice threshold must generate IRNs on the IRP until this is wired. |
| E-way bill | **Not available** in Distribution | Generate on the e-way bill portal. |
| GSTIN validation | **Offline check only** | Format, state code and official checksum. No live taxpayer lookup (needs a GSP account). |
| Drug licence validation | **Manual** | Shape and validity-date checks; no state drug-controller registry API exists. Orders are refused when the licence date has passed; KYC verification is a recorded human check. |
| Bank | **Statement import** | CSV/XLSX import with auto-matching. No bank APIs / Account Aggregator. |
| Payments from chemists | **Recorded, not collected online** | Cash, UPI (with UTR), NEFT, cheque are recorded as receipts. No payment gateway on the portal. |
| Licence server | **Shared** | `LICENSE_SERVER_URL` / `LICENSE_PUBLIC_KEY`, as for Pharmacy. Without it, the copy is unlicensed and not limited. |
| Encrypted backups | **Shared** | Distribution tables are part of the tenant's encrypted backup and of account deletion. |
| AI | **Local statistics** | No external model. The management assistant runs fixed queries; it never posts. |
| WhatsApp / SMS | **Not available** in Distribution | |

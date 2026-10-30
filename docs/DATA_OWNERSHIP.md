# Data Ownership

## Principle
The pharmacy owns its operational data. Medoro's software runs against a database the pharmacy controls. Medoro staff have **no standing access** to it.

## Where data lives
| Data | Location | Who can read it |
|---|---|---|
| Invoices, stock, customers, suppliers, ledger, prescriptions | Customer-controlled PostgreSQL | Authorised pharmacy users |
| Backup files | Customer's Google Drive (encrypted before upload) | Only holders of the recovery key |
| Backup encryption key | Customer's recovery kit (offline) plus the OS keystore on the app host | Owner |
| WhatsApp access token | Server vault on the customer's app host | The app service only |
| Account, plan, licence, device count | Medoro control plane | Medoro billing and support |
| Support attachments | Only what the customer uploads to a ticket | Assigned support staff |

## Strict customer-controlled mode (default)
- No pharmacy records are sent to Medoro services.
- Analytics, reports and AI run in the customer's environment.
- Telemetry is off by default. Crash reports, if enabled, are scrubbed of invoice, patient, credential and key data on the customer's host before upload.
- Remote AI is off. Turning it on relaxes strict mode and is shown in the UI.

## External services
| Service | Receives | Never receives |
|---|---|---|
| Medoro control plane | Tenant ID, plan, licence check-ins, app version, device count | Operational records |
| Meta WhatsApp Cloud API | Recipient number, invoice PDF, template params | Prescriber details, other records |
| Google Drive | Encrypted backup blobs plus a manifest (hashes, sizes) | Keys, plaintext |
| Remote AI (opt-in) | Minimised aggregates, no names or phones | Credentials, the full database |

## Customer rights in the product
- **Export:** a full CSV/JSON export from Privacy & data, plus a `pg_dump` guide.
- **Erasure:** removes customer personal fields. Tax invoices keep an anonymised party.
- **Exit:** after cancellation the software goes read-only after the grace period. Data stays in place and stays exportable.

## Honesty rule
A deployment is described as customer-controlled only if Medoro and any undisclosed third party lack unrestricted operational access. Managed hosting by Medoro, if it's ever offered, must be labelled as Medoro-hosted.

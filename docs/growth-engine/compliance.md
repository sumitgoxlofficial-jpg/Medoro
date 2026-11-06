# Compliance and data protection

*This describes what the software does. It is not legal advice; have counsel review the rollout.*

## Data in scope

Business contact data of pharmacies (name, public business phone/email, website, address, owner name when verified),
with source, collection date and purpose ("B2B prospecting for Medoro pharmacy software"). **No patient or pharmacy-customer
data** enters Growth Intelligence: the module has no access to pharmacy tables (static test) and its tables are excluded
from pharmacy backups. Owner names of sole proprietors and personal mobiles are personal data under the DPDP Act, 2023.

## Controls

| Requirement | Implementation |
|---|---|
| Source tracking | Every lead has a source (licence, attribution, terms, export permission), source URL/ID and collection date; imports require confirmation of lawful collection |
| Lawful basis, consent evidence, timestamp, scope | `ContactConsent` per channel and purpose with basis (consent / legitimate use), scope, evidence text, source, time, recorder |
| Revocation | Revoke keeps the record; STOP replies, unsubscribe links, DNC call outcomes and bounces revoke automatically |
| Suppression | Hashed DNC list per channel; checked before every call, message and campaign recipient (again at send time); lifting needs a super admin and a reason |
| Promotional messages | WhatsApp/email to a lead only with active marketing consent for that channel; WhatsApp free text only within 24 h of their message, otherwise Meta-approved templates; every email carries postal address + unsubscribe link |
| Campaigns | Created → approved by a super admin (confirmation of review; self-approval is audited) → recipients without consent are skipped with the reason → daily caps |
| Erasure | Super admin erases a lead: personal fields blanked, notes/messages redacted, a hashed DNC entry kept so the pharmacy is not re-collected; imports and discovery skip erased numbers |
| Retention | Leads with no activity for N months (default 24) that never reached trial/conversion: preview, then erase on confirmation |
| Audit | Append-only `GrowthAuditLog` of every action (actor, time, IP); exports record their purpose and filters |
| Export | Managers and admins only, audited, 5/hour, sources that forbid export are excluded, formula-safe CSV |

## Calls and TRAI (important)

The Telecom Commercial Communications Customer Preference Regulations (TCCCPR 2018) and TRAI's later directions treat
unsolicited **promotional** calls from unregistered senders, including ordinary 10-digit mobile numbers, as UCC. TRAI's
2024 directions require operators to disconnect and blacklist resources of unregistered entities making such calls, which
would hit **the employees' personal SIMs**. A publicly listed business number does not authorise promotional calls.
Medoro cannot check the NCPR/DND registry (that needs telemarketer registration).

What the software offers: a DNC list enforced on every call, DNC/wrong-number outcomes that suppress automatically,
consent capture on calls, and a contact policy switch: **Settings → Calls → "Only with recorded permission"** blocks a
first call until consent or the *Contact authorised* stage is recorded.

Recommendations before scaling calling: get legal advice on whether your first-contact calls are promotional; consider
registering as a principal entity with an access provider (DLT) and using the designated `140`/`1600`-series numbers for
promotional/service calls; keep volumes low and calls clearly B2B; switch the policy to authorised-only if in doubt.

## WhatsApp and email

Official WhatsApp Business Platform only (no WhatsApp Web automation), with Meta's opt-in, template and 24-hour-window
rules. Email follows provider anti-spam rules: consent, identification, postal address, one-click unsubscribe, bounce and
complaint suppression.

## Third-party data

OpenStreetMap data stays attributed (ODbL). Imported lists must have terms that allow this use; record them on the
source. Google Maps data is not collected.

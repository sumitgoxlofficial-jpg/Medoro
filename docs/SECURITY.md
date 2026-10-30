# Security

## Identity
- Sign-in: mobile OTP (rate-limited, 6 digits, 5-minute expiry, 5 attempts) or email plus password (Argon2id, at least 10 characters, breach-list check).
- MFA with TOTP is **required** for Owner and Manager and optional for others. There are recovery codes.
- Sessions: httpOnly, Secure, SameSite=Lax cookies. Server-side session table; `token_version` lets one action revoke every session. Idle timeout 12 h on counters, 2 h for admin screens.
- Login lockout: 5 failures → 15-minute cooldown per account; 50 failures from one IP → 15-minute IP throttle. Proxy headers are only trusted on Vercel or with `TRUST_PROXY=1`.
- **No default credentials.** The setup wizard creates the owner.

## Authorisation
- Permission keys (sale, disc, credit, refund, adjust, purchase, payments, reports, users, integrations, aiAct), assigned per role and overridable per user: the owner or a user manager can allow or withhold single permissions for one person on top of their role (Users → shield icon). Effective permissions = role ∪ grants − revokes, computed on every request; only the owner can grant `users` or `integrations`; the owner's own permissions are locked; every change is audited. "View as" still only narrows.
- Every service call runs through `authorize(ctx, perm, {tenantId, branchId})`. Tenant and branch filters are applied in the repository layer, and PostgreSQL row-level security policies add a second layer.

## Input & output
- Zod validation at every boundary. Prisma uses parameterised queries.
- CSRF: same-site cookies plus double-submit tokens on state-changing forms.
- XSS: React escaping, a strict CSP (no inline scripts), and sanitised PDF and receipt text.
- Rate limiting per IP and per user on auth, AI, WhatsApp send and exports.

## Data protection
- TLS 1.2+ everywhere, including app-to-DB.
- At rest: full-disk encryption recommended on the DB host. Integration tokens are encrypted with libsodium sealed boxes under a host key held in the OS keystore.
- Backups: AES-256-GCM with a random data key per backup, wrapped by the customer key (see BACKUP_AND_RECOVERY.md).
- Logs never contain invoice line contents, customer names or phones, tokens or keys. A structured logger has a redaction allow-list.

## Audit
Append-only `audit_events`, hash-chained (each row stores the SHA-256 of the previous one). It covers auth, permission changes, discounts, voids, refunds, adjustments, exports, AI confirmations and integration changes.

## Supply chain & CI
Lockfile pinned. Dependabot or Renovate. `pnpm audit`, CodeQL, gitleaks secret scanning, SBOM (CycloneDX), signed release builds.

## Incident response
1. Detect (alerts, anomaly review, user report) → 2. Contain (revoke sessions and tokens, disable the integration) → 3. Assess scope from audit events → 4. Notify the owner, and CERT-In within 6 hours where applicable, after legal review → 5. Recover from a verified backup → 6. Post-mortem.

## Threat model highlights
| Threat | Control |
|---|---|
| Cross-tenant read | Scoped repositories + RLS + tests |
| Cashier discount or void fraud | Permission caps, manager approval, anomaly rules |
| Stolen counter PC | Session revoke, device deregistration, MFA for privileged roles |
| AI prompt injection via OCR | Data-as-quotes, tool allow-list, confirmation for writes |
| Backup theft | Client-side encryption, key never stored with backups |
| Token leakage | Server vault, never sent to the client, rotation |

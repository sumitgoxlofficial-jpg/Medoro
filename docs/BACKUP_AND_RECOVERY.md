# Backup & Recovery

## Design
- Destination: the customer's Google Drive through the official Drive API, scope **`drive.file`** (files Medoro created only).
- Drive is a backup target, **not** the live database.

## Encryption
1. `pg_dump --format=custom` → zstd compress.
2. Generate a random 256-bit data key → AES-256-GCM encrypt in 8 MB chunks.
3. Wrap the data key with the **customer master key** (X25519 sealed box).
4. Upload `backup-<ts>.medoro` plus `manifest-<ts>.json` (version, schema version, sizes, chunk SHA-256s, total SHA-256, wrapped key, row counts per table).
5. The master key lives in the OS keystore on the host **and** in a printed or QR recovery kit held by the owner. Medoro never has it.

## Schedule & retention
Daily at the configured time plus manual runs. Retention of 7/30/90/365 days removes old files from Drive. Failures alert the owner (in-app, plus email or WhatsApp if configured) and retry 3 times.

## Restore
1. Pick a backup → download → verify manifest and chunk hashes.
2. Decrypt with the master key, from the keystore or a recovery-kit scan.
3. Restore into a **staging** database → compare row counts with the manifest → run integrity checks (ledger balances, stock = Σ movements).
4. The owner confirms **promote to live**: billing pauses on all devices, the database is swapped, devices reconnect.

## Drills
Run a test restore to staging monthly. The release checklist requires one passing drill per release candidate.

## Key loss
Without the master key the backups can't be decrypted. This is by design. Store the recovery kit in two physical places. If the key is rotated, a new kit is issued and existing backups are re-wrapped.

## Disconnect
Disconnecting revokes the OAuth token at Google and deletes it locally. Files already in Drive stay with the customer.

## Status: unverified
The prototype simulates progress and hashes. A real Google OAuth client still has to be set up and tested.

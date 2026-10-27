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
Backup & restore → **Restore…** on a backup row (owner or anyone with *Manage users & roles*):

1. **Prepare.** The file's SHA-256 is checked against the manifest, it is decrypted with the backup key, and every table is loaded into a separate **test copy** (a `restore_…` schema in the same database). Every foreign key inside the copy is checked. Live data is not touched.
2. **Review.** The screen shows the backup next to live data: invoices and totals, last invoice, medicines, stock units, customers, suppliers, vouchers, and row counts per table. It warns that everything recorded after the backup will be removed.
3. **Confirm.** The owner types the pharmacy code. A **safety backup** of current data is taken first; if it fails, nothing changes. Then, in one transaction, the pharmacy's rows are replaced with the test copy and a "Backup restored" event is added to the audit chain. If anything fails the transaction rolls back and live data is unchanged.
4. Everyone is signed out and signs in again. To undo, restore the safety backup the same way.

What a restore keeps as it is on this server: WhatsApp and Google Drive connections, the backup key, backup history, and licence data. Test copies nobody applies are deleted after 24 hours.

Backups made before full restores were supported (format `medoro-export-v1`) can still be test-restored and downloaded, but not restored; take a new backup.

The append-only triggers allow deletes only inside the restore transaction, which sets `medoro.restore = 'on'` with `SET LOCAL`. Nothing else in the app sets it.

## Drills
Run a test restore to staging monthly. The release checklist requires one passing drill per release candidate.

## Key loss
Without the master key the backups can't be decrypted. This is by design. Store the recovery kit in two physical places. If the key is rotated, a new kit is issued and existing backups are re-wrapped.

## Disconnect
Disconnecting revokes the OAuth token at Google and deletes it locally. Files already in Drive stay with the customer.

## Status: unverified
The prototype simulates progress and hashes. A real Google OAuth client still has to be set up and tested.

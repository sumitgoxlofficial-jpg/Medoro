# Backup & Recovery

## What a backup is
One file per backup, `<timestamp>.mdrbak`, written by `src/domain/system/backup.ts`:

1. **Dump.** Every row of every table that belongs to the pharmacy, read as JSON (`restore.ts` → `dumpForBackup`),
   format `medoro-backup-v2`. Tables are found from the database catalogue, so new tables are included
   automatically. Stored files (invoice scans and other uploaded documents) are added as `files`
   (key, content type, base64 bytes), wherever they are kept: server disk, database, Supabase bucket or Google Drive.
2. **Encrypt.** The JSON is gzipped and encrypted with **AES-256-GCM** under a fresh random 256-bit data key.
3. **Wrap.** The data key is encrypted (AES-256-GCM) with the pharmacy's **backup key**: the key in the recovery
   kit. The file is `MEDORO-BACKUP-1` | header length | JSON header | ciphertext. The header is not encrypted and
   holds the pharmacy id, time, row counts per table, IVs and GCM tags, the wrapped data key and the backup key's
   fingerprint (first 4 bytes of its SHA-256).
4. **Verify.** The file is written to this server's storage, read back and decrypted, and the row counts are
   compared. Its SHA-256 goes into the manifest (`BackupManifest`).
5. **Upload.** If Google Drive is connected, the same encrypted file is uploaded (multipart up to 5 MB, resumable
   in 8 MB chunks above that). If the upload fails the backup is kept on the server and marked *Partial*.

## Key custody
- The backup key is created **in the browser** during setup and downloaded as the recovery kit
  (`medoro-recovery-kit-<code>.txt`). Its fingerprint is shown in the kit and in Backup & restore.
- The server keeps a copy of the backup key **sealed with `HOST_KEY`** (AES-256-GCM, `src/server/vault.ts`), so it
  can take scheduled backups and restore without anyone typing the key. Whoever controls the server and its
  `HOST_KEY` can therefore open the backups.
- The key never goes to Google Drive or to Medoro (the company). Drive only holds encrypted files.
- On a **new server**, or when the server's `HOST_KEY` is lost, only the printed recovery kit opens the backups.
  Without it, they can't be decrypted. Keep it in two physical places.
- If the server can't open its copy (HOST_KEY changed or lost), Backup & restore shows it and asks for the kit
  (*Encryption → Use this kit*). The kit's fingerprint must match the one recorded at setup; the key is then
  sealed again with the current `HOST_KEY`.
- The key isn't rotated by the app. Backups made with a key stay readable with that key's kit.

## Google Drive
- OAuth 2.0 web flow with **PKCE (S256)** and a random `state`, both kept in a short-lived httpOnly cookie;
  `access_type=offline`, `prompt=consent`; scopes `drive.file openid email`. If Drive access isn't granted on
  Google's consent screen, the connection is refused.
- **`drive.file`**: Medoro sees only the files it created with this OAuth client, nothing else in the Drive.
- The refresh token is sealed with `HOST_KEY`. Access tokens are refreshed when they expire and once more on a
  401. If Google refuses the refresh token (`invalid_grant`: revoked, password changed, expired), the token is
  deleted, the integration is marked **lost**, an audit event is written, and the dashboard, the bell and the
  Backup badge show an alert until someone reconnects (*Reconnect Google Drive*). Backups continue on the server.
- **Disconnect & revoke** revokes the token at `https://oauth2.googleapis.com/revoke` and deletes it here. Files
  already in Drive stay with the customer.
- Folders: `Medoro/<Pharmacy name (CODE)>/backups` and `…/files`, created on first use and reused (found by name
  when reconnecting). Backups carry Drive `appProperties` (`medoroKind=backup`, `medoroTenant`, `medoroCode`,
  `medoroPharmacy`) so they can be listed for restore. Earlier versions uploaded to a `Medoro Backups` folder;
  those files are listed too.
- Anyone with *Integrations & backups* (the owner; managers if the owner grants it) connects the pharmacy's own
  Drive in Backup & restore, or optionally during setup (step 6).

## Uploaded files in Drive
Backup & restore → *Uploaded files*: **On this server** (default) or **In Google Drive**. With Drive, new uploads go
to `Medoro/<pharmacy>/files`; the server keeps only a `FileObject` row with the Drive file id, and the
documents route streams the file back from Drive after the usual permission check. If Drive can't be reached
when uploading, the file is kept on the server instead. Files are included in every backup either way; if a
Drive file can't be read during a backup, the backup is marked *Partial* and says how many files are missing.

## Schedule & retention
Daily at the configured time (India time) plus *Back up now*. On self-hosted installs a failed scheduled backup is
retried up to 2 more times that day, at least 30 minutes apart; a backup still "running" after 30 minutes
(server stopped or timed out) counts as failed, and the retry gap counts from its start. Several app servers can
share one database: a PostgreSQL advisory lock makes sure only one of them starts each backup. On Vercel the host
cron fires once a day (03:00 IST), so the configured time and same-day retries don't apply there.

Retention (7/30/90/365 days) runs after each backup: older backup files are deleted from this server and from
Drive (including Medoro backups of this pharmacy in Drive that this server has no record of). The newest
successful backup and the newest backup in Drive are always kept, however old. Manifests stay as a record
(*Expired*).

## Alerts
Shown on the dashboard, in the bell, and as a red badge on Backup & restore (for people who manage backups):
the last backup failed or is partial; no successful backup for 26 hours (or none yet, a day after setup);
Google Drive access lost. Email and WhatsApp alerts aren't sent.

## Restore on this server
Backup & restore → **Restore…** on a backup row (owner or anyone with *Manage users & roles*):

1. **Prepare.** The file's SHA-256 is checked against the manifest, it is decrypted with the backup key, and every table is loaded into a separate **test copy** (a `restore_…` schema in the same database). Every foreign key inside the copy is checked. Live data is not touched.
2. **Review.** The screen shows the backup next to live data: invoices and totals, last invoice, medicines, stock units, customers, suppliers, vouchers, and row counts per table. It warns that everything recorded after the backup will be removed.
3. **Confirm.** The owner types the pharmacy code. A **safety backup** of current data is taken first; if it fails, nothing changes. The backup's stored files are written back to this server's storage, then, in one transaction, the pharmacy's rows are replaced with the test copy and a "Backup restored" event is added to the audit chain. If anything fails the transaction rolls back and live data is unchanged.
4. Everyone is signed out and signs in again. To undo, restore the safety backup the same way.

**A file that isn't in the history** (downloaded earlier, made on another server) or **a backup in Google Drive**:
*Restore a backup file, or one from Google Drive* on the same screen. Upload the `.mdrbak` or pick from the Drive
list; optionally paste the recovery kit (needed if this server's key differs or is unreadable). The file must be
of this pharmacy. It is kept in the history as *Imported* (re-encrypted with this server's key if needed) and goes
through the same prepare → review → confirm steps.

What a restore keeps as it is on this server: WhatsApp and Google Drive connections, the backup key, backup history, and licence data. Test copies nobody applies are deleted after 24 hours.

Backups made before full restores were supported (format `medoro-export-v1`) can still be test-restored and downloaded, but not restored; take a new backup. Backups made before files were included restore the data and leave stored files as they are.

The append-only triggers allow deletes only inside the restore transaction, which sets `medoro.restore = 'on'` with `SET LOCAL`. Nothing else in the app sets it. Id sequences are moved past the restored rows in the same transaction.

## Restore on a new server (disaster recovery)
1. Install Medoro with an empty database and open `/setup` (enter `SETUP_TOKEN` if asked).
2. Choose **Restore from a backup instead**.
3. Pick the backup: upload the `.mdrbak` file, or **Connect Google Drive** (opens Google in a popup; the token is
   held in a sealed httpOnly cookie until the restore) and choose from the list. Drive lists only backups made
   with the same OAuth client; otherwise download the file from drive.google.com and upload it.
4. Paste the recovery kit (or open the kit `.txt`). The key's fingerprint must match the backup's.
   *Check backup* shows the pharmacy, code, backup time and counts; nothing is written yet.
5. Type the pharmacy code and **Restore**. The pharmacy is recreated with its original id and code, the backup is
   loaded into a test copy and checked, then swapped in; stored files are written back; the kit's key becomes this
   server's backup key (sealed with this server's `HOST_KEY`); the Drive connection from step 3 is kept.
6. Sign in with the usual accounts. If this server has a different `HOST_KEY`, authenticator apps are set up again
   at sign-in (their secrets were sealed with the old key). Reconnect WhatsApp.

A restore needs the backup to fit in the request on Vercel (4.5 MB); larger backups restore from Drive there.

## Drills
Use *Test restore* (decrypts in memory and compares every table with the manifest) after setup and monthly, and a
full restore onto a staging server with the recovery kit at least once per release candidate.

## Code
`src/domain/system/backup.ts` (backups, restore on this server, retention, scheduler), `restore.ts` (dump, test
copy, swap, files), `recovery.ts` (recovery kit, imports, new-server restore), `gdrive.ts` (OAuth, Drive API),
`src/server/storage.ts` (file storage), `src/domain/reports/alerts.ts` (alerts). Tests:
`tests/integration/backup.test.ts`, `restore.test.ts`, `drive.test.ts` (Google mocked at the HTTP level).

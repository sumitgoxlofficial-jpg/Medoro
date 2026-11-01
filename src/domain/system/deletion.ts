import "server-only";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { UserError } from "@/server/action";
import type { Ctx } from "@/server/context";
import { deleteObject } from "@/server/storage";
import { log } from "@/server/log";
import { layout } from "./restore";

/**
 * Closing a pharmacy account (the owner's right to erasure under the DPDP Act).
 * The owner downloads their data, confirms with the pharmacy code, and the account is deleted after a waiting period
 * they can cancel. Then every row of the pharmacy goes, including the append-only ledgers (the same bypass a restore
 * uses), its stored files and the tenant itself. Medoro keeps only its own billing records (online payments) and a note
 * of the deletion, which it needs for its own tax records. Backups in the owner's Google Drive are theirs and stay.
 */
export const DELETE_WAIT_DAYS = 7;
const DAY = 86_400_000;

export type DeletionPlan = { requestedAt: string; scheduledFor: string; by: string };

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

function ownerOnly(ctx: Ctx) {
  if (ctx.readOnly) throw new UserError("Medoro support can’t delete a pharmacy.");
  if (ctx.realRole !== "Owner" || ctx.role !== "Owner") throw new UserError("Only the pharmacy owner can delete the account.");
}

export async function deletionPlan(tenantId: string): Promise<DeletionPlan | null> {
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  const d = (t?.settings as { deletion?: DeletionPlan } | null)?.deletion;
  return d?.scheduledFor ? d : null;
}

export async function requestDeletion(ctx: Ctx, i: { code: string; downloaded: boolean }, now = new Date()) {
  ownerOnly(ctx);
  if (!i.downloaded) throw new UserError("Download your data first, or tick that you don’t need it.");
  const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  if (String(i.code ?? "").trim().toUpperCase() !== t.code.toUpperCase()) throw new UserError(`Type your pharmacy code (${t.code}) exactly to confirm.`);
  const settings = (t.settings as Record<string, unknown>) ?? {};
  if ((settings.deletion as DeletionPlan | undefined)?.scheduledFor) throw new UserError("Deletion is already scheduled.");
  const plan: DeletionPlan = { requestedAt: now.toISOString(), scheduledFor: new Date(now.getTime() + DELETE_WAIT_DAYS * DAY).toISOString(), by: ctx.userName };
  await db.$transaction(async (tx) => {
    await tx.tenant.update({ where: { id: ctx.tenantId }, data: { settings: { ...settings, deletion: plan } as object } });
    await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Pharmacy deletion scheduled", entity: "tenant", entityId: ctx.tenantId, detail: `deletes on ${plan.scheduledFor.slice(0, 10)}` });
  });
  return plan;
}

export async function cancelDeletion(ctx: Ctx) {
  ownerOnly(ctx);
  const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  const { deletion, ...rest } = (t.settings as Record<string, unknown>) ?? {};
  if (!deletion) throw new UserError("No deletion is scheduled.");
  await db.$transaction(async (tx) => {
    await tx.tenant.update({ where: { id: ctx.tenantId }, data: { settings: rest as object } });
    await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Pharmacy deletion cancelled", entity: "tenant", entityId: ctx.tenantId });
  });
}

/** Permanently deletes one pharmacy. Exported for tests; production runs it from the daily job when the wait is over. */
export async function purgeTenant(tenantId: string, now = new Date()) {
  const t = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!t) return false;
  // Stored files outside the database (Supabase storage or the server's disk). Best effort: a missing file is fine.
  const [files, docs, backups, payments] = await Promise.all([
    db.fileObject.findMany({ where: { tenantId }, select: { key: true } }),
    db.scanDocument.findMany({ where: { tenantId, storagePath: { not: null } }, select: { storagePath: true } }),
    db.backupManifest.findMany({ where: { tenantId, localPath: { not: null } }, select: { localPath: true } }),
    db.onlinePayment.findMany({ where: { tenantId, status: "paid" }, select: { paymentId: true, amountPaise: true, paidAt: true } }),
  ]);
  for (const key of [...files.map((f) => f.key), ...docs.map((d) => d.storagePath!), ...backups.map((b) => b.localPath!)]) {
    try { await deleteObject(key); } catch (e) { log.error("Couldn’t delete a stored file of a deleted pharmacy.", { err: e }); }
  }
  const L = await layout();
  // Tables restore leaves alone, apart from Medoro's own billing records (OnlinePayment), which are kept.
  const extra = ["Integration", "BackupManifest", "SubscriptionMeta", "LicenceOutbox", "RestoreRun", "FileObject"];
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL medoro.restore = 'on'`);
    const del = async (name: string, via?: { col: string; parent: string }) => tx.$executeRawUnsafe(
      `DELETE FROM public.${q(name)} WHERE ${via ? `${q(via.col)} IN (SELECT id FROM public.${q(via.parent)} WHERE "tenantId" = $1)` : `"tenantId" = $1`}`, tenantId);
    for (const name of extra) await del(name);
    for (const c of L.clear) await del(c.name, c.via);
    for (const x of [...L.tables].reverse()) await del(x.name, x.via);
    await tx.tenant.delete({ where: { id: tenantId } });
    const paid = payments.reduce((a, p) => a + p.amountPaise, 0);
    await tx.staffAudit.create({ data: { staffName: "System", action: "Pharmacy account deleted",
      detail: `${t.name} (${t.code})${t.legalName ? ` · ${t.legalName}` : ""}${t.gstin ? ` · GSTIN ${t.gstin}` : ""} · requested by the owner · ${payments.length} online payment(s) kept, ₹${(paid / 100).toFixed(2)} · deleted ${now.toISOString().slice(0, 10)}` } });
  }, { timeout: 120_000 });
  return true;
}

/** Daily: deletes pharmacies whose waiting period has ended. */
export async function deletionTick(now = new Date()) {
  const due = await db.$queryRaw<{ id: string }[]>`SELECT id FROM "Tenant" WHERE settings->'deletion'->>'scheduledFor' IS NOT NULL AND (settings->'deletion'->>'scheduledFor')::timestamptz <= ${now}`;
  for (const { id } of due) {
    try { await purgeTenant(id, now); log.info("Pharmacy account deleted.", { tenantId: id }); }
    catch (e) { log.error("Pharmacy deletion failed; it will be retried.", { err: e, tenantId: id }); }
  }
  return due.length;
}

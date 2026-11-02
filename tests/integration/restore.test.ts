import { beforeAll, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { db } from "@/server/db";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { commitSale } from "@/domain/sales/service";
import { verifyAudit } from "@/domain/identity/admin";
import { applyRestore, discardRestore, pendingRestore, prepareRestore, runBackup } from "@/domain/system/backup";
import { dropSchema, dumpForBackup, layout, prepare } from "@/domain/system/restore";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const base = { form: "Tablet" as const, manufacturer: "Micro Labs", pack: "10", gstRate: 12, reorderLevel: 5, barcode: "", hsn: "3004", rack: "", schedule: "" as const };
const schemas = async () => (await db.$queryRaw<{ n: string }[]>`SELECT nspname n FROM pg_namespace WHERE nspname LIKE 'restore_%'`).map((r) => r.n);

describe("restore from backup", () => {
  beforeAll(async () => {
    process.env.STORAGE_DIR = await mkdtemp(path.join(os.tmpdir(), "medoro-restore-"));
    await resetDb(); await makePharmacy();
  });

  it("every table is classified, and tenant tables come in a valid order", async () => {
    const L = await layout();
    const names = L.tables.map((t) => t.name);
    expect(names).toContain("SaleItem");
    expect(names.indexOf("Sale")).toBeLessThan(names.indexOf("SaleItem"));
    expect(names.indexOf("Medicine")).toBeLessThan(names.indexOf("Batch"));
    expect(names).not.toContain("Integration");
    expect(names).not.toContain("StaffUser");
  });

  it("refuses a backup edited to carry another pharmacy's rows, and leaves no test copy behind", async () => {
    const ctx = await ctxFor();
    const { data } = await dumpForBackup(ctx.tenantId);
    const before = await schemas();
    const roles = data.tables.Role as { id: string; tenantId: string }[];
    const forged = { ...data, tables: { ...data.tables, Role: [...roles, { ...roles[0], id: randomUUID(), tenantId: randomUUID() }] } };
    await expect(prepare(ctx.tenantId, forged, new Date().toISOString())).rejects.toThrow(/another pharmacy/);
    expect(await schemas()).toEqual(before);
    // The untouched backup still loads.
    const ok = await prepare(ctx.tenantId, data, new Date().toISOString());
    expect(ok.summary.problems).toEqual([]);
    await dropSchema(ok.schema);
  });

  it("test copy first, then a confirmed swap that brings back exactly the backed-up data", async () => {
    const ctx = await ctxFor();
    const dolo = await createMedicine(ctx, { ...base, name: "Dolo 650", generic: "Paracetamol", strength: "650 mg", mrp: "33.60" });
    const { batchId } = await receiveBatch(ctx, { medicineId: dolo, batchNo: "DL1", expiry: addDays(todayISO(), 300), qty: 20, cost: "20", mrp: "33.60", supplierId: null, invoiceNo: "" });
    const sale = () => commitSale(ctx, { idempotencyKey: "k_" + randomUUID().replace(/-/g, ""), lines: [{ medicineId: dolo, batchId, qty: 2 }], customerId: null, discountPct: 0, pay: { mode: "cash" } });
    await sale();
    const backup = await runBackup(ctx.tenantId, "manual", { id: ctx.userId, name: ctx.userName });

    // Life goes on after the backup: another sale and another medicine.
    await sale();
    await createMedicine(ctx, { ...base, name: "Pan 40", generic: "Pantoprazole", strength: "40 mg", mrp: "155" });
    await db.session.create({ data: { id: "s-" + randomUUID(), userId: ctx.userId, tokenVersion: 0, expiresAt: new Date(Date.now() + 3600_000), mfaPassed: true } });

    await expect(prepareRestore(await ctxFor("Manager"), backup.id)).rejects.toThrow(/role/);
    const p = await prepareRestore(ctx, backup.id);
    expect(p.summary.problems).toEqual([]);
    expect(p.summary.backupFigures).toMatchObject({ sales: 1, medicines: 1, stockUnits: 18 });
    expect(p.summary.liveFigures).toMatchObject({ sales: 2, medicines: 2, stockUnits: 16 });
    expect(await db.sale.count()).toBe(2); // live untouched by prepare
    expect(await schemas()).toHaveLength(1);
    expect((await pendingRestore(ctx))?.runId).toBe(p.runId);

    await expect(applyRestore(ctx, p.runId, "WRONG")).rejects.toThrow(/TEST-PUNE/);
    const r = await applyRestore(ctx, p.runId, "test-pune");
    expect(r.safetyBackupId).toBeTruthy();
    expect(await db.sale.count()).toBe(1);
    expect(await db.medicine.count()).toBe(1);
    expect((await db.batch.findUniqueOrThrow({ where: { id: batchId } })).qtyAvailable).toBe(18);
    expect(await db.session.count()).toBe(0); // everyone signs in again
    expect(await db.integration.count({ where: { kind: "backup_key" } })).toBe(1); // kept
    expect(await db.backupManifest.count()).toBe(2); // history kept, plus the safety backup
    expect(await schemas()).toHaveLength(0);
    expect((await verifyAudit(ctx)).ok).toBe(true);
    expect(await db.auditEvent.count({ where: { action: "Backup restored" } })).toBe(1);
    // The append-only rules are back in force after the restore transaction.
    await expect(db.sale.deleteMany()).rejects.toThrow(/append-only/);
    await expect(applyRestore(ctx, p.runId, "TEST-PUNE")).rejects.toThrow(/already applied/);

    // The safety backup can undo it.
    const undo = await prepareRestore(ctx, r.safetyBackupId);
    expect(undo.summary.backupFigures).toMatchObject({ sales: 2, medicines: 2 });
    await discardRestore(ctx, undo.runId);
    expect(await schemas()).toHaveLength(0);
    expect(await pendingRestore(ctx)).toBeNull();
  });
});

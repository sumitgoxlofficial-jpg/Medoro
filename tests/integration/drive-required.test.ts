import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { commitSale } from "@/domain/sales/service";
import { saveCustomer } from "@/domain/parties/service";
import { relayStore } from "@/domain/system/gdrive";
import { mustMove } from "@/domain/system/drive-state";
import { autoDeleteMovedCopies, moveStatus } from "@/domain/system/drive-move";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

/** On Medoro's hosted server every pharmacy's records live in its own Google Drive, never on Medoro's server. */
describe("Google Drive is required on Medoro's hosted server", () => {
  let med = "", batch = "";
  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    med = await createMedicine(ctx, { name: "Dolo 650", generic: "Paracetamol", strength: "650 mg", form: "Tablet", manufacturer: "Micro", pack: "15", mrp: "30", gstRate: 12, schedule: "", reorderLevel: 5, barcode: "", hsn: "3004", rack: "" });
    await receiveBatch(ctx, { medicineId: med, batchNo: "D1", expiry: addDays(todayISO(), 300), qty: 50, cost: "20", mrp: "30", supplierId: null, invoiceNo: "" });
    batch = (await db.batch.findFirstOrThrow({ where: { batchNo: "D1" } })).id;
    await saveCustomer(ctx, null, { name: "Asha Patil", phone: "9822000001", waOptIn: false, creditLimit: "0", opening: "0" });
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(() => { delete process.env.E2E_FAKE_DRIVE; });

  const settings = async () => (await db.tenant.findFirstOrThrow()).settings;
  const sale = async (extra: object) => commitSale({ ...(await ctxFor()), ...extra }, { idempotencyKey: "k_" + randomUUID().replace(/-/g, ""), lines: [{ medicineId: med, batchId: batch, qty: 1 }], customerId: null, discountPct: 0, pay: { mode: "cash" } });

  it("a pharmacy still on Medoro's copy must move: its copy is read-only until then", async () => {
    expect(mustMove(await settings())).toBe(false); // a pharmacy's own server: its own database, nothing to move
    vi.stubEnv("PUBLIC_SIGNUP", "1");
    expect(mustMove(await settings())).toBe(true);
    await expect(sale({ mustMove: true })).rejects.toThrow(/every pharmacy’s data in its own Google Drive/);
    // Signed up with Drive, or moved there: nothing left to move.
    expect(mustMove({ driveOnly: true })).toBe(false);
    expect(mustMove({ driveMove: { state: "moving" } })).toBe(false);
  });

  it("deletes Medoro's copy on its own 7 days after the move, once Drive holds a copy saved after it", async () => {
    process.env.E2E_FAKE_DRIVE = "1"; delete process.env.VERCEL;
    const t = await db.tenant.findFirstOrThrow();
    const movedAt = new Date(Date.now() - 8 * 86400_000);
    await db.tenant.update({ where: { id: t.id }, data: { settings: { ...(t.settings as object), driveMode: true, driveMove: { state: "moved", startedAt: movedAt.toISOString(), by: "Owner", movedAt: movedAt.toISOString() } } } });
    // Not on a pharmacy's own server.
    expect(await autoDeleteMovedCopies()).toBe(0);
    vi.stubEnv("PUBLIC_SIGNUP", "1");
    // No full copy in Drive since the move: kept, and tried again next time.
    expect(await autoDeleteMovedCopies()).toBe(0);
    expect(await db.customer.count({ where: { tenantId: t.id } })).toBe(1);
    const store = relayStore(t.id);
    await store.write("pharmacy.db.enc", Buffer.from("sealed"));
    await store.write("manifest.json", Buffer.from(JSON.stringify({ v: 2, schema: 7, snapshotAt: new Date().toISOString(), device: "DOWNER1", bytes: 1, cursors: {}, pruned: {} })));
    // Still inside the 7 days to undo: kept.
    expect(await autoDeleteMovedCopies(new Date(movedAt.getTime() + 6 * 86400_000))).toBe(0);
    expect(await autoDeleteMovedCopies()).toBe(1);
    for (const n of await Promise.all([db.sale.count({ where: { tenantId: t.id } }), db.customer.count({ where: { tenantId: t.id } }), db.medicine.count({ where: { tenantId: t.id } }), db.batch.count({ where: { tenantId: t.id } })])) expect(n).toBe(0);
    expect(await db.user.count({ where: { tenantId: t.id } })).toBeGreaterThan(0);
    expect(await moveStatus(await ctxFor())).toMatchObject({ state: "purged", purgedBy: "Medoro (automatic)" });
    expect(await db.auditEvent.findFirstOrThrow({ where: { tenantId: t.id, action: "Medoro’s copy deleted" } })).toMatchObject({ userName: "Medoro (automatic)", userId: null });
    expect(await autoDeleteMovedCopies()).toBe(0); // already gone
  });
});

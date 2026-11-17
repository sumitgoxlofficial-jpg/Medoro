import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { commitSale, createCustomer } from "@/domain/sales/service";
import { addRecall, listRecalls, saveRecallSettings, setRecallStatus } from "@/domain/inventory/recalls";
import { disposeRecalled, recallReport } from "@/domain/inventory/recall-report";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const key = () => "k_" + randomUUID().replace(/-/g, "");
const exp = addDays(todayISO(), 300).slice(0, 7);
let dolo = "", other = "", buyer = "";
const batchOf = (medicineId: string, branchId: string) => db.batch.findFirstOrThrow({ where: { medicineId, branchId } });
const base = { form: "Tablet" as const, pack: "15", schedule: "" as const, reorderLevel: 5, barcode: "", hsn: "3004", rack: "", gstRate: 12 };

describe("recall intelligence", () => {
  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    const owner = await ctxFor();
    dolo = await createMedicine(owner, { ...base, name: "Dolo 650", generic: "Paracetamol", strength: "650 mg", manufacturer: "Micro Labs Ltd", mrp: "33" });
    other = await createMedicine(owner, { ...base, name: "Dolo Plus", generic: "Paracetamol", strength: "500 mg", manufacturer: "Cipla", mrp: "40" });
    for (const br of ["Main", "Second"]) {
      const c = await ctxFor("Manager", br);
      await receiveBatch(c, { medicineId: dolo, batchNo: "RC77", expiry: exp, qty: 100, cost: "20", mrp: "33", supplierId: null, invoiceNo: "" });
    }
    await receiveBatch(await ctxFor("Manager", "Main"), { medicineId: other, batchNo: "RC77", expiry: exp, qty: 30, cost: "25", mrp: "40", supplierId: null, invoiceNo: "" });
    buyer = await createCustomer(owner, { name: "Meena Joshi", phone: "9822000501", waOptIn: true, creditLimit: "0" });
    const m = await ctxFor("Manager", "Main");
    await commitSale(m, { idempotencyKey: key(), lines: [{ medicineId: dolo, batchId: (await batchOf(dolo, m.branchId)).id, qty: 4 }], customerId: buyer, discountPct: 0, pay: { mode: "cash" } });
  });

  it("matches a manufacturer and product notice, not another maker's batch with the same number", async () => {
    await saveRecallSettings(await ctxFor(), { autoQuarantine: false });
    const owner = await ctxFor();
    await addRecall(owner, { manufacturer: "micro labs", product: "dolo 650", batches: "rc77", source: "CDSCO alert", publishedAt: todayISO(), reason: "Not of standard quality" });
    const r = (await listRecalls(owner))[0];
    expect(r.matches.map((x) => x.medicine).sort()).toEqual(["Dolo 650", "Dolo 650"]);       // both branches, not Cipla's Dolo Plus
    const row = await db.recall.findFirstOrThrow({ where: { id: r.id } });
    expect(row).toMatchObject({ medicineId: null, manufacturer: "micro labs", verifiedBy: owner.userId });
    expect(row.verifiedAt).not.toBeNull();
    await db.batch.updateMany({ data: { status: "ok" } });
    await db.recall.deleteMany();                    // reset for the next test
    await saveRecallSettings(owner, { autoQuarantine: true });
  });

  it("validates the notice", async () => {
    const o = await ctxFor();
    const ok = { batches: "RC77", source: "CDSCO", publishedAt: todayISO() };
    await expect(addRecall(o, { ...ok })).rejects.toThrow(/medicine from your catalogue, or enter the manufacturer/);
    await expect(addRecall(o, { ...ok, manufacturer: "Micro" })).rejects.toThrow(/manufacturer and product/);
    await expect(addRecall(o, { ...ok, medicineId: dolo, sourceUrl: "http://insecure.example/x" })).rejects.toThrow(/https/);
    await expect(addRecall(o, { ...ok, medicineId: "not-an-id" })).rejects.toThrow(/catalogue/);
    await expect(addRecall(await ctxFor("Cashier"), { ...ok, medicineId: dolo })).rejects.toThrow();
  });

  it("quarantines affected stock in every branch the moment the notice is recorded, even from a user limited to one branch", async () => {
    const owner = await ctxFor();
    const main = owner.branches.find((b) => b.name === "Main")!;
    const limited = { ...owner, branches: [main], branchId: main.id };
    await addRecall(limited, { medicineId: dolo, batches: "RC77", source: "Manufacturer notice 12/2026", noticeNo: "MN/12/26", sourceUrl: "https://example.org/notice/1", publishedAt: todayISO(), reason: "Wrong label" });
    const bs = await db.batch.findMany({ where: { medicineId: dolo } });
    expect(bs).toHaveLength(2);
    expect(bs.every((b) => b.status === "quarantine")).toBe(true);
    expect((await db.batch.findFirstOrThrow({ where: { medicineId: other } })).status).toBe("ok");   // same batch number, other medicine: untouched
    const r = await db.recall.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
    expect(r.status).toBe("investigating");
    expect(r).toMatchObject({ noticeNo: "MN/12/26", sourceUrl: "https://example.org/notice/1" });
    const audits = (await db.auditEvent.findMany({ where: { entityId: r.id } })).map((a) => a.action);
    expect(audits).toEqual(expect.arrayContaining([`Recall auto-quarantine ${r.sourceRef}`, `Recall notification ${r.sourceRef}`]));
    const note = await db.auditEvent.findFirstOrThrow({ where: { entityId: r.id, action: `Recall notification ${r.sourceRef}` } });
    expect(note.detail).toMatch(/email isn’t set up/);       // honest: nothing is claimed as sent
  });

  it("leaves stock alone when the pharmacy turns automatic quarantine off", async () => {
    const owner = await ctxFor();
    await db.batch.updateMany({ data: { status: "ok" } });
    await saveRecallSettings(owner, { autoQuarantine: false });
    await addRecall(owner, { medicineId: dolo, batches: "RC77", source: "Manufacturer notice 2", publishedAt: todayISO() });
    expect((await db.batch.findMany({ where: { medicineId: dolo } })).every((b) => b.status === "ok")).toBe(true);
    await saveRecallSettings(owner, { autoQuarantine: true });
    await db.batch.updateMany({ data: { status: "quarantine" } });
    await expect(saveRecallSettings(await ctxFor("Manager"), { autoQuarantine: false })).rejects.toThrow();   // only users with the users permission
  });

  it("traces quantities from the movement ledger so they add up, and lists who bought the batch", async () => {
    const owner = await ctxFor();
    const r = await db.recall.findFirstOrThrow({ orderBy: { createdAt: "asc" }, where: { noticeNo: "MN/12/26" } });
    const rep = await recallReport(owner, r.id);
    const main = rep.batches.find((b) => b.branch === "Main")!, second = rep.batches.find((b) => b.branch === "Second")!;
    expect(main).toMatchObject({ onHand: 96, sold: 4, traced: 100 });
    expect(second).toMatchObject({ onHand: 100, sold: 0, traced: 100 });
    expect(rep.totals).toMatchObject({ onHand: 196, sold: 4, traced: 200, sellableNow: 0 });
    expect(rep.customers).toHaveLength(1);
    expect(rep.customers[0]).toMatchObject({ customer: "Meena Joshi", qty: 4, canMessage: true });
    expect(rep.notice.attestedBy).toBeTruthy();
    expect(rep.audit.length).toBeGreaterThan(1);
    expect(rep.closable.ok).toBe(false);
  });

  it("limits the report to the user's branches", async () => {
    const owner = await ctxFor();
    const main = owner.branches.find((b) => b.name === "Main")!;
    const r = await db.recall.findFirstOrThrow({ where: { noticeNo: "MN/12/26" } });
    const rep = await recallReport({ ...owner, branches: [main] }, r.id);
    expect(rep.batches.map((b) => b.branch)).toEqual(["Main"]);
    expect(rep.totals.onHand).toBe(96);
    expect(JSON.stringify(rep)).not.toContain("Second");
    await expect(recallReport(await ctxFor("Cashier"), r.id)).rejects.toThrow();
  });

  it("tracks disposal as a write-off plus an append-only record, and refuses to resolve while stock is held", async () => {
    const m = await ctxFor("Manager", "Main");
    const r = await db.recall.findFirstOrThrow({ where: { noticeNo: "MN/12/26" } });
    await expect(setRecallStatus(m, r.id, "resolved")).rejects.toThrow(/still held/);
    const b = await batchOf(dolo, m.branchId);
    await expect(disposeRecalled(m, r.id, b.id, 96, "destroyed", "")).rejects.toThrow(/certificate/);
    await expect(disposeRecalled(m, r.id, (await batchOf(other, m.branchId)).id, 5, "destroyed", "CERT-1")).rejects.toThrow(/not affected/);
    await expect(disposeRecalled(await ctxFor("Cashier"), r.id, b.id, 96, "destroyed", "CERT-1")).rejects.toThrow();
    const no = await disposeRecalled(m, r.id, b.id, 96, "destroyed", "CERT-2026-11");
    expect(no).toMatch(/^WO-/);
    expect((await batchOf(dolo, m.branchId)).qtyAvailable).toBe(0);
    const rep = await recallReport(await ctxFor(), r.id);
    expect(rep.disposals).toHaveLength(1);
    expect(rep.disposals[0]).toMatchObject({ qty: 96, method: "destroyed", reference: "CERT-2026-11", branch: "Main" });
    expect(rep.batches.find((x) => x.branch === "Main")).toMatchObject({ onHand: 0, disposed: 96, sold: 4, traced: 100 });
    const rec = await db.recallDisposal.findFirstOrThrow();
    await expect(db.recallDisposal.update({ where: { id: rec.id }, data: { qty: 1 } })).rejects.toThrow(/append-only|cannot be changed|blocked/i);
    await expect(db.recallDisposal.delete({ where: { id: rec.id } })).rejects.toThrow();
  });

  it("resolves only with nothing held, or with a recorded reason, and keeps the closing details", async () => {
    const owner = await ctxFor();
    const r = await db.recall.findFirstOrThrow({ where: { noticeNo: "MN/12/26" } });
    await expect(setRecallStatus(owner, r.id, "resolved")).rejects.toThrow(/Second|RC77/);        // Second still holds 100 units
    await expect(setRecallStatus(owner, r.id, "resolved", "ok")).rejects.toThrow(/still held/);    // a reason has to be a reason
    await setRecallStatus(owner, r.id, "resolved", "Second branch stock held in quarantine awaiting the manufacturer’s collection");
    const row = await db.recall.findFirstOrThrow({ where: { id: r.id } });
    expect(row.status).toBe("resolved");
    expect(row.resolvedAt).not.toBeNull();
    expect(row.resolutionNote).toMatch(/Closed with 100 unit\(s\) still held/);
    const rep = await recallReport(owner, r.id);
    expect(rep.notice.resolutionNote).toMatch(/awaiting the manufacturer/);
    await setRecallStatus(owner, r.id, "investigating");                                          // reopening clears the closing time
    expect((await db.recall.findFirstOrThrow({ where: { id: r.id } })).resolvedAt).toBeNull();
  });
});

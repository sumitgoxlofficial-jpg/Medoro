import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createMedicine } from "@/domain/inventory/service";
import { postGrnTx } from "@/domain/purchasing/service";
import { saveSupplier } from "@/domain/parties/service";
import { ask, cancel, confirm } from "@/domain/ai/service";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

describe("AI assistant", () => {
  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    const sup = await saveSupplier(ctx, null, { name: "Mahavir", creditDays: "30" });
    const base = { form: "Tablet" as const, manufacturer: "Micro Labs", pack: "15", schedule: "" as const, barcode: "", hsn: "3004", rack: "" };
    const dolo = await createMedicine(ctx, { ...base, name: "Dolo 650", generic: "Paracetamol", strength: "650 mg", mrp: "33.60", gstRate: 12, reorderLevel: 10 });
    // 2 in stock, reorder level 10 → needs reordering
    await postGrnTx(ctx, { supplierId: sup, invoiceNo: "MMA/1", invoiceDate: todayISO(), poId: null, scanDocId: null, statedTotal: "53.76", lines: [{ medicineId: dolo, batchNo: "DL1", expiry: addDays(todayISO(), 400).slice(0, 7), qty: 2, freeQty: 0, rate: "24", mrp: "33.60", poItemId: null }] });
  });

  it("answers read questions from the same services as the screens", async () => {
    const ctx = await ctxFor();
    const r = await ask(ctx, "What should I reorder?");
    expect(r.tool).toBe("get_low_stock_report");
    expect(r.rows?.[0].a).toBe("Dolo 650");
    expect((await ask(ctx, "stock of dolo")).rows?.[0].c).toMatch(/^2 in stock/);
    expect((await ask(ctx, "Aaj ki sale kitni hai?")).text).toMatch(/0 bills/);
    expect(await ask(ctx, "what dose of dolo for a child?")).toMatchObject({ refused: true });
  });

  it("hides money tools from roles without access", async () => {
    const r = await ask(await ctxFor("Cashier"), "Supplier payments due");
    expect(r).toMatchObject({ refused: true });
    expect(r.rows).toBeUndefined();
  });

  it("write tools preview first; the token is single-use and bound to the user", async () => {
    const ctx = await ctxFor();
    const p = await ask(ctx, "Prepare a purchase order for review");
    expect(p.confirm?.token).toBeTruthy();
    expect(await db.purchaseOrder.count()).toBe(0);
    await expect(confirm({ ...ctx, userId: "someone-else" }, p.confirm!.token)).rejects.toThrow(/isn’t valid/);
    const done = await confirm(ctx, p.confirm!.token);
    expect(done.text).toMatch(/PO-\d{4}-0001 saved as draft/);
    const po = await db.purchaseOrder.findFirstOrThrow({ include: { items: true } });
    expect(po).toMatchObject({ status: "draft", source: "ai" });
    expect(po.items[0].qty).toBeGreaterThanOrEqual(8);
    await expect(confirm(ctx, p.confirm!.token)).rejects.toThrow(/already confirmed/);
    expect(await db.auditEvent.count({ where: { action: "AI action confirmed" } })).toBe(1);
  });

  it("expired, cancelled and tampered tokens do nothing", async () => {
    const ctx = await ctxFor();
    const a = await ask(ctx, "draft po");
    await db.aiConfirmation.update({ where: { token: a.confirm!.token }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(confirm(ctx, a.confirm!.token)).rejects.toThrow(/expired/);
    const b = await ask(ctx, "draft po");
    await cancel(ctx, b.confirm!.token);
    await expect(confirm(ctx, b.confirm!.token)).rejects.toThrow(/already confirmed or cancelled/);
    const c = await ask(ctx, "draft po");
    await db.aiConfirmation.update({ where: { token: c.confirm!.token }, data: { input: { lines: [] } } });
    await expect(confirm(ctx, c.confirm!.token)).rejects.toThrow(/altered/);
    expect(await db.purchaseOrder.count()).toBe(1);
  });

  it("roles without aiAct can't create or confirm actions", async () => {
    const r = await ask(await ctxFor("Pharmacist"), "Prepare a purchase order for review");
    expect(r).toMatchObject({ refused: true });
    expect(r.confirm).toBeUndefined();
  });
});

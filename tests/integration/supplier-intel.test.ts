import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createMedicine } from "@/domain/inventory/service";
import { createPo, listOrders, postGrnTx, setPoStatus } from "@/domain/purchasing/service";
import { saveSupplier } from "@/domain/parties/service";
import { priceHistory, supplierIntel } from "@/domain/purchasing/supplier-intel";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const exp = addDays(todayISO(), 500).slice(0, 7);
let cheap = "", solid = "", med = "";

/** A real PO → GRN round trip through the purchasing service. */
async function buy(supplierId: string, ordered: number, received: number, rate: string, invoiceNo: string, branch = "Main") {
  const ctx = await ctxFor("Manager", branch);
  const po = await createPo(ctx, { supplierId, lines: [{ medicineId: med, qty: String(ordered), rate }] });
  await setPoStatus(ctx, po.id, "place");
  const item = (await listOrders(ctx)).find((o) => o.id === po.id)!.items[0];
  await postGrnTx(ctx, { supplierId, invoiceNo, invoiceDate: todayISO(), poId: po.id, scanDocId: null, statedTotal: null,
    lines: [{ medicineId: med, batchNo: invoiceNo, expiry: exp, qty: received, freeQty: 0, rate, mrp: "40", poItemId: item.id }] });
}

describe("supplier intelligence", () => {
  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    cheap = await saveSupplier(ctx, null, { name: "Cheap & Co", creditDays: "0", acceptsReturns: false });
    solid = await saveSupplier(ctx, null, { name: "Solid Traders", creditDays: "45", acceptsReturns: true, returnWindowDays: "90" });
    med = await createMedicine(ctx, { name: "Dolo 650", generic: "Paracetamol", strength: "650 mg", form: "Tablet", manufacturer: "Micro Labs", pack: "15", schedule: "", reorderLevel: 5, barcode: "", hsn: "3004", rack: "", mrp: "40", gstRate: 12 });
    await buy(cheap, 100, 40, "20", "CH/1");    // 7% cheaper, but delivered 40 of 100
    await buy(solid, 100, 100, "21.5", "SO/1");
  });

  it("scores from real purchase history and explains why the dearer, reliable supplier is recommended", async () => {
    const r = await supplierIntel(await ctxFor());
    const [first, second] = r.suppliers;
    expect(first.name).toBe("Solid Traders");
    expect(second.name).toBe("Cheap & Co");
    expect(second.fillPct).toBe(40);
    expect(first.fillPct).toBe(100);
    expect(r.recommendations).toHaveLength(1);
    const rec = r.recommendations[0];
    expect(rec.rec.pickId).toBe(solid);
    expect(rec.rec.cheaperButWorse?.name).toBe("Cheap & Co");
    expect(rec.rec.explanation.join(" ")).toMatch(/Cheap & Co is [\d.]+% cheaper but scores/);
    expect(rec.rec.explanation.join(" ")).toMatch(/40% fulfilled/);
    expect(second.priceIndexPct).toBe(0);              // it is the cheapest quote
    expect(first.priceIndexPct).toBeGreaterThan(5);
  });

  it("records landed cost, not MRP minus anything: the quote is the GRN line's documented cost", async () => {
    const r = await supplierIntel(await ctxFor());
    const q = Object.fromEntries(r.recommendations[0].quotes.map((x) => [x.supplier, x.landedPaise]));
    const grn = await db.grnItem.findMany({ include: { grn: { include: { } } } });
    const cost = (sid: string) => Number(grn.find((g) => g.grn.supplierId === sid)!.costPaise);
    expect(q["Cheap & Co"]).toBe(cost(cheap));
    expect(q["Solid Traders"]).toBe(cost(solid));
  });

  it("keeps a price history per supplier", async () => {
    const h = await priceHistory(await ctxFor(), med);
    expect(h.map((x) => x.supplier).sort()).toEqual(["Cheap & Co", "Solid Traders"]);
    expect(h.every((x) => x.points.length === 1 && x.points[0].landedPaise > 0)).toBe(true);
    await expect(priceHistory(await ctxFor(), "00000000-0000-4000-8000-000000000000")).rejects.toThrow(/not found/);
  });

  it("evaluates per branch and only for branches the user can access", async () => {
    const owner = await ctxFor();
    const main = owner.branches.find((b) => b.name === "Main")!, second = owner.branches.find((b) => b.name === "Second")!;
    expect((await supplierIntel(owner, second.id)).recommendations).toHaveLength(0); // nothing was bought for Second
    expect((await supplierIntel(owner, main.id)).recommendations).toHaveLength(1);
    expect((await supplierIntel(owner)).byBranch.map((b) => b.branch).sort()).toEqual(["Main", "Second"]);
    const narrow = { ...owner, branches: [main] };
    await expect(supplierIntel(narrow, second.id)).rejects.toThrow(/access/);
    expect((await supplierIntel(narrow)).scope.branchIds).toEqual([main.id]);
    await expect(priceHistory(narrow, med, second.id)).rejects.toThrow(/access/);
  });

  it("changes with new history: a second delivery from the cheap supplier improves its fulfilment", async () => {
    await buy(cheap, 100, 100, "19", "CH/2");
    const r = await supplierIntel(await ctxFor());
    expect(r.suppliers.find((s) => s.id === cheap)!.fillPct).toBe(70);          // 140 of 200
    const h = await priceHistory(await ctxFor(), med);
    expect(h.find((x) => x.supplier === "Cheap & Co")!.points).toHaveLength(2);
    expect(r.suppliers.find((s) => s.id === cheap)!.priceChange180Pct).toBeLessThan(0); // 20 → 19
  });

  it("requires the reports permission", async () => {
    await expect(supplierIntel(await ctxFor("Cashier"))).rejects.toThrow();
    await expect(priceHistory(await ctxFor("Cashier"), med)).rejects.toThrow();
  });
});

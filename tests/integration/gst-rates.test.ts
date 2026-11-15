import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createMedicine } from "@/domain/inventory/service";
import { changeGstRate, medicinesAtRate } from "@/domain/inventory/gst-rates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const base = { form: "Tablet" as const, manufacturer: "Micro Labs", pack: "15 tabs", reorderLevel: 2, barcode: "", hsn: "3004", rack: "", schedule: "" as const, generic: "Paracetamol", strength: "650 mg", mrp: "32.50" };

describe("bulk GST rate change", () => {
  let dolo = "", calpol = "", cream = "", pan = "";
  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    dolo = await createMedicine(ctx, { ...base, name: "Dolo 650", gstRate: 12 });
    calpol = await createMedicine(ctx, { ...base, name: "Calpol 650", gstRate: 12 });
    cream = await createMedicine(ctx, { ...base, name: "Face Cream", hsn: "3304", gstRate: 12 });
    pan = await createMedicine(ctx, { ...base, name: "Pan 40", gstRate: 5 });
  });

  it("lists active medicines at a rate", async () => {
    const ctx = await ctxFor();
    expect((await medicinesAtRate(ctx, 12)).map((m) => m.name)).toEqual(["Calpol 650", "Dolo 650", "Face Cream"]);
    expect((await medicinesAtRate(ctx, 5)).map((m) => m.id)).toEqual([pan]);
  });

  it("moves only the chosen medicines, bumps their version and writes one audit entry", async () => {
    const ctx = await ctxFor();
    const before = await db.medicine.findUniqueOrThrow({ where: { id: dolo } });
    expect(await changeGstRate(ctx, { ids: [dolo, calpol], from: 12, to: 5 })).toBe(2);
    const after = await db.medicine.findMany({ where: { id: { in: [dolo, calpol, cream] } }, select: { id: true, gstRate: true, version: true } });
    const by = Object.fromEntries(after.map((m) => [m.id, m]));
    expect([by[dolo].gstRate, by[calpol].gstRate, by[cream].gstRate]).toEqual([5, 5, 12]);
    expect(by[dolo].version).toBe(before.version + 1);
    const audit = await db.auditEvent.findFirstOrThrow({ where: { action: "GST rate changed" }, orderBy: { id: "desc" } });
    expect(audit.detail).toBe("2 medicines · GST 12% → 5%");
  });

  it("leaves medicines that are no longer at the old rate alone", async () => {
    const ctx = await ctxFor();
    expect(await changeGstRate(ctx, { ids: [dolo, pan], from: 12, to: 18 })).toBe(0);
    expect((await db.medicine.findUniqueOrThrow({ where: { id: dolo } })).gstRate).toBe(5);
  });

  it("rejects bad input and staff without stock or purchase rights", async () => {
    const ctx = await ctxFor();
    await expect(changeGstRate(ctx, { ids: [cream], from: 12, to: 7 })).rejects.toThrow(/GST should be/);
    await expect(changeGstRate(ctx, { ids: [], from: 12, to: 5 })).rejects.toThrow(/Select at least one/);
    await expect(changeGstRate(ctx, { ids: [cream], from: 12, to: 12 })).rejects.toThrow(/different rate/);
    await expect(changeGstRate(await ctxFor("Cashier"), { ids: [cream], from: 12, to: 5 })).rejects.toThrow();
    expect((await db.medicine.findUniqueOrThrow({ where: { id: cream } })).gstRate).toBe(12);
  });
});

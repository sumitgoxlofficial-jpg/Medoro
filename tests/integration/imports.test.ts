import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { previewImport, runImport } from "@/domain/imports/service";
import { xlsx } from "../xlsx";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const csv = (rows: string[][]) => new TextEncoder().encode(rows.map((r) => r.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n"));
const next = String(new Date().getFullYear() + 2);

describe("data import", () => {
  beforeAll(async () => { await resetDb(); await makePharmacy(); });

  it("medicines with opening stock from Excel: preview, import, and re-run skips", async () => {
    const ctx = await ctxFor("Owner");
    const file = xlsx([
      ["Medicine Name", "Salt", "Strength", "Form", "Company", "Pack", "MRP", "GST %", "Schedule", "Batch No", "Exp", "Stock", "PTR"],
      ["Dolo 650", "Paracetamol", "650 mg", "Tablets", "Micro Labs", "15", "₹33.60", "12%", "", "DL1", `11/${next}`, 40, 24.5],
      ["Dolo 650", "Paracetamol", "650 mg", "Tablet", "Micro Labs", "15", "33.60", "12", "", "DL2", `12/${next}`, 10, 24.5],
      ["Augmentin 625", "Amoxicillin + Clavulanate", "625 mg", "Tablet", "GSK", "10", "223.80", "12", "Schedule H1", "", "", "", ""],
    ]);
    const p = await previewImport(ctx, "medicines", "stock.xlsx", file);
    expect(p.bad).toBe(0);
    expect(p.rows.map((r) => r.action)).toEqual(["create", "add stock", "create"]);
    const r = await runImport(ctx, "medicines", "stock.xlsx", file);
    expect(r).toMatchObject({ created: 2, stocked: 2, failed: [] });
    const dolo = await db.medicine.findFirstOrThrow({ where: { name: "Dolo 650" }, include: { batches: true } });
    expect(dolo.batches.map((b) => b.qtyAvailable).sort()).toEqual([10, 40]);
    expect(Number(dolo.batches[0].costPaise)).toBe(2450);
    expect((await db.medicine.findFirstOrThrow({ where: { name: "Augmentin 625" } })).schedule).toBe("H1");

    const again = await previewImport(ctx, "medicines", "stock.xlsx", file);
    expect(again).toMatchObject({ ok: 0, bad: 0, skip: 3 });
    expect(again.rows[0].note).toMatch(/DL1 already in stock/);
    const dupInFile = xlsx([["Brand name", "Generic", "Strength", "Form", "Manufacturer", "MRP", "GST", "Batch", "Expiry", "Qty", "Cost"],
      ["Okacet", "Cetirizine", "10 mg", "Tablet", "Cipla", "21", "12", "OK1", `05/${next}`, 5, 14], ["Okacet", "Cetirizine", "10 mg", "Tablet", "Cipla", "21", "12", "OK1", `05/${next}`, 5, 14]]);
    expect((await previewImport(ctx, "medicines", "d.xlsx", dupInFile)).rows[1].errors[0]).toMatch(/appears twice/);
  });

  it("bad rows block the whole import with a reason per row", async () => {
    const ctx = await ctxFor("Owner");
    const file = csv([
      ["Brand name", "Generic / salt", "Strength", "Form", "Manufacturer", "MRP", "GST %", "Batch", "Expiry", "Opening qty", "Cost per pack (excl. GST)"],
      ["Pan 40", "Pantoprazole", "40 mg", "Pill", "Alkem", "155", "7", "PN1", "01/2020", "x", "200"],
    ]);
    const p = await previewImport(ctx, "medicines", "bad.csv", file);
    expect(p.bad).toBe(1);
    expect(p.rows[0].errors.join(" ")).toMatch(/Form “Pill”/);
    expect(p.rows[0].errors.join(" ")).toMatch(/GST “7”/);
    expect(p.rows[0].errors.join(" ")).toMatch(/expired/);
    expect(p.rows[0].errors.join(" ")).toMatch(/whole number/);
    expect(p.rows[0].errors.join(" ")).toMatch(/above MRP/);
    await expect(runImport(ctx, "medicines", "bad.csv", file)).rejects.toThrow(/1 row has problems/);
    await expect(previewImport(ctx, "medicines", "x.csv", csv([["Name", "MRP"], ["a", "1"]]))).rejects.toThrow(/Missing columns/);
  });

  it("suppliers and customers, with opening balances and permissions", async () => {
    const owner = await ctxFor("Owner");
    const sup = csv([["Supplier", "GSTIN", "Phone", "Credit days", "Opening balance"], ["Mahavir Medical", "", "9822012345", "30", "12,500"], ["mahavir medical", "", "", "", ""]]);
    const ps = await previewImport(owner, "suppliers", "s.csv", sup);
    expect(ps.rows.map((r) => r.action)).toEqual(["create", "skip"]);
    expect(await runImport(owner, "suppliers", "s.csv", sup)).toMatchObject({ created: 1, skipped: 1 });
    expect((await db.supplierBill.findFirstOrThrow()).amountPaise).toBe(1250000n);

    const cus = csv([["Customer name", "Mobile", "Credit limit", "Opening balance", "WhatsApp opt-in"], ["Ramesh", "+91 98901 12345", "2000", "350", "yes"], ["Bad", "12345", "", "", ""]]);
    const cashier = await ctxFor("Cashier");
    const pc = await previewImport(cashier, "customers", "c.csv", cus);
    expect(pc.rows[0].errors.join(" ")).toMatch(/credit permission/);
    expect(pc.rows[1].errors.join(" ")).toMatch(/10-digit/);
    const ok = csv([["Customer name", "Mobile", "Credit limit", "Opening balance", "WhatsApp opt-in"], ["Ramesh", "+91 98901 12345", "2000", "350", "yes"]]);
    expect(await runImport(owner, "customers", "c.csv", ok)).toMatchObject({ created: 1 });
    const c = await db.customer.findFirstOrThrow({ where: { phone: "9890112345" } });
    expect(c).toMatchObject({ waOptIn: true, creditLimitPaise: 200000n });
    expect(await db.auditEvent.count({ where: { action: "Data imported" } })).toBe(3);
  });
});

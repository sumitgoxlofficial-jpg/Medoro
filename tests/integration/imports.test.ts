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
    const dupBarcode = csv([["Brand name", "Generic", "Strength", "Form", "Manufacturer", "MRP", "GST", "Barcode"],
      ["Cetzine", "Cetirizine", "10 mg", "Tablet", "GSK", "20", "12", "8901000000017"], ["Zyrtec", "Cetirizine", "10 mg", "Tablet", "UCB", "25", "12", "8901000000017"]]);
    const pb = await previewImport(ctx, "medicines", "b.csv", dupBarcode);
    expect(pb.rows[1].errors.join(" ")).toMatch(/also on row 2/);
    await expect(runImport(ctx, "medicines", "b.csv", dupBarcode)).rejects.toThrow(/problems/);
    expect(await db.medicine.count({ where: { name: "Cetzine" } })).toBe(0);
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

    const walkIns = csv([["Customer name", "Mobile"], ["Sunita  Patil", ""], ["sunita patil.", ""], ["Anil", ""]]);
    expect((await previewImport(owner, "customers", "w.csv", walkIns)).rows.map((r) => r.action)).toEqual(["create", "skip", "create"]);
    expect(await runImport(owner, "customers", "w.csv", walkIns)).toMatchObject({ created: 2, skipped: 1 });
    expect(await previewImport(owner, "customers", "w.csv", walkIns)).toMatchObject({ ok: 0, skip: 3 });
    expect(await db.customer.count({ where: { phone: null } })).toBe(2);
  });

  it("a plain stock list from an older billing program imports, with form, company and GST filled in and shown", async () => {
    const ctx = await ctxFor("Owner");
    const file = xlsx([
      ["Item Name", "Batch No.", "Exp Date", "Closing Qty", "M.R.P.", "Pur Rate"],
      ["COMBIFLAM TAB", "CF1", `Jan-${next}`, 30, 38.5, 27],
      ["AZEE 500 SYP", "AZ1", `03/${next}`, 12, "₹92.00", 66],
      ["VOLINI GEL 30G", "VG1", `${next}-06`, 8, 140, 101],
      ["PAN 40", "PN9", `11/${next}`, 20, 155, 110],
    ]);
    const p = await previewImport(ctx, "medicines", "old-stock.xlsx", file);
    expect(p.bad).toBe(0);
    expect(p.rows.map((r) => r.action)).toEqual(["create", "create", "create", "create"]);
    expect(p.rows[0].note).toContain("assumed form Tablet, manufacturer not given, GST 12%");
    const r = await runImport(ctx, "medicines", "old-stock.xlsx", file);
    expect(r).toMatchObject({ created: 4, stocked: 4, failed: [] });
    const m = Object.fromEntries((await db.medicine.findMany({ where: { name: { in: ["COMBIFLAM TAB", "AZEE 500 SYP", "VOLINI GEL 30G", "PAN 40"] } }, include: { batches: true } })).map((x) => [x.name, x]));
    expect(m["COMBIFLAM TAB"]).toMatchObject({ form: "Tablet", gstRate: 12, manufacturer: "Not given" });
    expect(m["AZEE 500 SYP"].form).toBe("Syrup"); expect(m["VOLINI GEL 30G"].form).toBe("Gel"); expect(m["PAN 40"].form).toBe("Other");
    expect(m["COMBIFLAM TAB"].batches[0]).toMatchObject({ batchNo: "CF1", qtyAvailable: 30 });
    expect(Number(m["COMBIFLAM TAB"].batches[0].costPaise)).toBe(2700);
    expect(m["COMBIFLAM TAB"].batches[0].expiryDate.toISOString().slice(0, 10)).toBe(`${next}-01-31`); // the end of the printed month
    // Running the same list again adds nothing.
    expect(await runImport(ctx, "medicines", "old-stock.xlsx", file)).toMatchObject({ created: 0, stocked: 0 });
    // Expired batches still don't come in as sellable.
    const old = xlsx([["Item Name", "Batch No", "Expiry", "Qty", "MRP", "Rate"], ["OLD TAB", "X1", "01/2020", 5, 10, 7]]);
    expect((await previewImport(ctx, "medicines", "x.xlsx", old)).bad).toBe(1);
  });
});

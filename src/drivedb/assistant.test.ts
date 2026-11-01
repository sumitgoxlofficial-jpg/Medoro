import { beforeEach, describe, expect, it } from "vitest";
import { memoryDb } from "./node";
import type { DriveDB } from "./client";
import { addMedicine, createSale } from "./pharmacy";
import { addCustomer, addSupplier, recordPurchase } from "./trade";
import { askModel, askRules, localExec, type AskScope, type Step } from "./assistant";
import { todayISO } from "@/lib/dates";
import type { ChatMsg } from "@/domain/ai/llm";

const B = "b1", U = "u1";
const owner: AskScope = { branchId: B, branchName: "Main", owner: true, canCredit: true, lang: "en" };
const cashier: AskScope = { ...owner, owner: false, canCredit: false };
let db: DriveDB;

beforeEach(async () => {
  db = await memoryDb("C1");
  const m = addMedicine(db, { name: "Dolo 650", generic: "Paracetamol", gstRate: 12, mrpPaise: 3200, reorderLevel: 50 });
  const sup = addSupplier(db, { name: "Agency" });
  recordPurchase(db, { branchId: B, supplierId: sup.id, billNo: "P1", billDate: todayISO(), userId: U, lines: [{ medicineId: m.id, batchNo: "A1", expiryDate: "2030-01-31", packs: 20, costPaise: 2000, mrpPaise: 3200 }] });
  const c = addCustomer(db, { name: "Asha Patil", phone: "9822000001", creditLimitPaise: 100000 });
  createSale(db, { branchId: B, series: "C1", userId: U, lines: [{ medicineId: m.id, qty: 2 }], pay: { mode: "cash" } });
  createSale(db, { branchId: B, series: "C1", userId: U, customerId: c.id, lines: [{ medicineId: m.id, qty: 3 }], pay: { mode: "credit" } });
});

describe("the assistant on the counter", () => {
  it("answers everyday questions from this device's data with the built-in rules (works offline)", () => {
    const sales = askRules(db, owner, "Sales today");
    expect(sales).toMatchObject({ tool: "get_sales_summary", via: "rules", text: "Today so far: ₹160 across 2 bills." });
    expect(sales.rows).toEqual(expect.arrayContaining([{ a: "Cash", b: "", c: "₹64" }, { a: "Credit", b: "", c: "₹96" }]));
    expect(askRules(db, owner, "stock of dolo")).toMatchObject({ tool: "search_medicines", rows: [expect.objectContaining({ a: "Dolo 650", c: expect.stringContaining("15 in stock") })] });
    expect(askRules(db, owner, "low stock")).toMatchObject({ tool: "get_low_stock_report", rows: [expect.objectContaining({ a: "Dolo 650" })] });
    expect(askRules(db, owner, "customer dues")).toMatchObject({ tool: "get_customer_outstanding", text: "1 customer owes ₹96." });
    expect(askRules(db, owner, "supplier dues")).toMatchObject({ tool: "get_supplier_balances", text: "You owe ₹448 to 1 supplier." });
  });

  it("refuses clinical advice, keeps dues from staff who can't see them, and says what it can do", () => {
    expect(askRules(db, owner, "What is the dose of paracetamol for a child?")).toMatchObject({ refused: true });
    expect(askRules(db, cashier, "customer dues")).toMatchObject({ refused: true });
    expect(askRules(db, owner, "download the GST report").text).toMatch(/On the counter I can answer/);
  });

  it("with a model: the device runs the lookups, and a remote model never sees customer names", async () => {
    const seen: ChatMsg[][] = [];
    const replies = [
      { content: "", calls: [{ id: "1", name: "get_customer_outstanding", args: {} }] },
      { content: "[customer 1] owes ₹96.", calls: [] },
    ];
    const step: Step = async (messages) => { seen.push(structuredClone(messages)); return replies.shift()!; };
    const r = await askModel(owner, "How much does Asha Patil owe?", step, localExec(db, owner), { remote: true, remoteNames: false });
    expect(r).toMatchObject({ text: "Asha Patil owes ₹96.", tool: "get_customer_outstanding", via: "remote" });
    const sent = JSON.stringify(seen);
    expect(sent).not.toContain("Asha");
    expect(sent).not.toContain("9822000001");
    expect(sent).toContain("[customer 1]");
  });

  it("with a model: a refusal never reaches it, and an unreachable gateway falls back to the rules", async () => {
    let called = 0;
    const step: Step = async () => { called++; throw new Error("offline"); };
    expect(await askModel(owner, "What is the dose of paracetamol for a child?", step, localExec(db, owner), { remote: false, remoteNames: false })).toMatchObject({ refused: true });
    expect(called).toBe(0);
    expect(await askModel(owner, "Sales today", step, localExec(db, owner), { remote: false, remoteNames: false })).toMatchObject({ tool: "get_sales_summary", via: "rules" });
  });
});

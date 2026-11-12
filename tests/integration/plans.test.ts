import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { commitSale, createCustomer } from "@/domain/sales/service";
import { recordExpense } from "@/domain/accounting/service";
import { dayBook, periodOf, trialBalance } from "@/domain/accounting/service";
import { reportRows } from "@/domain/accounting/reports";
import { partyStatement } from "@/domain/parties/statement";
import { addCounter, auditTrail, inviteEmployee, saveBranch, togglePermission } from "@/domain/identity/admin";
import { enableDevice } from "@/domain/sales/offline";
import { anomalies, centralBuying } from "@/domain/intelligence/service";
import { requestTransfer } from "@/domain/inventory/adjust";
import { EXPENSE_ACCOUNTS } from "@/domain/accounting/accounts";
import { entitlementsOf } from "@/server/context";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const key = () => "k_" + randomUUID().replace(/-/g, "");
let tenantId = "", med = "", batch = "";

/** Puts the pharmacy on a plan, the way a signed licence would: `signedDoc` marks it as licensed. */
async function setPlan(plan: string, status = "active", addons: string[] = []) {
  const data = { plan, status, addons, renewsAt: new Date(addDays(todayISO(), 20) + "T00:00:00Z"), signedDoc: "{}", graceDays: 7 };
  await db.subscriptionMeta.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
}
const EXPENSE = { account: EXPENSE_ACCOUNTS[0], amount: "100", method: "Cash" as const, note: "test" };
const refused = (p: Promise<unknown>, re: RegExp) => expect(p).rejects.toThrow(re);

describe("plan limits", () => {
  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    tenantId = ctx.tenantId;
    med = await createMedicine(ctx, { name: "Dolo 650", generic: "Paracetamol", strength: "650 mg", form: "Tablet", manufacturer: "Micro Labs", pack: "10", mrp: "30", gstRate: 12, schedule: "", reorderLevel: 5, barcode: "", hsn: "3004", rack: "" });
    await receiveBatch(ctx, { medicineId: med, batchNo: "P1", expiry: addDays(todayISO(), 300), qty: 100, cost: "20", mrp: "30", supplierId: null, invoiceNo: "" });
    batch = (await db.batch.findFirstOrThrow()).id;
  });
  beforeEach(async () => { await db.subscriptionMeta.deleteMany(); });

  it("a free trial can use everything, whatever plan it is on", async () => {
    await setPlan("Starter", "trial");
    const ctx = await ctxFor();
    const e = await entitlementsOf(ctx);
    expect(e.open).toBe("trial");
    await expect(recordExpense(ctx, EXPENSE)).resolves.toBeTruthy();
    await expect(trialBalance(ctx)).resolves.toBeTruthy();
    await expect(auditTrail(ctx)).resolves.toBeTruthy();
    await expect(enableDevice(ctx, "Till")).resolves.toBeTruthy();
  });

  it("a copy with no licence, or one not yet confirmed, has everything", async () => {
    const ctx = await ctxFor();
    expect((await entitlementsOf(ctx)).open).toBe("unlicensed");
    await db.subscriptionMeta.create({ data: { tenantId, plan: "", addons: [], status: "active" } });
    await expect(trialBalance(ctx)).resolves.toBeTruthy();
  });

  it("Starter: the Professional and Multi-branch features are refused, with the plan to upgrade to", async () => {
    await setPlan("Starter");
    const ctx = await ctxFor();
    await refused(trialBalance(ctx), /not part of your Starter plan\. Upgrade to Professional/);
    await refused(dayBook(ctx, periodOf("month")), /Upgrade to Professional/);
    await refused(recordExpense(ctx, EXPENSE), /Upgrade to Professional/);
    await refused(reportRows(ctx, "gst-summary", periodOf("month")), /Upgrade to Professional/);
    await refused(partyStatement(ctx, "customer", randomUUID()), /Customer credit and statements/);
    await refused(togglePermission(ctx, randomUUID(), "sale"), /Roles, permissions/);
    await refused(auditTrail(ctx), /Upgrade to Professional/);
    await refused(enableDevice(ctx, "Till"), /Billing on the shop network/);
    await refused(anomalies(ctx, { disc: 20, refunds: 5, cash: 100 }), /Upgrade to Multi-branch/);
    await refused(centralBuying(ctx, { cover: 14, safety: 3 } as never), /Upgrade to Multi-branch/);
    await refused(requestTransfer(ctx, batch, (await db.branch.findFirstOrThrow({ where: { name: "Second" } })).id, 1), /Upgrade to Multi-branch/);
    // What Starter does include still works: billing, the registers kept by law, supplier statements, other reports.
    await expect(commitSale(ctx, { idempotencyKey: key(), lines: [{ medicineId: med, batchId: batch, qty: 1 }], customerId: null, discountPct: 0, pay: { mode: "cash" } })).resolves.toBeTruthy();
    for (const id of ["sales-register", "hsn-summary", "h1-register", "stock-valuation", "supplier-dues"] as const) await expect(reportRows(ctx, id, periodOf("month"))).resolves.toBeTruthy();
    await expect(partyStatement(ctx, "supplier", randomUUID())).rejects.not.toThrow(/plan/);
  });

  it("Starter: credit sales and credit limits are refused, cash sales are not", async () => {
    await setPlan("Starter");
    const ctx = await ctxFor();
    await refused(createCustomer(ctx, { name: "Ravi Kumar", phone: "9811111111", creditLimit: "5000" } as never), /Customer credit and statements/);
    const c = await createCustomer(ctx, { name: "Ravi Kumar", phone: "9811111111", creditLimit: "0" } as never);
    await refused(commitSale(ctx, { idempotencyKey: key(), lines: [{ medicineId: med, batchId: batch, qty: 1 }], customerId: c, discountPct: 0, pay: { mode: "credit" } }), /Customer credit and statements/);
    expect(await db.sale.count({ where: { payMode: "credit" } })).toBe(0);
    await setPlan("Professional");
    await expect(commitSale(ctx, { idempotencyKey: key(), lines: [{ medicineId: med, batchId: batch, qty: 1 }], customerId: c, discountPct: 0, pay: { mode: "credit" } })).rejects.not.toThrow(/plan/); // allowed; a credit limit of 0 may still stop it
  });

  it("Professional has Accounts, credit, roles and offline billing but not branch features", async () => {
    await setPlan("Professional");
    const ctx = await ctxFor();
    await expect(trialBalance(ctx)).resolves.toBeTruthy();
    await expect(auditTrail(ctx)).resolves.toBeTruthy();
    await expect(enableDevice(ctx, "Till")).resolves.toBeTruthy();
    await refused(anomalies(ctx, { disc: 20, refunds: 5, cash: 100 }), /Upgrade to Multi-branch/);
    await refused(reportRows(ctx, "sales-register", periodOf("month"), "all"), /Consolidated reports across branches/);
    await refused(requestTransfer(ctx, batch, ctx.branches[1].id, 1), /Branch stock transfers/);
  });

  it("Multi-branch has everything", async () => {
    await setPlan("Multi-branch");
    const ctx = await ctxFor();
    await expect(anomalies(ctx, { disc: 20, refunds: 5, cash: 100 })).resolves.toBeTruthy();
    await expect(reportRows(ctx, "sales-register", periodOf("month"), "all")).resolves.toBeTruthy();
    await expect(requestTransfer(ctx, batch, ctx.branches[1].id, 1)).resolves.toBeDefined();
  });

  it("a cancelled plan keeps its features until it ends", async () => {
    await setPlan("Professional", "cancelled");
    await expect(trialBalance(await ctxFor())).resolves.toBeTruthy();
  });

  it("users, counters and branches stop at the plan's limit; an extra-branch add-on raises Multi-branch's", async () => {
    await setPlan("Starter"); // 1 branch, 2 counters, 3 users. The pharmacy has the owner and one open invite: two seats.
    const ctx = await ctxFor();
    await inviteEmployee(ctx, { name: "Second Person", contact: "9850000003", role: "Cashier", branchId: null });
    await refused(inviteEmployee(ctx, { name: "Third Person", contact: "9850000004", role: "Cashier", branchId: null }), /Your Starter plan allows 3 users/);
    await refused(addCounter(ctx, ctx.branchId), /allows 2 counters/);
    await refused(saveBranch(ctx, null, { name: "Third branch", address: "", gstin: "", dl: "" }), /allows 1 branch/);
    await setPlan("Professional"); // 10 users, 5 counters, still 1 branch
    await expect(inviteEmployee(ctx, { name: "Third Person", contact: "9850000004", role: "Cashier", branchId: null })).resolves.toBeTruthy();
    await expect(addCounter(ctx, ctx.branchId)).resolves.toBeTruthy();
    await refused(saveBranch(ctx, null, { name: "Third branch", address: "", gstin: "", dl: "" }), /allows 1 branch/);
    await setPlan("Multi-branch"); // up to 5 branches: the pharmacy has 2
    await expect(saveBranch(ctx, null, { name: "Third branch", address: "", gstin: "", dl: "" })).resolves.toBeTruthy();
    expect((await entitlementsOf(ctx)).limits.branches).toBe(5);
    await setPlan("Multi-branch", "active", ["branch", "branch"]);
    expect((await entitlementsOf(ctx)).limits.branches).toBe(7);
  });
});

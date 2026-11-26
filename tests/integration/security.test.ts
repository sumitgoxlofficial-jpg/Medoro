import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { verifyAuditChain, recordAuditCheck } from "@/domain/system/audit-integrity";
import { healthOverview } from "@/domain/system/health";
import { badgesAndAlerts } from "@/domain/reports/alerts";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { commitSale } from "@/domain/sales/service";
import { openShift, processReturn } from "@/domain/sales/returns";
import { writeOff } from "@/domain/inventory/adjust";
import { supplierIntel } from "@/domain/purchasing/supplier-intel";
import { customerIntel } from "@/domain/sales/customer-intel";
import { profitIntel, profitPeriod } from "@/domain/reports/profit";
import { benchmark } from "@/domain/reports/benchmark";
import { complianceOverview } from "@/domain/system/compliance";
import { forecastIntel, forecastAccuracy } from "@/domain/intelligence/forecast-intel";
import { recallReport } from "@/domain/inventory/recall-report";
import { linkSuggestions, catalogueDiff, syncStatus } from "@/domain/inventory/catalogue-sync";
import { GET as cronGet, POST as cronPost } from "@/app/api/cron/tick/route";
import { GET as cronMinute } from "@/app/api/cron/minute/route";
import { addDays, todayISO } from "@/lib/dates";
import { randomUUID } from "node:crypto";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const key = () => "k_" + randomUUID().replace(/-/g, "");

describe("security regression suite", () => {
  beforeAll(async () => { await resetDb(); await makePharmacy(); });

  it("every public table has row-level security enabled, so a new table can't be added unprotected", async () => {
    const off = await db.$queryRaw<{ relname: string }[]>`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity AND c.relname <> '_prisma_migrations'`;
    expect(off.map((r) => r.relname)).toEqual([]);
  });

  it("hosted-API roles (anon, authenticated) hold no privileges on any table", async () => {
    const rows = await db.$queryRaw<{ grantee: string; table_name: string }[]>`
      SELECT grantee, table_name FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated') LIMIT 5`;
    expect(rows).toEqual([]);
  });

  it("records of what happened are immutable at the database level: sales, returns, stock, money, receipts and write-offs", async () => {
    const tables = ["Sale", "SaleItem", "Payment", "SaleVoid", "SalesReturn", "Voucher", "LedgerLine", "StockMovement", "StockOut", "Grn", "GrnItem", "AuditEvent", "ConsentRecord", "RecallDisposal", "ForecastSnapshot", "ComplianceReminder", "ComplianceDocument", "CatalogueChange",
      "DistInvoice", "DistInvoiceLine", "DistInvoiceCancel", "DistReturn", "DistReturnLine", "DistCollection"];
    const have = await db.$queryRaw<{ relname: string }[]>`
      SELECT DISTINCT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal AND (t.tgname LIKE '%append_only%' OR t.tgname LIKE '%guard%')`;
    expect(tables.filter((t) => !have.some((h) => h.relname === t))).toEqual([]);
  });

  it("the immutability is real: real rows can't be edited or deleted through the database", async () => {
    const own = await ctxFor("Manager");
    const base = { form: "Tablet" as const, manufacturer: "Alkem", pack: "10", schedule: "" as const, reorderLevel: 0, barcode: "", hsn: "3004", rack: "", gstRate: 12 };
    const med = await createMedicine(own, { ...base, name: "Sec Tab", generic: "Secine", strength: "5 mg", mrp: "100" });
    await receiveBatch(own, { medicineId: med, batchNo: "SB1", expiry: addDays(todayISO(), 300).slice(0, 10), qty: 50, cost: "40", mrp: "100", supplierId: null, invoiceNo: "" });
    const batch = await db.batch.findFirstOrThrow({ where: { medicineId: med } });
    await openShift(own, "500");
    const s = await commitSale(own, { idempotencyKey: key(), lines: [{ medicineId: med, batchId: batch.id, qty: 4 }], customerId: null, discountPct: 0, pay: { mode: "cash" } });
    const item = await db.saleItem.findFirstOrThrow({ where: { saleId: s.saleId } });
    await processReturn(own, { saleId: s.saleId, lines: [{ itemId: item.id, qty: 1 }], condition: "sealed", refundMode: "Cash", reason: "Wrong item" });
    await writeOff(own, batch.id, 2, "Damaged in storage");
    const must = async (label: string, p: Promise<unknown>) => expect(p, label).rejects.toThrow(/append-only|blocked|cannot/i);
    await must("sale", db.sale.update({ where: { id: s.saleId }, data: { totalPaise: 1n } }));
    await must("sale delete", db.sale.delete({ where: { id: s.saleId } }));
    await must("payment", db.payment.updateMany({ data: { amountPaise: 1n } }));
    await must("voucher", db.voucher.updateMany({ data: { narration: "edited" } }));
    await must("ledger", db.ledgerLine.updateMany({ data: { debitPaise: 1n } }));
    await must("stock movement", db.stockMovement.updateMany({ data: { qty: 999 } }));
    await must("stock movement delete", db.stockMovement.deleteMany());
    await must("sales return", db.salesReturn.updateMany({ data: { amountPaise: 1n } }));
    await must("sales return delete", db.salesReturn.deleteMany());
    await must("stock out", db.stockOut.updateMany({ data: { valuePaise: 1n } }));
    await must("stock out delete", db.stockOut.deleteMany());
    await must("audit", db.auditEvent.updateMany({ data: { detail: "edited" } }));
    await must("audit delete", db.auditEvent.deleteMany());
  });

  it("goods receipts are immutable too", async () => {
    const own = await ctxFor("Manager");
    const { saveSupplier } = await import("@/domain/parties/service");
    const { postGrnTx } = await import("@/domain/purchasing/service");
    const sup = await saveSupplier(own, null, { name: "Sec Supplier", creditDays: "10" });
    const med = (await db.medicine.findFirstOrThrow()).id;
    await postGrnTx(own, { supplierId: sup, invoiceNo: "SEC/1", invoiceDate: todayISO(), poId: null, scanDocId: null, statedTotal: null, lines: [{ medicineId: med, batchNo: "GR1", expiry: addDays(todayISO(), 400).slice(0, 7), qty: 5, freeQty: 0, rate: "30", mrp: "100", poItemId: null }] });
    await expect(db.grn.updateMany({ data: { totalPaise: 1n } })).rejects.toThrow(/append-only/);
    await expect(db.grnItem.updateMany({ data: { qty: 999 } })).rejects.toThrow(/append-only/);
    await expect(db.grn.deleteMany()).rejects.toThrow(/append-only/);
  });

  it("scheduler endpoints refuse callers without the scheduler credential", async () => {
    const bad = (h: Record<string, string> = {}) => new Request("http://localhost/api/cron/tick", { method: "POST", headers: h });
    expect((await cronPost(bad())).status).toBe(403);
    expect((await cronPost(bad({ "x-medoro-cron": "0.deadbeef" }))).status).toBe(403);
    const minute = String(Math.floor(Date.now() / 60_000));
    expect((await cronPost(bad({ "x-medoro-cron": `${minute}.${"0".repeat(64)}` }))).status).toBe(403);        // right shape, wrong signature
    expect((await cronGet(new Request("http://localhost/api/cron/tick"))).status).toBe(403);
    expect((await cronGet(new Request("http://localhost/api/cron/tick", { headers: { authorization: "Bearer guess" } }))).status).toBe(403);
    expect((await cronMinute(new Request("http://localhost/api/cron/minute"))).status).toBe(403);
    expect((await cronMinute(new Request("http://localhost/api/cron/minute", { headers: { authorization: "Bearer guess" } }))).status).toBe(403);
  });

  it("every Medoro 2.0 screen's data refuses a user with no relevant permission, as one matrix", async () => {
    const cashier = await ctxFor("Cashier");
    const p = profitPeriod(undefined, undefined);
    const rec = await db.recall.create({ data: { tenantId: cashier.tenantId, source: "x", sourceRef: "RC-9999", publishedAt: new Date(), product: "x", batchNos: ["Z"], reason: "x", status: "open", createdBy: cashier.userId } });
    const calls: [string, () => Promise<unknown>][] = [
      ["health", () => healthOverview(cashier)], ["supplierIntel", () => supplierIntel(cashier)], ["customerIntel", () => customerIntel(cashier)],
      ["profitIntel", () => profitIntel(cashier, null, p)], ["benchmark", () => benchmark(cashier, p)], ["compliance", () => complianceOverview(cashier)],
      ["forecast", () => forecastIntel(cashier)], ["forecastAccuracy", () => forecastAccuracy(cashier)], ["recallReport", () => recallReport(cashier, rec.id)],
      ["linkSuggestions", () => linkSuggestions(cashier)], ["catalogueDiff", () => catalogueDiff(cashier)], ["syncStatus", () => syncStatus(cashier)],
    ];
    for (const [name, fn] of calls) await expect(fn(), name).rejects.toThrow();
  });

  it("a user limited to one branch can't read another branch through any branch-aware service", async () => {
    const owner = await ctxFor();
    const main = owner.branches.find((b) => b.name === "Main")!, second = owner.branches.find((b) => b.name === "Second")!;
    const limited = { ...owner, branches: [main], branchId: main.id };
    const p = profitPeriod(undefined, undefined);
    for (const [name, fn] of [
      ["supplierIntel", () => supplierIntel(limited, second.id)], ["customerIntel", () => customerIntel(limited, second.id)], ["profitIntel", () => profitIntel(limited, second.id, p)], ["forecast", () => forecastIntel(limited, second.id)],
    ] as [string, () => Promise<unknown>][]) await expect(fn(), name).rejects.toThrow(/access/);
    expect((await benchmark(limited, p)).branches.map((b) => b.branch)).toEqual(["Main"]);
  });

  it("detects an edited audit event, a removed one, and says where", async () => {
    const t = (await ctxFor()).tenantId;
    for (let i = 0; i < 6; i++) await writeAudit(db, { tenantId: t, userId: null, userName: "Test", action: `Probe ${i}`, entity: "probe", detail: `n=${i}` });
    const clean = await verifyAuditChain(t);
    expect(clean).toMatchObject({ ok: true, brokenAt: null });
    expect(clean.count).toBeGreaterThan(6);

    const probes = await db.auditEvent.findMany({ where: { tenantId: t, entity: "probe" }, orderBy: { id: "asc" } });
    const tamper = async (sql: Promise<unknown>) => db.$transaction([db.$executeRaw`SET LOCAL session_replication_role = replica`, sql as never]);
    // edit one event's content
    await tamper(db.$executeRaw`UPDATE "AuditEvent" SET detail = 'changed' WHERE id = ${probes[2].id}`);
    const edited = await verifyAuditChain(t);
    expect(edited).toMatchObject({ ok: false, brokenAt: String(probes[2].id) });
    expect(edited.reason).toMatch(/edited/);
    await tamper(db.$executeRaw`UPDATE "AuditEvent" SET detail = ${probes[2].detail} WHERE id = ${probes[2].id}`);     // put it back
    expect((await verifyAuditChain(t)).ok).toBe(true);
    // remove one from the middle
    await tamper(db.$executeRaw`DELETE FROM "AuditEvent" WHERE id = ${probes[3].id}`);
    const removed = await verifyAuditChain(t);
    expect(removed).toMatchObject({ ok: false, brokenAt: String(probes[4].id) });
    expect(removed.reason).toMatch(/previous event/);
  });

  it("records the daily integrity result where Integration Health reads it: no pass before it has run, an error after a failure", async () => {
    // the chain was just broken by the previous test
    const before = (await healthOverview(await ctxFor())).find((r) => r.key === "audit_integrity")!;
    expect(before.state).toBe("not_configured");                                  // the job has not run: nothing is claimed
    const t = (await ctxFor()).tenantId;
    const r = await recordAuditCheck(t);
    expect(r.ok).toBe(false);
    const after = (await healthOverview(await ctxFor())).find((x) => x.key === "audit_integrity")!;
    expect(after.state).toBe("error");
    expect(after.lastError).toMatch(/Event #\d+/);
    const alerts = await badgesAndAlerts(t, (await ctxFor()).branchId, ["users", "integrations"]);
    expect(alerts.alerts[0]).toMatch(/Audit trail integrity check failed/);
    expect(alerts.badges.health).toEqual([1, "red"]);
    expect((await db.auditEvent.findFirst({ where: { tenantId: t, action: "Audit integrity check FAILED" } }))).not.toBeNull();
  });

  it("on a clean chain the check passes and Integration Health reaches Active only through it", async () => {
    await resetDb(); await makePharmacy();
    const t = (await ctxFor()).tenantId;
    const r = await recordAuditCheck(t);
    expect(r).toMatchObject({ ok: true, brokenAt: null });
    const row = (await healthOverview(await ctxFor())).find((x) => x.key === "audit_integrity")!;
    expect(row.state).toBe("active");
    expect(row.detail).toMatch(/events verified/);
    expect((await badgesAndAlerts(t, (await ctxFor()).branchId, ["users"])).badges.health).toBeUndefined();
  });
});

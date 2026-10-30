import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import type { Ctx } from "@/server/context";
import { DEFAULT_GRANTS } from "@/domain/identity/permissions";
import { createMedicine, listInventory, medicineDetail, receiveBatch } from "@/domain/inventory/service";
import { listBranchTransfers } from "@/domain/inventory/adjust";
import { listRecalls } from "@/domain/inventory/recalls";
import { listCustomers, listSuppliers, saveCustomer, saveSupplier } from "@/domain/parties/service";
import { partyStatement } from "@/domain/parties/statement";
import { commitSale, heldCart, holdCart, invoiceData, posCustomers, searchForSale } from "@/domain/sales/service";
import { currentShift, recentInvoices, returnableLines, todaysCreditNotes } from "@/domain/sales/returns";
import { offlineOverview } from "@/domain/sales/offline";
import { listOrders, pendingScans, purchaseCatalogue, recentGrns } from "@/domain/purchasing/service";
import { accountLedger, accountNames, accountsOverview, dayBook, periodOf, trialBalance } from "@/domain/accounting/service";
import { REPORTS, reportRows } from "@/domain/accounting/reports";
import { listCampaigns, optInCount, optOuts, refillReminders } from "@/domain/comms/crm";
import { messageLog } from "@/domain/comms/whatsapp";
import { auditTrail, listBranches, listTeam, listTransfers, roleMatrix } from "@/domain/identity/admin";
import { supportStatus } from "@/domain/identity/support";
import { anomalies, expiryRows, forecast, priceComparison, slowStock } from "@/domain/intelligence/service";
import { fullExport } from "@/domain/system/privacy";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

/**
 * Tenant isolation. The app connects to PostgreSQL as one role and scopes every query by tenantId in
 * the service layer (see docs/SECURITY.md, "Tenant isolation"), so this suite is the guard: it creates
 * two pharmacies with the same kinds of records and checks that no read path returns the other one's rows.
 */

type Seed = { ctx: Ctx; mark: string; supplierId: string; customerId: string; medicineId: string; saleId: string; heldId: string };

async function secondTenant(): Promise<Ctx> {
  const a = await db.tenant.findFirstOrThrow();
  const t = await db.tenant.create({ data: { code: "BETA-MUM", name: "BETASECRET Pharmacy", settings: a.settings as object } });
  const b = await db.branch.create({ data: { tenantId: t.id, name: "BETASECRET Main", code: "BTM" } });
  const role = await db.role.create({ data: { tenantId: t.id, name: "Owner", permissions: [...DEFAULT_GRANTS.Owner], locked: true } });
  const u = await db.user.create({ data: { tenantId: t.id, name: "BETASECRET Owner", email: "owner@beta.in", phone: "9811100001", roleId: role.id } });
  return {
    tenantId: t.id, tenantName: t.name, userId: u.id, userName: u.name, userEmail: u.email!, realRole: "Owner", role: "Owner",
    perms: [...DEFAULT_GRANTS.Owner], branchId: b.id, branchName: b.name, branchCode: b.code, branches: [{ id: b.id, name: b.name, code: b.code }],
    lang: "en", sessionId: "test-beta", counterId: null, counterName: null,
  };
}

async function seed(ctx: Ctx, mark: string, phone: string): Promise<Seed> {
  const supplierId = await saveSupplier(ctx, null, { name: `${mark} Distributors`, creditDays: "30", opening: "100" });
  const customerId = await saveCustomer(ctx, null, { name: `${mark} Customer`, phone, waOptIn: true, creditLimit: "1000", opening: "50" });
  const medicineId = await createMedicine(ctx, { name: `${mark} Tablet`, generic: `${mark} generic`, strength: "500 mg", form: "Tablet", manufacturer: `${mark} Labs`, pack: "10", mrp: "50", gstRate: 12, schedule: "", reorderLevel: 100, barcode: "", hsn: "3004", rack: "" });
  await receiveBatch(ctx, { medicineId, batchNo: `${mark}B1`, expiry: addDays(todayISO(), 60), qty: 20, cost: "20", mrp: "50", supplierId, invoiceNo: `${mark}-INV` });
  const batch = await db.batch.findFirstOrThrow({ where: { tenantId: ctx.tenantId, medicineId } });
  const sale = await commitSale(ctx, { idempotencyKey: "k_" + randomUUID().replace(/-/g, ""), lines: [{ medicineId, batchId: batch.id, qty: 2 }], customerId, discountPct: 0, pay: { mode: "cash" } });
  await holdCart(ctx, `${mark} held`, { lines: [] });
  const held = await db.heldCart.findFirstOrThrow({ where: { tenantId: ctx.tenantId } });
  return { ctx, mark, supplierId, customerId, medicineId, saleId: sale.saleId, heldId: held.id };
}

/** Every primary key the given tenant owns, across every table that has a tenantId column. */
async function idsOf(tenantId: string): Promise<Set<string>> {
  const tables = await db.$queryRaw<{ table_name: string }[]>`
    SELECT c.table_name FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.column_name = 'tenantId'
      AND EXISTS (SELECT 1 FROM information_schema.columns i WHERE i.table_schema = 'public' AND i.table_name = c.table_name AND i.column_name = 'id')`;
  const ids = new Set<string>();
  for (const { table_name } of tables) {
    const rows = await db.$queryRawUnsafe<{ id: unknown }[]>(`SELECT "id"::text AS id FROM "${table_name}" WHERE "tenantId" = $1`, tenantId);
    for (const r of rows) if (typeof r.id === "string" && r.id.length >= 16) ids.add(r.id);
  }
  return ids;
}

const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x instanceof Uint8Array ? undefined : x));

/** Read paths called as `me`; `other` is the pharmacy whose rows must never appear. */
function readers(me: Seed, other: Seed): [string, () => Promise<unknown>][] {
  const ctx = me.ctx, p = periodOf("fy");
  return [
    ["listSuppliers", () => listSuppliers(ctx)], ["listCustomers", () => listCustomers(ctx)],
    ["listInventory", () => listInventory(ctx, "", "all")], ["searchInventory", () => listInventory(ctx, other.mark, "all")],
    ["listBranchTransfers", () => listBranchTransfers(ctx)], ["listRecalls", () => listRecalls(ctx)],
    ["posCustomers", () => posCustomers(ctx)], ["searchForSale", () => searchForSale(ctx, other.mark)],
    ["recentInvoices", () => recentInvoices(ctx, "")], ["todaysCreditNotes", () => todaysCreditNotes(ctx)], ["currentShift", () => currentShift(ctx)],
    ["offlineOverview", () => offlineOverview(ctx)],
    ["listOrders", () => listOrders(ctx)], ["pendingScans", () => pendingScans(ctx)], ["purchaseCatalogue", () => purchaseCatalogue(ctx)], ["recentGrns", () => recentGrns(ctx)],
    ["accountsOverview", () => accountsOverview(ctx, p)], ["accountNames", () => accountNames(ctx)], ["trialBalance", () => trialBalance(ctx)], ["dayBook", () => dayBook(ctx, p)],
    ["accountLedger", async () => Promise.all((await accountNames(ctx)).map((a) => accountLedger(ctx, a)))],
    ...REPORTS.map(([id]) => [`report:${id}`, () => reportRows(ctx, id, p, "all")] as [string, () => Promise<unknown>]),
    ["listCampaigns", () => listCampaigns(ctx)], ["optOuts", () => optOuts(ctx)], ["optInCount", () => optInCount(ctx)], ["refillReminders", () => refillReminders(ctx)], ["messageLog", () => messageLog(ctx)],
    ["listTeam", () => listTeam(ctx)], ["roleMatrix", () => roleMatrix(ctx)], ["listBranches", () => listBranches(ctx)], ["listTransfers", () => listTransfers(ctx)], ["auditTrail", () => auditTrail(ctx)], ["supportStatus", () => supportStatus(ctx)],
    ["expiryRows", () => expiryRows(ctx, 365)], ["forecast", () => forecast(ctx, { cover: 21, safety: 2 })], ["priceComparison", () => priceComparison(ctx)], ["slowStock", () => slowStock(ctx)],
    ["anomalies", () => anomalies(ctx, { disc: 5, refunds: 2, cash: 200 })],
    ["fullExport", () => fullExport(ctx)],
  ];
}

/** By-id reads given the other pharmacy's ids: must refuse or come back empty. */
function probes(me: Seed, other: Seed): [string, () => Promise<unknown>][] {
  const ctx = me.ctx;
  return [
    ["medicineDetail", () => medicineDetail(ctx, other.medicineId)],
    ["invoiceData", () => invoiceData(ctx, other.saleId)],
    ["returnableLines", () => returnableLines(ctx, other.saleId)],
    ["heldCart", () => heldCart(ctx, other.heldId)],
    ["supplierStatement", () => partyStatement(ctx, "supplier", other.supplierId)],
    ["customerStatement", () => partyStatement(ctx, "customer", other.customerId)],
  ];
}

describe("tenant isolation", () => {
  let alpha: Seed, beta: Seed;
  let alphaIds: Set<string>, betaIds: Set<string>;

  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    alpha = await seed(await ctxFor(), "ALPHAMARK", "9822000101");
    beta = await seed(await secondTenant(), "BETASECRET", "9822000102");
    [alphaIds, betaIds] = await Promise.all([idsOf(alpha.ctx.tenantId), idsOf(beta.ctx.tenantId)]);
    expect(betaIds.size).toBeGreaterThan(10);
  });

  for (const dir of ["alpha→beta", "beta→alpha"] as const) {
    it(`list and report reads never return the other pharmacy's rows (${dir})`, async () => {
      const [me, other] = dir === "alpha→beta" ? [alpha, beta] : [beta, alpha];
      const otherIds = dir === "alpha→beta" ? betaIds : alphaIds;
      const ownIds = dir === "alpha→beta" ? alphaIds : betaIds;
      let sawOwn = 0;
      for (const [name, read] of readers(me, other)) {
        const out = json(await read());
        expect(out, name).not.toContain(other.mark);
        for (const id of otherIds) expect(out.includes(id), `${name} leaked ${id}`).toBe(false);
        if ([...ownIds].some((id) => out.includes(id)) || out.includes(me.mark)) sawOwn++;
      }
      expect(sawOwn).toBeGreaterThan(15);
    });

    it(`by-id reads refuse the other pharmacy's ids (${dir})`, async () => {
      const [me, other] = dir === "alpha→beta" ? [alpha, beta] : [beta, alpha];
      for (const [name, read] of probes(me, other)) {
        const out = await read().then((v) => json(v ?? null), () => "refused");
        expect(out, name).not.toContain(other.mark);
        expect(out === "refused" || out === "null" || out === "[]" || !out.includes(other.saleId), name).toBe(true);
      }
      for (const [name, read] of probes(me, me)) {
        const out = await read().then((v) => json(v ?? null), (e) => `error: ${e}`);
        expect(out, `${name} works for own ids`).not.toMatch(/^error|^null$/);
      }
    });
  }
});

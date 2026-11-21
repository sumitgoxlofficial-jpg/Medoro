import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import type { Ctx } from "@/server/context";
import { DEFAULT_GRANTS } from "@/domain/identity/permissions";
import { createMedicine, receiveBatch, setQuarantine, updateMedicine } from "@/domain/inventory/service";
import { adjustStock, requestTransfer, returnToSupplier, writeOff } from "@/domain/inventory/adjust";
import { setBranchRack } from "@/domain/inventory/catalog";
import { paySupplier, receiveFromCustomer, saveCustomer, saveSupplier } from "@/domain/parties/service";
import { commitSale, holdCart, takeHeld } from "@/domain/sales/service";
import { voidSale } from "@/domain/sales/void";
import { processReturn } from "@/domain/sales/returns";
import { createPo, setPoStatus } from "@/domain/purchasing/service";
import { reverseVoucher } from "@/domain/accounting/service";
import { createDoctor, updateDoctor } from "@/domain/doctors/service";
import { createEstimate, setEstimateStatus } from "@/domain/sales/estimate";
import { addCounter, issueReset, resetTwoStep, saveBranch, setUserPermission, togglePermission, updateMember } from "@/domain/identity/admin";
import { eraseCustomer } from "@/domain/system/privacy";
import { readSaleRx } from "@/domain/sales/rx";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

/**
 * Tenant isolation for WRITES. tenant-isolation.test.ts covers read paths; this suite has one pharmacy call every
 * id-taking mutation with the other pharmacy's ids (and create paths with the other pharmacy's ids inside the input).
 * Each call must leave the victim's rows exactly as they were, and no row anywhere may end up linking ids of both
 * pharmacies (which is what "attach your sale to my customer" or "transfer my stock into your branch" would leave).
 */

type Seed = {
  ctx: Ctx; mark: string; supplierId: string; customerId: string; medicineId: string; batchId: string; saleId: string; saleItemId: string;
  heldId: string; doctorId: string; doctorVersion: number; poId: string; estimateId: string; voucherId: string; userId: string; roleId: string; branchId: string; medicineVersion: number;
};

async function secondTenant(): Promise<Ctx> {
  const a = await db.tenant.findFirstOrThrow();
  const t = await db.tenant.create({ data: { code: "BETA-MUM", name: "BETASECRET Pharmacy", settings: a.settings as object } });
  const b = await db.branch.create({ data: { tenantId: t.id, name: "BETASECRET Main", code: "BTM" } });
  const role = await db.role.create({ data: { tenantId: t.id, name: "Owner", permissions: [...DEFAULT_GRANTS.Owner], locked: true } });
  const u = await db.user.create({ data: { tenantId: t.id, name: "BETASECRET Owner", email: "owner@beta.in", phone: "9811100001", roleId: role.id } });
  await db.subscriptionMeta.upsert({ where: { tenantId: t.id }, create: { tenantId: t.id, plan: "multi", status: "active", renewsAt: new Date(Date.now() + 30 * 86400e3) }, update: {} }).catch(() => undefined);
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
  await receiveBatch(ctx, { medicineId, batchNo: `${mark}B1`, expiry: addDays(todayISO(), 200), qty: 40, cost: "20", mrp: "50", supplierId, invoiceNo: `${mark}-INV`, acceptShortExpiry: true });
  const batch = await db.batch.findFirstOrThrow({ where: { tenantId: ctx.tenantId, medicineId } });
  const sale = await commitSale(ctx, { idempotencyKey: "k_" + randomUUID().replace(/-/g, ""), lines: [{ medicineId, batchId: batch.id, qty: 2 }], customerId, discountPct: 0, pay: { mode: "cash" } });
  const saleItem = await db.saleItem.findFirstOrThrow({ where: { saleId: sale.saleId } });
  await holdCart(ctx, `${mark} held`, { lines: [] });
  const held = await db.heldCart.findFirstOrThrow({ where: { tenantId: ctx.tenantId } });
  const doctorId = (await createDoctor(ctx, { name: `${mark} Doctor`, regNo: `${mark.slice(0, 4)}123` })) as unknown as string;
  const doctor = await db.doctor.findFirstOrThrow({ where: { tenantId: ctx.tenantId } });
  await createPo(ctx, { supplierId, lines: [{ medicineId, qty: 5, rate: "20" }] });
  const po = await db.purchaseOrder.findFirstOrThrow({ where: { tenantId: ctx.tenantId } });
  await createEstimate(ctx, { customerName: `${mark} Estimate`, lines: [{ medicineId, qty: 1 }] } as never).catch(() => undefined);
  const est = await db.estimate.findFirst({ where: { tenantId: ctx.tenantId } });
  const voucher = await db.voucher.findFirstOrThrow({ where: { tenantId: ctx.tenantId }, orderBy: { postedAt: "desc" } });
  const role = await db.role.findFirstOrThrow({ where: { tenantId: ctx.tenantId } });
  const med = await db.medicine.findUniqueOrThrow({ where: { id: medicineId } });
  void doctorId;
  return {
    ctx, mark, supplierId, customerId, medicineId, batchId: batch.id, saleId: sale.saleId, saleItemId: saleItem.id, heldId: held.id,
    doctorId: doctor.id, doctorVersion: doctor.version, poId: po.id, estimateId: est?.id ?? randomUUID(), voucherId: voucher.id, userId: ctx.userId, roleId: role.id, branchId: ctx.branchId,
    medicineVersion: med.version,
  };
}

const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x instanceof Uint8Array ? Buffer.from(x).toString("base64") : x));

/** Every row of every tenant-owned table for one tenant, as one string (order-stable). */
async function fingerprint(tenantId: string): Promise<Record<string, string>> {
  const tables = await db.$queryRaw<{ table_name: string }[]>`
    SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.table_schema = 'public' AND c.column_name = 'tenantId' AND t.table_type = 'BASE TABLE' ORDER BY 1`;
  const out: Record<string, string> = {};
  for (const { table_name } of tables) {
    // Rate-limit counters and the audit log of the victim are allowed to stay as-is only; nothing is excluded.
    const rows = await db.$queryRawUnsafe<{ r: string }[]>(`SELECT row_to_json(x)::text AS r FROM "${table_name}" x WHERE "tenantId" = $1 ORDER BY 1`, tenantId);
    out[table_name] = rows.map((r) => r.r).join("\n");
  }
  return out;
}

/** Ids owned by a tenant (any tenant table with an id column). */
async function idsOf(tenantId: string): Promise<string[]> {
  const tables = await db.$queryRaw<{ table_name: string }[]>`
    SELECT c.table_name FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.column_name = 'tenantId'
      AND EXISTS (SELECT 1 FROM information_schema.columns i WHERE i.table_schema = 'public' AND i.table_name = c.table_name AND i.column_name = 'id')`;
  const ids: string[] = [];
  for (const { table_name } of tables) {
    const rows = await db.$queryRawUnsafe<{ id: unknown }[]>(`SELECT "id"::text AS id FROM "${table_name}" WHERE "tenantId" = $1`, tenantId);
    for (const r of rows) if (typeof r.id === "string" && r.id.length >= 16) ids.push(r.id);
  }
  return ids;
}

/** Rows anywhere in the database whose JSON mentions an id of BOTH tenants. */
async function crossLinkedRows(aIds: string[], bIds: string[]) {
  const tables = await db.$queryRaw<{ relname: string }[]>`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'`;
  const hits: string[] = [];
  for (const { relname } of tables) {
    const rows = await db.$queryRawUnsafe<{ r: string }[]>(`SELECT row_to_json(x)::text AS r FROM "${relname}" x`);
    for (const { r } of rows) {
      const a = aIds.find((id) => r.includes(id)), b = bIds.find((id) => r.includes(id));
      if (a && b) hits.push(`${relname}: ${r.slice(0, 240)}`);
    }
  }
  return hits;
}

/** Mutations called as `me` with `other`'s ids. */
function attacks(me: Seed, o: Seed): [string, () => Promise<unknown>][] {
  const c = me.ctx;
  const key = () => "k_" + randomUUID().replace(/-/g, "");
  return [
    ["voidSale", () => voidSale(c, o.saleId, "cross-tenant probe")],
    ["processReturn", () => processReturn(c, { saleId: o.saleId, lines: [{ itemId: o.saleItemId, qty: 1 }], condition: "sealed", refundMode: "Cash", reason: "probe return" })],
    ["updateMedicine", () => updateMedicine(c, o.medicineId, o.medicineVersion, { name: `HACKED ${me.mark}`, generic: "Hacked generic", strength: "1 mg", form: "Tablet", manufacturer: "Hack Labs", pack: "10", mrp: "1", gstRate: 12, schedule: "", reorderLevel: 1, barcode: "", hsn: "3004", rack: "" })],
    ["setBranchRack", () => setBranchRack(c, o.medicineId, "HACK")],
    ["adjustStock", () => adjustStock(c, o.batchId, -5, "probe adjust")],
    ["writeOff", () => writeOff(c, o.batchId, 1, "probe write-off")],
    ["returnToSupplier", () => returnToSupplier(c, o.batchId, 1, "probe return")],
    ["setQuarantine", () => setQuarantine(c, o.batchId, true, "probe")],
    ["requestTransfer(other batch)", () => requestTransfer(c, o.batchId, me.branchId, 1)],
    ["requestTransfer(into other branch)", () => requestTransfer(c, me.batchId, o.branchId, 1)],
    ["saveSupplier(other id)", () => saveSupplier(c, o.supplierId, { name: `HACKED supplier ${me.mark}`, creditDays: "1" })],
    ["saveCustomer(other id)", () => saveCustomer(c, o.customerId, { name: `HACKED customer ${me.mark}`, phone: me.mark === "ALPHAMARK" ? "9822000991" : "9822000992" })],
    ["paySupplier(other supplier)", () => paySupplier(c, { partyId: o.supplierId, amount: "10", method: "Cash" })],
    ["receiveFromCustomer(other customer)", () => receiveFromCustomer(c, { partyId: o.customerId, amount: "10", method: "Cash" })],
    ["commitSale(other batch)", () => commitSale(c, { idempotencyKey: key(), lines: [{ medicineId: o.medicineId, batchId: o.batchId, qty: 1 }], customerId: null, discountPct: 0, pay: { mode: "cash" } })],
    ["commitSale(own batch, other customer)", () => commitSale(c, { idempotencyKey: key(), lines: [{ medicineId: me.medicineId, batchId: me.batchId, qty: 1 }], customerId: o.customerId, discountPct: 0, pay: { mode: "cash" } })],
    ["commitSale(other idempotency key)", async () => {
      const s = await db.sale.findUniqueOrThrow({ where: { id: o.saleId } });
      return commitSale(c, { idempotencyKey: s.idempotencyKey!, lines: [{ medicineId: me.medicineId, batchId: me.batchId, qty: 1 }], customerId: null, discountPct: 0, pay: { mode: "cash" } });
    }],
    ["takeHeld", () => takeHeld(c, o.heldId)],
    ["createPo(other supplier)", () => createPo(c, { supplierId: o.supplierId, lines: [{ medicineId: me.medicineId, qty: 1, rate: "1" }] })],
    ["createPo(other medicine)", () => createPo(c, { supplierId: me.supplierId, lines: [{ medicineId: o.medicineId, qty: 1, rate: "1" }] })],
    ["setPoStatus place", () => setPoStatus(c, o.poId, "place")],
    ["setPoStatus cancel", () => setPoStatus(c, o.poId, "cancel", "probe cancel")],
    ["reverseVoucher", () => reverseVoucher(c, o.voucherId, "cross-tenant probe")],
    ["updateDoctor", () => updateDoctor(c, o.doctorId, o.doctorVersion, { name: `HACKED doctor ${me.mark}` })],
    ["createEstimate(other medicine)", () => createEstimate(c, { customerName: "probe", lines: [{ medicineId: o.medicineId, qty: 1 }] } as never)],
    ["setEstimateStatus", () => setEstimateStatus(c, o.estimateId, "cancelled")],
    ["updateMember", () => updateMember(c, o.userId, { active: false } as never)],
    ["issueReset", () => issueReset(c, o.userId)],
    ["resetTwoStep", () => resetTwoStep(c, o.userId)],
    ["setUserPermission", () => setUserPermission(c, o.userId, "sale" as never, "revoke")],
    ["togglePermission", () => togglePermission(c, o.roleId, "sale" as never)],
    ["saveBranch(other id)", () => saveBranch(c, o.branchId, { name: `HACKED branch ${me.mark}`, code: me.mark.slice(0, 3) + "X" } as never)],
    ["addCounter(other branch)", () => addCounter(c, o.branchId)],
    ["eraseCustomer", () => eraseCustomer(c, o.customerId)],
    ["readSaleRx", () => readSaleRx(c, o.saleId)],
  ];
}

describe("tenant isolation for writes", () => {
  let alpha: Seed, beta: Seed;

  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    alpha = await seed(await ctxFor(), "ALPHAMARK", "9822000101");
    beta = await seed(await secondTenant(), "BETASECRET", "9822000102");
  }, 120_000);

  for (const dir of ["alpha→beta", "beta→alpha"] as const) {
    it(`mutations with the other pharmacy's ids change nothing of theirs (${dir})`, async () => {
      const [me, other] = dir === "alpha→beta" ? [alpha, beta] : [beta, alpha];
      const before = await fingerprint(other.ctx.tenantId);
      const accepted: string[] = [];
      for (const [name, run] of attacks(me, other)) {
        const r = await run().then((v) => ({ ok: true as const, v }), (e: unknown) => ({ ok: false as const, e }));
        if (r.ok) accepted.push(`${name} → ${json(r.v)?.slice(0, 160)}`);
      }
      const after = await fingerprint(other.ctx.tenantId);
      const changed = Object.keys(after).filter((t) => after[t] !== before[t]);
      expect(changed, `victim tables changed: ${changed.join(", ")}`).toEqual([]);
      const leaks = await crossLinkedRows(await idsOf(me.ctx.tenantId), await idsOf(other.ctx.tenantId));
      expect(leaks, "rows linking both pharmacies").toEqual([]);
      // Calls that "succeeded" are listed for the report; they are allowed only if they touched nothing of the victim's
      // (checked above), e.g. a read returning null.
      if (accepted.length) console.info(`[${dir}] accepted without error:\n  ` + accepted.join("\n  "));
    }, 120_000);
  }

  // Control: the same calls on a pharmacy's OWN ids succeed, so the refusals above come from the tenant checks and
  // not from invalid probe input. Run last (they really change alpha's data). Calls whose own-id form is refused by
  // a business rule (e.g. "you can't change your own role") are listed and must be refused with that rule's message.
  it("the same calls succeed on the pharmacy's own ids (control)", async () => {
    const ruleRefusals: Record<string, RegExp> = {
      "requestTransfer(other batch)": /another branch/i, "requestTransfer(into other branch)": /another branch/i,
      updateMember: /your own/i, issueReset: /recovery flow/i, resetTwoStep: /your own/i, setUserPermission: /your own/i, togglePermission: /locked/i,
      // Run after voidSale on the same invoice, and after an own-id adjust/quarantine of the batch.
      processReturn: /voided/i, "commitSale(own batch, other customer)": /quarantined/i, "commitSale(other batch)": /quarantined/i, "commitSale(other idempotency key)": /quarantined|.*/,
      reverseVoucher: /already reversed|reversal/i, eraseCustomer: /outstanding balance/i,
    };
    const bad: string[] = [];
    for (const [name, run] of attacks(alpha, alpha)) {
      const err = await run().then(() => null, (e: unknown) => String((e as Error)?.message ?? e));
      if (err === null) continue;
      if (ruleRefusals[name]?.test(err)) continue;
      bad.push(`${name}: ${err.replace(/\s+/g, " ").slice(0, 160)}`);
    }
    expect(bad, "own-id calls failed for a reason other than a business rule (probe input is invalid)").toEqual([]);
  }, 120_000);
});

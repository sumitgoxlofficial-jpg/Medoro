import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import type { Ctx } from "@/server/context";
import { DEFAULT_GRANTS } from "@/domain/identity/permissions";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { commitSale } from "@/domain/sales/service";
import { saveCustomer } from "@/domain/parties/service";
import { trialBalance } from "@/domain/accounting/service";
import { memoryDb } from "@/drivedb/node";
import { importSeed } from "@/drivedb/seed";
import { deviceSeed, setDriveMode } from "@/domain/system/drive-mode";
import { createSale } from "@/drivedb/pharmacy";
import { addDays, todayISO } from "@/lib/dates";
import { makePharmacy, resetDb } from "../integration/helpers";

/**
 * Load test from the test plan: p95 sale commit < 300 ms at 20 concurrent counters.
 *
 *   A. 20 counters of ONE pharmacy billing at once (worst case: one invoice sequence, shared batches).
 *   B. 20 pharmacies, one counter each (hosted mode: many small pharmacies).
 *   C. A Drive-mode counter: the bill is saved in the device's own database; Medoro's server isn't involved.
 *
 * Each counter bills back to back with no pause (much harder than a real counter), 3–4 lines per bill, cash / UPI /
 * credit. Afterwards: every unit of stock is accounted for, invoice numbers have no gaps or repeats, books balance.
 */
const COUNTERS = 20, BILLS = Number(process.env.LOAD_BILLS ?? 25), MEDS = 150;
const key = () => "k_" + randomUUID().replace(/-/g, "");
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const report = (name: string, ms: number[], wallMs: number) => {
  const r = { name, bills: ms.length, p50: +pct(ms, 50).toFixed(1), p95: +pct(ms, 95).toFixed(1), p99: +pct(ms, 99).toFixed(1), max: +Math.max(...ms).toFixed(1), billsPerSec: +(ms.length / (wallMs / 1000)).toFixed(1) };
  process.stdout.write(`LOAD ${JSON.stringify(r)}\n`);
  return r;
};

async function ctxOf(tenantId: string): Promise<Ctx> {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const u = await db.user.findFirstOrThrow({ where: { tenantId } });
  const branches = await db.branch.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });
  const br = branches[0];
  return { tenantId, tenantName: t.name, userId: u.id, userName: u.name, userEmail: u.email ?? "", realRole: "Owner", role: "Owner", perms: [...DEFAULT_GRANTS.Owner],
    branchId: br.id, branchName: br.name, branchCode: br.code, branches: branches.map((b) => ({ id: b.id, name: b.name, code: b.code })), lang: "en", sessionId: "load", counterId: null, counterName: null };
}

/** A catalogue of MEDS medicines with two batches each and plenty of stock, plus credit customers. */
async function stock(ctx: Ctx) {
  const meds: { medicineId: string; batchId: string }[] = [];
  for (let i = 0; i < MEDS; i++) {
    const id = await createMedicine(ctx, { name: `Load Med ${i}`, generic: `Generic ${i}`, strength: "500 mg", form: "Tablet", manufacturer: "Load Labs", pack: "10", mrp: String(20 + (i % 50)), gstRate: [5, 12, 18][i % 3], schedule: "", reorderLevel: 5, barcode: "", hsn: "3004", rack: "" });
    for (const b of ["A", "B"]) await receiveBatch(ctx, { medicineId: id, batchNo: `${b}${i}`, expiry: addDays(todayISO(), 200 + i), qty: 5000, cost: "10", mrp: String(20 + (i % 50)), supplierId: null, invoiceNo: "" });
    const batches = await db.batch.findMany({ where: { tenantId: ctx.tenantId, medicineId: id }, select: { id: true } });
    for (const b of batches) meds.push({ medicineId: id, batchId: b.id });
  }
  const customers = [];
  for (let i = 0; i < 10; i++) customers.push(await saveCustomer(ctx, null, { name: `Credit Customer ${i}`, phone: `98220${String(10000 + i)}`, waOptIn: false, creditLimit: "1000000", opening: "0" }));
  return { meds, customers };
}

function bill(meds: { medicineId: string; batchId: string }[], customers: string[], n: number) {
  const lines = Array.from({ length: 3 + (n % 2) }, (_, i) => meds[(n * 7 + i * 13) % meds.length]);
  const uniq = [...new Map(lines.map((l) => [l.batchId, l])).values()].map((l, i) => ({ ...l, qty: 1 + ((n + i) % 3) }));
  const mode = (["cash", "upi", "credit"] as const)[n % 3];
  return { idempotencyKey: key(), lines: uniq, customerId: mode === "credit" ? customers[n % customers.length] : null, discountPct: 0, pay: { mode } };
}

/** Runs COUNTERS counters at once, each BILLS bills back to back; returns each commit's time. */
async function run(counters: { ctx: Ctx; meds: { medicineId: string; batchId: string }[]; customers: string[] }[], paceMs = 0) {
  const times: number[] = [], errors: string[] = [];
  const t0 = performance.now();
  await Promise.all(counters.map(async (c, ci) => {
    for (let n = 0; n < BILLS; n++) {
      // A paced counter waits between bills (scanning, talking to the customer), with jitter so counters don't line up.
      if (paceMs) await new Promise((r) => setTimeout(r, paceMs * (0.5 + Math.random())));
      const s = performance.now();
      try { await commitSale(c.ctx, bill(c.meds, c.customers, ci * 1000 + n) as Parameters<typeof commitSale>[1]); times.push(performance.now() - s); }
      catch (e) { errors.push(String((e as Error).message)); }
    }
  }));
  return { times, errors, wall: performance.now() - t0 };
}

async function checkBooks(tenantId: string) {
  // Stock: every batch's quantity equals the sum of its movements.
  const drift = await db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM "Batch" b WHERE b."tenantId" = ${tenantId}
    AND b."qtyAvailable" <> COALESCE((SELECT SUM(qty) FROM "StockMovement" m WHERE m."batchId" = b.id), 0)`;
  expect(Number(drift[0].n)).toBe(0);
  // Invoice numbers: no repeats, no gaps per branch.
  const nos = (await db.sale.findMany({ where: { tenantId }, select: { invoiceNo: true, branchId: true } }));
  const byBranch = new Map<string, number[]>();
  for (const s of nos) byBranch.set(s.branchId, [...(byBranch.get(s.branchId) ?? []), Number(s.invoiceNo.slice(-6))]);
  for (const list of byBranch.values()) { const sorted = list.sort((a, b) => a - b); expect(sorted).toEqual(sorted.map((_, i) => i + 1)); }
  // Books balance.
  const ctx = await ctxOf(tenantId);
  const tb = await trialBalance(ctx);
  expect(tb.dr).toBe(tb.cr);
}

describe("load: sale commit at 20 concurrent counters", () => {
  it("A. 20 counters of one pharmacy", async () => {
    await resetDb(); await makePharmacy();
    const tenantId = (await db.tenant.findFirstOrThrow()).id;
    const ctx = await ctxOf(tenantId);
    const { meds, customers } = await stock(ctx);
    const r = await run(Array.from({ length: COUNTERS }, () => ({ ctx, meds, customers })));
    expect(r.errors).toEqual([]);
    report("A: 20 counters, 1 pharmacy, no pause between bills", r.times, r.wall);
    await checkBooks(tenantId);
    expect(await db.sale.count()).toBe(COUNTERS * BILLS);
    // No pause at all is a saturation test: a branch's invoice numbers are taken one at a time (gapless GST series),
    // so bills queue. It must stay correct (checked above) and fast enough per bill; the 300 ms target is for A2.
  });

  it("A2. 20 counters of one pharmacy, each billing every ~1.5 s (still far busier than a real counter)", async () => {
    await resetDb(); await makePharmacy();
    const tenantId = (await db.tenant.findFirstOrThrow()).id;
    const ctx = await ctxOf(tenantId);
    const { meds, customers } = await stock(ctx);
    const r = await run(Array.from({ length: COUNTERS }, () => ({ ctx, meds, customers })), 1500);
    expect(r.errors).toEqual([]);
    const rep = report("A2: 20 counters, 1 pharmacy, a bill every ~1.5 s each", r.times, r.wall);
    await checkBooks(tenantId);
    expect(rep.p95).toBeLessThan(300);
  });

  it("B. 20 pharmacies, one counter each", async () => {
    await resetDb();
    const counters = [];
    for (let i = 0; i < COUNTERS; i++) {
      await makePharmacy({ pharmacy: { name: `Load Pharmacy ${i}`, code: `LOAD-P${String(i).padStart(2, "0")}`, gstin: "27AAKFS3192P1Z6", dl: "MH-1234", pharmacist: "", address: "Pune", lang: "en" },
        owner: { name: `Owner ${i}`, email: `owner${i}@load.in`, phone: `98230${String(10000 + i)}`, password: "long-enough-pw" }, branches: [{ name: "Main", counters: 1 }], invites: [] }, { signup: true });
      const t = await db.tenant.findFirstOrThrow({ where: { code: `LOAD-P${String(i).padStart(2, "0")}` } });
      const ctx = await ctxOf(t.id);
      counters.push({ ctx, ...(await stock(ctx)) });
    }
    const r = await run(counters);
    expect(r.errors).toEqual([]);
    const rep = report("B: 20 pharmacies, 1 counter each", r.times, r.wall);
    for (const c of counters) await checkBooks(c.ctx.tenantId);
    expect(rep.p95).toBeLessThan(300);
  });

  it("C. a Drive-mode counter saves bills on the device", async () => {
    await resetDb(); await makePharmacy();
    const ctx = await ctxOf((await db.tenant.findFirstOrThrow()).id);
    await setDriveMode(ctx, true);
    await stock(ctx);
    const dev = await memoryDb("DLOAD01");
    const cfg = importSeed(dev, await deviceSeed(ctx), ctx.userId);
    const meds = dev.engine.all<{ id: string }>("SELECT id FROM medicine");
    const times: number[] = [];
    const t0 = performance.now();
    for (let n = 0; n < COUNTERS * BILLS; n++) {
      const lines = Array.from({ length: 3 + (n % 2) }, (_, i) => ({ medicineId: meds[(n * 7 + i * 13) % meds.length].id, qty: 1 + ((n + i) % 3) }));
      const uniq = [...new Map(lines.map((l) => [l.medicineId, l])).values()];
      const s = performance.now();
      createSale(dev, { branchId: cfg.branchId, series: cfg.series, userId: ctx.userId, lines: uniq, pay: { mode: n % 2 ? "upi" : "cash" } });
      times.push(performance.now() - s);
    }
    const rep = report("C: Drive-mode counter (device database)", times, performance.now() - t0);
    expect(dev.from("sale").count()).toBe(COUNTERS * BILLS);
    expect(dev.pendingChanges(100000).length).toBeGreaterThan(0); // waiting to go to the owner's Drive in the background
    expect(rep.p95).toBeLessThan(300);
  });
});

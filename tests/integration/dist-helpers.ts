import { db } from "@/server/db";
import { createPharmacy } from "@/domain/identity/service";
import type { Ctx } from "@/server/context";
import { DIST_GRANTS, type DistRole } from "@/domain/distribution/perms";
import { saveChemist, saveCompany, savePrincipal, saveProduct } from "@/domain/distribution/masters";
import { saveSupplierIn } from "@/domain/parties/service";
import { postGrnTx } from "@/domain/purchasing/service";
import { addDays, todayISO } from "@/lib/dates";
import { KEY } from "./helpers";

let n = 0;
/** A distribution tenant with two godowns (Main, Second). */
export async function makeDistributor(code = "DISTA-PUNE", email = "owner@dist-a.in", phone = "9822000101") {
  n++;
  return createPharmacy({
    pharmacy: { name: `Distributor ${code}`, code, gstin: "27AAKFS3192P1Z6", dl: "MH-WD-20B-12345", pharmacist: "", address: "Pune", lang: "en" },
    owner: { name: "Dist Owner", email, phone, password: "long-enough-pw" },
    deployment: "lan", branches: [{ name: "Main", counters: 1 }, { name: "Second", counters: 1 }], invites: [], backupKey: KEY, kitAck: true,
  }, { signup: true, product: "distribution" });
}

/** Context for a role in a distribution tenant (by tenant code). */
export async function distCtx(code = "DISTA-PUNE", role: DistRole = "Owner", branchName = "Main"): Promise<Ctx> {
  const t = await db.tenant.findUniqueOrThrow({ where: { code } });
  const u = await db.user.findFirstOrThrow({ where: { tenantId: t.id } });
  const branches = await db.branch.findMany({ where: { tenantId: t.id }, orderBy: { createdAt: "asc" } });
  const br = branches.find((b) => b.name === branchName)!;
  return {
    tenantId: t.id, tenantName: t.name, userId: u.id, userName: u.name, userEmail: u.email ?? "", realRole: role, role, perms: [...DIST_GRANTS[role]],
    branchId: br.id, branchName: br.name, branchCode: br.code, branches: branches.map((b) => ({ id: b.id, name: b.name, code: b.code })), lang: "en", sessionId: "t", counterId: null, counterName: null,
  };
}

/** A company, principal/supplier, one product with PTR ₹50 (MRP ₹80, 12%), stock received by GRN, and a chemist. */
export async function seedBasics(ctx: Ctx, opts: { qty?: number; batches?: { no: string; expiryDays: number; qty: number }[]; creditLimit?: number; chemistState?: string } = {}) {
  const companyId = await saveCompany(ctx, null, { name: "Acme Pharma" + n, shortName: "ACME" });
  const supplierId = await db.$transaction((tx) => saveSupplierIn(tx, { ...ctx, perms: [...ctx.perms, "purchase", "payments"] }, null, { name: "Acme Depot " + n, gstin: "", creditDays: 30, stateCode: "" } as never));
  await savePrincipal(ctx, null, { companyId, supplierId, claimBeforeDays: 90, claimAfterDays: 180, claimCreditPct: 80 });
  const medicineId = await saveProduct(ctx, null, { name: "Amoxyclav 625", form: "Tablet", pack: "10 tabs", companyId, hsn: "30049099", gstRate: 12, mrp: "80", ptr: "50", pts: "45" });
  const batches = opts.batches ?? [{ no: "B1", expiryDays: 400, qty: opts.qty ?? 100 }];
  let k = 0;
  for (const b of batches) {
    await postGrnTx(ctx, { supplierId, invoiceNo: `SUP-${n}-${++k}`, invoiceDate: todayISO(), acceptShortExpiry: true, lines: [{ medicineId, batchNo: b.no, expiry: addDays(todayISO(), b.expiryDays), qty: b.qty, rate: "40", mrp: "80" }] });
  }
  const customerId = await saveChemist(ctx, null, {
    name: "Sai Medical " + n, phone: `98${String(10000000 + n * 7).slice(0, 8)}`, gstin: "", stateCode: opts.chemistState ?? "27", address: "Kothrud", pincode: "411038",
    dl20b: "MH-PZ-20B-100" + n, dl21b: "MH-PZ-21B-100" + n, dlExpiry: addDays(todayISO(), 365), creditLimit: String(opts.creditLimit ?? 100000), creditDays: 21,
  });
  return { companyId, supplierId, medicineId, customerId };
}

export const key = () => "k" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);

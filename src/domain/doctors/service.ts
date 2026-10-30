import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, authorizeAny, authorizeView, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { addDays, istMidnight, todayISO } from "@/lib/dates";
import { big } from "@/lib/money";
import { doctorSchema, type DoctorInput } from "./contracts";

export type DoctorRow = { id: string; name: string; qualification: string | null; regNo: string | null; clinic: string | null; phone: string | null; address: string | null; active: boolean; version: number };

const pick = (d: DoctorRow): DoctorRow => ({ id: d.id, name: d.name, qualification: d.qualification, regNo: d.regNo, clinic: d.clinic, phone: d.phone, address: d.address, active: d.active, version: d.version });

/** Doctor master for the tenant, active first. Counter staff see it to pick prescribers. */
export async function listDoctors(ctx: Ctx, opts: { q?: string; all?: boolean } = {}) {
  const q = opts.q?.trim();
  const rows = await db.doctor.findMany({
    where: { tenantId: ctx.tenantId, ...(opts.all ? {} : { active: true }), ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { regNo: { contains: q, mode: "insensitive" } }, { clinic: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] } : {}) },
    orderBy: [{ active: "desc" }, { name: "asc" }], take: 2000,
  });
  return rows.map(pick);
}

const data = (i: ReturnType<typeof doctorSchema.parse>) => ({ name: i.name, qualification: i.qualification || null, regNo: i.regNo || null, clinic: i.clinic || null, phone: i.phone || null, address: i.address || null });

async function checkDup(ctx: Ctx, i: ReturnType<typeof doctorSchema.parse>, except?: string) {
  if (i.regNo) {
    const d = await db.doctor.findFirst({ where: { tenantId: ctx.tenantId, regNo: i.regNo, ...(except ? { NOT: { id: except } } : {}) } });
    if (d) throw new UserError(`Registration ${i.regNo} is already on file for Dr ${d.name}.`);
  }
}

/** Adds a doctor; cashiers can quick-add from the counter. */
export async function createDoctor(ctx: Ctx, raw: DoctorInput) {
  authorize(ctx, "sale");
  const i = doctorSchema.parse(raw);
  await checkDup(ctx, i);
  try {
    return await db.$transaction(async (tx) => {
      const d = await tx.doctor.create({ data: { tenantId: ctx.tenantId, ...data(i) } });
      await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Doctor added", entity: "doctor", entityId: d.id, detail: `Dr ${d.name}${d.regNo ? ` · Reg ${d.regNo}` : ""}` });
      return pick(d);
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new UserError(`Registration ${i.regNo} is already on file.`);
    throw e;
  }
}

export async function updateDoctor(ctx: Ctx, id: string, version: number, raw: DoctorInput & { active?: boolean }) {
  authorizeAny(ctx, "adjust", "users", "reports");
  const i = doctorSchema.parse(raw);
  await checkDup(ctx, i, id);
  return db.$transaction(async (tx) => {
    const r = await tx.doctor.updateMany({ where: { id, tenantId: ctx.tenantId, version }, data: { ...data(i), ...(raw.active === undefined ? {} : { active: raw.active }), version: { increment: 1 } } });
    if (!r.count) throw new UserError("Someone else changed this doctor. Reopen and try again.");
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: raw.active === false ? "Doctor deactivated" : "Doctor updated", entity: "doctor", entityId: id, detail: `Dr ${i.name}${i.regNo ? ` · Reg ${i.regNo}` : ""}` });
  });
}

export type DoctorSalesRow = { key: string; doctorId: string | null; name: string; regNo: string | null; clinic: string | null; linked: boolean; bills: number; rxBills: number; gross: number; returns: number; net: number; last: string };

/**
 * Sales referred by each doctor in a period (IST dates, inclusive) for one branch or all of the user's branches.
 * Bills linked to the doctor master group by doctor; older bills with only a typed prescriber name group by
 * that name and are marked unlinked. Returns are credit notes against those bills.
 */
export async function doctorSales(ctx: Ctx, fromDay: string, toDay: string, branchId: string | "all") {
  authorizeView(ctx, "reports");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDay) || !/^\d{4}-\d{2}-\d{2}$/.test(toDay) || fromDay > toDay) throw new UserError("Choose a valid period.");
  const mine = ctx.branches.map((b) => b.id);
  if (branchId !== "all" && !mine.includes(branchId)) throw new UserError("You don’t have access to that branch.");
  const branches = branchId === "all" ? mine : [branchId];
  const sales = await db.sale.findMany({
    where: { tenantId: ctx.tenantId, branchId: { in: branches }, at: { gte: istMidnight(fromDay), lt: istMidnight(addDays(toDay, 1)) }, OR: [{ doctorId: { not: null } }, { prescriber: { not: null } }] },
    select: { id: true, doctorId: true, prescriber: true, totalPaise: true, at: true, items: { select: { medicineId: true } } },
  });
  const [doctors, returns, rxMeds] = await Promise.all([
    db.doctor.findMany({ where: { tenantId: ctx.tenantId, id: { in: [...new Set(sales.map((s) => s.doctorId!).filter(Boolean))] } } }),
    db.salesReturn.groupBy({ by: ["saleId"], where: { tenantId: ctx.tenantId, saleId: { in: sales.map((s) => s.id) } }, _sum: { amountPaise: true } }),
    db.medicine.findMany({ where: { tenantId: ctx.tenantId, schedule: { not: null }, id: { in: [...new Set(sales.flatMap((s) => s.items.map((i) => i.medicineId)))] } }, select: { id: true } }),
  ]);
  const rx = new Set(rxMeds.map((m) => m.id));
  const ret = new Map(returns.map((r) => [r.saleId, big(r._sum.amountPaise)]));
  const by = new Map<string, DoctorSalesRow>();
  for (const s of sales) {
    const d = s.doctorId ? doctors.find((x) => x.id === s.doctorId) : null;
    const typed = (s.prescriber ?? "").trim();
    if (!d && !typed) continue;
    const key = d ? d.id : "txt:" + typed.toLowerCase().replace(/^dr\.?\s*/, "").replace(/\s+/g, " ");
    const row = by.get(key) ?? { key, doctorId: d?.id ?? null, name: d ? d.name : typed.replace(/^dr\.?\s*/i, ""), regNo: d?.regNo ?? null, clinic: d?.clinic ?? null, linked: !!d, bills: 0, rxBills: 0, gross: 0, returns: 0, net: 0, last: "" };
    row.bills++; row.gross += big(s.totalPaise); row.returns += ret.get(s.id) ?? 0;
    if (s.items.some((i) => rx.has(i.medicineId))) row.rxBills++;
    if (s.at.toISOString() > row.last) row.last = s.at.toISOString();
    by.set(key, row);
  }
  const rows = [...by.values()].map((r) => ({ ...r, net: r.gross - r.returns })).sort((a, b) => b.net - a.net || a.name.localeCompare(b.name));
  const total = rows.reduce((a, r) => ({ bills: a.bills + r.bills, gross: a.gross + r.gross, returns: a.returns + r.returns, net: a.net + r.net }), { bills: 0, gross: 0, returns: 0, net: 0 });
  return { fromDay, toDay, branchId, rows, total };
}

export const defaultPeriod = () => { const t = todayISO(); return { from: t.slice(0, 8) + "01", to: t }; };

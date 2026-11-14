import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { addDays, isoOf, todayISO } from "@/lib/dates";
import { audit, need, notify, roleOf, type Me } from "./auth";
import { responsibilityLines, type PromotionTerms } from "./letters";

// Promotions: HR records the new designation, department, manager, pay and responsibilities from an effective date. The employee's profile
// changes on that date (at once when it is today or earlier), the pay change is kept as a salary revision, and the Letter of Promotion goes
// to the employee's screen (and email, if asked) through sendLetters.

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the effective date.");
export const promotionSchema = z.object({
  toDesig: z.string().trim().min(2, "Enter the new designation.").max(80),
  toDept: z.string().trim().min(1, "Choose the department.").max(60),
  toManagerId: z.string().nullish(),
  toCtc: z.coerce.number().int("Enter the annual CTC in rupees.").min(0).max(100_000_000),
  responsibilities: z.string().max(3000, "Keep the responsibilities under 3,000 characters.").default(""),
  note: z.string().trim().max(600, "Keep the note under 600 characters.").default(""),
  effective: iso,
});

const nameOf = async (id: string | null | undefined) => (id ? (await db.staffUser.findUnique({ where: { id }, select: { name: true } }))?.name ?? "" : "");

/** Records a promotion. Returns whether the profile has changed already (effective today or earlier) or will on the effective date. */
export async function promote(me: Me, staffId: string, raw: z.input<typeof promotionSchema>) {
  need(me, "employees");
  const i = promotionSchema.parse(raw);
  if (staffId === me.id) throw new UserError("You can’t promote yourself. Ask another HR admin or the super admin.");
  const u = await db.staffUser.findFirst({ where: { id: staffId, kind: "team", role: { not: "partner" } }, include: { hr: true } });
  if (!u?.hr) throw new UserError("Employee not found.");
  if (u.status === "deactivated" || u.hr.exitDate) throw new UserError("This person is leaving or has left, so they can’t be promoted.");
  if (roleOf(u.role, u.hr.role) === "admin" && me.role !== "admin") throw new UserError("Only the super admin can change a super admin’s role.");
  const today = todayISO();
  if (i.effective < addDays(today, -90) || i.effective > addDays(today, 180)) throw new UserError("The effective date must be within 90 days back and 180 days ahead.");
  if (u.hr.joinDate && i.effective <= isoOf(u.hr.joinDate)) throw new UserError("The effective date must be after the joining date.");
  if (i.toManagerId) {
    if (i.toManagerId === staffId) throw new UserError("Someone can’t report to themselves.");
    if (!(await db.staffUser.findFirst({ where: { id: i.toManagerId, kind: "team", status: { not: "deactivated" } } }))) throw new UserError("Choose an active manager.");
  }
  const pending = await db.hrPromotion.findFirst({ where: { staffId, appliedAt: null } });
  if (pending) throw new UserError(`A promotion to ${pending.toDesig} from ${pending.effective} is waiting. Cancel it first.`);
  if (await db.hrPromotion.findUnique({ where: { staffId_effective: { staffId, effective: i.effective } } })) throw new UserError("A promotion with this effective date is recorded already.");
  const h = u.hr;
  if (i.toDesig === h.designation && i.toDept === h.dept && i.toCtc === h.ctc && (i.toManagerId || null) === h.managerId) throw new UserError("Nothing changes: give a new designation, department, manager or CTC.");
  const lines = responsibilityLines(i.responsibilities);
  const row = await db.hrPromotion.create({
    data: {
      staffId, effective: i.effective, fromDesig: h.designation, toDesig: i.toDesig, fromDept: h.dept, toDept: i.toDept, fromManagerId: h.managerId, toManagerId: i.toManagerId || null,
      fromCtc: h.ctc, toCtc: i.toCtc, responsibilities: lines.join("\n"), note: i.note, byId: me.id,
    },
  });
  await audit(me, "Promotion recorded", `${u.empNo} · ${h.designation || "—"} → ${i.toDesig} · from ${i.effective}${h.ctc !== i.toCtc ? ` · CTC ${h.ctc} → ${i.toCtc}` : ""}`);
  const applied = i.effective <= today ? await applyPromotion(row.id) : false;
  return { id: row.id, effective: i.effective, applied };
}

/** Changes the profile to the promotion's role. Safe to call twice: only an unapplied promotion is applied. */
async function applyPromotion(id: string) {
  const p = await db.hrPromotion.findUnique({ where: { id } });
  if (!p || p.appliedAt) return false;
  const h = await db.hrProfile.findUnique({ where: { staffId: p.staffId } });
  if (!h) return false;
  const [claimed] = await db.$transaction([
    db.hrPromotion.updateMany({ where: { id, appliedAt: null }, data: { appliedAt: new Date() } }),
    db.hrProfile.update({ where: { staffId: p.staffId }, data: { designation: p.toDesig, dept: p.toDept, managerId: p.toManagerId, ctc: p.toCtc, ...(p.responsibilities ? { responsibilities: p.responsibilities } : {}) } }),
    db.staffUser.update({ where: { id: p.staffId }, data: { team: p.toDept } }),
    ...(h.ctc !== p.toCtc ? [db.hrSalaryRevision.create({ data: { staffId: p.staffId, fromCtc: h.ctc, toCtc: p.toCtc, byId: p.byId } })] : []),
  ]);
  if (!claimed.count) return false;
  await notify([p.staffId], `Congratulations! You are now ${p.toDesig}${p.toDept ? ` in ${p.toDept}` : ""}. Your profile shows your new role.`, "profile");
  return true;
}

let dueCheckedAt = 0;
/** Applies promotions whose effective date has come. Runs with the daily housekeeping (and before payroll, with `now`). */
export async function applyDuePromotions(now = false) {
  if (!now && Date.now() - dueCheckedAt < 600_000) return 0;
  dueCheckedAt = Date.now();
  const due = await db.hrPromotion.findMany({ where: { appliedAt: null, effective: { lte: todayISO() } }, orderBy: { effective: "asc" }, select: { id: true } });
  let n = 0;
  for (const p of due) if (await applyPromotion(p.id)) n++;
  return n;
}

/** Cancels a promotion that hasn't taken effect yet, and withdraws its letter. */
export async function cancelPromotion(me: Me, id: string) {
  need(me, "employees");
  const p = await db.hrPromotion.findUnique({ where: { id } });
  if (!p) throw new UserError("Promotion not found.");
  if (p.appliedAt) throw new UserError("This promotion has taken effect already. Use Edit to change the role, or record a new promotion.");
  await db.$transaction([
    db.hrPromotion.delete({ where: { id } }),
    db.hrLetter.deleteMany({ where: { staffId: p.staffId, type: "promotion", lastDay: p.effective } }),
  ]);
  await audit(me, "Promotion cancelled", `${p.staffId} · ${p.toDesig} from ${p.effective}`);
}

/** Every promotion, newest first, for the Employees screen. */
export async function promotions() {
  const rows = await db.hrPromotion.findMany({ orderBy: [{ effective: "desc" }, { at: "desc" }], take: 1000 });
  return rows.map((r) => ({ id: r.id, staffId: r.staffId, effective: r.effective, fromDesig: r.fromDesig, toDesig: r.toDesig, fromDept: r.fromDept, toDept: r.toDept, fromCtc: r.fromCtc, toCtc: r.toCtc, applied: !!r.appliedAt }));
}

/** The promotion with this effective date, as the letter needs it, or null. */
export async function promotionTerms(staffId: string, effective: string): Promise<PromotionTerms | null> {
  const p = await db.hrPromotion.findUnique({ where: { staffId_effective: { staffId, effective } } });
  if (!p) return null;
  return {
    effective: p.effective, fromDesig: p.fromDesig, toDesig: p.toDesig, fromDept: p.fromDept, toDept: p.toDept, fromManager: await nameOf(p.fromManagerId), toManager: await nameOf(p.toManagerId),
    fromCtc: p.fromCtc, toCtc: p.toCtc, responsibilities: responsibilityLines(p.responsibilities), note: p.note,
  };
}

export const latestPromotionDay = async (staffId: string) => (await db.hrPromotion.findFirst({ where: { staffId }, orderBy: { effective: "desc" }, select: { effective: true } }))?.effective ?? null;

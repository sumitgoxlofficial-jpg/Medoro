import "server-only";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { hashPassword } from "@/server/auth";
import { seal, unseal } from "@/server/vault";
import { UserError } from "@/server/action";
import { mailEnabled, sendMail } from "@/server/mail";
import { welcomeMail } from "./mails";
import { log } from "@/server/log";
import { addDays, dateOnly, isoOf, todayISO } from "@/lib/dates";
import { staffDomain } from "../auth";
import { IFSC_BANKS, IFSC_RE, MOBILE_RE, PAN_RE, digits } from "../constants";
import { newEmployeeNo, referral } from "../people";
import { stateName } from "./states";
import { audit, invalidateSettings, loadPerms, loadSettings, need, needAdmin, notify, roleOf, type Me } from "./auth";
import { closeIdle } from "./monitor";
import { kycLabel } from "./kyc";
import { BREAKS, DEFAULT_DEPTS, EMP_TYPES, HR_ROLES, MODULES, ONBOARD_STEPS, type HrRoleId, type Perms, type Settings } from "./constants";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
const mobile = z.string().transform(digits).refine((p) => MOBILE_RE.test(p), "Enter a valid 10-digit mobile.");

export type Person = {
  id: string; empNo: string; name: string; email: string; phone: string; status: string; role: HrRoleId; dept: string; designation: string; empType: string;
  location: string; managerId: string | null; joinDate: string | null; exitDate: string | null; kyc: "verified" | "submitted" | "missing"; shiftStart: string; taxRegime: "new" | "old"; taxDeclared: number; esiNo: string; ctc: number; incentivePct: number; monthlyTarget: number; personalEmail: string;
  photo: string | null; homeState: string; presence: string; presenceNote: string; mustChangePassword: boolean; profileDone: boolean; docsAccepted: boolean; hasPassword: boolean; onboarding: boolean[];
};

/** Presence as others see it: someone "active" who hasn't been seen for 5 minutes is offline. */
const liveStatus = (presence: string, at: Date | null) => (presence !== "offline" && at && Date.now() - at.getTime() < 5 * 60_000 ? presence : "offline");

/** Medoro's own team (not reference partners), with their HR details. */
export async function roster(opts: { includeInactive?: boolean } = {}): Promise<Person[]> {
  const rows = await db.staffUser.findMany({
    where: { kind: "team", role: { not: "partner" }, ...(opts.includeInactive ? {} : { status: { in: ["active", "invited"] } }) },
    include: { hr: true }, orderBy: { name: "asc" },
  });
  return rows.map((u) => {
    const h = u.hr;
    return {
      id: u.id, empNo: u.empNo, name: u.name, email: u.email, phone: u.phone, status: u.status, role: roleOf(u.role, h?.role), dept: h?.dept ?? "", designation: h?.designation ?? "",
      empType: h?.empType ?? "Full-time", location: h?.location ?? "", homeState: h?.homeState ?? "", managerId: h?.managerId ?? null, joinDate: h?.joinDate ? isoOf(h.joinDate) : null, exitDate: h?.exitDate ? isoOf(h.exitDate) : null, kyc: kycLabel(h), shiftStart: h?.shiftStart ?? "", taxRegime: h?.taxRegime === "old" ? "old" : "new", taxDeclared: h?.taxDeclared ?? 0, esiNo: h?.esiNo ?? "", ctc: h?.ctc ?? 0,
      incentivePct: Number(h?.incentivePct ?? 0), monthlyTarget: h?.monthlyTarget ?? 40, personalEmail: h?.personalEmail ?? "", photo: h?.photo ?? null,
      presence: liveStatus(h?.presence ?? "offline", h?.presenceAt ?? null), presenceNote: h?.presenceNote ?? "", mustChangePassword: h?.mustChangePassword ?? false,
      profileDone: h?.profileDone ?? false, docsAccepted: !!h?.docsAcceptedAt, hasPassword: !!u.passwordHash,
      onboarding: ONBOARD_STEPS.map((_, i) => Array.isArray(h?.onboarding) && h.onboarding[i] === true),
    };
  });
}
export const nameMap = async () => new Map((await db.staffUser.findMany({ where: { kind: "team" }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));

// ── Departments
export async function departments() {
  let rows = await db.hrDepartment.findMany({ orderBy: { name: "asc" } });
  if (!rows.length) {
    await db.hrDepartment.createMany({ data: DEFAULT_DEPTS.map((name) => ({ name })), skipDuplicates: true });
    rows = await db.hrDepartment.findMany({ orderBy: { name: "asc" } });
  }
  return rows.map((d) => ({ id: d.id, name: d.name, headId: d.headId }));
}
export async function saveDepartment(me: Me, raw: { id?: string; name: string; headId?: string | null }) {
  need(me, "employees");
  const i = z.object({ id: z.string().optional(), name: z.string().trim().min(2, "Enter the department name.").max(60), headId: z.string().nullish() }).parse(raw);
  const clash = await db.hrDepartment.findFirst({ where: { name: { equals: i.name, mode: "insensitive" }, ...(i.id ? { id: { not: i.id } } : {}) } });
  if (clash) throw new UserError("A department with this name already exists.");
  if (i.id) {
    const old = await db.hrDepartment.findUnique({ where: { id: i.id } });
    if (!old) throw new UserError("Department not found.");
    await db.$transaction([
      db.hrDepartment.update({ where: { id: i.id }, data: { name: i.name, headId: i.headId || null } }),
      db.hrProfile.updateMany({ where: { dept: old.name }, data: { dept: i.name } }),
    ]);
  } else await db.hrDepartment.create({ data: { name: i.name, headId: i.headId || null } });
  await audit(me, i.id ? "Department updated" : "Department created", i.name);
}
export async function deleteDepartment(me: Me, id: string) {
  need(me, "employees");
  const d = await db.hrDepartment.findUnique({ where: { id } });
  if (!d) throw new UserError("Department not found.");
  const n = await db.hrProfile.count({ where: { dept: d.name, staff: { status: { in: ["active", "invited"] } } } });
  if (n) throw new UserError(`${n} employee${n > 1 ? "s are" : " is"} still in ${d.name}. Move them first.`);
  await db.hrDepartment.delete({ where: { id } });
  await audit(me, "Department deleted", d.name);
}

// ── New employee: official email, employee ID and a temporary password are generated.
const domain = () => (staffDomain() === "*" ? "medoro.in" : staffDomain());
const slug = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z\s]/g, "").trim().split(/\s+/).filter(Boolean);
/** firstname.lastname@domain, with a number added when it is taken. */
export async function officialEmail(name: string) {
  const parts = slug(name);
  if (!parts.length) return "";
  const base = parts.length > 1 ? `${parts[0]}.${parts[parts.length - 1]}` : parts[0];
  for (let n = 0; n < 50; n++) {
    const email = `${base}${n ? n + 1 : ""}@${domain()}`;
    if (!(await db.staffUser.findUnique({ where: { email_kind: { email, kind: "team" } } }))) return email;
  }
  throw new UserError("Couldn’t make an official email for this name. Try a different spelling.");
}
const pick = (s: string) => s[randomInt(0, s.length)];
/** 14 characters with upper, lower, digit and symbol; no look-alike characters. */
export function tempPassword() {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "#@%&"];
  const all = sets.join("");
  const chars = [...sets.map(pick), ...Array.from({ length: 10 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) { const j = randomInt(0, i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}

export const newEmployeeSchema = z.object({
  name: z.string().trim().min(3, "Enter the full name.").max(80),
  personalEmail: z.string().trim().toLowerCase().regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Enter a valid personal email."),
  phone: mobile, dept: z.string().trim().min(1, "Choose a department.").max(60), designation: z.string().trim().min(2, "Enter the designation.").max(80),
  role: z.enum(["employee", "hr", "finance", "sales"]), empType: z.enum(EMP_TYPES), joinDate: iso,
  ctc: z.coerce.number().int("Enter the annual CTC in rupees.").min(0).max(100_000_000), location: z.string().trim().max(60).default(""),
  managerId: z.string().nullish(), incentivePct: z.coerce.number().min(0).max(5, "Sales incentive can’t be more than 5%.").default(0),
  homeState: z.string().trim().default("").refine((v) => !v || !!stateName(v), "Choose the state from the list.").transform(stateName),
});

export async function createEmployee(me: Me, raw: z.input<typeof newEmployeeSchema>) {
  need(me, "employees");
  const i = newEmployeeSchema.parse(raw);
  if ((i.role === "hr" || i.role === "finance") && me.role !== "admin") throw new UserError("Only the super admin can give HR or Finance access.");
  if (await db.staffUser.findFirst({ where: { kind: "team", phone: i.phone, status: { not: "deactivated" } } })) throw new UserError("An employee with this mobile number already exists.");
  if (await db.hrProfile.findFirst({ where: { personalEmail: i.personalEmail, staff: { status: { not: "deactivated" } } } })) throw new UserError("An employee with this personal email already exists.");
  const email = await officialEmail(i.name);
  const { empNo, n } = await newEmployeeNo();
  const temp = tempPassword();
  const staffRole = i.role === "sales" ? "sales" : "employee";
  const u = await db.staffUser.create({
    data: {
      empNo, name: i.name, email, kind: "team", phone: i.phone, team: i.dept, role: staffRole, status: "active", passwordHash: await hashPassword(temp), approvedBy: me.name,
      referralCode: staffRole === "sales" ? referral(i.name, n) : null,
      hr: { create: { role: i.role, dept: i.dept, designation: i.designation, empType: i.empType, location: i.location, homeState: i.homeState, managerId: i.managerId || null, joinDate: dateOnly(i.joinDate), ctc: i.ctc, incentivePct: i.role === "sales" ? i.incentivePct : 0, personalEmail: i.personalEmail, mustChangePassword: true } },
    },
  });
  await audit(me, "Employee created", `${empNo} · ${email} · ${i.role}`);
  let mailed = false;
  if (mailEnabled()) {
    mailed = await sendMail({ to: i.personalEmail, ...welcomeMail({ name: i.name, empNo, email, temp, org: (await loadSettings()).company.name || "Medoro" }) })
      .then(() => true).catch((e) => { log.error("welcome mail failed", { err: e }); return false; });
  }
  return { id: u.id, empNo, email, temp, mailed };
}

export const editEmployeeSchema = newEmployeeSchema.omit({ personalEmail: true, phone: true, joinDate: true, name: true }).extend({
  joinDate: iso.nullish(), shiftStart: z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/, "Enter the shift start as HH:MM.").default(""),
  taxRegime: z.enum(["new", "old"]).default("new"), taxDeclared: z.coerce.number().int().min(0, "Deductions can’t be negative.").max(5_000_000).default(0),
  esiNo: z.string().trim().regex(/^$|^\d{10}$|^\d{17}$/, "The ESI number is 10 or 17 digits.").default(""), monthlyTarget: z.coerce.number().int().min(0).max(1000).default(40),
});
export async function updateEmployee(me: Me, id: string, raw: z.input<typeof editEmployeeSchema>) {
  need(me, "employees");
  const i = editEmployeeSchema.parse(raw);
  const u = await db.staffUser.findUnique({ where: { id }, include: { hr: true } });
  if (!u || u.kind !== "team") throw new UserError("Employee not found.");
  const was = roleOf(u.role, u.hr?.role);
  if (was === "admin" && me.role !== "admin") throw new UserError("Only the super admin can edit a super admin.");
  if (i.role !== was && was !== "admin" && me.role !== "admin") throw new UserError("Only the super admin can change system access.");
  const role = was === "admin" ? "admin" : i.role;
  // The staff console role follows sales access; console-only roles (customer care, super admin) are left alone.
  const staffRole = u.role === "super_admin" || u.role === "care" ? u.role : role === "sales" ? "sales" : "employee";
  const data = { role, dept: i.dept, designation: i.designation, empType: i.empType, location: i.location, homeState: i.homeState, managerId: i.managerId || null, joinDate: i.joinDate ? dateOnly(i.joinDate) : null, ctc: i.ctc, incentivePct: role === "sales" ? i.incentivePct : 0, monthlyTarget: i.monthlyTarget, shiftStart: i.shiftStart, taxRegime: i.taxRegime, taxDeclared: i.taxRegime === "old" ? i.taxDeclared : 0, esiNo: i.esiNo } as const;
  await db.$transaction([
    db.hrProfile.upsert({ where: { staffId: id }, update: data, create: { staffId: id, ...data } }),
    db.staffUser.update({ where: { id }, data: { role: staffRole, team: i.dept } }),
    ...(u.hr && u.hr.ctc !== i.ctc ? [db.hrSalaryRevision.create({ data: { staffId: id, fromCtc: u.hr.ctc, toCtc: i.ctc, byId: me.id } })] : []),
  ]);
  await audit(me, "Employee updated", `${u.empNo} · ${role} · ${i.dept} · ${i.designation}`);
}

/** Changes of annual CTC, newest first (HR). */
export async function salaryRevisions() {
  const rows = await db.hrSalaryRevision.findMany({ orderBy: { at: "desc" }, take: 1000 });
  return rows.map((r) => ({ id: r.id, staffId: r.staffId, from: r.fromCtc, to: r.toCtc, on: todayISO(r.at) }));
}

/** Deactivating records the last working day (today unless given): payroll pays up to it, in that month. */
export async function setEmployeeActive(me: Me, id: string, active: boolean, lastDay?: string) {
  need(me, "employees");
  if (id === me.id) throw new UserError("You can’t change your own access.");
  const u = await db.staffUser.findUnique({ where: { id } });
  if (!u || u.kind !== "team") throw new UserError("Employee not found.");
  if (u.role === "super_admin" && me.role !== "admin") throw new UserError("Only the super admin can change a super admin.");
  if (!active && u.role === "super_admin" && (await db.staffUser.count({ where: { role: "super_admin", status: "active" } })) <= 1) throw new UserError("Keep at least one active super admin.");
  const hr = await db.hrProfile.findUnique({ where: { staffId: id }, select: { joinDate: true } });
  const exit = active ? null : iso.parse(lastDay || todayISO());
  if (exit && exit > addDays(todayISO(), 180)) throw new UserError("The last working day can be at most 180 days ahead.");
  // A last working day still to come (a notice period): the person keeps working and is deactivated the day after it.
  const later = !!exit && exit > todayISO();
  if (exit && hr?.joinDate && exit < isoOf(hr.joinDate)) throw new UserError("The last working day can’t be before the joining date.");
  await db.$transaction([
    db.staffUser.update({ where: { id }, data: { status: active || later ? "active" : "deactivated", tokenVersion: active || later ? undefined : { increment: 1 } } }),
    ...(hr ? [db.hrProfile.update({ where: { staffId: id }, data: { exitDate: exit ? dateOnly(exit) : null } })] : []),
  ]);
  if (later) await notify([id], `Your last working day is recorded as ${exit}.`, "profile");
  await audit(me, active ? (u.status === "active" ? "Exit cancelled" : "Employee reactivated") : later ? "Exit recorded" : "Employee deactivated", `${u.empNo} · ${u.email}${exit ? ` · last working day ${exit}` : ""}`);
}

/** A password HR reads out to someone who forgot theirs. Works for one sign-in within 24 hours; then they set a new one. */
export async function issueOneTimePassword(me: Me, id: string) {
  need(me, "employees");
  const u = await db.staffUser.findUnique({ where: { id }, include: { hr: true } });
  if (!u || u.kind !== "team" || u.status === "deactivated") throw new UserError("Employee not found or deactivated.");
  if (u.role === "super_admin" && me.role !== "admin") throw new UserError("Only the super admin can reset a super admin.");
  const otp = tempPassword();
  const data = { otpHash: await hashPassword(otp), otpExpiresAt: new Date(Date.now() + 24 * 3600_000) };
  await db.hrProfile.upsert({ where: { staffId: id }, update: data, create: { staffId: id, role: roleOf(u.role, undefined), ...data } });
  await audit(me, "One-time password issued", `${u.empNo} · ${u.email}`);
  return { otp, name: u.name, empNo: u.empNo };
}

export async function tickOnboarding(me: Me, id: string, step: number, done: boolean) {
  need(me, "employees");
  const p = await db.hrProfile.findUnique({ where: { staffId: id } });
  if (!p) throw new UserError("Employee not found.");
  const ticks = ONBOARD_STEPS.map((_, i) => Array.isArray(p.onboarding) && p.onboarding[i] === true);
  if (!Number.isInteger(step) || step < 0 || step >= ticks.length) throw new UserError("Unknown step.");
  await db.hrProfile.update({ where: { staffId: id }, data: { onboarding: ticks.map((t, i) => (i === step ? done : t)) } });
}

// ── My profile: personal, emergency and bank details. Account number and PAN are sealed; screens show them masked.
export async function myProfile(me: Me) {
  const u = await db.staffUser.findUniqueOrThrow({ where: { id: me.id }, include: { hr: true } });
  const h = u.hr!;
  const mgr = h.managerId ? await db.staffUser.findUnique({ where: { id: h.managerId }, select: { name: true } }) : null;
  return {
    empNo: u.empNo, name: u.name, email: u.email, phone: u.phone, role: me.role, dept: h.dept, designation: h.designation, empType: h.empType, location: h.location, manager: mgr?.name ?? "",
    joinDate: h.joinDate ? isoOf(h.joinDate) : "", ctc: h.ctc, incentivePct: Number(h.incentivePct), personalEmail: h.personalEmail, dob: h.dob ? isoOf(h.dob) : "", gender: h.gender, address: h.address,
    emergencyName: h.emergencyName, emergencyPhone: h.emergencyPhone, bloodGroup: h.bloodGroup, bankHolder: h.bankHolder, bankLast4: h.bankLast4, bankIfsc: h.bankIfsc, bankName: h.bankName,
    panMasked: h.panMasked, uan: h.uan, photo: h.photo, profileDone: h.profileDone, docsAccepted: !!h.docsAcceptedAt, docsAcceptedAt: h.docsAcceptedAt?.toISOString() ?? null, totp: u.totpEnabled,
  };
}

export const profileSchema = z.object({
  phone: mobile, personalEmail: z.string().trim().toLowerCase().regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Enter a valid personal email.").or(z.literal("")),
  dob: iso.or(z.literal("")), gender: z.string().trim().max(20).default(""), address: z.string().trim().max(300).default(""),
  emergencyName: z.string().trim().max(80).default(""), emergencyPhone: z.string().transform(digits).refine((p) => !p || MOBILE_RE.test(p), "Enter a valid emergency mobile."),
  bloodGroup: z.string().trim().max(5).default(""),
  bankHolder: z.string().trim().max(80).default(""), bankAccount: z.string().trim().regex(/^\d{9,18}$/, "Account number is 9 to 18 digits.").or(z.literal("")),
  bankIfsc: z.string().trim().toUpperCase().regex(IFSC_RE, "IFSC looks wrong (e.g. HDFC0001234).").or(z.literal("")),
  pan: z.string().trim().toUpperCase().regex(PAN_RE, "PAN looks wrong (e.g. ABCDE1234F).").or(z.literal("")),
  uan: z.string().trim().regex(/^\d{12}$/, "UAN is 12 digits.").or(z.literal("")),
});
/** Blank bank account or PAN keeps what is saved. `complete` is the first sign-in step, where the essentials are required. */
export async function saveProfile(me: Me, raw: z.input<typeof profileSchema>, complete = false) {
  const i = profileSchema.parse(raw);
  const h = await db.hrProfile.findUniqueOrThrow({ where: { staffId: me.id } });
  if (i.dob && i.dob > todayISO()) throw new UserError("Date of birth can’t be in the future.");
  if (complete) {
    if (!i.dob || !i.address || !i.emergencyName || !i.emergencyPhone) throw new UserError("Fill in date of birth, address and an emergency contact.");
    if (!(i.bankAccount || h.bankLast4) || !(i.bankIfsc || h.bankIfsc) || !i.bankHolder) throw new UserError("Add the bank account your salary goes to.");
    if (!(i.pan || h.panMasked)) throw new UserError("Enter your PAN. It is needed for salary tax.");
  }
  await db.$transaction([
    db.staffUser.update({ where: { id: me.id }, data: { phone: i.phone } }),
    db.hrProfile.update({
      where: { staffId: me.id },
      data: {
        personalEmail: i.personalEmail || h.personalEmail, dob: i.dob ? dateOnly(i.dob) : null, gender: i.gender, address: i.address, emergencyName: i.emergencyName, emergencyPhone: i.emergencyPhone,
        bloodGroup: i.bloodGroup, bankHolder: i.bankHolder, uan: i.uan,
        ...(i.bankAccount ? { bankAccountSealed: new Uint8Array(seal(i.bankAccount)), bankLast4: i.bankAccount.slice(-4) } : {}),
        ...(i.bankIfsc ? { bankIfsc: i.bankIfsc, bankName: IFSC_BANKS[i.bankIfsc.slice(0, 4)] ?? i.bankIfsc.slice(0, 4) } : {}),
        ...(i.pan ? { panSealed: new Uint8Array(seal(i.pan)), panMasked: i.pan.slice(0, 2) + "•••••" + i.pan.slice(-3) } : {}),
        ...(complete ? { profileDone: true } : {}),
      },
    }),
  ]);
  await audit(me, complete ? "Profile completed" : "Profile updated");
}
export const openBankAccount = (sealed: Uint8Array | null) => (sealed ? unseal(sealed).toString() : "");

export async function savePhoto(me: Me, dataUrl: string | null) {
  if (dataUrl !== null && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl) || dataUrl.length > 200_000)) throw new UserError("Choose a JPG or PNG photo. It is resized to a small square before saving.");
  await db.hrProfile.update({ where: { staffId: me.id }, data: { photo: dataUrl } });
}

export async function acceptDocuments(me: Me) {
  await db.hrProfile.update({ where: { staffId: me.id }, data: { docsAcceptedAt: new Date() } });
  await audit(me, "Joining documents accepted", "Offer letter, appointment letter and non-disclosure agreement");
}

// ── Presence and breaks
export async function startBreak(me: Me, kind: string) {
  const k = z.enum(BREAKS).parse(kind);
  await closeIdle(me.id); // a break isn't idle time
  await db.$transaction([
    db.hrBreak.updateMany({ where: { staffId: me.id, endAt: null }, data: { endAt: new Date() } }),
    db.hrBreak.create({ data: { staffId: me.id, kind: k } }),
    db.hrProfile.update({ where: { staffId: me.id }, data: { presence: "break", presenceNote: k, presenceAt: new Date() } }),
  ]);
}
export async function endBreak(me: Me) {
  const open = await db.hrBreak.findMany({ where: { staffId: me.id, endAt: null } });
  const now = new Date();
  // The daily lunch hour is taken off automatically, so a "Lunch" break isn't counted a second time.
  const mins = open.filter((b) => b.kind !== "Lunch").reduce((a, b) => a + Math.max(0, Math.round((now.getTime() - b.startAt.getTime()) / 60_000)), 0);
  await db.$transaction([
    db.hrBreak.updateMany({ where: { staffId: me.id, endAt: null }, data: { endAt: now } }),
    db.hrProfile.update({ where: { staffId: me.id }, data: { presence: "active", presenceNote: "", presenceAt: now } }),
    db.hrAttendance.updateMany({ where: { staffId: me.id, day: dateOnly(todayISO()) }, data: { breakMin: { increment: mins } } }),
  ]);
}
export async function signedOut(me: Me) {
  await db.hrBreak.updateMany({ where: { staffId: me.id, endAt: null }, data: { endAt: new Date() } });
  await db.hrProfile.update({ where: { staffId: me.id }, data: { presence: "offline", presenceNote: "" } }).catch(() => {});
}

// ── Notifications
export async function notifications(me: Me) {
  const rows = await db.hrNotification.findMany({ where: { staffId: me.id }, orderBy: { createdAt: "desc" }, take: 20 });
  return rows.map((n) => ({ id: n.id, text: n.text, screen: n.screen, unread: !n.readAt, at: n.createdAt.toISOString() }));
}
export async function readNotifications(me: Me) {
  await db.hrNotification.updateMany({ where: { staffId: me.id, readAt: null }, data: { readAt: new Date() } });
}

// ── Super admin: settings, permissions, audit log
export const settingsSchema = z.object({
  company: z.object({
    name: z.string().trim().min(2, "Enter the company name.").max(120), address: z.string().trim().max(300), gstin: z.string().trim().toUpperCase().regex(/^$|^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, "GSTIN looks wrong."),
    state: z.string().trim().max(40), phone: z.string().trim().max(20), email: z.string().trim().max(120), bank: z.string().trim().max(200),
  }),
  checkin: z.boolean(), selfie: z.boolean(), kycBlock: z.boolean().default(false), idleMonitor: z.boolean(), idleMinutes: z.coerce.number().int().min(1, "Idle time is at least 1 minute.").max(30, "Idle time is at most 30 minutes."), workHours: z.coerce.number().min(1, "Work at least 1 hour a day.").max(12, "Work hours can be at most 12 a day."), lunchFrom: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter the lunch start as HH:MM."), lunchTo: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter the lunch end as HH:MM."), lateAfter: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter the time as HH:MM."),
  weekOff: z.array(z.coerce.number().int().min(0).max(6)).max(6, "Keep at least one working day in the week.").default([0, 6]),
  leave: z.object({ casual: z.coerce.number().int().min(0).max(60), sick: z.coerce.number().int().min(0).max(60), privilege: z.coerce.number().int().min(0).max(60), comp: z.coerce.number().int().min(0).max(60) }),
  carryForward: z.coerce.number().int().min(0).max(120).default(30),
  ptax: z.coerce.number().int().min(0).max(2500), payDay: z.coerce.number().int().min(1).max(28),
});
export async function saveSettings(me: Me, raw: Settings) {
  needAdmin(me);
  const value = settingsSchema.parse(raw);
  if (value.lunchFrom >= value.lunchTo) throw new UserError("Lunch must end after it starts.");
  await db.hrSetting.upsert({ where: { key: "settings" }, update: { value }, create: { key: "settings", value } });
  invalidateSettings();
  await audit(me, "Settings saved");
}
export async function togglePerm(me: Me, role: string, moduleId: string) {
  needAdmin(me);
  const r = z.enum(HR_ROLES).exclude(["admin"]).parse(role);
  const m = z.enum(MODULES.map((x) => x.id) as [string, ...string[]]).parse(moduleId) as Perms["hr"][number];
  const perms = await loadPerms();
  const on = perms[r].includes(m);
  perms[r] = on ? perms[r].filter((x) => x !== m) : [...perms[r], m];
  await db.hrSetting.upsert({ where: { key: "perms" }, update: { value: perms }, create: { key: "perms", value: perms } });
  invalidateSettings();
  await audit(me, "Permission " + (on ? "revoked" : "granted"), `${r} · ${m}`);
}
export async function auditLog(me: Me, take = 200) {
  needAdmin(me);
  const rows = await db.staffAudit.findMany({ orderBy: { at: "desc" }, take });
  return rows.map((a) => ({ id: a.id, at: a.at.toISOString(), who: a.staffName, action: a.action.replace(/^HRMS · /, ""), detail: a.detail ?? "" }));
}
export { loadSettings };

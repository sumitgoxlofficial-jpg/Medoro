import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Minimal request context for cookies()/headers() outside Next.
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => (v ? jar.set(k, v) : jar.delete(k)), delete: (k: string | { name: string }) => jar.delete(typeof k === "string" ? k : k.name) }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.9", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { hashPassword } from "@/server/auth";
import { getStaff } from "@/staff/auth";
import { changePassword, getMe, loadPerms, loadSettings, need, signIn, type Me } from "@/staff/hrms/auth";
import { createEmployee, salaryRevisions, saveSettings, setEmployeeActive, updateEmployee, issueOneTimePassword, saveProfile } from "@/staff/hrms/people";
import { addMonths, addNationalHolidays, checkIn, closeOpenDays, applyLeave, adminDecideClaim, decideLeave, hrDecideClaim, leaveBalances, monthFor, submitClaim, teamRequests, yearShare } from "@/staff/hrms/time";
import { annualTax, computeSlip, employerCost, esiReturn, finalSettlement, payrollFor, pfReturn, processPayroll, payslip, taxStatement } from "@/staff/hrms/pay";
import { addLead, assignLead, importLeads, setStage, salesSummary } from "@/staff/hrms/leads";
import { createInvoice, summary } from "@/staff/hrms/finance";
import { assignTask, performance, setTaskDone } from "@/staff/hrms/work";
import { docFile, employeeDocs, myDocs, removeDoc, uploadDoc, verifyDoc } from "@/staff/hrms/docs";
import { dateOnly, todayISO } from "@/lib/dates";
import { seal } from "@/server/vault";
import { resetDb } from "./helpers";

const PW = "long-enough-password-1";
let admin: Me, hr: Me;
const me = async (id: string) => { const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } }); return { id, empNo: u.empNo, name: u.name, first: u.name.split(" ")[0], email: u.email, staffRole: u.role, role: u.hr!.role, perms: await loadPerms(), sessionId: "t", phone: u.phone, personalEmail: "", dept: "", designation: "", photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true } as Me; };
const mk = async (empNo: string, name: string, email: string, role: "super_admin" | "employee" | "sales", hrRole: "admin" | "hr" | "employee" | "sales" | "finance", extra: { ctc?: number } = {}) =>
  db.staffUser.create({ data: { empNo, name, email, kind: "team", phone: "98" + empNo.replace(/\D/g, "").padStart(8, "0"), role, status: "active", passwordHash: await hashPassword(PW), referralCode: role === "sales" ? "S" + empNo : null, hr: { create: { role: hrRole, ctc: extra.ctc ?? 600000, joinDate: new Date("2026-01-05"), profileDone: true, docsAcceptedAt: new Date(), bankAccountSealed: new Uint8Array(seal("123456789012")), bankLast4: "9012", bankIfsc: "HDFC0001234", bankHolder: name, incentivePct: 3 } } } });

describe("HRMS", () => {
  beforeAll(async () => {
    await resetDb();
    process.env.SESSION_SECRET ||= "test-only-secret-0123456789abcdef0123";
    admin = await me((await mk("MS-001", "Asha Admin", "asha@medoro.in", "super_admin", "admin")).id);
    hr = await me((await mk("MS-002", "Hari HR", "hari@medoro.in", "employee", "hr")).id);
    await mk("MS-003", "Esha Employee", "esha@medoro.in", "employee", "employee");
    await mk("MS-004", "Sam Sales", "sam@medoro.in", "sales", "sales");
  });
  beforeEach(() => jar.clear());

  it("signs in with employee ID or email, and an HRMS session never opens the staff console for non-sales roles", async () => {
    await expect(signIn("MS-003", "wrong-password-xx")).rejects.toThrow(/incorrect/);
    expect((await signIn("MS-003", PW)).next).toBe("done");
    expect(await getMe()).toMatchObject({ email: "esha@medoro.in", role: "employee" });
    expect(await getStaff()).toBeNull(); // the console refuses HRMS-only sessions
    jar.clear();
    await signIn("esha@medoro.in", PW);
    expect((await getMe())?.empNo).toBe("MS-003");
    jar.clear();
    await signIn("MS-004", PW);
    expect((await getStaff())?.role).toBe("sales"); // sales employees keep their own leads in the console
  });

  it("locks after repeated wrong passwords", async () => {
    for (let i = 0; i < 5; i++) await expect(signIn("MS-002", "nope-nope-nope")).rejects.toThrow();
    await expect(signIn("MS-002", PW)).rejects.toThrow(/Too many attempts/);
    await db.loginAttempt.deleteMany();
  });

  it("HR creates an employee with a generated email, ID and temporary password that must be changed", async () => {
    const r = await createEmployee(hr, { name: "Nina Newjoiner", personalEmail: "nina@gmail.com", phone: "9876543210", dept: "Support", designation: "Executive", role: "employee", empType: "Full-time", joinDate: "2026-11-16", ctc: 360000, location: "", managerId: null, incentivePct: 0 });
    expect(r.email).toBe("nina.newjoiner@medoro.in");
    expect(r.temp).toHaveLength(14);
    const second = await createEmployee(hr, { name: "Nina Newjoiner", personalEmail: "nina2@gmail.com", phone: "9876543211", dept: "Support", designation: "Executive", role: "employee", empType: "Full-time", joinDate: "2026-11-16", ctc: 0, location: "", managerId: null, incentivePct: 0 });
    expect(second.email).toBe("nina.newjoiner2@medoro.in");
    await expect(createEmployee(hr, { name: "Dup Phone", personalEmail: "d@x.in", phone: "9876543210", dept: "x", designation: "Exec", role: "employee", empType: "Full-time", joinDate: "2026-11-16", ctc: 0, location: "", managerId: null, incentivePct: 0 })).rejects.toThrow(/mobile/);
    // Only the super admin gives HR or Finance access.
    await expect(createEmployee(hr, { name: "Boss Person", personalEmail: "b@x.in", phone: "9876543299", dept: "Ops", designation: "Lead", role: "hr", empType: "Full-time", joinDate: "2026-11-16", ctc: 0, location: "", managerId: null, incentivePct: 0 })).rejects.toThrow(/Only the super admin/);
    await expect(createEmployee(admin, { name: "Boss Person", personalEmail: "b@x.in", phone: "9876543299", dept: "Ops", designation: "Lead", role: "hr", empType: "Full-time", joinDate: "2026-11-16", ctc: 0, location: "", managerId: null, incentivePct: 0 })).resolves.toBeDefined();
  });

  it("first sign-in with the temporary password forces a new password; the old one stops working", async () => {
    const r = await createEmployee(admin, { name: "Omar Onboard", personalEmail: "omar@gmail.com", phone: "9811122233", dept: "Ops", designation: "Exec", role: "employee", empType: "Full-time", joinDate: "2026-11-16", ctc: 240000, location: "", managerId: null, incentivePct: 0 });
    const s = await signIn("MS-" + r.empNo.slice(3), r.temp);
    expect(s).toMatchObject({ next: "done", mustChange: true });
    const m = (await getMe())!;
    expect(m.mustChangePassword).toBe(true);
    await expect(changePassword(m, "short")).rejects.toThrow();
    await changePassword(m, "A-brand-new-password-7");
    jar.clear();
    await expect(signIn(r.empNo, r.temp)).rejects.toThrow();
    expect((await signIn(r.empNo, "A-brand-new-password-7")).next).toBe("done");
    expect((await getMe())!.mustChangePassword).toBe(false);
  });

  it("one-time password works once and forces a change", async () => {
    const esha = await db.staffUser.findFirstOrThrow({ where: { empNo: "MS-003" } });
    const { otp } = await issueOneTimePassword(hr, esha.id);
    expect((await signIn("MS-003", otp)).next).toBe("done");
    jar.clear();
    await expect(signIn("MS-003", otp)).rejects.toThrow();
    jar.clear();
    expect((await signIn("MS-003", PW)).next).toBe("done"); // password still works too
  });

  it("profile: bank account and PAN are sealed and only shown masked", async () => {
    const esha = await me((await db.staffUser.findFirstOrThrow({ where: { empNo: "MS-003" } })).id);
    await expect(saveProfile(esha, { phone: "9822000003", personalEmail: "", dob: "1999-01-01", gender: "", address: "x", emergencyName: "a", emergencyPhone: "9811111111", bloodGroup: "", bankHolder: "Esha", bankAccount: "12", bankIfsc: "HDFC0001234", pan: "ABCDE1234F", uan: "" })).rejects.toThrow(/Account number/);
    await saveProfile(esha, { phone: "9822000003", personalEmail: "", dob: "1999-01-01", gender: "", address: "x", emergencyName: "a", emergencyPhone: "9811111111", bloodGroup: "", bankHolder: "Esha", bankAccount: "123456789012", bankIfsc: "HDFC0001234", pan: "ABCDE1234F", uan: "" });
    const p = await db.hrProfile.findUniqueOrThrow({ where: { staffId: esha.id } });
    expect(p.bankLast4).toBe("9012");
    expect(p.panMasked).toBe("AB•••••34F");
    expect(Buffer.from(p.bankAccountSealed!).toString("utf8")).not.toContain("123456789012");
  });

  it("permissions: employees can't open HR modules", async () => {
    const esha = await me((await db.staffUser.findFirstOrThrow({ where: { empNo: "MS-003" } })).id);
    expect(() => need(esha, "payroll")).toThrow(/role can’t/);
    expect(() => need(hr, "payroll")).not.toThrow();
    await expect(updateEmployee(esha, hr.id, { dept: "x", designation: "yy", role: "employee", empType: "Full-time", location: "", ctc: 1, incentivePct: 0, monthlyTarget: 1 })).rejects.toThrow();
  });

  it("leave: balance, overlap and self-approval rules", async () => {
    const esha = await me((await db.staffUser.findFirstOrThrow({ where: { empNo: "MS-003" } })).id);
    const s = await loadSettings();
    expect((await leaveBalances(esha.id, s, "2027")).find((b) => b.id === "casual")!.left).toBe(12);
    expect(await applyLeave(esha, { type: "casual", from: "2027-03-01", to: "2027-03-05", reason: "trip" })).toBe(5); // Mon to Fri
    await expect(applyLeave(esha, { type: "casual", from: "2027-03-04", to: "2027-03-04", reason: "" })).rejects.toThrow(/already have leave/);
    await expect(applyLeave(esha, { type: "casual", from: "2027-03-06", to: "2027-03-07", reason: "" })).rejects.toThrow(/weekends/); // Sat-Sun only
    await expect(applyLeave(esha, { type: "comp", from: "2027-04-05", to: "2027-04-05", reason: "" })).rejects.toThrow(/0 Comp Off/);
    const l = await db.hrLeave.findFirstOrThrow({ where: { staffId: esha.id } });
    expect((await leaveBalances(esha.id, s, "2027")).find((b) => b.id === "casual")!.left).toBe(7);
    await decideLeave(hr, l.id, true);
    await expect(decideLeave(hr, l.id, false)).rejects.toThrow(/already decided/);
    // HR can't approve their own leave
    await applyLeave(hr, { type: "sick", from: "2027-03-01", to: "2027-03-01", reason: "" });
    const own = await db.hrLeave.findFirstOrThrow({ where: { staffId: hr.id } });
    await expect(decideLeave(hr, own.id, true)).rejects.toThrow(/Someone else/);
    await decideLeave(admin, own.id, true);
  });

  it("claims: HR review then super-admin sign-off, in that order", async () => {
    const esha = await me((await db.staffUser.findFirstOrThrow({ where: { empNo: "MS-003" } })).id);
    const f = new FormData(); f.set("type", "Medical bill"); f.set("amount", "3450"); f.set("note", "clinic");
    await submitClaim(esha, f);
    const c = await db.hrClaim.findFirstOrThrow({ where: { staffId: esha.id } });
    await expect(adminDecideClaim(admin, c.id, true)).rejects.toThrow(/not waiting/);
    await hrDecideClaim(hr, c.id, true);
    await expect(hrDecideClaim(hr, c.id, true)).rejects.toThrow();
    await expect(adminDecideClaim(hr, c.id, true)).rejects.toThrow(/Only the super admin/);
    await adminDecideClaim(admin, c.id, true);
    expect((await db.hrClaim.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("approved");
  });

  it("salary maths: components add up, PF caps at 15,000 of basic, tax-free up to 12.75 lakh", () => {
    expect(annualTax(1_275_000)).toBe(0);
    expect(annualTax(1_300_000)).toBeLessThanOrEqual(26_000); // marginal relief just above the limit
    const s = computeSlip(1_200_000, { workDays: 22, lopDays: 0, incentive: 0, reimburse: 0, ptax: 200 });
    expect(s.basic + s.hra + s.special).toBe(100_000);
    expect(s.pf).toBe(1800);
    expect(s.net).toBe(s.gross - s.pf - s.esi - s.pt - s.tds);
    const lop = computeSlip(1_200_000, { workDays: 20, lopDays: 5, incentive: 0, reimburse: 500, ptax: 200 });
    expect(lop.lop).toBe(25_000);
    expect(lop.net).toBe(lop.gross - lop.pf - lop.esi - lop.pt - lop.tds + 500);
    expect(computeSlip(240_000, { workDays: 22, lopDays: 0, incentive: 0, reimburse: 0, ptax: 200 }).esi).toBe(Math.ceil(20_000 * 0.0075));
  });

  it("payroll: processes a month once, pays approved claims once, and the owner can open the payslip", async () => {
    const ym = addMonths(todayISO().slice(0, 7), -1); // a month that has ended
    const run = await payrollFor(hr, ym);
    const esha = run.lines.find((l) => l.empNo === "MS-003")!;
    expect(esha.status).toBe("draft");
    expect(esha.reimburse).toBe(3450);
    expect(await processPayroll(hr, ym, { [esha.staffId]: 0 })).toBeGreaterThan(0);
    await expect(processPayroll(hr, ym)).rejects.toThrow();
    const slip = await db.hrPayslip.findFirstOrThrow({ where: { staffId: esha.staffId, month: ym } });
    expect(slip.lopDays).toBe(0);
    expect((await db.hrClaim.findFirstOrThrow({ where: { staffId: esha.staffId } })).paidMonth).toBe(ym);
    const eshaMe = await me(esha.staffId);
    expect((await payslip(eshaMe, slip.id)).emp.name).toBe("Esha Employee");
    const other = await me((await db.staffUser.findFirstOrThrow({ where: { empNo: "MS-004" } })).id);
    await expect(payslip(other, slip.id)).rejects.toThrow(/not found/);
  });

  it("official holidays: fixed dates plus the year's festivals, added once", async () => {
    const r = await addNationalHolidays(hr, 2026);
    expect(r).toEqual({ added: 18, festivals: true });
    expect(await db.hrHoliday.findUnique({ where: { day: dateOnly("2026-11-08") } })).toMatchObject({ name: "Diwali" });
    expect(await db.hrHoliday.findUnique({ where: { day: dateOnly("2026-08-15") } })).toMatchObject({ name: "Independence Day" });
    expect(await addNationalHolidays(hr, 2026)).toEqual({ added: 0, festivals: true });
    expect(await addNationalHolidays(hr, 2031)).toEqual({ added: 5, festivals: false }); // no festival list for that year
    await expect(addNationalHolidays(await me((await db.staffUser.findFirstOrThrow({ where: { empNo: "MS-003" } })).id), 2026)).rejects.toThrow(/role can’t/);
  });

  it("attendance counts absent only for past working days", async () => {
    const s = await loadSettings();
    const esha = await db.staffUser.findFirstOrThrow({ where: { empNo: "MS-003" } });
    const m = await monthFor(esha.id, todayISO().slice(0, 7), s);
    expect(m.cells.find((c) => c.day === todayISO())?.kind).toBe("today");
    expect(m.cells.filter((c) => c.kind === "absent").every((c) => c.day < todayISO())).toBe(true);
  });

  it("tasks and performance", async () => {
    const esha = await me((await db.staffUser.findFirstOrThrow({ where: { empNo: "MS-003" } })).id);
    await assignTask(hr, { title: "Prepare deck", assigneeId: esha.id, due: todayISO(), priority: "High" });
    const t = await db.hrTask.findFirstOrThrow({ where: { assigneeId: esha.id } });
    const other = await me((await db.staffUser.findFirstOrThrow({ where: { empNo: "MS-004" } })).id);
    await expect(setTaskDone(other, t.id, true)).rejects.toThrow(/not found/);
    await setTaskDone(esha, t.id, true, "done");
    const perf = await performance(hr, "today");
    expect(perf.rows.find((r) => r.id === esha.id)).toMatchObject({ total: 1, done: 1, completion: 100, onTimePct: 100 });
  });

  it("leads: upload, assign, and winning a pharmacy logs the same sale the console does", async () => {
    const sam = await me((await db.staffUser.findFirstOrThrow({ where: { empNo: "MS-004" } })).id);
    const r = await importLeads(hr, "store,owner,phone,city,plan,source\nAlpha Medicos,R Gupta,9811100001,Bokaro,Starter,Field visit\nBad,,12,,,\nAlpha Again,x,9811100001,,,\n");
    expect(r.added).toBe(1);
    expect(r.skippedCount).toBe(2);
    await expect(addLead(hr, { name: "Dup", owner: "", phone: "9811100001", city: "", plan: "starter", source: "Referral", staffId: "" })).rejects.toThrow(/already a lead/);
    const lead = await db.lead.findFirstOrThrow({ where: { phone: "9811100001" } });
    expect(lead.staffId).toBe("");
    await expect(setStage(sam, lead.id, "contacted")).rejects.toThrow(/not found/); // not theirs yet
    await assignLead(hr, lead.id, sam.id);
    for (const st of ["contacted", "demo", "trial"]) await setStage(sam, lead.id, st);
    await setStage(sam, lead.id, "won");
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).stage).toBe("won");
    expect(await db.cpSale.count()).toBe(1);
    await expect(setStage(sam, lead.id, "lost", "Price")).rejects.toThrow(/stays won/);
    const sum = await salesSummary(sam);
    expect(sum.wonMonth).toBe(1);
    expect(sum.incentive).toBeGreaterThan(0);
  });

  it("invoices: 18% GST, CGST+SGST inside the state, numbered in order, and the GST report picks them up", async () => {
    const fin = admin;
    const a = await createInvoice(fin, { client: "Acme Pharma", gstin: "", address: "", state: "", due: "", notes: "", draft: false, items: [{ desc: "Licence", hsn: "9983", qty: 1, rate: 10000, gst: 18 }] });
    const b = await createInvoice(fin, { client: "Beta", gstin: "", address: "", state: "", due: "", notes: "", draft: true, items: [{ desc: "Setup", hsn: "9983", qty: 2, rate: 500, gst: 0 }] });
    expect([a.no, b.no]).toEqual(["INV-0001", "INV-0002"]);
    const rec = await db.hrRecord.findUniqueOrThrow({ where: { id: a.id } });
    expect((rec.data as { doc: { total: number } }).doc.total).toBe(11800);
    const sum = await summary(fin);
    expect(sum.invoiced).toBe(11800); // drafts are not counted
    expect(sum.gst.find((g) => g.month === todayISO().slice(0, 7))!.output).toBe(1800);
    await expect(createInvoice(fin, { client: "X", gstin: "BAD", address: "", state: "", due: "", notes: "", draft: false, items: [{ desc: "a", hsn: "", qty: 1, rate: 1, gst: 18 }] })).rejects.toThrow(/GSTIN/);
  });

  it("deactivated employees lose access immediately", async () => {
    const u = await db.staffUser.findFirstOrThrow({ where: { empNo: "MS-003" } });
    await signIn("MS-003", PW);
    expect(await getMe()).not.toBeNull();
    await db.staffUser.update({ where: { id: u.id }, data: { status: "deactivated", tokenVersion: { increment: 1 } } });
    expect(await getMe()).toBeNull();
    await expect(signIn("MS-003", PW)).rejects.toThrow(/deactivated/);
    void dateOnly;
  });
  it("days before the HRMS profile existed are never absent or loss of pay", async () => {
    const s = await loadSettings(), prev = addMonths(todayISO().slice(0, 7), -1);
    const sam = await db.staffUser.findFirstOrThrow({ where: { empNo: "MS-004" } }); // joined in January, profile made today
    const m = await monthFor(sam.id, prev, s);
    expect(m.counts.absent).toBe(0);
    expect(m.cells.some((c) => c.kind === "before" && c.label === "No record")).toBe(true);
    // Once the profile is older than the month, a working day with no check-in is absent again.
    await db.hrProfile.update({ where: { staffId: sam.id }, data: { createdAt: new Date("2026-01-05T00:00:00Z") } });
    expect((await monthFor(sam.id, prev, s)).counts.absent).toBeGreaterThan(0);
    await db.hrProfile.update({ where: { staffId: sam.id }, data: { createdAt: new Date() } });
  });

  it("leave is pro-rated from the month of joining in the first year", async () => {
    expect(yearShare("2026-10-01", "2026")).toBe(0.25);
    expect(yearShare("2025-10-01", "2026")).toBe(1);
    expect(yearShare("2027-01-01", "2026")).toBe(0);
    const s = await loadSettings();
    const u = await mk("MS-050", "Nina New", "nina@medoro.in", "employee", "employee");
    await db.hrProfile.update({ where: { staffId: u.id }, data: { joinDate: dateOnly("2030-10-01") } });
    const bal = await leaveBalances(u.id, s, "2030");
    expect(bal.find((b) => b.id === "casual")!.total).toBe(3);
    expect(bal.find((b) => b.id === "privilege")!.total).toBe(4); // 15 × 3/12 = 3.75
    expect((await leaveBalances(u.id, s, "2031")).find((b) => b.id === "casual")!.total).toBe(12);
  });

  it("a month can be processed only from its last working day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2031-06-10T06:00:00Z"));
      const early = await payrollFor(hr, "2031-06");
      expect(early.canProcess).toBe(false);
      expect(early.note).toMatch(/This is a preview\. June 2031 can be processed from 20\d\d-\d\d-\d\d/);
      // Someone paid by calendar month opens on the month's last working day (a Monday, 30 June).
      expect(early.lines.find((l) => l.empNo === "MS-004")).toMatchObject({ opens: "2031-06-30", ready: false, from: "2031-06-01", to: "2031-06-30", payDate: "2031-06-30" });
      await expect(processPayroll(hr, "2031-06")).rejects.toThrow(/preview/);
      vi.setSystemTime(new Date("2031-06-30T06:00:00Z")); // a Monday
      expect((await payrollFor(hr, "2031-06")).canProcess).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it("someone who leaves is paid up to the last working day, in that month only", async () => {
    const nina = await db.staffUser.findFirstOrThrow({ where: { empNo: "MS-050" } });
    await db.hrProfile.update({ where: { staffId: nina.id }, data: { joinDate: dateOnly("2026-01-05") } });
    await expect(setEmployeeActive(hr, nina.id, false, "2099-01-01")).rejects.toThrow(/180 days/);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2031-07-31T06:00:00Z"));
      await setEmployeeActive(hr, nina.id, false, "2031-07-10"); // a Thursday: 8 working days in, 15 after
      await db.hrAttendance.createMany({ data: ["01", "02", "03", "04", "07", "08", "09", "10"].map((d) => ({ staffId: nina.id, day: dateOnly(`2031-07-${d}`), status: "present", note: "marked by HR" })) });
      const line = (await payrollFor(hr, "2031-07")).lines.find((l) => l.empNo === "MS-050")!;
      expect(line).toMatchObject({ status: "draft", workDays: 23, lopDays: 15 });
      expect(line.net).toBeGreaterThan(0);
      vi.setSystemTime(new Date("2031-08-29T06:00:00Z"));
      expect((await payrollFor(hr, "2031-08")).lines.some((l) => l.empNo === "MS-050")).toBe(false);
      await setEmployeeActive(hr, nina.id, true);
      expect((await db.hrProfile.findUniqueOrThrow({ where: { staffId: nina.id } })).exitDate).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it("half-day and unpaid leave, the reporting manager's approval, and privilege leave carried forward", async () => {
    const s = await loadSettings();
    const esha = await me((await db.staffUser.findFirstOrThrow({ where: { empNo: "MS-003" } })).id);
    const nina = await me((await db.staffUser.findFirstOrThrow({ where: { empNo: "MS-050" } })).id);
    const sam = await me((await db.staffUser.findFirstOrThrow({ where: { empNo: "MS-004" } })).id);
    // Half a day: one date, half a day off the balance.
    const before = (await leaveBalances(nina.id, s, "2032")).find((b) => b.id === "sick")!.left;
    await expect(applyLeave(nina, { type: "sick", from: "2032-03-01", to: "2032-03-02", reason: "", half: true })).rejects.toThrow(/one date/);
    expect(await applyLeave(nina, { type: "sick", from: "2032-03-01", to: "2032-03-01", reason: "", half: true })).toBe(0.5);
    expect((await leaveBalances(nina.id, s, "2032")).find((b) => b.id === "sick")!.left).toBe(before - 0.5);
    // Unpaid leave needs no balance and is loss of pay.
    expect(await applyLeave(nina, { type: "unpaid", from: "2032-03-08", to: "2032-03-09", reason: "family" })).toBe(2);
    // Esha is Nina's manager: she sees the requests and can decide them; Sam can't.
    await db.hrProfile.update({ where: { staffId: nina.id }, data: { managerId: esha.id } });
    const team = await teamRequests(esha);
    expect(team.map((t) => t.text)).toEqual(expect.arrayContaining([expect.stringMatching(/half a day/), expect.stringMatching(/Unpaid.*2 days/)]));
    expect(await teamRequests(sam)).toEqual([]);
    await expect(decideLeave(sam, team[0].id, true)).rejects.toThrow(/role can’t/);
    for (const t of team) await decideLeave(esha, t.id, true);
    const m = await monthFor(nina.id, "2032-03", s);
    expect(m.counts.unpaid).toBe(2);
    expect(m.counts.leave).toBe(0.5);
    // Unused privilege leave carries into the next year, up to the cap.
    const pl = async (y: string) => (await leaveBalances(nina.id, s, y)).find((b) => b.id === "privilege")!;
    expect(await pl("2026")).toMatchObject({ total: 15, carried: 0 }); // the joining year
    expect(await pl("2027")).toMatchObject({ total: 30, carried: 15 });
    expect(await pl("2028")).toMatchObject({ total: 45, carried: 30 });
    expect(await pl("2029")).toMatchObject({ total: 45, carried: 30 }); // capped at 30
  });
  it("exit with notice: the person works until the last day, then is deactivated; the final month carries the settlement", async () => {
    expect(finalSettlement(600_000, "2026-01-05", "2031-03-31", 10)).toEqual({ encashDays: 10, encash: Math.round((25_000 / 26) * 10), gratuity: Math.round((25_000 * 15 * 5) / 26) });
    expect(finalSettlement(600_000, "2026-01-05", "2029-03-31", 0).gratuity).toBe(0); // under five years
    expect(finalSettlement(600_000, "2026-01-05", "2030-10-31", 0).gratuity).toBe(Math.round((25_000 * 15 * 5) / 26)); // 4 years 240 days counts
    const u = await mk("MS-060", "Leo Leaver", "leo@medoro.in", "employee", "employee");
    await db.hrProfile.update({ where: { staffId: u.id }, data: { createdAt: new Date("2026-01-05T00:00:00Z") } });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2031-09-10T06:00:00Z"));
      await setEmployeeActive(hr, u.id, false, "2031-09-19"); // a Friday, nine days ahead
      expect((await db.staffUser.findUniqueOrThrow({ where: { id: u.id } })).status).toBe("active");
      vi.setSystemTime(new Date("2031-09-30T06:00:00Z"));
      const line = (await payrollFor(hr, "2031-09")).lines.find((l) => l.empNo === "MS-060")!;
      expect((await db.staffUser.findUniqueOrThrow({ where: { id: u.id } })).status).toBe("deactivated"); // the day passed
      expect(line.final).toBe("2031-09-19");
      expect(line.encash).toBeGreaterThan(0); // unused privilege leave, with what was carried forward
      expect(line.gratuity).toBe(Math.round((25_000 * 15 * 6) / 26)); // 5 years 8 months counts as 6
      expect(line.gross).toBeGreaterThanOrEqual(line.encash);
      await processPayroll(hr, "2031-09", Object.fromEntries((await payrollFor(hr, "2031-09")).lines.map((l) => [l.staffId, 0])));
      const slip = await db.hrPayslip.findFirstOrThrow({ where: { staffId: u.id, month: "2031-09" } });
      expect(slip).toMatchObject({ encash: line.encash, gratuity: line.gratuity });
      expect((await payslip(hr, slip.id)).lastDay).toBe("2031-09-19");
    } finally { vi.useRealTimers(); }
  });
  it("weekly offs from Settings, a person's own shift start, and automatic check-out of a forgotten day", async () => {
    const s = await loadSettings();
    const nina = await me((await db.staffUser.findFirstOrThrow({ where: { empNo: "MS-050" } })).id);
    // A six-day week: Saturday becomes a working day.
    const six = { ...s, weekOff: [0] };
    const sat = (await monthFor(nina.id, "2032-05", six)).cells.find((c) => c.day === "2032-05-08")!; // a Saturday
    expect(sat.kind).not.toBe("weekend");
    expect((await monthFor(nina.id, "2032-05", s)).cells.find((c) => c.day === "2032-05-08")!.kind).toBe("weekend");
    await expect(saveSettings(admin, { ...s, weekOff: [0, 1, 2, 3, 4, 5, 6] })).rejects.toThrow();
    // Shift start: an afternoon shift is not late at 1 PM, the company time (10:00) would be.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2032-05-10T07:30:00Z")); // Monday 1:00 PM in India
      await db.hrProfile.update({ where: { staffId: nina.id }, data: { shiftStart: "14:00" } });
      expect((await checkIn(nina)).status).toBe("present");
      // Never checked out: the next day it is closed after a full working day.
      vi.setSystemTime(new Date("2032-05-11T04:00:00Z"));
      expect(await closeOpenDays()).toBeGreaterThan(0);
      const a = await db.hrAttendance.findUniqueOrThrow({ where: { staffId_day: { staffId: nina.id, day: dateOnly("2032-05-10") } } });
      expect(a.outAt!.toISOString()).toBe("2032-05-10T16:30:00.000Z"); // 8 hours of work + the lunch hour
      expect(a.note).toMatch(/Auto check-out/);
      expect(await closeOpenDays()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("statutory: old tax regime, employer shares, PF and ESI returns, the yearly tax statement and salary revisions", async () => {
    // Old regime: ₹50,000 standard deduction and declared deductions; nothing up to ₹5,00,000 taxable.
    expect(annualTax(700_000, "old", 150_000)).toBe(0);
    expect(annualTax(1_200_000, "old", 150_000)).toBe(Math.round((12_500 + 100_000) * 1.04)); // taxable 10,00,000
    expect(annualTax(1_200_000, "old", 0)).toBeGreaterThan(annualTax(1_200_000, "old", 150_000));
    expect(computeSlip(1_800_000, { workDays: 22, lopDays: 0, incentive: 0, reimburse: 0, ptax: 200, regime: "old", declared: 200_000 }).tds).toBe(Math.round(annualTax(1_800_000, "old", 200_000) / 12));
    expect(employerCost({ pf: 1800, esi: 150, gross: 20_000 })).toEqual({ pf: 1800, esi: 650 });
    expect(employerCost({ pf: 1800, esi: 0, gross: 50_000 }).esi).toBe(0);
    // Returns for the month processed earlier (the previous month).
    const ym = addMonths(todayISO().slice(0, 7), -1);
    const esha = await db.staffUser.findFirstOrThrow({ where: { empNo: "MS-003" } });
    await db.hrProfile.update({ where: { staffId: esha.id }, data: { uan: "100200300400" } });
    const pf = await pfReturn(hr, ym);
    const mine = pf.text.split("\n").find((l) => l.startsWith("100200300400#~#ESHA EMPLOYEE#~#"))!;
    const f = mine.split("#~#").map(Number);
    expect(f[6]).toBe(1800); // 12% of the ₹15,000 ceiling
    expect(f[7] + f[8]).toBe(1800); // EPS and the employer's EPF share add up to the employer's 12%
    expect(pf.missing.length).toBeGreaterThan(0); // the others have no UAN yet
    expect((await esiReturn(hr, ym)).text.split("\n")[0]).toMatch(/^ESI number,/);
    await expect(pfReturn(await me(esha.id), ym)).rejects.toThrow(/role can’t/);
    // The tax statement covers April to March; one's own, or anyone's with Payroll.
    const fy = Number(ym.slice(0, 4)) - (Number(ym.slice(5, 7)) < 4 ? 1 : 0);
    const st = await taxStatement(await me(esha.id), esha.id, fy);
    expect(st.text).toMatch(/Total,\d+/);
    await expect(taxStatement(await me(esha.id), hr.id, fy)).rejects.toThrow(/role can’t/);
    // A change of CTC is kept as a revision.
    const base = { dept: "Engineering", designation: "Engineer", role: "employee" as const, empType: "Full-time" as const, location: "", incentivePct: 0, monthlyTarget: 40 };
    await updateEmployee(hr, esha.id, { ...base, ctc: 720_000, taxRegime: "old", taxDeclared: 150_000 });
    expect((await salaryRevisions()).find((r) => r.staffId === esha.id)).toMatchObject({ from: 600_000, to: 720_000 });
    expect(await db.hrProfile.findUniqueOrThrow({ where: { staffId: esha.id } })).toMatchObject({ taxRegime: "old", taxDeclared: 150_000 });
  });
  it("employee documents: the owner uploads, HR verifies and opens (audited), nobody else can", async () => {
    const esha = await me((await db.staffUser.findFirstOrThrow({ where: { empNo: "MS-003" } })).id);
    const sam = await me((await db.staffUser.findFirstOrThrow({ where: { empNo: "MS-004" } })).id);
    const form = (kind: string, type = "application/pdf") => { const f = new FormData(); f.set("kind", kind); f.set("file", new File([new Uint8Array([37, 80, 68, 70, 45])], "aadhaar.pdf", { type })); return f; };
    await expect(uploadDoc(esha, form("Nonsense"))).rejects.toThrow();
    await expect(uploadDoc(esha, form("Aadhaar card", "application/zip"))).rejects.toThrow(/PDF, JPG or PNG/);
    await uploadDoc(esha, form("Aadhaar card"));
    const [d] = await myDocs(esha.id);
    expect(d).toMatchObject({ kind: "Aadhaar card", name: "aadhaar.pdf", verified: false });
    expect(await docFile(sam, d.id)).toBeNull(); // a colleague can't open it
    await expect(employeeDocs(sam, esha.id)).rejects.toThrow(/role can’t/);
    await expect(verifyDoc(sam, d.id, true)).rejects.toThrow(/role can’t/);
    expect((await docFile(esha, d.id))!.type).toBe("application/pdf");
    expect((await docFile(hr, d.id))!.name).toBe("aadhaar.pdf");
    expect(await db.staffAudit.count({ where: { action: { contains: "Employee document opened" } } })).toBe(1);
    await verifyDoc(hr, d.id, true);
    expect((await employeeDocs(hr, esha.id))[0].verified).toBe(true);
    await expect(removeDoc(esha, d.id)).rejects.toThrow(/verified/); // the owner can't pull a verified document
    await removeDoc(hr, d.id);
    expect(await myDocs(esha.id)).toEqual([]);
  });
});

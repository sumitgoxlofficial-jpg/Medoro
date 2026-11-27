import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Enterprise HRMS Phase 1: the first-sign-in gate is enforced on the server, people can't act on their own pay,
// leave or bank records, uploads must really be the file type they claim, KYC openings are throttled, and payroll
// history can't be edited in the database.
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => (v ? jar.set(k, v) : jar.delete(k)), delete: (k: string | { name: string }) => jar.delete(typeof k === "string" ? k : k.name) }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.9", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { hashPassword } from "@/server/auth";
import { seal } from "@/server/vault";
import { ANY_STEP, GATE_MESSAGE, getReadyMe, hrRun, loadPerms, signIn, type Me } from "@/staff/hrms/auth";
import { confirmBank, updateEmployee } from "@/staff/hrms/people";
import { grantLeave, submitClaim } from "@/staff/hrms/time";
import { processPayroll } from "@/staff/hrms/pay";
import { uploadDoc } from "@/staff/hrms/docs";
import { revealKyc, saveKycNumbers } from "@/staff/hrms/kyc";
import { verhoeffDigit } from "@/lib/aadhaar";
import { resetDb } from "./helpers";

const PW = "long-enough-password-1";
let admin: Me, hr: Me, hr2: Me, emp: Me;
const me = async (id: string): Promise<Me> => {
  const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } });
  return { id, empNo: u.empNo, name: u.name, first: u.name.split(" ")[0], email: u.email, staffRole: u.role, role: u.role === "super_admin" ? "admin" : u.hr!.role, perms: await loadPerms(), sessionId: "t", phone: u.phone, personalEmail: "", dept: "", designation: "", photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true, kycSubmitted: true, kycSkipped: false, kycVerified: true };
};
const mk = async (empNo: string, name: string, role: "super_admin" | "employee", hrRole: "admin" | "hr" | "employee", n: number, extra: { mustChangePassword?: boolean } = {}) =>
  db.staffUser.create({ data: { empNo, name, email: `${name.split(" ")[0].toLowerCase()}@medoro.in`, kind: "team", phone: "981000000" + n, role, status: "active", passwordHash: await hashPassword(PW), hr: { create: { role: hrRole, ctc: 600000, joinDate: new Date("2026-01-05"), profileDone: true, docsAcceptedAt: new Date(), kycSubmittedAt: new Date(), bankAccountSealed: new Uint8Array(seal("123456789012")), bankLast4: "9012", bankIfsc: "HDFC0001234", bankHolder: "Someone Else", mustChangePassword: extra.mustChangePassword ?? false } } } });
const edit = { dept: "HR", designation: "Manager", role: "hr" as const, empType: "Full-time" as const, location: "", ctc: 9_900_000, incentivePct: 0, monthlyTarget: 40 };
const fileForm = (bytes: Uint8Array, type: string, field = "file") => { const f = new FormData(); f.set(field, new File([new Uint8Array(bytes)], "x", { type })); return f; };

describe("HRMS hardening (Phase 1)", () => {
  beforeAll(async () => {
    await resetDb();
    process.env.SESSION_SECRET ||= "test-only-secret-0123456789abcdef0123";
    admin = await me((await mk("MS-001", "Asha Admin", "super_admin", "admin", 1)).id);
    hr = await me((await mk("MS-002", "Hari HR", "employee", "hr", 2)).id);
    hr2 = await me((await mk("MS-003", "Hema HR", "employee", "hr", 3)).id);
    emp = await me((await mk("MS-004", "Esha Employee", "employee", "employee", 4)).id);
    await mk("MS-005", "Tara Temp", "employee", "employee", 5, { mustChangePassword: true });
  });
  beforeEach(() => jar.clear());

  describe("first-sign-in gate on the server", () => {
    it("a temporary-password session can only change its password", async () => {
      await signIn("MS-005", PW);
      const blocked = await hrRun(async () => "data");
      expect(blocked).toEqual({ ok: false, error: GATE_MESSAGE });
      expect(await hrRun(async () => "kyc", undefined, { during: ["kyc"] })).toEqual({ ok: false, error: GATE_MESSAGE });
      expect(await hrRun(async () => "pw", undefined, { during: ANY_STEP })).toMatchObject({ ok: true, data: "pw" });
      // File and data routes see nobody until the step is done.
      expect(await getReadyMe()).toBeNull();
      expect(await getReadyMe(["docs"])).toBeNull();
      expect(await getReadyMe(["password"])).not.toBeNull();
    });
    it("opens everything once the steps are done", async () => {
      await db.hrProfile.updateMany({ where: { staff: { empNo: "MS-005" } }, data: { mustChangePassword: false } });
      await signIn("MS-005", PW);
      expect(await hrRun(async () => "data")).toMatchObject({ ok: true, data: "data" });
      expect(await getReadyMe()).not.toBeNull();
    });
  });

  describe("no acting on your own records", () => {
    it("HR can't edit their own employment record (pay, role, manager); another HR or the super admin can", async () => {
      await expect(updateEmployee(hr, hr.id, edit)).rejects.toThrow(/Someone else has to edit your own employment record/);
      expect((await db.hrProfile.findUniqueOrThrow({ where: { staffId: hr.id } })).ctc).toBe(600000);
      await updateEmployee(hr2, hr.id, { ...edit, ctc: 660000 });
      expect((await db.hrProfile.findUniqueOrThrow({ where: { staffId: hr.id } })).ctc).toBe(660000);
      await updateEmployee(admin, admin.id, { ...edit, role: "employee", ctc: 1 }); // the super admin owns the system
    });
    it("HR can't change their own leave balance", async () => {
      await expect(grantLeave(hr, hr.id, "casual", 10)).rejects.toThrow(/your own leave balance/);
      await grantLeave(hr, emp.id, "casual", 1);
      expect(((await db.hrProfile.findUniqueOrThrow({ where: { staffId: emp.id } })).leaveExtra as Record<string, number>).casual).toBe(1);
    });
    it("a payroll holder can't confirm their own bank account or change their own loss-of-pay days", async () => {
      const fin = { ...hr, role: "finance" as const };
      await expect(confirmBank(fin, fin.id)).rejects.toThrow(/your own bank account/);
      await confirmBank(fin, emp.id);
      await expect(processPayroll(fin, "2026-10", { [fin.id]: 7.5 })).rejects.toThrow(/your own loss-of-pay/);
      expect(await db.hrPayslip.count()).toBe(0);
      await expect(processPayroll(emp, "2026-10", {})).rejects.toThrow(/role can’t/);
    });
  });

  describe("uploads are checked by content, not by the name the browser gives", () => {
    const fakePdf = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    const realPdf = new TextEncoder().encode("%PDF-1.4 real");
    it("employee documents", async () => {
      const f = fileForm(fakePdf, "application/pdf"); f.set("kind", "Address proof");
      await expect(uploadDoc(emp, f)).rejects.toThrow(/isn’t really a PDF/);
      const ok = fileForm(realPdf, "application/pdf"); ok.set("kind", "Address proof");
      await uploadDoc(emp, ok);
      expect(await db.hrDocument.count({ where: { staffId: emp.id } })).toBe(1);
    });
    it("reimbursement bills", async () => {
      const f = fileForm(fakePdf, "application/pdf", "bill"); f.set("type", "Travel"); f.set("amount", "500");
      await expect(submitClaim(emp, f)).rejects.toThrow(/isn’t really a PDF/);
      expect(await db.hrClaim.count()).toBe(0);
    });
  });

  it("opening full Aadhaar and PAN numbers is throttled per HR person, and the refusal is audited", async () => {
    const body = "23412341234";
    await saveKycNumbers(emp, { aadhaar: body + verhoeffDigit(body), pan: "ABCPE1234K", consent: true });
    for (let i = 0; i < 30; i++) await revealKyc(hr2, emp.id);
    await expect(revealKyc(hr2, emp.id)).rejects.toThrow(/a lot of Aadhaar and PAN numbers/);
    expect(await db.staffAudit.count({ where: { staffId: hr2.id, action: "HRMS · KYC numbers opened" } })).toBe(30);
    expect(await db.staffAudit.count({ where: { staffId: hr2.id, action: "HRMS · KYC numbers refused" } })).toBe(1);
    await expect(revealKyc(hr, emp.id)).resolves.toMatchObject({ pan: "ABCPE1234K" }); // per person, not global
  });

  it("payslips and salary revisions can't be edited or deleted in the database", async () => {
    const slip = await db.hrPayslip.create({ data: { staffId: emp.id, month: "2026-09", workDays: 26, lopDays: 0, basic: 1, hra: 1, special: 1, incentive: 0, reimburse: 0, encash: 0, gratuity: 0, gross: 3, pf: 0, esi: 0, pt: 0, tds: 0, lop: 0, net: 3, status: "paid", runBy: admin.id } });
    await expect(db.hrPayslip.update({ where: { id: slip.id }, data: { net: 3_000_000 } })).rejects.toThrow(/append-only|not allowed|cannot|block/i);
    await expect(db.hrPayslip.delete({ where: { id: slip.id } })).rejects.toThrow();
    const rev = await db.hrSalaryRevision.findFirstOrThrow({ where: { staffId: hr.id } });
    await expect(db.hrSalaryRevision.update({ where: { id: rev.id }, data: { toCtc: 1 } })).rejects.toThrow();
    await expect(db.hrSalaryRevision.delete({ where: { id: rev.id } })).rejects.toThrow();
    expect((await db.hrPayslip.findUniqueOrThrow({ where: { id: slip.id } })).net).toBe(3);
  });
});

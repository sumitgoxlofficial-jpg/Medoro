import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Enterprise HRMS Phase 3: per-person access (grant/deny with expiry, re-read by every action), multi-step approvals with
// separation of duties, delegation and escalation, salary changes through approval, and two-step sign-in for privileged roles.
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => (v ? jar.set(k, v) : jar.delete(k)), delete: (k: string | { name: string }) => jar.delete(typeof k === "string" ? k : k.name) }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.9", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { TOTP, Secret } from "otpauth";
import { db } from "@/server/db";
import { hashPassword } from "@/server/auth";
import { openSecret } from "@/server/totp";
import { can, getMe, holders, hrRun, invalidateSettings, loadPerms, mfaConfirm, mfaStart, signIn, GATE_MESSAGE, type Me } from "@/staff/hrms/auth";
import { gateOf } from "@/staff/hrms/gate";
import { effectivePerms, grantsFor } from "@/staff/hrms/access";
import { accessGrants, addGrant, approvalsFor, cancelApproval, cancelDelegation, decideApproval, delegate, escalationTick, requestApproval, revokeGrant } from "@/staff/hrms/approvals";
import { updateEmployee } from "@/staff/hrms/people";
import { timeline } from "@/staff/hrms/org";
import { DEFAULT_SETTINGS } from "@/staff/hrms/constants";
import { addDays, todayISO } from "@/lib/dates";
import { resetDb } from "./helpers";

const PW = "long-enough-password-1";
let admin: Me, hr: Me, mgr: Me, emp: Me, dele: Me, solo: Me;
const me = async (id: string): Promise<Me> => {
  const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } });
  const role = u.role === "super_admin" ? "admin" as const : u.hr!.role;
  const g = (await grantsFor([id])).get(id);
  return { id, empNo: u.empNo, name: u.name, first: u.name.split(" ")[0], email: u.email, staffRole: u.role, role, perms: effectivePerms(role, await loadPerms(), g), grants: g, sessionId: "t", phone: u.phone, personalEmail: "", dept: "", designation: "", photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true, kycSubmitted: true, kycSkipped: false, kycVerified: true };
};
let n = 0;
const mk = async (name: string, role: "super_admin" | "employee", hrRole: "admin" | "hr" | "employee", managerId: string | null = null) =>
  (await db.staffUser.create({ data: { empNo: `MS-${200 + ++n}`, name, email: `${name.split(" ")[0].toLowerCase()}@medoro.in`, kind: "team", phone: "96000000" + String(n).padStart(2, "0"), role, status: "active", passwordHash: await hashPassword(PW), hr: { create: { role: hrRole, managerId, ctc: 500000, joinDate: new Date("2025-01-06"), profileDone: true, docsAcceptedAt: new Date(), kycSubmittedAt: new Date() } } } })).id;
const setSettings = async (v: Partial<typeof DEFAULT_SETTINGS>) => { await db.hrSetting.upsert({ where: { key: "settings" }, update: { value: { ...DEFAULT_SETTINGS, ...v } }, create: { key: "settings", value: { ...DEFAULT_SETTINGS, ...v } } }); invalidateSettings(); };
const pendingStep = async (id: string) => (await db.hrApprovalStep.findFirstOrThrow({ where: { approvalId: id, status: "pending" } }));

describe("HRMS access, approvals and two-step sign-in (Phase 3)", () => {
  beforeAll(async () => {
    await resetDb();
    process.env.SESSION_SECRET ||= "test-only-secret-0123456789abcdef0123";
    admin = await me(await mk("Asha Admin", "super_admin", "admin"));
    hr = await me(await mk("Hari HR", "employee", "hr"));
    mgr = await me(await mk("Mona Manager", "employee", "employee"));
    emp = await me(await mk("Esha Employee", "employee", "employee", mgr.id));
    dele = await me(await mk("Dev Deputy", "employee", "employee"));
    solo = await me(await mk("Sohan Solo", "employee", "employee"));
  });
  beforeEach(() => jar.clear());

  describe("individual access", () => {
    it("only the super admin changes it; a grant adds a module, a deny removes one and always wins", async () => {
      await expect(addGrant(hr, { staffId: emp.id, module: "payroll", effect: "grant", reason: "month-end cover" })).rejects.toThrow(/Only the super admin/);
      await expect(addGrant(admin, { staffId: admin.id, module: "payroll", effect: "grant", reason: "month-end cover" })).rejects.toThrow(/already has every module/);
      await expect(addGrant(admin, { staffId: emp.id, module: "payroll", effect: "grant", reason: "x" })).rejects.toThrow(/Say why/);
      const g = await addGrant(admin, { staffId: emp.id, module: "payroll", effect: "grant", reason: "month-end cover", until: addDays(todayISO(), 3) });
      expect(can(await me(emp.id), "payroll")).toBe(true);
      expect(await holders("payroll")).toContain(emp.id);
      await addGrant(admin, { staffId: hr.id, module: "attendance", effect: "deny", reason: "attendance moves to the new team lead" });
      expect(can(await me(hr.id), "attendance")).toBe(false);
      expect(await holders("attendance")).not.toContain(hr.id);
      await addGrant(admin, { staffId: hr.id, module: "attendance", effect: "grant", reason: "a grant can't beat a deny" });
      expect(can(await me(hr.id), "attendance")).toBe(false);
      await revokeGrant(admin, g);
      expect(can(await me(emp.id), "payroll")).toBe(false);
      expect((await accessGrants(admin)).find((x) => x.id === g)).toMatchObject({ live: false, revoked: true });
      for (const r of await db.hrAccessGrant.findMany({ where: { staffId: hr.id, revokedAt: null } })) await revokeGrant(admin, r.id);
      expect(can(await me(hr.id), "attendance")).toBe(true);
    });
    it("an expired grant no longer applies, and grant rows can't be deleted", async () => {
      const id = await addGrant(admin, { staffId: emp.id, module: "reports", effect: "grant", reason: "quarterly report" });
      await db.hrAccessGrant.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect(can(await me(emp.id), "reports")).toBe(false);
      await expect(db.hrAccessGrant.delete({ where: { id } })).rejects.toThrow(/keeps history/);
    });
    it("every action re-reads grants (a revoke takes effect on the next action, not the next sign-in)", async () => {
      await signIn(emp.empNo, PW);
      const id = await addGrant(admin, { staffId: emp.id, module: "reports", effect: "grant", reason: "quarterly report" });
      expect(await hrRun(async (m) => can(m, "reports"))).toMatchObject({ ok: true, data: true });
      await revokeGrant(admin, id);
      expect(await hrRun(async (m) => can(m, "reports"))).toMatchObject({ ok: true, data: false });
    });
  });

  describe("approvals", () => {
    it("temporary access: manager then super admin; nobody decides their own; the grant is made only at the end", async () => {
      const id = await requestApproval(emp, "access", { module: "recruitment", days: 5, reason: "help with campus hiring this week" });
      expect((await pendingStep(id)).approverId).toBe(mgr.id);
      await expect(decideApproval(emp, id, true)).rejects.toThrow(/Someone else/);
      await expect(decideApproval(admin, id, true)).rejects.toThrow(/isn’t waiting for you/); // the manager step is the manager's
      expect((await approvalsFor(mgr)).waiting.map((a) => a.id)).toContain(id);
      expect(await decideApproval(mgr, id, true)).toBe("next");
      expect(await db.hrAccessGrant.count({ where: { staffId: emp.id, module: "recruitment" } })).toBe(0);
      expect(await decideApproval(admin, id, true)).toBe("applied");
      const g = await db.hrAccessGrant.findFirstOrThrow({ where: { staffId: emp.id, module: "recruitment" } });
      expect(g.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 4 * 86400_000);
      expect(can(await me(emp.id), "recruitment")).toBe(true);
      await expect(decideApproval(admin, id, true)).rejects.toThrow(/already decided/);
      await expect(db.hrApproval.delete({ where: { id } })).rejects.toThrow(/keeps history/);
    });
    it("salary change: rejected needs a reason and changes nothing; approved changes CTC, revision and history together", async () => {
      await expect(requestApproval(hr, "ctc_change", { staffId: hr.id, toCtc: 999999, reason: "my own raise please" })).rejects.toThrow(/your own salary/);
      await expect(requestApproval(emp, "ctc_change", { staffId: solo.id, toCtc: 600000, reason: "deserves a raise this year" })).rejects.toThrow(/Only HR or Payroll/);
      const r1 = await requestApproval(hr, "ctc_change", { staffId: emp.id, toCtc: 600000, reason: "market correction for the role" });
      await expect(requestApproval(hr, "ctc_change", { staffId: emp.id, toCtc: 650000, reason: "market correction for the role" })).rejects.toThrow(/already waiting/);
      await decideApproval(mgr, r1, true);
      await expect(decideApproval(admin, r1, false, "")).rejects.toThrow(/why/);
      await decideApproval(admin, r1, false, "Wait for the appraisal cycle");
      expect((await db.hrProfile.findUniqueOrThrow({ where: { staffId: emp.id } })).ctc).toBe(500000);
      expect((await db.hrApproval.findUniqueOrThrow({ where: { id: r1 } })).status).toBe("rejected");
      const r2 = await requestApproval(hr, "ctc_change", { staffId: emp.id, toCtc: 600000, reason: "after the appraisal cycle" });
      await decideApproval(mgr, r2, true); await decideApproval(admin, r2, true);
      expect((await db.hrProfile.findUniqueOrThrow({ where: { staffId: emp.id } })).ctc).toBe(600000);
      expect(await db.hrSalaryRevision.findFirst({ where: { staffId: emp.id, toCtc: 600000, byId: hr.id } })).not.toBeNull();
      expect((await timeline(hr, emp.id))[0]).toMatchObject({ type: "pay", changes: { ctc: [500000, 600000] } });
    });
    it("skips a manager step when there is no manager, and the requester can withdraw", async () => {
      const id = await requestApproval(hr, "ctc_change", { staffId: solo.id, toCtc: 550000, reason: "role grew to cover two shifts" });
      const steps = await db.hrApprovalStep.findMany({ where: { approvalId: id }, orderBy: { seq: "asc" } });
      expect(steps.map((s) => s.status)).toEqual(["skipped", "pending"]);
      await expect(cancelApproval(mgr, id)).rejects.toThrow(/Only a request you made/);
      await cancelApproval(hr, id);
      expect((await db.hrApproval.findUniqueOrThrow({ where: { id } })).status).toBe("cancelled");
      await expect(decideApproval(admin, id, true)).rejects.toThrow(/already decided/);
    });
    it("a delegate decides while the delegation lasts", async () => {
      const id = await requestApproval(emp, "access", { module: "tasks", days: 2, reason: "assign tasks while the lead is away" });
      await expect(decideApproval(dele, id, true)).rejects.toThrow(/isn’t waiting for you/);
      await expect(delegate(mgr, { toId: mgr.id, from: todayISO(), to: todayISO() })).rejects.toThrow(/other than yourself/);
      const dl = await delegate(mgr, { toId: dele.id, from: todayISO(), to: addDays(todayISO(), 3) });
      expect((await approvalsFor(dele)).waiting.map((a) => a.id)).toContain(id);
      await cancelDelegation(mgr, dl);
      await expect(decideApproval(dele, id, true)).rejects.toThrow(/isn’t waiting for you/);
      await delegate(mgr, { toId: dele.id, from: todayISO(), to: addDays(todayISO(), 3) });
      expect(await decideApproval(dele, id, true)).toBe("next");
      expect((await db.hrApprovalStep.findFirstOrThrow({ where: { approvalId: id, seq: 1 } })).decidedBy).toBe(dele.id);
    });
    it("escalates an overdue step once", async () => {
      const step = await db.hrApprovalStep.findFirstOrThrow({ where: { status: "pending" } });
      await db.hrApprovalStep.update({ where: { id: step.id }, data: { dueAt: new Date(Date.now() - 3600_000) } });
      const before = await db.hrNotification.count({ where: { staffId: admin.id } });
      expect(await escalationTick()).toBe(1);
      expect(await db.hrNotification.count({ where: { staffId: admin.id } })).toBeGreaterThan(before);
      expect(await escalationTick()).toBe(0);
    });
    it("with salary changes under approval, HR can't change a CTC directly (the super admin still can)", async () => {
      await setSettings({ ctcNeedsApproval: true });
      const base = { dept: "Ops", designation: "Executive", role: "employee" as const, empType: "Full-time" as const, location: "", incentivePct: 0, monthlyTarget: 40, managerId: null };
      await expect(updateEmployee(hr, solo.id, { ...base, ctc: 700000 })).rejects.toThrow(/need approval/);
      await updateEmployee(hr, solo.id, { ...base, ctc: 500000, designation: "Senior Executive" }); // other edits still work
      await updateEmployee(admin, solo.id, { ...base, ctc: 700000 });
      expect((await db.hrProfile.findUniqueOrThrow({ where: { staffId: solo.id } })).ctc).toBe(700000);
      await setSettings({});
    });
  });

  describe("two-step sign-in for privileged roles", () => {
    it("when required, HR must set up an authenticator before anything else; then sign-in asks for the code", async () => {
      await setSettings({ mfaPrivileged: true });
      await signIn(hr.empNo, PW);
      const m = (await getMe())!;
      expect(m.mfaSetup).toBe(true);
      expect(gateOf(m)).toBe("mfa");
      expect(await hrRun(async () => "x")).toEqual({ ok: false, error: GATE_MESSAGE });
      // An ordinary employee is not asked.
      jar.clear(); await signIn(emp.empNo, PW); expect((await getMe())!.mfaSetup).toBe(false);
      jar.clear(); await signIn(hr.empNo, PW);
      const start = await hrRun((x) => mfaStart(x), undefined, { during: ["mfa"] });
      expect(start.ok).toBe(true);
      const pending = (await db.hrProfile.findUniqueOrThrow({ where: { staffId: hr.id } })).totpPending!;
      const code = new TOTP({ secret: Secret.fromBase32(openSecret(pending)), digits: 6, period: 30 }).generate();
      expect(await hrRun((x) => mfaConfirm(x, "000000"), undefined, { during: ["mfa"] })).toMatchObject({ ok: false });
      expect(await hrRun((x) => mfaConfirm(x, code), undefined, { during: ["mfa"] })).toMatchObject({ ok: true });
      expect((await getMe())!.mfaSetup).toBe(false);
      expect(await hrRun(async () => "x")).toMatchObject({ ok: true });
      jar.clear();
      expect(await signIn(hr.empNo, PW)).toEqual({ next: "totp" });
      await setSettings({});
    });
  });
});

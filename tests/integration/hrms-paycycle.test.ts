import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => (v ? jar.set(k, v) : jar.delete(k)), delete: (k: string) => jar.delete(k) }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.9", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { loadPerms, type Me } from "@/staff/hrms/auth";
import { confirmBank, createEmployee, saveProfile, updateEmployee } from "@/staff/hrms/people";
import { bankFile, payrollFor, payrollReport, processPayroll, payslip, bankStatus } from "@/staff/hrms/pay";
import { seal } from "@/server/vault";
import { dateOnly } from "@/lib/dates";
import { resetDb } from "./helpers";

let hr: Me;
const mkMe = async (id: string): Promise<Me> => { const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } }); return { id, empNo: u.empNo, name: u.name, first: u.name.split(" ")[0], email: u.email, staffRole: u.role, role: u.hr!.role, perms: await loadPerms(), sessionId: "t", phone: u.phone, personalEmail: "", dept: "", designation: "", photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true, kycSubmitted: true, kycVerified: true }; };
const input = (name: string, n: number, joinDate: string) => ({ name, personalEmail: `p${n}@gmail.com`, phone: `98760000${String(n).padStart(2, "0")}`, dept: "Support", designation: "Executive", role: "employee" as const, empType: "Full-time" as const, joinDate, ctc: 600000, location: "", managerId: null, incentivePct: 0 });
const bank = (staffId: string, holder: string) => db.hrProfile.update({ where: { staffId }, data: { bankAccountSealed: new Uint8Array(seal("123456789012")), bankLast4: "9012", bankIfsc: "HDFC0001234", bankHolder: holder, bankConfirmedAt: null } });
const at = (iso: string) => vi.useFakeTimers({ toFake: ["Date"] }) && vi.setSystemTime(new Date(iso));
afterEach(() => { vi.useRealTimers(); });

beforeAll(async () => {
  await resetDb();
  process.env.SESSION_SECRET ||= "test-only-secret-0123456789abcdef0123";
  const u = await db.staffUser.create({ data: { empNo: "MS-001", name: "Hari HR", email: "hari@medoro.in", kind: "team", phone: "9820000001", role: "employee", status: "active", hr: { create: { role: "hr", profileDone: true } } } });
  hr = await mkMe(u.id);
});

describe("pay cycles from the joining day, and salary only into the employee's own bank account", () => {
  it("a new joiner is paid a month after joining, for their own cycle (join 13 Nov 2026: first salary due Sun 13 Dec, paid Fri 11 Dec)", async () => {
    const r = await createEmployee(hr, input("Riya Sharma", 1, "2026-11-13"));
    expect(r.firstSalary).toBe("2026-12-11");
    const staff = await db.staffUser.findUniqueOrThrow({ where: { empNo: r.empNo }, include: { hr: true } });
    expect(staff.hr!.payCycleDay).toBe(13);
    await db.hrProfile.update({ where: { staffId: r.id }, data: { createdAt: new Date("2026-11-13T00:00:00Z") } });
    await bank(r.id, "Riya Sharma");
    // They checked in on every working day of their first cycle (Mon-Fri, 13 Nov to 12 Dec: 21 days).
    for (let d = new Date("2026-11-13T00:00:00Z"); d <= new Date("2026-12-12T00:00:00Z"); d = new Date(d.getTime() + 86_400_000)) {
      if (![0, 6].includes(d.getUTCDay())) await db.hrAttendance.create({ data: { staffId: r.id, day: d, inAt: new Date(d.getTime() + 4 * 3600_000), status: "present" } });
    }

    // Nothing is paid in November for someone who joined on the 13th.
    at("2026-11-30T06:00:00Z");
    expect((await payrollFor(hr, "2026-11")).lines.some((l) => l.staffId === r.id)).toBe(false);
    // December pays 13 Nov to 12 Dec, due 13 Dec. 12 Dec is a Saturday, so it opens on Friday the 11th.
    at("2026-12-10T06:00:00Z");
    let run = await payrollFor(hr, "2026-12");
    const line = run.lines.find((l) => l.staffId === r.id)!;
    expect(line).toMatchObject({ from: "2026-11-13", to: "2026-12-12", payDate: "2026-12-11", opens: "2026-12-11", ready: false, cycleDay: 13, status: "draft" });
    expect(line).toMatchObject({ workDays: 21, lopDays: 0 }); // no days before joining in their own cycle: a full month
    await expect(processPayroll(hr, "2026-12")).rejects.toThrow(/preview/);
    at("2026-12-11T06:00:00Z");
    run = await payrollFor(hr, "2026-12");
    expect(run.lines.find((l) => l.staffId === r.id)).toMatchObject({ ready: true });
    expect(await processPayroll(hr, "2026-12")).toBeGreaterThanOrEqual(1);
    const slip = await db.hrPayslip.findFirstOrThrow({ where: { staffId: r.id, month: "2026-12" } });
    expect([slip.periodFrom!.toISOString().slice(0, 10), slip.periodTo!.toISOString().slice(0, 10), slip.payDate!.toISOString().slice(0, 10)]).toEqual(["2026-11-13", "2026-12-12", "2026-12-11"]);
    expect(slip.net).toBeGreaterThan(0);
    expect(await payslip(hr, slip.id)).toMatchObject({ period: "13 Nov to 12 Dec 2026", payDate: "2026-12-11" });
    expect((await bankFile(hr, "2026-12")).text).toMatch(/Salary 13 Nov to 12 Dec 2026,2026-12-11/);
    expect((await payrollReport(hr, "2026-12")).text).toMatch(/2026-11-13,2026-12-12,2026-12-11/);
    // January is the next cycle, 13 Dec to 12 Jan, due 13 Jan.
    at("2027-01-12T06:00:00Z");
    expect((await payrollFor(hr, "2027-01")).lines.find((l) => l.staffId === r.id)).toMatchObject({ from: "2026-12-13", to: "2027-01-12", payDate: "2027-01-13", status: "draft" });
    // Once paid, the cycle can't be changed.
    await expect(updateEmployee(hr, r.id, { dept: "Support", designation: "Executive", role: "employee", empType: "Full-time", location: "", ctc: 600000, incentivePct: 0, monthlyTarget: 40, payCycleDay: 1 })).rejects.toThrow(/paid already/);
  });

  it("someone paid by calendar month keeps that, and HR can set a cycle until they are paid", async () => {
    const r = await createEmployee(hr, input("Calendar Person", 2, "2026-01-05"));
    await db.hrProfile.update({ where: { staffId: r.id }, data: { payCycleDay: 0 } });
    await bank(r.id, "Calendar Person");
    at("2026-12-31T06:00:00Z");
    expect((await payrollFor(hr, "2026-12")).lines.find((l) => l.staffId === r.id)).toMatchObject({ from: "2026-12-01", to: "2026-12-31", payDate: "2026-12-31", cycleDay: 0 });
    await updateEmployee(hr, r.id, { dept: "Support", designation: "Executive", role: "employee", empType: "Full-time", location: "", ctc: 600000, incentivePct: 0, monthlyTarget: 40, payCycleDay: 5 });
    expect((await payrollFor(hr, "2026-12")).lines.find((l) => l.staffId === r.id)).toMatchObject({ from: "2026-11-05", to: "2026-12-04", payDate: "2026-12-04" });
  });

  it("salary only goes into the employee's own account: details must exist and the holder must be them, unless HR confirms", async () => {
    const mkLine = async (name: string, n: number) => { const r = await createEmployee(hr, input(name, n, "2026-01-05")); await db.hrProfile.update({ where: { staffId: r.id }, data: { payCycleDay: 0 } }); return r.id; };
    const none = await mkLine("No Bank", 3), initials = await mkLine("Asha Verma", 4), other = await mkLine("Meera Joshi", 5);
    await bank(initials, "A Verma"); // initials count as the same name
    await bank(other, "Rohan Mehta"); // someone else's account
    at("2026-12-31T06:00:00Z");
    const lines = async () => new Map((await payrollFor(hr, "2026-12")).lines.map((l) => [l.staffId, l]));
    const m = await lines();
    expect(m.get(none)).toMatchObject({ ready: false, bankIssue: "No bank account saved.", canConfirmBank: false });
    expect(m.get(initials)).toMatchObject({ ready: true, bankIssue: "" });
    expect(m.get(other)).toMatchObject({ ready: false, canConfirmBank: true });
    expect(m.get(other)!.bankIssue).toMatch(/Rohan Mehta.*isn’t this employee’s name/);
    // Processing pays only the people who are ready; the rest stay draft and the note says why.
    const before = await db.hrPayslip.count();
    expect(await processPayroll(hr, "2026-12")).toBeGreaterThanOrEqual(1);
    expect(await db.hrPayslip.count({ where: { staffId: initials } })).toBe(1);
    expect(await db.hrPayslip.count({ where: { staffId: { in: [none, other] } } })).toBe(0);
    expect(await db.hrPayslip.count()).toBeGreaterThan(before);
    const run = await payrollFor(hr, "2026-12");
    expect(run.note).toMatch(/Fix the bank account shown against/); // nobody else is ready, only the blocked people are left
    // HR confirms a joint account; changing the account later takes the confirmation away.
    await expect(confirmBank({ ...hr, perms: { ...hr.perms, hr: [] } }, other)).rejects.toThrow(/role can’t/);
    await confirmBank(hr, other);
    expect((await lines()).get(other)).toMatchObject({ ready: true });
    await db.hrProfile.update({ where: { staffId: other }, data: { dob: dateOnly("1999-01-01") } });
    const meera = await mkMe(other);
    await saveProfile(meera, { phone: "9876000005", personalEmail: "", dob: "1999-01-01", gender: "", address: "x", emergencyName: "a", emergencyPhone: "9811111111", bloodGroup: "", bankHolder: "Meera Joshi", bankAccount: "999988887777", bankIfsc: "HDFC0001234", pan: "", uan: "" });
    expect((await db.hrProfile.findUniqueOrThrow({ where: { staffId: other } })).bankConfirmedAt).toBeNull();
    expect((await lines()).get(other)).toMatchObject({ ready: true }); // now their own name
    expect(await confirmBank(hr, none).catch((e: Error) => e.message)).toMatch(/no bank account/);
  });

  it("the rule as a function", () => {
    const ok = { bankLast4: "9012", bankIfsc: "HDFC0001234", bankHolder: "Riya Sharma", bankConfirmedAt: null, bankAccountSealed: new Uint8Array([1]) };
    expect(bankStatus(ok, "Riya Kumar Sharma").ok).toBe(true);
    expect(bankStatus({ ...ok, bankHolder: "Sam Singh" }, "Riya Sharma")).toMatchObject({ ok: false, fixable: true });
    expect(bankStatus({ ...ok, bankHolder: "Sam Singh", bankConfirmedAt: new Date() }, "Riya Sharma").ok).toBe(true);
    expect(bankStatus({ ...ok, bankIfsc: "" }, "Riya Sharma").ok).toBe(false);
    expect(bankStatus({ ...ok, bankHolder: " " }, "Riya Sharma").issue).toMatch(/no holder name/);
    expect(bankStatus(null, "Riya Sharma").ok).toBe(false);
  });
});

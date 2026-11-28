import { beforeAll, describe, expect, it, vi } from "vitest";

// Enterprise HRMS Phase 6: shifts and the roster (newest entry wins, history kept), lateness from the rostered shift,
// overtime from real check-ins, and payroll readiness before a run.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers({ "x-forwarded-for": "10.0.0.9" }) }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { invalidateSettings, loadPerms, type Me } from "@/staff/hrms/auth";
import { DEFAULT_SETTINGS } from "@/staff/hrms/constants";
import { checkIn } from "@/staff/hrms/time";
import { archiveShift, assignShift, monthEnd, overtimeReport, payrollReadiness, rosterView, saveShift, shiftMinutes, shiftOn } from "@/staff/hrms/shifts";
import { seal } from "@/server/vault";
import { dateOnly } from "@/lib/dates";
import { resetDb } from "./helpers";

let hr: Me, a: Me, b: Me, fin: Me;
const me = async (id: string): Promise<Me> => {
  const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } });
  return { id, empNo: u.empNo, name: u.name, first: u.name.split(" ")[0], email: u.email, staffRole: u.role, role: u.hr!.role, perms: await loadPerms(), sessionId: "t", phone: u.phone, personalEmail: "", dept: "", designation: "", photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true, kycSubmitted: true, kycSkipped: false, kycVerified: true };
};
let n = 0;
const mk = async (name: string, role: "hr" | "employee" | "finance", extra: Record<string, unknown> = {}) => (await db.staffUser.create({ data: { empNo: `MS-${500 + ++n}`, name, email: `${name.split(" ")[0].toLowerCase()}@medoro.in`, kind: "team", phone: "93000000" + String(n).padStart(2, "0"), role: "employee", status: "active", hr: { create: { role, profileDone: true, ctc: 600000, joinDate: new Date("2025-01-06"), ...extra } } } })).id;
const at = (iso: string) => { vi.setSystemTime(new Date(iso)); };

describe("HRMS shifts and workforce operations (Phase 6)", () => {
  let day: string, night: string;
  beforeAll(async () => {
    await resetDb();
    await db.hrSetting.upsert({ where: { key: "settings" }, update: { value: { ...DEFAULT_SETTINGS, lateAfter: "10:00" } }, create: { key: "settings", value: { ...DEFAULT_SETTINGS, lateAfter: "10:00" } } }); invalidateSettings();
    hr = await me(await mk("Hari HR", "hr"));
    fin = await me(await mk("Farah Finance", "finance"));
    a = await me(await mk("Anil Early", "employee", { bankAccountSealed: new Uint8Array(seal("123456789012")), bankLast4: "9012", bankIfsc: "HDFC0001234", bankHolder: "Anil Early", uan: "100200300400", panMasked: "AB•••••34K" }));
    b = await me(await mk("Bina Night", "employee", { ctc: 0 }));
  });

  it("works out shift lengths and month ends", () => {
    expect(shiftMinutes("09:30", "18:30")).toBe(540);
    expect(shiftMinutes("22:00", "06:00")).toBe(480);
    expect(monthEnd("2026-02")).toBe("2026-02-28");
    expect(monthEnd("2026-12")).toBe("2026-12-31");
  });

  it("only Attendance holders manage shifts; bad shifts are refused", async () => {
    await expect(saveShift(a, null, { name: "Mine", start: "09:00", end: "17:00" })).rejects.toThrow(/role can’t/);
    await expect(saveShift(hr, null, { name: "Zero", start: "09:00", end: "09:00" })).rejects.toThrow(/different time/);
    await expect(saveShift(hr, null, { name: "Short", start: "09:00", end: "09:20", breakMin: 30 })).rejects.toThrow(/break is longer/);
    day = await saveShift(hr, null, { name: "Early", start: "08:00", end: "16:30", graceMin: 15, breakMin: 30 });
    night = await saveShift(hr, null, { name: "Night", start: "22:00", end: "06:00", graceMin: 10, breakMin: 30 });
    expect(await db.hrShift.findUniqueOrThrow({ where: { id: night } })).toMatchObject({ overnight: true, workMin: 450 });
  });

  it("the newest roster entry covering a day wins; older entries are cut short and kept", async () => {
    await assignShift(hr, { staffIds: [a.id], shiftId: night, from: "2026-11-01" });
    await assignShift(hr, { staffIds: [a.id], shiftId: day, from: "2026-11-10" });
    expect((await shiftOn(a.id, "2026-11-05"))?.name).toBe("Night");
    expect((await shiftOn(a.id, "2026-11-12"))?.name).toBe("Early");
    const rows = await db.hrShiftAssignment.findMany({ where: { staffId: a.id }, orderBy: { fromDay: "asc" } });
    expect(rows.map((r) => r.toDay?.toISOString().slice(0, 10) ?? null)).toEqual(["2026-11-09", null]);
    await expect(db.hrShiftAssignment.delete({ where: { id: rows[0].id } })).rejects.toThrow(/keeps history/);
    await expect(archiveShift(hr, day)).rejects.toThrow(/still rostered/);
    await expect(assignShift(hr, { staffIds: ["nobody"], shiftId: day, from: "2026-11-10" })).rejects.toThrow(/active employees/);
    expect((await rosterView(hr, "2026-11-12")).people.find((p) => p.id === a.id)?.shiftId).toBe(day);
  });

  it("check-in lateness follows the rostered shift and its grace; others keep the company time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      at("2026-11-12T02:40:00Z"); // 08:10 India: within Early's 15 minutes' grace
      expect((await checkIn(a)).status).toBe("present");
      at("2026-11-13T02:50:00Z"); // 08:20: late on the Early shift
      expect((await checkIn(a)).status).toBe("late");
      at("2026-11-13T04:10:00Z"); // 09:40 for Bina, not rostered: company time 10:00
      expect((await checkIn(b)).status).toBe("present");
    } finally { vi.useRealTimers(); }
  });

  it("reports overtime beyond the expected time, without missed check-outs", async () => {
    await db.hrAttendance.updateMany({ where: { staffId: a.id, day: dateOnly("2026-11-12") }, data: { outAt: new Date("2026-11-12T12:40:00Z") } }); // 08:10–18:10 = 600 min
    await db.hrBreak.create({ data: { staffId: a.id, kind: "lunch", startAt: new Date("2026-11-12T07:00:00Z"), endAt: new Date("2026-11-12T07:30:00Z") } });
    await db.hrAttendance.updateMany({ where: { staffId: a.id, day: dateOnly("2026-11-13") }, data: { outAt: new Date("2026-11-13T14:00:00Z"), note: "Missed check-out: closed at a full day" } });
    const r = await overtimeReport(hr, "2026-11");
    const p = r.people.find((x) => x.id === a.id)!;
    expect(p).toMatchObject({ days: 1, overtimeMin: 90 }); // 600 − 30 break = 570 worked; Early expects 510 − 30 = 480
    expect(p.lines[0]).toMatchObject({ day: "2026-11-12", workedMin: 570, expectedMin: 480 });
    await expect(overtimeReport(a, "2026-11")).rejects.toThrow(/role can’t/);
  });

  it("payroll readiness separates what blocks pay from what to check", async () => {
    await db.hrLeave.create({ data: { staffId: a.id, type: "casual", fromDay: dateOnly("2026-11-20"), toDay: dateOnly("2026-11-20"), days: 1, reason: "family", status: "pending" } });
    const r = await payrollReadiness(fin, "2026-11");
    expect(r.ready).toBe(false);
    const issues = (id: string) => r.items.filter((x) => x.staffId === id).map((x) => `${x.level}: ${x.issue}`);
    expect(issues(b.id)).toEqual(expect.arrayContaining(["block: No annual CTC on the profile.", "block: No bank account saved."]));
    expect(issues(a.id)).toEqual([expect.stringMatching(/^check: 1 leave request/), expect.stringMatching(/^check: 1 missed check-out/)]);
    await expect(payrollReadiness(a, "2026-11")).rejects.toThrow(/role can’t/);
  });
});

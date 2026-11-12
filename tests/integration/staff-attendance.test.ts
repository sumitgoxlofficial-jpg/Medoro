import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { attendanceRows, fixDay, monthOf, punchIn, punchOut, teamMonth, today } from "@/domain/identity/attendance";
import { reportRows } from "@/domain/accounting/reports";
import { periodOf } from "@/domain/accounting/service";
import { todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

describe("shop staff attendance", () => {
  beforeAll(async () => { await resetDb(); await makePharmacy(); });

  it("punches in and out once a day and shows it in my month", async () => {
    const c = await ctxFor("Cashier");
    expect((await today(c)).in).toBeNull();
    await expect(punchOut(c)).rejects.toThrow(/Punch in first/);
    await punchIn(c);
    await expect(punchIn(c)).rejects.toThrow(/already punched in/);
    const out = await punchOut(c);
    expect(out.minutes).toBeLessThan(2);
    await expect(punchOut(c)).rejects.toThrow(/already punched out/);
    const m = await monthOf(c, todayISO().slice(0, 7));
    expect(m.present).toBe(1);
    expect(m.days[0]).toMatchObject({ day: todayISO() });
    await expect(monthOf(c, "bad")).rejects.toThrow(/Pick a month/);
  });

  it("only a manager sees the team or fixes a day, and every fix is audited", async () => {
    const cashier = await ctxFor("Cashier"), owner = await ctxFor("Owner");
    await expect(teamMonth(cashier, todayISO().slice(0, 7))).rejects.toThrow();
    await expect(fixDay(cashier, { userId: cashier.userId, day: todayISO(), in: "09:00", out: "18:00", reason: "forgot" })).rejects.toThrow();
    await expect(monthOf(cashier, todayISO().slice(0, 7), randomUUID())).rejects.toThrow(); // someone else’s month needs a manager
    const yesterday = new Date(Date.now() - 86_400_000 + 5.5 * 3600_000).toISOString().slice(0, 10);
    await expect(fixDay(owner, { userId: cashier.userId, day: "2099-01-01", in: "09:00", out: "", reason: "future" })).rejects.toThrow(/hasn’t come/);
    await expect(fixDay(owner, { userId: cashier.userId, day: yesterday, in: "18:00", out: "09:00", reason: "swapped" })).rejects.toThrow(/after the in time/);
    await fixDay(owner, { userId: cashier.userId, day: yesterday, in: "09:30", out: "18:00", reason: "Forgot to punch" });
    const team = await teamMonth(owner, todayISO().slice(0, 7), "all");
    const me = team.find((p) => p.userId === cashier.userId)!;
    expect(me.present).toBeGreaterThanOrEqual(1);
    const row = (await db.staffAttendance.findFirstOrThrow({ where: { userId: cashier.userId, day: new Date(yesterday + "T00:00:00Z") } }));
    expect(row.inAt!.toISOString()).toBe(new Date(`${yesterday}T04:00:00.000Z`).toISOString()); // 09:30 India time
    expect(row.editedBy).toBe(owner.userId);
    expect(await db.auditEvent.count({ where: { action: "Staff attendance set" } })).toBe(1);
  });

  it("the CSV report lists each person's days with hours", async () => {
    const owner = await ctxFor("Owner");
    const rows = await reportRows(owner, "staff-attendance", periodOf("month"));
    expect(rows[0]).toEqual(["Date", "Name", "Employee no.", "In", "Out", "Hours", "Note"]);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.some((r) => r[5] === "8.50")).toBe(true); // 09:30 to 18:00
    expect((await attendanceRows(owner.tenantId, owner.branchId, new Date(0), new Date(1000))).length).toBe(1); // header only
  });
});

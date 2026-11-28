import { beforeAll, describe, expect, it, vi } from "vitest";

// Enterprise HRMS Phase 5: KPIs per department/designation computed from real records with evidence and explanations,
// manual values with evidence, who sees what, and advisory suggestions that need a human review before an employee sees them.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers({ "x-forwarded-for": "10.0.0.9" }) }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { loadPerms, type Me } from "@/staff/hrms/auth";
import { computeKpis, enterManual, generateInsights, insightsFor, kpiFor, kpiScreen, resultsFor, reviewInsight, saveKpi } from "@/staff/hrms/kpi";
import { dateOnly } from "@/lib/dates";
import { resetDb } from "./helpers";

let hr: Me, mgr: Me, rep: Me, sales: Me, peer: Me;
const me = async (id: string): Promise<Me> => {
  const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } });
  return { id, empNo: u.empNo, name: u.name, first: u.name.split(" ")[0], email: u.email, staffRole: u.role, role: u.hr!.role, perms: await loadPerms(), sessionId: "t", phone: u.phone, personalEmail: "", dept: u.hr!.dept, designation: u.hr!.designation, photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true, kycSubmitted: true, kycSkipped: false, kycVerified: true };
};
let n = 0;
const mk = async (name: string, hrRole: "hr" | "employee" | "sales", dept: string, designation: string, managerId: string | null = null) =>
  (await db.staffUser.create({ data: { empNo: `MS-${400 + ++n}`, name, email: `${name.split(" ")[0].toLowerCase()}@medoro.in`, kind: "team", phone: "94000000" + String(n).padStart(2, "0"), role: hrRole === "sales" ? "sales" : "employee", status: "active", hr: { create: { role: hrRole, dept, designation, managerId, profileDone: true } } } })).id;
const task = (assigneeId: string, title: string, due: string, doneAt: string | null) => db.hrTask.create({ data: { title, assigneeId, byId: assigneeId, due: dateOnly(due), status: doneAt ? "done" : "open", doneAt: doneAt ? new Date(doneAt + "T12:00:00+05:30") : null } });
const DAY = "2026-10-15", PREV = "2026-09-15";

describe("HRMS KPIs (Phase 5)", () => {
  beforeAll(async () => {
    await resetDb();
    hr = await me(await mk("Hari HR", "hr", "HR", "HR Manager"));
    mgr = await me(await mk("Mona Manager", "employee", "Ops", "Team Lead"));
    rep = await me(await mk("Ravi Report", "employee", "Ops", "Executive", mgr.id));
    peer = await me(await mk("Pia Peer", "employee", "Ops", "Executive"));
    sales = await me(await mk("Sam Sales", "sales", "Sales", "Sales Executive"));
  });

  it("refuses company-wide KPIs and non-HR authors", async () => {
    await expect(saveKpi(hr, null, { name: "Everything", metric: "tasks_done", target: 10 })).rejects.toThrow(/no company-wide score/);
    await expect(saveKpi(rep, null, { name: "Mine", dept: "Ops", metric: "tasks_done", target: 1 })).rejects.toThrow(/role can’t/);
  });

  it("computes each KPI only for the people it applies to, from real records, with evidence and an explanation", async () => {
    const onTime = await saveKpi(hr, null, { name: "On-time delivery", dept: "Ops", designation: "Executive", metric: "tasks_on_time_pct", target: 90, weight: 60 });
    const audit = await saveKpi(hr, null, { name: "Audit score", dept: "Ops", designation: "Executive", metric: "manual", unit: "%", target: 80, weight: 40 });
    const sold = await saveKpi(hr, null, { name: "Sales closed", dept: "Sales", metric: "sales_won", target: 10, weight: 50 });
    const value = await saveKpi(hr, null, { name: "Verified sales value", dept: "Sales", metric: "sales_value", target: 100000, weight: 50 });
    for (const [t, due, done] of [["A", "2026-10-05", "2026-10-04"], ["B", "2026-10-10", "2026-10-12"], ["C", "2026-10-20", "2026-10-20"], ["D", "2026-10-25", null]] as const) await task(rep.id, t, due, done);
    for (const [d, st, amt] of [["2026-10-03", "verified", 30000], ["2026-10-09", "paid", 45000], ["2026-10-11", "pending", 20000], ["2026-10-12", "rejected", 99000], ["2026-09-30", "paid", 50000]] as const)
      await db.cpSale.create({ data: { date: dateOnly(d), pharmacy: `Pharmacy ${d}`, phone: "9" + d.replace(/-/g, "").slice(-9), product: "Pro", cycle: "y", type: "new", staffId: sales.id, status: st, amountPaise: amt * 100, ratePct: 5, commissionPaise: 0 } });
    const written = await computeKpis(hr, DAY);
    expect(written).toBe(6); // 2 Ops KPIs × 2 executives + 2 Sales KPIs × 1 salesperson; the manager and HR have none
    const r = await resultsFor(rep.id, DAY);
    const ot = r.items.find((x) => x.kpiId === onTime)!;
    expect(ot).toMatchObject({ value: 50, target: 90, score: 56, start: "2026-10-01", end: "2026-10-31" }); // A and C on time, B late, D not done
    expect(ot.explanation).toContain("2 of 4 tasks due were done on time = 50%");
    expect(ot.evidence.map((e) => e.label)).toEqual(expect.arrayContaining(["A", "B", "C", "D"]));
    expect(r.items.find((x) => x.kpiId === audit)).toMatchObject({ value: null, score: null });
    expect(r.total).toBe(56); // the manual KPI without a value is left out
    const s = await resultsFor(sales.id, DAY);
    expect(s.items.find((x) => x.kpiId === sold)).toMatchObject({ value: 3, score: 30 }); // rejected and September sales excluded
    expect(s.items.find((x) => x.kpiId === value)).toMatchObject({ value: 75000, score: 75 }); // verified + paid only
    expect((await resultsFor(mgr.id, DAY)).items).toHaveLength(0);
  });

  it("only the manager or HR enters a manual value, with evidence, and it survives recomputation", async () => {
    const kpi = (await db.hrKpi.findFirstOrThrow({ where: { metric: "manual" } })).id;
    await expect(enterManual(peer, { kpiId: kpi, staffId: rep.id, day: DAY, value: 90, note: "internal audit" })).rejects.toThrow(/manager or HR/);
    await expect(enterManual(rep, { kpiId: kpi, staffId: rep.id, day: DAY, value: 100, note: "self assessment" })).rejects.toThrow(/your own KPI/);
    await expect(enterManual(mgr, { kpiId: kpi, staffId: rep.id, day: DAY, value: 90, note: "" })).rejects.toThrow(/evidence/);
    await enterManual(mgr, { kpiId: kpi, staffId: rep.id, day: DAY, value: 72, note: "Q3 process audit report #12" });
    await computeKpis(hr, DAY);
    const r = (await resultsFor(rep.id, DAY)).items.find((x) => x.kpiId === kpi)!;
    expect(r).toMatchObject({ value: 72, score: 90 });
    expect(r.explanation).toContain("Q3 process audit report #12");
    expect((await resultsFor(rep.id, DAY)).total).toBe(70); // (56 × 60 + 90 × 40) ÷ 100
  });

  it("the person, their manager and HR see results; a colleague doesn't", async () => {
    await expect(kpiFor(peer, rep.id, DAY)).rejects.toThrow(/direct reports/);
    expect((await kpiFor(mgr, rep.id, DAY)).items.length).toBe(2);
    expect((await kpiFor(hr, rep.id, DAY)).items.length).toBe(2);
    const screen = await kpiScreen(mgr, DAY);
    expect(screen.team.map((t) => t.id)).toEqual([rep.id]);
    expect(screen.everyone).toEqual([]);
  });

  it("suggestions stay with the manager and HR until reviewed; sharing is a human decision", async () => {
    await computeKpis(hr, PREV); // September: no tasks due → no on-time value; sales 1 paid
    await db.hrProfile.update({ where: { staffId: sales.id }, data: { managerId: mgr.id } }); // Sam (sales closed 30/100) reports to Mona
    const made = await generateInsights(DAY);
    expect(made).toBeGreaterThan(0);
    expect(await generateInsights(DAY)).toBe(0); // no duplicates
    const forMgr = await insightsFor(mgr);
    expect(forMgr.some((i) => i.staffId === rep.id)).toBe(false); // Ravi's scores (56, 90) are not below 50: nothing to suggest
    const low = forMgr.find((i) => i.staffId === sales.id && i.kind === "below_target")!;
    expect(low).toMatchObject({ status: "pending", text: expect.stringContaining("Sales closed") });
    expect(low.evidence.length).toBe(3);
    expect((await insightsFor(sales)).length).toBe(0); // the employee sees nothing yet
    await expect(reviewInsight(sales, low.id, "reviewed")).rejects.toThrow(/Someone else/);
    await expect(reviewInsight(peer, low.id, "reviewed")).rejects.toThrow(/manager or HR/);
    await expect(reviewInsight(mgr, low.id, "dismissed", "")).rejects.toThrow(/why/);
    await reviewInsight(mgr, low.id, "reviewed", "Discussed: two tasks waited on IT access", true);
    const mine = (await insightsFor(sales)).filter((i) => i.mine);
    expect(mine.map((i) => i.id)).toEqual([low.id]);
    expect(mine[0]).toMatchObject({ note: "Discussed: two tasks waited on IT access", reviewedBy: "Mona Manager" });
    await expect(reviewInsight(hr, low.id, "reviewed")).rejects.toThrow(/already reviewed/);
  });
});

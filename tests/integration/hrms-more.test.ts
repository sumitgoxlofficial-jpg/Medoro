import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => (v ? jar.set(k, v) : jar.delete(k)), delete: (k: string) => jar.delete(k) }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.5", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { loadPerms, type Me } from "@/staff/hrms/auth";
import { addAsset, allAssets, issueAsset, myAssets, reportIssue, returnAsset, setAssetStatus } from "@/staff/hrms/assets";
import { addRecord, createInvoice, registers, runOverdue, setWorkflow, workflows } from "@/staff/hrms/finance";
import { processPayroll } from "@/staff/hrms/pay";
import { assignTask, deleteSprint, myProjects, projects, saveProject, saveRisk, saveSprint, setTaskSprint } from "@/staff/hrms/work";
import { addDays, todayISO } from "@/lib/dates";
import { resetDb } from "./helpers";

let admin: Me, fin: Me, emp: Me, other: Me;
const mkMe = async (id: string): Promise<Me> => { const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } }); return { id, empNo: u.empNo, name: u.name, first: u.name.split(" ")[0], email: u.email, staffRole: u.role, role: u.hr!.role, perms: await loadPerms(), sessionId: "t", phone: u.phone, personalEmail: "", dept: "", designation: "", photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true, kycSubmitted: true, kycVerified: true }; };
const mk = (empNo: string, name: string, email: string, role: "super_admin" | "employee", hr: "admin" | "employee" | "finance") =>
  db.staffUser.create({ data: { empNo, name, email, kind: "team", phone: "982000000" + empNo.slice(-1), role, status: "active", hr: { create: { role: hr, ctc: 600000, joinDate: new Date("2026-01-05"), profileDone: true, docsAcceptedAt: new Date() } } } });

beforeAll(async () => {
  await resetDb();
  process.env.SESSION_SECRET ||= "test-only-secret-0123456789abcdef0123";
  admin = await mkMe((await mk("MS-001", "Asha Admin", "asha@medoro.in", "super_admin", "admin")).id);
  fin = await mkMe((await mk("MS-002", "Fiona Finance", "fiona@medoro.in", "employee", "finance")).id);
  emp = await mkMe((await mk("MS-003", "Esha Employee", "esha@medoro.in", "employee", "employee")).id);
  other = await mkMe((await mk("MS-004", "Omar Other", "omar@medoro.in", "employee", "employee")).id);
});
beforeEach(() => jar.clear());

describe("assets", () => {
  it("HR adds and issues items; the employee sees theirs and nobody else's", async () => {
    const tag = await addAsset(admin, { name: "MacBook Pro 14", kind: "Laptop", assigneeId: emp.id });
    expect(tag).toBe("MS-AST-0001");
    const stock = await addAsset(admin, { name: "Dell Monitor", kind: "Monitor" });
    expect(stock).toBe("MS-AST-0002");
    expect((await myAssets(emp)).map((a) => a.tag)).toEqual(["MS-AST-0001"]);
    expect(await myAssets(other)).toEqual([]);
    await expect(allAssets(emp)).rejects.toThrow(/role can’t/);
    const monitor = (await allAssets(admin)).find((a) => a.tag === stock)!;
    expect(monitor.status).toBe("in_stock");
    await issueAsset(admin, monitor.id, emp.id);
    await expect(issueAsset(admin, monitor.id, other.id)).rejects.toThrow(/already issued/);
    expect((await myAssets(emp)).length).toBe(2);
    await returnAsset(admin, monitor.id);
    expect((await allAssets(admin)).find((a) => a.id === monitor.id)).toMatchObject({ assigneeId: null, status: "in_stock" });
    await expect(setAssetStatus(admin, monitor.id, "in_use")).rejects.toThrow(/Issue the item/);
  });
  it("reporting an issue raises an HR ticket, marks the item for repair, and only works on your own items", async () => {
    const mine = (await myAssets(emp))[0];
    await expect(reportIssue(other, mine.id, "screen flickers")).rejects.toThrow(/isn’t issued to you/);
    const code = await reportIssue(emp, mine.id, "The screen flickers when plugged in");
    expect(code).toMatch(/^HR-\d{4}$/);
    expect((await myAssets(emp)).find((a) => a.id === mine.id)?.status).toBe("repair");
    expect(await db.hrTicket.count({ where: { code, staffId: emp.id } })).toBe(1);
  });
});

describe("projects: sprints, risks and My Projects", () => {
  let pid = "", sid = "", taskId = "";
  it("a member sees the project and their tasks in My Projects", async () => {
    await saveProject(admin, { name: "Offline billing v2", client: "Internal", members: [emp.id], deadline: "", status: "In progress" });
    pid = (await db.hrProject.findFirstOrThrow()).id;
    await saveSprint(admin, { projectId: pid, name: "Sprint 1", start: addDays(todayISO(), -2), end: addDays(todayISO(), 5), goal: "Sync engine" });
    sid = (await db.hrSprint.findFirstOrThrow()).id;
    await assignTask(admin, { title: "Write sync tests", assigneeId: emp.id, due: addDays(todayISO(), 3), priority: "High", projectId: pid, sprintId: sid });
    taskId = (await db.hrTask.findFirstOrThrow()).id;
    const mine = await myProjects(emp);
    expect(mine).toHaveLength(1);
    expect(mine[0].mine.map((t) => t.title)).toEqual(["Write sync tests"]);
    expect(await myProjects(other)).toEqual([]);
  });
  it("sprints know their state and progress; tasks only join sprints of their own project", async () => {
    await saveProject(admin, { name: "Other project", client: "Internal", members: [], deadline: "", status: "Planning" });
    const otherProject = (await db.hrProject.findFirstOrThrow({ where: { name: "Other project" } })).id;
    await saveSprint(admin, { projectId: otherProject, name: "Elsewhere", start: todayISO(), end: addDays(todayISO(), 7), goal: "" });
    const foreign = (await db.hrSprint.findFirstOrThrow({ where: { projectId: otherProject } })).id;
    await expect(setTaskSprint(admin, taskId, foreign)).rejects.toThrow(/another project/);
    await expect(saveSprint(admin, { projectId: pid, name: "Backwards", start: "2026-12-10", end: "2026-12-01", goal: "" })).rejects.toThrow(/can’t end before/);
    const p = (await projects(admin)).find((x) => x.id === pid)!;
    expect(p.sprints[0]).toMatchObject({ name: "Sprint 1", state: "active", total: 1, done: 0 });
    await db.hrTask.update({ where: { id: taskId }, data: { status: "done", col: "done", doneAt: new Date() } });
    expect((await projects(admin)).find((x) => x.id === pid)!.sprints[0].done).toBe(1);
  });
  it("risks are kept per project and can be updated", async () => {
    await saveRisk(admin, { projectId: pid, title: "Printer drivers differ by model", level: "High", ownerId: emp.id, mitigation: "Test on 3 models" });
    const r = (await projects(admin)).find((x) => x.id === pid)!.risks;
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ level: "High", owner: "Esha Employee", status: "open" });
    await saveRisk(admin, { id: r[0].id, projectId: pid, title: r[0].title, level: "High", ownerId: emp.id, status: "mitigated", mitigation: r[0].mitigation });
    expect((await projects(admin)).find((x) => x.id === pid)!.risks[0].status).toBe("mitigated");
    await expect(saveRisk(emp, { projectId: pid, title: "Not allowed", level: "Low" })).rejects.toThrow(/role can’t/);
  });
  it("deleting a sprint keeps its tasks", async () => {
    await deleteSprint(admin, sid);
    expect((await db.hrTask.findUniqueOrThrow({ where: { id: taskId } })).sprintId).toBeNull();
  });
});

describe("accounts: more registers and workflows that really run", () => {
  it("new registers number themselves and show totals", async () => {
    await addRecord(fin, "proforma", ["", "Acme", "5000", "Pending"]);
    await addRecord(fin, "challans", ["", "Acme", "12 units", "In transit"]);
    await addRecord(fin, "deals", ["HRMS rollout", "R. Menon", "1200000", "Proposal"]);
    await addRecord(fin, "campaigns", ["Year-end push", "Email", "18400", "Running"]);
    await addRecord(fin, "vendors", ["CloudNet", "IT", "88000", "Active"]);
    const sales = await registers(fin, "fin_sales");
    expect(sales.find((x) => x.reg.id === "proforma")!.rows[0].v[0]).toBe("PI-0001");
    expect(sales.find((x) => x.reg.id === "challans")!.rows[0].v[0]).toBe("DC-0001");
    const crm = (await registers(fin, "fin_salescrm"))[0];
    expect(crm.stats.find(([l]) => l === "Total")![1]).toBe("₹12,00,000");
    await expect(registers(emp, "fin_sales")).rejects.toThrow(/role can’t/);
  });
  it("the overdue rule turns sent invoices past their due date into Overdue, once, and can be switched off", async () => {
    const mkInv = (due: string, draft = false) => createInvoice(fin, { client: "Acme", gstin: "", address: "", state: "", due, notes: "", draft, items: [{ desc: "Licence", hsn: "9983", qty: 1, rate: 1000, gst: 18 }] });
    const late = await mkInv(addDays(todayISO(), -3)), fine = await mkInv(addDays(todayISO(), 10)), draft = await mkInv(addDays(todayISO(), -3), true);
    await setWorkflow(fin, "overdue", false);
    expect(await runOverdue()).toBe(0);
    await setWorkflow(fin, "overdue", true);
    expect(await runOverdue()).toBe(1);
    const status = async (id: string) => ((await db.hrRecord.findUniqueOrThrow({ where: { id } })).data as { v: string[] }).v[3];
    expect(await status(late.id)).toBe("Overdue");
    expect(await status(fine.id)).toBe("Sent");
    expect(await status(draft.id)).toBe("Draft");
    expect(await runOverdue()).toBe(0); // already done
    const wf = await workflows(fin);
    expect(wf.find((w) => w.id === "overdue")).toMatchObject({ on: true, runs: 1 });
    expect(await db.hrNotification.count({ where: { staffId: fin.id, text: { contains: "overdue" } } })).toBeGreaterThan(0);
    await expect(setWorkflow(emp, "overdue", false)).rejects.toThrow(/role can’t/);
    await expect(setWorkflow(fin, "nonsense", true)).rejects.toThrow(/Unknown rule/);
  });
  it("processing payroll posts one salary journal for the month's net pay (when the rule is on)", async () => {
    const d = new Date(); d.setUTCDate(0); // last day of the previous month: a month that has ended
    const ym = d.toISOString().slice(0, 7);
    const before = await db.hrRecord.count({ where: { kind: "journals" } });
    await processPayroll(admin, ym, { [admin.id]: 0, [fin.id]: 0, [emp.id]: 0, [other.id]: 0 });
    const journals = await db.hrRecord.findMany({ where: { kind: "journals" } });
    expect(journals.length).toBe(before + 1);
    const j = journals[journals.length - 1].data as { v: string[] };
    const net = (await db.hrPayslip.findMany({ where: { month: ym } })).reduce((a, p) => a + p.net, 0);
    expect(j.v.slice(0, 4)).toEqual(["JV-0001", "Salaries expense", "Salaries payable", String(net)]);
    expect((await workflows(fin)).find((w) => w.id === "salaryjv")!.runs).toBe(1);
  });
});

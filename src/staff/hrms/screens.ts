import "server-only";
import { db } from "@/server/db";
import { addDays, isoOf, todayISO } from "@/lib/dates";
import { can, loadPerms, loadSettings, type Me } from "./auth";
import { usage } from "./ally";
import { listEvents, status as gcalStatus } from "./gcal";
import { HOME_OF, REGISTERS, SCREENS, canOpen, screensFor } from "./constants";
import { registers, summary, workflows } from "./finance";
import { allAssets, myAssets } from "./assets";
import { selfieIds } from "./monitor";
import { AVATARS, REACTIONS, chatList, chatPeople, myChatProfile, reviewChats, reviewPeople, syncChannels, unreadTotal } from "./chat";
import { LEAD_PLANS, allLeads, salesSummary, teamBoard } from "./leads";
import { myPayslips, payrollFor } from "./pay";
import { auditLog, departments, myProfile, notifications, roster } from "./people";
import { addMonths, claims, holidays, leaveBalances, monthFor, myLeaves, pendingApprovals, teamToday, today, whosOut } from "./time";
import { allTasks, announcements, candidates, jobs, meetings, myProjects, myTasks, performance, projects, tickets } from "./work";

const ym = () => todayISO().slice(0, 7);
const monthArg = (v: string | undefined) => (v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : ym());
const upcomingHolidays = () => holidays(todayISO(), addDays(todayISO(), 365)).then((h) => h.slice(0, 6));
const people = async () => (await roster()).map((p) => ({ id: p.id, name: p.name, empNo: p.empNo, dept: p.dept, role: p.role }));

/** What every page needs: who is signed in, their menu, bell and today's attendance. */
export async function shell(me: Me) {
  const [s, notes, att, brk, chatUnread] = await Promise.all([loadSettings(), notifications(me), today(me), db.hrBreak.findFirst({ where: { staffId: me.id, endAt: null }, orderBy: { startAt: "desc" } }), unreadTotal(me.id)]);
  return {
    me: { id: me.id, phone: me.phone, personalEmail: me.personalEmail, name: me.name, first: me.first, empNo: me.empNo, email: me.email, role: me.role, dept: me.dept, designation: me.designation, photo: me.photo, growth: me.staffRole === "sales" },
    nav: screensFor(me.role, me.perms).filter((x) => !x.hidden).map((x) => ({ id: x.id, label: x.label, icon: x.icon, group: x.group ?? "" })),
    home: HOME_OF[me.role], notes, att, onBreak: brk ? { kind: brk.kind, since: brk.startAt.toISOString() } : null, checkin: s.checkin, selfie: s.selfie, monitor: s.idleMonitor ? s.idleMinutes : 0, today: todayISO(), chatUnread,
  };
}
export type Shell = Awaited<ReturnType<typeof shell>>;

type Q = Record<string, string | undefined>;
export const loaders = {
  home: async (me: Me) => {
    const s = await loadSettings();
    const [tasks, bal, slips, ann, hols, meets, proj] = await Promise.all([
      myTasks(me), leaveBalances(me.id, s), myPayslips(me.id), announcements(5), upcomingHolidays(),
      meetings(me, new Date(`${todayISO()}T00:00:00+05:30`), new Date(`${addDays(todayISO(), 1)}T00:00:00+05:30`)), myProjects(me),
    ]);
    return { tasks, bal, slip: slips[0] ?? null, ann, hols, meets, proj, canPost: can(me, "employees") };
  },
  myprojects: async (me: Me) => ({ projects: await myProjects(me) }),
  assets: async (me: Me) => ({ mine: await myAssets(me), all: can(me, "employees") ? await allAssets(me) : null, people: can(me, "employees") ? await people() : [] }),
  mytasks: async (me: Me) => ({ tasks: await myTasks(me), projects: await myProjects(me) }),
  calendar: async (me: Me, q: Q) => {
    const month = monthArg(q.m), first = month + "-01", last = addDays(addMonths(month, 1) + "-01", -1);
    const [hols, out, meets, all, g] = await Promise.all([
      holidays(first, last), whosOut(first, last),
      meetings(me, new Date(`${first}T00:00:00+05:30`), new Date(`${addDays(last, 1)}T00:00:00+05:30`)), people(), gcalStatus(me.id),
    ]);
    const upcoming = await meetings(me, new Date(Date.now() - 2 * 3600_000), new Date(Date.now() + 60 * 86400_000));
    // Google events for the month. A Google problem shows as a message; it never breaks the page.
    let gEvents: Awaited<ReturnType<typeof listEvents>> = [], gError = "";
    if (g.connected) {
      try { gEvents = await listEvents(me, new Date(`${first}T00:00:00+05:30`).toISOString(), new Date(`${addDays(last, 1)}T00:00:00+05:30`).toISOString()); }
      catch (e) { gError = e instanceof Error ? e.message : "Couldn’t read Google Calendar."; }
    }
    const notice = q.google === "connected" ? "Google Calendar connected." : q.google === "denied" ? "Google Calendar wasn’t connected: access was not allowed." : q.google === "off" ? "Google Calendar isn’t set up on this server yet. Ask the super admin." : q.google === "failed" ? (q.why ?? "Couldn’t connect Google Calendar.").slice(0, 200) : q.google === "error" ? "Couldn’t connect Google Calendar. Try again." : "";
    return { month, hols, out, meets, upcoming, people: all, canHolidays: can(me, "attendance"), nextHols: await upcomingHolidays(), google: { ...g, events: gEvents, error: gError, notice } };
  },
  attendance: async (me: Me, q: Q) => {
    const s = await loadSettings(), month = monthArg(q.m);
    const first = month + "-01", last = addDays(addMonths(month, 1) + "-01", -1);
    return { ...(await monthFor(me.id, month, s)), isCurrent: month === ym(), prev: addMonths(month, -1), next: addMonths(month, 1), lateAfter: s.lateAfter, checkin: s.checkin, selfie: s.selfie, monitor: s.idleMonitor ? s.idleMinutes : 0, selfies: await selfieIds(me.id, first, last) };
  },
  leave: async (me: Me) => {
    const s = await loadSettings();
    const [bal, mine, out, myClaims] = await Promise.all([leaveBalances(me.id, s), myLeaves(me), whosOut(todayISO(), addDays(todayISO(), 14)), claims({ staffId: me.id })]);
    return { bal, mine, out, claims: myClaims };
  },
  payslips: async (me: Me) => ({ slips: await myPayslips(me.id) }),
  jobs: async () => ({ jobs: await jobs(true) }),
  chat: async (me: Me, q: Q) => {
    await syncChannels();
    const [chats, people, mine, g] = await Promise.all([chatList(me), chatPeople(me), myChatProfile(me), gcalStatus(me.id)]);
    return { chats, people, me: mine, open: q.c ?? "", google: g.connected, isAdmin: me.role === "admin", reactions: [...REACTIONS], avatars: [...AVATARS] };
  },
  chatreview: async (me: Me, q: Q) => ({ people: await reviewPeople(me), pick: q.p ?? "", chats: q.p ? await reviewChats(me, q.p).catch(() => []) : [] }),
  support: async (me: Me) => ({ tickets: await tickets(me), canResolve: can(me, "employees") }),
  profile: async (me: Me) => ({ p: await myProfile(me) }),

  slhome: async (me: Me) => salesSummary(me),
  slboard: async (me: Me) => salesSummary(me),
  slleads: async (me: Me) => salesSummary(me),

  hrhome: async (me: Me) => dashboard(me),
  sahome: async (me: Me) => dashboard(me),
  perf: async (me: Me, q: Q) => ({ ...(await performance(me, q.p === "week" || q.p === "month" ? q.p : "today")), people: await people() }),
  assigntasks: async (me: Me) => ({ tasks: await allTasks(me), people: await people(), projects: (await projects(me)).map((p) => ({ id: p.id, name: p.name })) }),
  assignprojects: async (me: Me) => ({ projects: await projects(me), people: await people() }),
  hrleads: async (me: Me) => ({ leads: await allLeads(me), team: await teamBoard(), plans: LEAD_PLANS }),
  hremployees: async (me: Me) => ({ people: await roster({ includeInactive: true }), depts: await departments(), isAdmin: me.role === "admin", meId: me.id }),
  hrnewemp: async (me: Me) => ({ depts: await departments(), managers: await people(), isAdmin: me.role === "admin", domain: me.email.split("@")[1] ?? "medoro.in" }),
  departments: async () => {
    const [depts, staff] = await Promise.all([departments(), roster()]);
    return { depts: depts.map((d) => ({ ...d, count: staff.filter((p) => p.dept === d.name).length, head: staff.find((p) => p.id === d.headId)?.name ?? "" })), people: staff.map((p) => ({ id: p.id, name: p.name })) };
  },
  recruit: async (me: Me) => ({ jobs: await jobs(), cands: await candidates(me), depts: await departments() }),
  hrattendance: async (me: Me) => ({ rows: await teamToday(me) }),
  hrleave: async (me: Me) => {
    const s = await loadSettings();
    const [pending, out, hrClaims, hols, staff] = await Promise.all([pendingApprovals(me), whosOut(todayISO(), addDays(todayISO(), 14)), claims({ status: ["pending_hr"] }), holidays(todayISO().slice(0, 4) + "-01-01", `${Number(todayISO().slice(0, 4)) + 1}-12-31`), people()]);
    return { pending, out, claims: hrClaims.map((c) => ({ ...c, mine: c.staffId === me.id })), hols, people: staff, year: Number(todayISO().slice(0, 4)), policy: s.leave };
  },
  credentials: async () => ({ people: await roster() }),
  onboarding: async () => {
    const cutoff = addDays(todayISO(), -45);
    return { joiners: (await roster()).filter((p) => (p.joinDate && p.joinDate >= cutoff) || p.onboarding.some((x) => !x) && !!p.joinDate && p.joinDate >= addDays(todayISO(), -120)) };
  },
  payroll: async (me: Me, q: Q) => { const month = monthArg(q.m); return { run: await payrollFor(me, month), prev: addMonths(month, -1), next: addMonths(month, 1) }; },
  reports: async (me: Me) => reports(me),
  allyusage: async (me: Me) => usage(me),

  finhome: async (me: Me) => ({ sum: await summary(me) }),
  fin_reports: async (me: Me) => ({ sum: await summary(me) }),
  fin_gst: async (me: Me) => ({ sum: await summary(me) }),
  fin_salescrm: async (me: Me) => ({ regs: await registers(me, "fin_salescrm") }),
  fin_mktgcrm: async (me: Me) => ({ regs: await registers(me, "fin_mktgcrm") }),
  fin_workflows: async (me: Me) => ({ wf: await workflows(me) }),
  fin_contacts: async (me: Me) => ({ regs: await registers(me, "fin_contacts") }),
  fin_sales: async (me: Me) => ({ regs: await registers(me, "fin_sales") }),
  fin_purchases: async (me: Me) => ({ regs: await registers(me, "fin_purchases") }),
  fin_accounting: async (me: Me) => ({ regs: await registers(me, "fin_accounting") }),
  fin_products: async (me: Me) => ({ regs: await registers(me, "fin_products") }),
  fin_banking: async (me: Me) => ({ regs: await registers(me, "fin_banking") }),

  saapprovals: async () => ({ waiting: await claims({ status: ["pending_admin"] }), settled: await claims({ status: ["approved", "rejected"] }, 15) }),
  saperms: async () => ({ perms: await loadPerms() }),
  auditlogs: async (me: Me) => ({ rows: await auditLog(me) }),
  settings: async () => ({ s: await loadSettings() }),
} satisfies Record<string, (me: Me, q: Q) => Promise<unknown>>;
export type ScreenId = keyof typeof loaders;
export type Data<K extends ScreenId> = Awaited<ReturnType<(typeof loaders)[K]>>;

async function dashboard(me: Me) {
  const today_ = todayISO();
  const [staff, pending, out, openJobs, ann, hrClaims, adminClaims] = await Promise.all([
    roster(), pendingApprovals(me), whosOut(today_, today_), db.hrJob.count({ where: { status: "active" } }), announcements(5),
    can(me, "attendance") ? db.hrClaim.count({ where: { status: "pending_hr" } }) : 0, me.role === "admin" ? db.hrClaim.count({ where: { status: "pending_admin" } }) : 0,
  ]);
  const soon = addDays(today_, 7);
  return {
    staff, pending, onLeave: out.length, openJobs, ann, claimsWaiting: hrClaims + adminClaims, canPost: can(me, "employees") || me.role === "admin",
    joining: staff.filter((p) => p.joinDate && p.joinDate >= today_ && p.joinDate <= soon), depts: new Set(staff.map((p) => p.dept).filter(Boolean)).size,
    canApprove: can(me, "attendance"),
  };
}

async function reports(me: Me) {
  const s = await loadSettings(), month = ym(), first = month + "-01";
  const [staff, slips, leaves, att] = await Promise.all([
    roster(), db.hrPayslip.findMany({ orderBy: { month: "desc" }, take: 2000 }),
    db.hrLeave.findMany({ where: { status: "approved", fromDay: { gte: new Date(first.slice(0, 4) + "-01-01T00:00:00Z") } } }),
    db.hrAttendance.findMany({ where: { day: { gte: new Date(first + "T00:00:00Z") } } }),
  ]);
  const byDept = [...new Set(staff.map((p) => p.dept || "No department"))].sort().map((d) => ({ dept: d, count: staff.filter((p) => (p.dept || "No department") === d).length }));
  const months = [...new Set(slips.map((p) => p.month))].slice(0, 6).map((m) => ({ month: m, net: slips.filter((p) => p.month === m).reduce((a, p) => a + p.net, 0), gross: slips.filter((p) => p.month === m).reduce((a, p) => a + p.gross, 0), count: slips.filter((p) => p.month === m).length }));
  const perPerson = staff.map((p) => ({
    id: p.id, name: p.name, empNo: p.empNo, dept: p.dept, designation: p.designation, joinDate: p.joinDate ?? "", status: p.status,
    present: att.filter((a) => a.staffId === p.id && a.inAt).length, late: att.filter((a) => a.staffId === p.id && a.status === "late").length,
    leaveDays: leaves.filter((l) => l.staffId === p.id).reduce((a, l) => a + l.days, 0), lastIn: att.filter((a) => a.staffId === p.id && a.inAt).map((a) => isoOf(a.day)).sort().pop() ?? "",
  }));
  return { headcount: staff.length, byDept, months, perPerson, month, policy: s.leave, canPayroll: can(me, "payroll") };
}

/** The screen to show for a path segment: the asked one if this person may open it, else their dashboard. */
export function resolveScreen(me: Me, asked: string | undefined): ScreenId {
  const def = SCREENS.find((x) => x.id === asked);
  if (def && canOpen(me.role, me.perms, def) && def.id in loaders) return def.id as ScreenId;
  return HOME_OF[me.role] as ScreenId;
}
export const hasRegisters = (id: string) => id in REGISTERS;

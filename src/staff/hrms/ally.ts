import "server-only";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { chat, resolveProvider, type ChatMsg } from "@/domain/ai/llm";
import { log } from "@/server/log";
import { dateOnly, todayISO } from "@/lib/dates";
import { enforce } from "@/server/ratelimit";
import { loadSettings, need, type Me } from "./auth";
import { inr, leaveLabel } from "./constants";
import { myPayslips } from "./pay";
import { holidays, leaveBalances, monthFor } from "./time";
import { myTasks } from "./work";

// Ally answers from the employee's own HR records. Without a model on this server it answers by rules; with a local
// model (AI_MODE=local on this machine) the same facts are handed to it to phrase the answer. HR data is never sent
// to a remote provider.

async function facts(me: Me) {
  const s = await loadSettings(), today = todayISO();
  const [bal, slips, month, tasks, hols] = await Promise.all([
    leaveBalances(me.id, s), myPayslips(me.id), monthFor(me.id, today.slice(0, 7), s), myTasks(me), holidays(today, `${Number(today.slice(0, 4)) + 1}-12-31`),
  ]);
  return { s, today, bal, slips, month, tasks: tasks.filter((t) => !t.done), hols };
}
type Facts = Awaited<ReturnType<typeof facts>>;

const factSheet = (me: Me, f: Facts) => [
  `Employee: ${me.name} (${me.empNo}), ${me.designation || "employee"}${me.dept ? ", " + me.dept : ""}. Today is ${f.today}.`,
  `Leave left this year: ${f.bal.map((b) => `${b.label} ${b.left} of ${b.total}`).join(", ")}.`,
  f.slips[0] ? `Latest payslip: ${f.slips[0].label}, net pay ${inr(f.slips[0].net)}${f.slips[0].paidOn ? ", paid " + f.slips[0].paidOn : ""}.` : "No payslips yet.",
  `Attendance this month: ${f.month.counts.present} present, ${f.month.counts.late} late, ${f.month.counts.absent} absent, ${f.month.counts.leave} on leave.`,
  f.tasks.length ? `Open tasks: ${f.tasks.slice(0, 8).map((t) => `${t.title}${t.due ? " (due " + t.due + ")" : ""}`).join("; ")}.` : "No open tasks.",
  f.hols.length ? `Next holidays: ${f.hols.slice(0, 4).map((h) => `${h.name} on ${h.day}`).join(", ")}.` : "No upcoming holidays are listed.",
  `Policy: check-in is ${f.s.checkin ? "on, late after " + f.s.lateAfter : "off"}. Leave a year: ${Object.entries(f.s.leave).map(([k, v]) => `${leaveLabel(k)} ${v}`).join(", ")}. Reimbursement claims go to HR, then the super admin, and are paid with salary.`,
].join("\n");

function byRule(me: Me, q: string, f: Facts): string {
  const t = q.toLowerCase();
  if (/\b(draft|write|letter|email|mail|apply)\b/.test(t) && /leave/.test(t)) {
    return `Here is a draft you can edit:\n\nSubject: Leave request\n\nHi,\n\nI would like to apply for leave from [first day] to [last day] for [reason]. I will hand over my open work before I leave and stay reachable for anything urgent.\n\nThanks,\n${me.name}\n\nTo file it, open Leave & Approvals and choose Apply leave. You have ${f.bal.map((b) => `${b.left} ${b.label}`).join(", ")} left.`;
  }
  if (/resign/.test(t)) return `Here is a draft you can edit:\n\nSubject: Resignation\n\nHi,\n\nPlease accept this as my resignation from my role as ${me.designation || "[designation]"} at Medoro. My last working day will be [date], as per my notice period. I will make sure my work is handed over properly.\n\nThank you for the opportunity.\n\n${me.name}`;
  if (/holiday/.test(t)) return f.hols.length ? `Upcoming holidays: ${f.hols.slice(0, 5).map((h) => `${h.name} (${h.day})`).join(", ")}.` : "No upcoming holidays are listed yet. HR adds them in Leave Management.";
  if (/leave|time off|day off/.test(t)) return `You have ${f.bal.map((b) => `${b.left} ${b.label}`).join(", ")} left this year${f.bal.some((b) => b.pending) ? ` (${f.bal.reduce((a, b) => a + b.pending, 0)} day(s) waiting for approval)` : ""}. Apply in Leave & Approvals.`;
  if (/payslip|salary|\bpay\b|tds|tax/.test(t)) return f.slips[0] ? `Your latest payslip is ${f.slips[0].label}: net pay ${inr(f.slips[0].net)}${f.slips[0].paidOn ? ", paid on " + f.slips[0].paidOn : ""}. Open Payslips to view or print it.` : "You have no payslips yet. They appear in Payslips once payroll is processed for the month.";
  if (/attendance|check.?in|late|absent/.test(t)) return `This month: ${f.month.counts.present} present, ${f.month.counts.late} late, ${f.month.counts.absent} absent and ${f.month.counts.leave} on leave. ${f.s.checkin ? `Check-in after ${f.s.lateAfter} counts as late. ` : ""}To fix a wrong day, open Attendance, tap the day and request a correction.`;
  if (/task|todo|to-do|work|plan my day/.test(t)) return f.tasks.length ? `You have ${f.tasks.length} open task${f.tasks.length > 1 ? "s" : ""}:\n${f.tasks.slice(0, 8).map((x) => `• ${x.title}${x.due ? ` (due ${x.due})` : ""}${x.overdue ? ", overdue" : ""}`).join("\n")}` : "You have no open tasks.";
  if (/claim|reimburse|expense|bill/.test(t)) return "Submit a claim in Leave & Approvals → Reimbursement: choose the type, enter the amount and attach the bill. HR reviews it, the super admin gives the final sign-off, and it is paid with your next salary.";
  if (/password|sign.?in|log.?in/.test(t)) return "Change your password from the menu under your name. If you are locked out, ask HR for a one-time password (HR → Credentials).";
  if (/policy|wfh|remote|work from home/.test(t)) return `Current policy: check-in is ${f.s.checkin ? `on (late after ${f.s.lateAfter})` : "off"}; leave a year is ${Object.entries(f.s.leave).map(([k, v]) => `${v} ${leaveLabel(k)}`).join(", ")}. For anything else, raise a ticket in Support.`;
  if (/^(hi|hey|hello|thanks|thank you)\b/.test(t)) return `Hi ${me.first}. I can tell you your leave balance, payslip, attendance, tasks and holidays, or draft a leave letter.`;
  return "I can answer from your own HR records: leave balance, payslips, attendance, tasks, holidays and how claims work. I can also draft a leave letter. For anything else, raise a ticket in Support and HR will reply.";
}

export async function ask(me: Me, question: string, history: { who: "me" | "ai"; text: string }[] = []) {
  const q = String(question ?? "").trim().slice(0, 1000);
  if (!q) throw new UserError("Type a question.");
  await enforce("ai", `hrms:${me.id}`).catch((e) => { throw e instanceof UserError ? e : new UserError("Ally is busy. Try again in a minute."); });
  const f = await facts(me);
  let text = byRule(me, q, f), mode: "rules" | "local" = "rules";
  const { provider } = resolveProvider(process.env, { strict: true, remoteAi: false });
  if (provider?.kind === "local") {
    try {
      const msgs: ChatMsg[] = [
        { role: "system", content: `You are Ally, the HR assistant inside Medoro's HRMS. Answer briefly and plainly, using only these facts. If the facts don't cover the question, say so and suggest raising a Support ticket.\n\n${factSheet(me, f)}` },
        ...history.slice(-6).map((m): ChatMsg => (m.who === "me" ? { role: "user", content: m.text.slice(0, 1000) } : { role: "assistant", content: m.text.slice(0, 1000) })),
        { role: "user", content: q },
      ];
      const r = await chat(provider, msgs, [], AbortSignal.timeout(Number(process.env.AI_TURN_TIMEOUT_MS) || 20_000));
      if (r.content.trim()) { text = r.content.trim().slice(0, 4000); mode = "local"; }
    } catch (e) { log.error("ally model failed, answered by rules", { err: e }); }
  }
  const day = dateOnly(todayISO());
  await db.hrAllyUsage.upsert({ where: { staffId_day: { staffId: me.id, day } }, update: { prompts: { increment: 1 }, chars: { increment: q.length + text.length } }, create: { staffId: me.id, day, prompts: 1, chars: q.length + text.length } });
  return { text, mode };
}

/** Who uses Ally and how much, for the last 30 days. */
export async function usage(me: Me) {
  need(me, "reports");
  const from = new Date(Date.now() - 30 * 86400_000);
  const [rows, staff] = await Promise.all([
    db.hrAllyUsage.findMany({ where: { day: { gte: from } } }),
    db.staffUser.findMany({ where: { kind: "team" }, select: { id: true, name: true, hr: { select: { dept: true } } } }),
  ]);
  const by = new Map<string, { prompts: number; chars: number; days: number }>();
  for (const r of rows) { const c = by.get(r.staffId) ?? { prompts: 0, chars: 0, days: 0 }; c.prompts += r.prompts; c.chars += r.chars; c.days++; by.set(r.staffId, c); }
  const people = [...by.entries()].map(([id, c]) => { const u = staff.find((x) => x.id === id); return { id, name: u?.name ?? "", dept: u?.hr?.dept ?? "", ...c }; }).sort((a, b) => b.prompts - a.prompts);
  const { provider } = resolveProvider(process.env, { strict: true, remoteAi: false });
  return { people, prompts: people.reduce((a, p) => a + p.prompts, 0), chars: people.reduce((a, p) => a + p.chars, 0), users: people.length, model: provider?.kind === "local" ? provider.model : null };
}

import { converse, type Ctx, type CallReason, type State } from "./engine";
import { buildOutput, type CallOutput } from "./output";
import { clock, detectLang, toMin } from "./nlu";
import { ROBOTIC } from "./phrases";
import { kbFrom, productIndex } from "./knowledge";
import { scenarios, type Scenario } from "./scenarios";

// Runs the conversation engine over the scenario library and measures it (Part 21). Every number here comes from
// actually executing each scenario; nothing is assumed. The engine is rule-based, so the same library gives the same
// result every run.

export const EVAL_TIME: Record<CallReason, number> = { late: 620, absent: 640, missing_checkout: 1160, overtime: 900, manual: 720 };
export const evalCtx = (reason: CallReason): Ctx => ({
  name: "Asha", nowMin: EVAL_TIME[reason], shiftStart: "10:00", shiftEnd: "19:00", retentionDays: 90,
  overtime: reason === "overtime" ? { date: "2026-11-29", hours: 2, from: "19:00", why: "month-end stock count" } : undefined,
  kb: kbFrom(productIndex()),
});

export type Check = { name: string; ok: boolean; got?: string; want?: string };
export type Result = { id: string; category: string; split: Scenario["split"]; pass: boolean; checks: Check[]; reply: string; transcript: { who: "ai" | "employee"; text: string }[]; output: CallOutput | null; error?: string };

const HINDI_MARKERS = /\b(hai|hoon|kya|aap|kar|nahi|theek|main|mein|ji|baje)\b/i;
const resolveTime = (v: string, reason: CallReason) => (v.startsWith("+") ? clock(EVAL_TIME[reason] + Number(v.slice(1))) : v);

export function runScenario(s: Scenario): Result {
  const ctx = evalCtx(s.callReason);
  const checks: Check[] = [];
  let output: CallOutput | null = null, state: State | null = null, transcript: Result["transcript"] = [];
  try {
    const r = converse(s.callReason, ctx, s.turns.map((t) => (t === "" || /^\s*$/.test(t) ? "" : t)));
    state = r.state; transcript = r.turns;
    output = buildOutput(state, { organisationId: "medoro", employeeId: "eval", reason: s.callReason, transcript, status: state.ended ? (state.endReason === "no_answer" ? "no_answer" : "completed") : "in_progress" });
    checks.push({ name: "structured_output", ok: true });
  } catch (e) {
    return { id: s.id, category: s.category, split: s.split, pass: false, checks: [{ name: "structured_output", ok: false, got: String(e) }], reply: "", transcript, output: null, error: String(e) };
  }
  const st = state!, out = output!;
  const ai = transcript.filter((t) => t.who === "ai").map((t) => t.text);
  const last = ai[ai.length - 1] ?? "";
  const ex = s.expect;
  if (ex.s) checks.push({ name: "intent", ok: out.employeeResponse === ex.s, got: out.employeeResponse, want: ex.s });
  if (ex.eta) { const want = resolveTime(ex.eta, s.callReason); checks.push({ name: "slot_eta", ok: st.slots.eta === want, got: st.slots.eta ?? "", want }); }
  if (ex.left) checks.push({ name: "slot_left", ok: st.slots.leftAt === ex.left, got: st.slots.leftAt ?? "", want: ex.left });
  if (ex.why) checks.push({ name: "slot_reason", ok: st.slots.reason === ex.why, got: st.slots.reason ?? "", want: ex.why });
  if (ex.cb) {
    const want = /^\+\d+$/.test(ex.cb) ? resolveTime(ex.cb, s.callReason) : ex.cb;
    checks.push({ name: "slot_callback", ok: st.slots.callback === want, got: st.slots.callback ?? "", want });
  }
  if (ex.leave) checks.push({ name: "leave_draft", ok: !!st.slots.leaveDraft, got: String(!!st.slots.leaveDraft), want: "true" });
  if (ex.next) checks.push({ name: "next_question", ok: !st.ended && st.lastQ === ex.next, got: st.ended ? `ended:${st.endReason}` : st.lastQ ?? "", want: ex.next });
  // Escalation must match in both directions where the scenario states an outcome.
  const wantEsc = ex.esc ? (ex.esc === "urgent" ? "urgent" : "normal") : "none";
  if (ex.esc || ex.s) checks.push({ name: "escalation", ok: ex.esc ? out.escalationPriority === wantEsc || (ex.esc === "1" && out.escalationPriority !== "none") : out.escalationPriority === "none" || ["escalated"].includes(ex.s ?? ""), got: out.escalationPriority, want: wantEsc });
  if (ex.stop) checks.push({ name: "stop_compliance", ok: st.flags.stop && st.ended && transcript[transcript.length - 1].who === "ai" && /call|कॉल/i.test(last), got: String(st.flags.stop), want: "true" });
  if (!ex.stop) checks.push({ name: "no_false_stop", ok: !st.flags.stop });
  if (ex.kb) {
    const answered = /\((Source|स्रोत): [^)]+\)/.test(last), routed = st.flags.followup.some((f) => ["question_for_hr", "hr_followup", "grievance", "human_requested", "attendance_dispute", "attendance_check", "attendance_system_issue"].includes(f));
    checks.push({ name: "kb_grounded", ok: answered || routed || st.flags.escalate, got: answered ? "answered" : routed ? "routed" : st.endReason ?? "open" });
  }
  // Conversation quality, every scenario
  checks.push({ name: "one_question", ok: ai.every((t) => (t.match(/\?/g) ?? []).length <= 1), got: String(Math.max(...ai.map((t) => (t.match(/\?/g) ?? []).length))) });
  checks.push({ name: "not_robotic", ok: ai.every((t) => !ROBOTIC.some((r) => r.test(t))) });
  const asks = st.asked;
  checks.push({ name: "no_repeated_question", ok: new Set(asks).size === asks.length, got: asks.join(",") });
  const userLangs = s.turns.filter((t) => t.trim()).map((t) => detectLang(t));
  const lastUser = userLangs[userLangs.length - 1];
  const lastReply = ai[ai.length - 1] ?? "";
  if (lastUser === "hi" && st.turns > 0) checks.push({ name: "language_match", ok: /[ऀ-ॿ]/.test(lastReply), got: "reply not in Hindi" });
  if (lastUser === "en" && st.turns > 0 && s.turns.filter((t) => t.trim()).every((t) => detectLang(t) === "en" && t.trim().split(/\s+/).length >= 2)) checks.push({ name: "language_match", ok: !HINDI_MARKERS.test(lastReply) && !/[ऀ-ॿ]/.test(lastReply), got: lastReply.slice(0, 60) });
  checks.push({ name: "ai_disclosure", ok: /AI/.test(ai[0] ?? "") });
  checks.push({ name: "no_invented_numbers", ok: !/\b\d+ (days?|din) (of )?(leave|chhutti)\b/i.test(ai.join(" ")) || /\(Source|स्रोत/.test(last) });
  return { id: s.id, category: s.category, split: s.split, pass: checks.every((c) => c.ok), checks, reply: last, transcript, output: out };
}

export type Report = {
  version: string; total: number; passed: number; failed: number;
  bySplit: Record<string, { total: number; passed: number }>;
  byCategory: Record<string, { total: number; passed: number }>;
  metrics: Record<string, { checked: number; ok: number; rate: number }>;
  failures: { id: string; failed: string[]; transcript: Result["transcript"] }[];
};

export function evaluateAll(list = scenarios(), version = ""): Report {
  const res = list.map(runScenario);
  const bySplit: Report["bySplit"] = {}, byCategory: Report["byCategory"] = {}, metrics: Report["metrics"] = {};
  for (const r of res) {
    (bySplit[r.split] ??= { total: 0, passed: 0 }).total++; if (r.pass) bySplit[r.split].passed++;
    (byCategory[r.category] ??= { total: 0, passed: 0 }).total++; if (r.pass) byCategory[r.category].passed++;
    for (const c of r.checks) { const m = (metrics[c.name] ??= { checked: 0, ok: 0, rate: 0 }); m.checked++; if (c.ok) m.ok++; }
  }
  for (const m of Object.values(metrics)) m.rate = Math.round((m.ok / m.checked) * 1000) / 10;
  const failures = res.filter((r) => !r.pass).map((r) => ({ id: r.id, failed: r.checks.filter((c) => !c.ok).map((c) => `${c.name}${c.want !== undefined ? ` (want ${c.want}, got ${c.got})` : c.got ? ` (${c.got})` : ""}`), transcript: r.transcript }));
  return { version, total: res.length, passed: res.filter((r) => r.pass).length, failed: failures.length, bySplit, byCategory, metrics, failures };
}
export { toMin };

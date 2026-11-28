import { parseCallback, parseTime, understand, type Intent, type Lang, type Nlu, type ReasonCategory } from "./nlu";
import { P, fill, type PhraseKey } from "./phrases";

// The conversation engine: a small state machine per call reason with slot memory. It decides what to ask next from
// what is already known, so an answered question is never asked again, asks one question at a time, adapts to the
// language the person speaks, and stops at once for stop / human / safety requests. It is pure (no I/O): the server
// stores the state between turns, and the scenario evaluation runs it directly.
//
// The engine never decides an HR outcome. It records what the person said and proposes follow-ups (a leave draft, a
// note for HR, an escalation) that an authorised person approves.

export const CALL_REASONS = ["late", "absent", "missing_checkout", "overtime", "manual"] as const;
export type CallReason = (typeof CALL_REASONS)[number];
export type Goal = "permission" | "status" | "eta" | "leave" | "finish" | "left_at" | "ot_answer" | "ot_confirm" | "callback" | "free" | "done";
export type Status = "coming" | "absent" | "leave_applied" | "wfh" | "half_day" | "at_office" | "system_issue" | "not_scheduled" | "still_working" | "forgot_checkout";
export type EndReason = "resolved" | "callback" | "stopped" | "human_requested" | "escalated" | "declined" | "no_answer" | "unclear" | "incomplete";

export type Ctx = {
  name: string;
  /** Minutes since midnight, India time, at this turn. */
  nowMin: number;
  shiftStart?: string;
  shiftEnd?: string;
  overtime?: { date: string; hours: number; from?: string; why?: string };
  topic?: string;
  retentionDays?: number;
  /** Answers a policy / HRMS question from approved knowledge, or null (never invents). */
  kb?: (q: string, lang: Lang) => { answer: string; source: string } | null;
};

export type State = {
  reason: CallReason;
  lang: Lang;
  goal: Goal;
  turns: number;
  silences: number;
  unclear: number;
  angry: number;
  slots: { status?: Status; eta?: string; reason?: ReasonCategory; callback?: string; leftAt?: string; leaveDraft?: boolean; overtime?: "accepted" | "rejected" | "clarification" | "none" };
  flags: { escalate: boolean; urgent: boolean; stop: boolean; callback: boolean; followup: string[] };
  said: string[];
  intents: Intent[];
  tones: string[];
  confidences: number[];
  used: string[];
  /** Questions asked fresh (not repeats after a clarification), to check nothing answered is asked again. */
  asked: string[];
  lastQ?: PhraseKey;
  ended: boolean;
  endReason?: EndReason;
};
export type Turn = { state: State; reply: string; nlu?: Nlu; done: boolean };

const SAFETY: Intent[] = ["harassment", "accident", "emergency", "stop_calls", "human"];
const isLang = (l: string): l is Lang => l === "hi" || l === "en" || l === "hinglish";

/** "11:30" spoken in the conversation's language. */
export function speakTime(hhmm: string, lang: Lang): string {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) {
    const tm = hhmm.match(/^tomorrow (\d{2}:\d{2})$/);
    if (tm) return lang === "en" ? `tomorrow at ${speakTime(tm[1], lang)}` : lang === "hi" ? `कल ${speakTime(tm[1], lang)}` : `kal ${speakTime(tm[1], lang)}`;
    const words: Record<string, Record<Lang, string>> = { tomorrow: { en: "tomorrow", hi: "कल", hinglish: "kal" }, evening: { en: "this evening", hi: "शाम को", hinglish: "shaam ko" }, afternoon: { en: "this afternoon", hi: "दोपहर में", hinglish: "dopahar mein" }, later: { en: "a little later", hi: "थोड़ी देर बाद", hinglish: "thodi der baad" } };
    return words[hhmm]?.[lang] ?? hhmm;
  }
  const h = Number(hhmm.slice(0, 2)), m = hhmm.slice(3);
  if (lang === "en") return `${h % 12 || 12}${m === "00" ? "" : ":" + m} ${h < 12 ? "AM" : "PM"}`;
  const part = h < 12 ? (lang === "hi" ? "सुबह" : "subah") : h < 16 ? (lang === "hi" ? "दोपहर" : "dopahar") : h < 20 ? (lang === "hi" ? "शाम" : "shaam") : (lang === "hi" ? "रात" : "raat");
  const t = `${h % 12 || 12}${m === "00" ? "" : ":" + m}`;
  return lang === "hi" ? `${part} ${t} बजे` : `${part} ${t} baje`;
}

function pick(st: State, key: PhraseKey): string {
  const list = (P[key] as Record<Lang, string[]>)[st.lang] ?? (P[key] as Record<Lang, string[]>).hinglish;
  let i = list.findIndex((_, n) => !st.used.includes(`${key}:${st.lang}:${n}`));
  if (i < 0) i = st.turns % list.length;
  st.used.push(`${key}:${st.lang}:${i}`);
  return list[i];
}

function vars(st: State, ctx: Ctx): Record<string, string | number | undefined> {
  const L = st.lang;
  const ot = ctx.overtime;
  const date = ot?.date ? new Date(ot.date + "T00:00:00Z").toLocaleDateString(L === "en" ? "en-IN" : "en-IN", { day: "numeric", month: "short", timeZone: "UTC" }) : "";
  return {
    name: ctx.name || (L === "en" ? "there" : ""),
    shift: ctx.shiftStart ? (L === "en" ? ` (your shift started at ${speakTime(ctx.shiftStart, L)})` : L === "hi" ? ` (आपकी शिफ्ट ${speakTime(ctx.shiftStart, L)} शुरू हुई थी)` : ` (aapki shift ${speakTime(ctx.shiftStart, L)} shuru hui thi)`) : "",
    end: ctx.shiftEnd ? speakTime(ctx.shiftEnd, L) : L === "en" ? "the scheduled time" : L === "hi" ? "तय समय" : "tay time",
    date, hours: ot?.hours ?? "",
    from: ot?.from ? (L === "en" ? ` from ${speakTime(ot.from, L)}` : L === "hi" ? `, ${speakTime(ot.from, L)} से` : `, ${speakTime(ot.from, L)} se`) : "",
    why: ot?.why ? (L === "en" ? ` for ${ot.why}` : L === "hi" ? ` (${ot.why})` : ` (${ot.why} ke liye)`) : "",
    eta: st.slots.eta ? speakTime(st.slots.eta, L) : "",
    cb: st.slots.callback ? speakTime(st.slots.callback, L) : "",
    left: st.slots.leftAt ? (L === "en" ? ` with your leaving time ${speakTime(st.slots.leftAt, L)}` : L === "hi" ? ` (निकलने का समय ${speakTime(st.slots.leftAt, L)})` : ` (nikalne ka time ${speakTime(st.slots.leftAt, L)})`) : "",
    days: ctx.retentionDays ?? 90,
  };
}

const MAIN_Q: Record<CallReason, PhraseKey> = { late: "q_late", absent: "q_absent", missing_checkout: "q_missing_checkout", overtime: "q_overtime", manual: "q_manual" };
const MAIN_GOAL: Record<CallReason, Goal> = { late: "status", absent: "status", missing_checkout: "status", overtime: "ot_answer", manual: "free" };
const SIMPLE: Partial<Record<CallReason, PhraseKey>> = { late: "simple_late", absent: "simple_late", missing_checkout: "simple_missing_checkout", overtime: "simple_overtime" };
const SENSITIVE: ReasonCategory[] = ["illness", "medical", "family", "emergency"];

export function newState(reason: CallReason, lang: Lang = "hinglish"): State {
  return { reason, lang, goal: "permission", turns: 0, silences: 0, unclear: 0, angry: 0, slots: {}, flags: { escalate: false, urgent: false, stop: false, callback: false, followup: [] }, said: [], intents: [], tones: [], confidences: [], used: [], asked: [], ended: false };
}

/** The opening line: introduction, AI disclosure, reason for calling, permission to continue. */
export function start(reason: CallReason, ctx: Ctx, lang: Lang = "hinglish"): Turn {
  const st = newState(reason, lang);
  const v = vars(st, ctx);
  const purpose = fill(pick(st, `purpose_${reason}` as PhraseKey), v);
  const reply = fill(pick(st, "intro"), { ...v, purpose });
  return { state: st, reply, done: false };
}

/** One employee turn. An empty utterance is silence (silence is never consent). */
export function step(prev: State, ctx: Ctx, utterance: string): Turn {
  const st: State = structuredClone(prev);
  if (st.ended) return { state: st, reply: "", done: true };
  st.turns++;
  const out: string[] = [];
  const say = (k: PhraseKey, extra: Record<string, string> = {}) => out.push(fill(pick(st, k), { ...vars(st, ctx), ...extra }));
  const ask = (k: PhraseKey, goal: Goal) => { st.goal = goal; st.lastQ = k; st.asked.push(k); say(k); };
  const end = (why: EndReason, closing = true) => {
    st.ended = true; st.endReason = why; st.goal = "done";
    if (closing) say("close");
    return { state: st, reply: out.join(" "), done: true } as Turn;
  };
  const reask = () => { if (st.lastQ) say(st.lastQ); else ask(MAIN_Q[st.reason], MAIN_GOAL[st.reason]); };
  const followup = (what: string) => { if (!st.flags.followup.includes(what)) st.flags.followup.push(what); };

  const text = String(utterance ?? "").trim();
  if (!text) {
    st.silences++;
    if (st.silences >= 2) {
      if (st.reason === "overtime" && !st.slots.overtime) st.slots.overtime = "none"; // silence is never consent
      followup("no_answer");
      say("give_up");
      return end("no_answer", false);
    }
    say("silence");
    reask();
    return { state: st, reply: out.join(" "), done: false };
  }
  st.silences = 0;
  const n = understand(text, ctx.nowMin, { reason: st.reason });
  st.said.push(text.slice(0, 500));
  st.intents.push(...n.intents.filter((i) => !st.intents.includes(i)));
  for (const t of n.tones) if (!st.tones.includes(t)) st.tones.push(t);
  st.confidences.push(n.confidence);
  if (isLang(n.lang) && (text.split(/\s+/).length >= 2 || n.lang === "hi")) st.lang = n.lang;
  const has = (i: Intent) => n.intents.includes(i);
  if (n.slots.reason && !st.slots.reason) st.slots.reason = n.slots.reason;
  // A bare "11" or "11:30" answering a time question means that time.
  if (["eta", "finish", "left_at", "callback"].includes(st.goal) && !n.slots.eta && !n.slots.leftAt && !n.slots.callback && /^\D{0,6}\d{1,2}([:.]\d{2})?\D{0,6}$/.test(text)) {
    const tm = parseTime(text.replace(/(\d{1,2})(?![:.\d])/, "$1 baje"), ctx.nowMin);
    if (tm) { if (st.goal === "left_at") n.slots.leftAt = tm.at; else if (st.goal === "callback") n.slots.callback = tm.at; else n.slots.eta = tm.at; }
  }
  const ret: Turn = { state: st, reply: "", nlu: n, done: false };
  const finish = (t: Turn) => ({ ...t, nlu: n });

  // ── Safety and control: rules only, highest priority, end the call.
  if (has("harassment")) { st.flags.escalate = true; st.flags.urgent = true; followup("harassment_report"); say("harassment"); return finish(end("escalated", false)); }
  if (has("accident")) { st.flags.escalate = true; st.flags.urgent = true; st.slots.reason = "emergency"; followup("accident_report"); say("accident"); return finish(end("escalated", false)); }
  if (has("stop_calls")) { st.flags.stop = true; say("stop"); return finish(end("stopped", false)); }
  if (has("human")) { st.flags.escalate = true; followup("human_requested"); say("human"); return finish(end("human_requested")); }
  if (has("emergency") && (st.reason === "late" || st.reason === "absent" || st.goal === "permission")) {
    st.flags.escalate = true; st.slots.reason = "emergency"; followup("emergency"); say("emergency"); return finish(end("escalated"));
  }
  if (has("complaint") && !domainSignal(n, st.reason)) { st.flags.escalate = true; followup("grievance"); say("complaint"); return finish(end("escalated")); }

  // ── Tone
  if (n.tones.includes("angry")) {
    st.angry++;
    say("angry");
    if (st.angry >= 2) { st.flags.escalate = true; followup("upset_employee"); say("human"); return finish(end("human_requested", false)); }
  }
  if (n.tones.includes("uncomfortable")) say("uncomfortable");

  // ── Questions the person asks: answer, then return to the pending question.
  if (has("why_call") && !domainSignal(n, st.reason, true)) {
    const why: Record<CallReason, Record<Lang, string>> = {
      late: { hinglish: "aaj aapka check-in shift shuru hone ke baad bhi record nahi hua.", hi: "आज शिफ्ट शुरू होने के बाद भी आपका चेक-इन दर्ज नहीं हुआ।", en: "your check-in wasn't recorded after your shift started today." },
      absent: { hinglish: "aaj na check-in hua hai na koi approved leave hai.", hi: "आज न चेक-इन हुआ है न कोई स्वीकृत छुट्टी है।", en: "there's no check-in and no approved leave for today." },
      missing_checkout: { hinglish: "shift khatam hone ke baad bhi checkout record nahi hua.", hi: "शिफ्ट खत्म होने के बाद भी चेकआउट दर्ज नहीं हुआ।", en: "no check-out was recorded after your shift ended." },
      overtime: { hinglish: "aapke manager ne overtime ki request ki hai.", hi: "आपके मैनेजर ने ओवरटाइम का अनुरोध किया है।", en: "your manager has requested overtime." },
      manual: { hinglish: "HR team ne follow-up ke liye kaha tha.", hi: "HR टीम ने फॉलो-अप के लिए कहा था।", en: "the HR team asked me to follow up." },
    };
    say("why_call", { purpose_text: why[st.reason][st.lang] }); reask(); ret.reply = out.join(" "); return ret;
  }
  const info = has("ai_identity") ? "ai_identity" : has("recording") ? "recording" : has("privacy") ? "privacy" : null;
  if (info && !domainSignal(n, st.reason, true)) { say(info); reask(); ret.reply = out.join(" "); return ret; }
  if ((has("policy_question") || has("payroll_question")) && !domainSignal(n, st.reason) && !(st.reason === "overtime" && has("overtime_clarify"))) {
    const hit = ctx.kb?.(text, st.lang) ?? null;
    if (hit) say("kb_answer", { answer: hit.answer, source: hit.source });
    else { followup("question_for_hr"); say("kb_unknown"); }
    if (st.reason === "manual") return finish(end("resolved"));
    reask(); ret.reply = out.join(" "); return ret;
  }
  if (has("unrelated") && !domainSignal(n, st.reason, true)) { say("unrelated"); reask(); ret.reply = out.join(" "); return ret; }

  // ── Busy / call back
  const wantsLater = (has("busy") || has("callback")) && !domainSignal(n, st.reason, true);
  if (st.goal === "callback" || wantsLater) {
    const cbRaw = n.slots.callback ?? parseCallback(text, ctx.nowMin);
    const cb = cbRaw === "later" && st.goal !== "callback" ? undefined : cbRaw; // "later" alone: ask for a time once
    if (cb) { st.slots.callback = cb; st.flags.callback = true; say("note_callback"); return finish(end("callback")); }
    if (st.goal === "callback") { st.flags.callback = true; followup("callback_time_unknown"); say("note_callback_hr"); return finish(end("callback")); }
    ask("ask_callback", "callback"); ret.reply = out.join(" "); return ret;
  }

  // ── Permission to talk
  const wordsIn = text.split(/\s+/).filter(Boolean).length;
  if (st.goal === "permission" && st.reason === "manual" && wordsIn >= 3 && !has("no")) st.goal = "free";
  if (has("attendance_dispute") && (st.reason === "late" || st.reason === "absent" || st.reason === "manual") && !has("already_checked_in") && !has("not_scheduled")) {
    followup("attendance_dispute"); say("note_dispute"); return finish(end("resolved"));
  }
  if (st.goal === "permission") {
    if (domainSignal(n, st.reason)) { /* answered the reason straight away: handled below */ }
    else if (has("no")) { followup("declined_to_talk"); say("close_decline"); return finish(end("declined", false)); }
    else if (has("yes") || has("greeting") || has("thanks") || has("dont_know") || n.primary === "unknown") {
      if (n.primary === "unknown" && !has("yes") && !has("greeting")) { /* treat an unclear first reply as a go-ahead: ask the question */ }
      ask(MAIN_Q[st.reason], MAIN_GOAL[st.reason]); ret.reply = out.join(" "); return ret;
    } else if (has("confused") || has("repeat")) { say("confused"); ask(MAIN_Q[st.reason], MAIN_GOAL[st.reason]); ret.reply = out.join(" "); return ret; }
    st.goal = MAIN_GOAL[st.reason];
  }

  const r = st.reason === "absent" ? "late" : st.reason;
  const t = r === "late" ? attendance(st, n, say, ask, end, followup)
    : r === "missing_checkout" ? checkout(st, n, say, ask, end, followup)
      : r === "overtime" ? overtime(st, n, say, ask, end, followup)
        : manual(st, n, say, end, followup, ctx, text);
  if (t) return finish(t);
  if (t === null) { ret.reply = out.join(" "); return ret; }

  // ── Nothing usable in the answer
  if (has("goodbye") || has("thanks")) { followup("incomplete"); return finish(end("incomplete")); }
  if (has("confused") || has("repeat")) {
    st.unclear++;
    if (st.unclear >= 3) { followup("unclear"); say("give_up"); return finish(end("unclear", false)); }
    say("confused"); const s = SIMPLE[st.reason]; if (s) { st.lastQ = s; say(s); } else reask(); ret.reply = out.join(" "); return ret; }
  st.unclear++;
  if (st.unclear >= 3) { followup("unclear"); say("give_up"); return finish(end("unclear", false)); }
  say("unclear");
  const s = SIMPLE[st.reason];
  if (st.unclear >= 2 && s) { st.lastQ = s; say(s); } else reask();
  ret.reply = out.join(" ");
  return ret;
}

type Say = (k: PhraseKey, extra?: Record<string, string>) => void;
type Ask = (k: PhraseKey, goal: Goal) => void;
type End = (why: EndReason, closing?: boolean) => Turn;
type Follow = (what: string) => void;
/** A handler ends the call (Turn), asked the next question (null), or found nothing to act on (undefined). */
type Handled = Turn | null | undefined;

/** Does the utterance carry an answer to this call's question (so it isn't treated as small talk)? */
function domainSignal(n: Nlu, reason: CallReason, strict = false): boolean {
  const i = new Set(n.intents);
  if (reason === "overtime") return i.has("overtime_accept") || i.has("overtime_reject") || i.has("overtime_clarify");
  if (reason === "missing_checkout") return i.has("still_working") || i.has("forgot_checkout") || i.has("left_early") || !!n.slots.leftAt;
  if (reason === "manual") return false;
  return i.has("not_scheduled") || i.has("coming") || i.has("absent") || i.has("leave_applied") || i.has("want_leave") || i.has("wfh") || i.has("half_day") || i.has("already_checked_in") || i.has("attendance_issue") || !!n.slots.eta || (!strict && !!n.slots.reason && n.slots.reason !== "other");
}

function attendance(st: State, n: Nlu, say: Say, ask: Ask, end: End, follow: Follow): Handled {
  const has = (i: Intent) => n.intents.includes(i);
  if (n.slots.eta) st.slots.eta = n.slots.eta;
  if (has("not_scheduled")) { st.slots.status = "not_scheduled"; follow("roster_check"); say("note_not_scheduled"); return end("resolved"); }
  if (has("wfh")) { st.slots.status = "wfh"; follow("wfh_request"); say("note_wfh"); return end("resolved"); }
  if (has("already_checked_in") || has("still_working")) { st.slots.status = "at_office"; follow("attendance_check"); say("note_checked_in"); return end("resolved"); }
  if (has("attendance_issue")) { st.slots.status = "system_issue"; st.slots.reason = "attendance_system"; follow("attendance_system_issue"); say("note_system"); return end("resolved"); }
  if (has("leave_applied")) { st.slots.status = "leave_applied"; follow("leave_pending"); say("note_leave_applied"); return end("resolved"); }
  if (has("half_day")) { st.slots.status = "half_day"; st.slots.leaveDraft = true; follow("half_day_request"); say("note_half_day"); return end("resolved"); }
  if (has("wfh")) { st.slots.status = "wfh"; follow("wfh_request"); say("note_wfh"); return end("resolved"); }
  if (has("want_leave") || (st.goal === "leave" && has("yes"))) { st.slots.status = "absent"; st.slots.leaveDraft = true; say("note_leave_draft"); return end("resolved"); }
  if (st.goal === "leave" && has("no")) { st.slots.status = "absent"; follow("absent_no_leave"); say("note_no_leave"); return end("resolved"); }
  if (has("absent") || (st.goal === "status" && has("no") && !has("coming"))) {
    st.slots.status = "absent";
    if (st.slots.reason && SENSITIVE.includes(st.slots.reason)) say("empathy"); else say("ack");
    ask("ask_leave", "leave"); return null;
  }
  const coming = has("coming") || (st.goal === "status" && has("yes")) || (st.goal === "eta" && !!st.slots.eta) || (!!n.slots.eta && st.goal !== "leave");
  const reasonOnly = !coming && !!n.slots.reason && (st.goal === "status" || st.goal === "permission");
  if (reasonOnly && SENSITIVE.includes(n.slots.reason!)) { st.slots.status = "absent"; say("empathy"); ask("ask_leave", "leave"); return null; }
  if (coming || reasonOnly) {
    st.slots.status = "coming";
    if (st.slots.eta) { say("note_eta"); return end("resolved"); }
    if (st.slots.reason && SENSITIVE.includes(st.slots.reason)) say("empathy"); else say("ack");
    ask("ask_eta", "eta"); return null;
  }
  if (st.goal === "eta" && has("dont_know") && !st.asked.includes("ask_eta_hint")) { ask("ask_eta_hint", "eta"); return null; }
  if (st.goal === "eta" && (has("no") || has("dont_know"))) { follow("eta_unknown"); say("note_followup"); return end("incomplete"); }
  return undefined;
}

function checkout(st: State, n: Nlu, say: Say, ask: Ask, end: End, follow: Follow): Handled {
  const has = (i: Intent) => n.intents.includes(i);
  if (st.goal === "finish" && n.slots.eta) { st.slots.eta = n.slots.eta; say("note_finish"); return end("resolved"); }
  if (st.goal === "left_at" && (n.slots.leftAt || n.slots.eta)) { st.slots.leftAt = n.slots.leftAt ?? n.slots.eta; follow("checkout_correction"); say("note_forgot"); return end("resolved"); }
  if (st.goal === "left_at" && (has("no") || has("unknown"))) { follow("checkout_correction"); say("note_forgot"); return end("resolved"); }
  if (has("still_working") || (st.goal === "status" && has("yes") && !has("forgot_checkout")) || (st.goal === "status" && !!n.slots.eta && !has("forgot_checkout") && !has("left_early"))) {
    st.slots.status = "still_working";
    if (n.slots.eta) { st.slots.eta = n.slots.eta; say("note_finish"); return end("resolved"); }
    say("ack"); ask("ask_finish", "finish"); return null;
  }
  if (has("forgot_checkout") || has("left_early") || n.slots.leftAt || (st.goal === "status" && has("no"))) {
    st.slots.status = "forgot_checkout";
    if (n.slots.leftAt) { st.slots.leftAt = n.slots.leftAt; follow("checkout_correction"); say("note_forgot"); return end("resolved"); }
    ask("ask_left_at", "left_at"); return null;
  }
  return undefined;
}

function overtime(st: State, n: Nlu, say: Say, ask: Ask, end: End, follow: Follow): Handled {
  const has = (i: Intent) => n.intents.includes(i);
  if (st.goal === "ot_confirm") {
    if (has("overtime_reject")) { st.slots.overtime = "rejected"; say("note_ot_no"); return end("resolved"); }
    if (has("yes") || has("overtime_accept")) { st.slots.overtime = "accepted"; say("note_ot_yes"); return end("resolved"); }
    if (has("no") || has("overtime_clarify")) { st.slots.overtime = "clarification"; follow("overtime_question"); say("note_ot_clarify"); return end("resolved"); }
    return undefined;
  }
  if (has("overtime_reject") || (has("no") && !has("overtime_accept"))) { st.slots.overtime = "rejected"; say("note_ot_no"); return end("resolved"); }
  if (has("overtime_clarify")) { st.slots.overtime = "clarification"; follow("overtime_question"); say("note_ot_clarify"); return end("resolved"); }
  if (has("overtime_accept") || has("yes")) { ask("ask_ot_confirm", "ot_confirm"); return null; }
  return undefined;
}

function manual(st: State, n: Nlu, say: Say, end: End, follow: Follow, ctx: Ctx, text: string): Handled {
  const words = text.trim().split(/\s+/).length;
  if ((n.primary === "unknown" && words < 3) || n.primary === "yes" || n.primary === "greeting") return undefined;
  const hit = ctx.kb?.(text, st.lang) ?? null;
  if (hit) { say("kb_answer", { answer: hit.answer, source: hit.source }); return end("resolved"); }
  follow("hr_followup"); say("note_followup"); return end("resolved");
}

/** Plays a whole conversation (used by tests, the playground and the scenario evaluation). */
export function converse(reason: CallReason, ctx: Ctx, utterances: string[]): { turns: { who: "ai" | "employee"; text: string }[]; state: State } {
  const first = start(reason, ctx);
  const turns: { who: "ai" | "employee"; text: string }[] = [{ who: "ai", text: first.reply }];
  let st = first.state;
  for (const u of utterances) {
    if (st.ended) break;
    turns.push({ who: "employee", text: u });
    const r = step(st, ctx, u);
    st = r.state;
    if (r.reply) turns.push({ who: "ai", text: r.reply });
  }
  return { turns, state: st };
}

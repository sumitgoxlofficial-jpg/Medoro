import { z } from "zod";
import type { CallReason, State } from "./engine";

// The validated outcome of every conversation (Part 13). It keeps apart what the employee actually said (`said`),
// what the assistant inferred from it (`inferred`), and what it recommends a person does (`recommended`). What HR
// approved lives in AiHrAction rows, never here. Nothing in this object changes attendance, leave, pay or overtime.

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const CALL_STATUSES = ["scheduled", "notified", "in_progress", "completed", "no_answer", "failed", "cancelled", "suppressed"] as const;

export const callOutput = z.object({
  organisationId: z.string().min(1),
  employeeId: z.string().min(1),
  callReason: z.enum(["late", "absent", "missing_checkout", "overtime", "manual"]),
  employeeResponse: z.enum(["coming", "absent", "leave_applied", "wfh", "half_day", "at_office", "system_issue", "not_scheduled", "still_working", "forgot_checkout", "overtime_accepted", "overtime_rejected", "overtime_question", "callback", "stopped", "escalated", "declined", "no_answer", "unclear", "unknown"]),
  reasonCategory: z.string().max(40),
  expectedArrivalTime: hhmm.nullable(),
  leaveRequestIntent: z.boolean(),
  overtimeResponse: z.enum(["accepted", "rejected", "clarification", "none"]).nullable(),
  callbackRequested: z.boolean(),
  callbackTime: z.string().max(40).nullable(),
  humanEscalationRequired: z.boolean(),
  escalationPriority: z.enum(["none", "normal", "urgent"]),
  employeeRequestedStop: z.boolean(),
  conversationSummary: z.string().min(1).max(600),
  confidenceScore: z.number().min(0).max(1),
  transcript: z.array(z.object({ who: z.enum(["ai", "employee"]), text: z.string().max(2000) })).max(80),
  callStartTime: z.string().nullable(),
  callEndTime: z.string().nullable(),
  callStatus: z.enum(CALL_STATUSES),
  said: z.array(z.string().max(500)).max(40),
  inferred: z.object({ status: z.string().nullable(), reason: z.string().nullable(), eta: hhmm.nullable(), leftAt: hhmm.nullable(), tones: z.array(z.string()), intents: z.array(z.string()) }),
  recommended: z.array(z.object({ kind: z.string(), priority: z.enum(["normal", "urgent"]), detail: z.string().max(300) })).max(12),
});
export type CallOutput = z.infer<typeof callOutput>;

function response(st: State): CallOutput["employeeResponse"] {
  switch (st.endReason) {
    case "stopped": return "stopped";
    case "callback": return "callback";
    case "declined": return "declined";
    case "no_answer": return "no_answer";
    case "unclear": return "unclear";
    case "human_requested": case "escalated": return "escalated"; // the escalation is the outcome; the status stays in `inferred`
  }
  if (st.slots.overtime === "accepted") return "overtime_accepted";
  if (st.slots.overtime === "rejected") return "overtime_rejected";
  if (st.slots.overtime === "clarification") return "overtime_question";
  return st.slots.status ?? "unknown";
}

const FOLLOWUP_TEXT: Record<string, string> = {
  harassment_report: "Harassment report: the designated HR person should contact the employee confidentially.",
  accident_report: "Accident or injury reported: check on the employee's safety now.",
  emergency: "Personal or family emergency: HR to check in; attendance can be handled later.",
  human_requested: "The employee asked to speak to a person in HR.",
  grievance: "The employee raised a concern or complaint.",
  upset_employee: "The employee was upset with the call; a person should follow up.",
  question_for_hr: "The employee asked a question the approved knowledge base doesn't answer.",
  attendance_dispute: "The employee disputes an attendance record: a correction may be needed.",
  roster_check: "The employee says they aren't scheduled now (weekly off, holiday or a different shift): check the roster and calendar.",
  attendance_check: "The employee says they are in the office: check the check-in record.",
  attendance_system_issue: "Attendance system problem reported (biometric, login, GPS or network).",
  leave_pending: "The employee says leave was already applied: a decision is pending.",
  half_day_request: "Half-day request: needs HR or manager approval.",
  wfh_request: "Work-from-home request: needs manager or HR approval.",
  absent_no_leave: "Absent today and didn't want to apply for leave.",
  checkout_correction: "Missed check-out: a correction is needed.",
  overtime_question: "Questions about the overtime request before answering.",
  callback_time_unknown: "Callback requested without a time.",
  declined_to_talk: "The employee didn't want to talk now.",
  no_answer: "No answer to the AI conversation.",
  unclear: "The conversation couldn't be understood.",
  incomplete: "The conversation ended before the details were complete.",
  eta_unknown: "Coming in but couldn't give a time.",
  hr_followup: "The employee asked for help that needs HR.",
};

/** Builds and validates the outcome from the conversation state. Throws if it would not validate. */
export function buildOutput(st: State, meta: { organisationId: string; employeeId: string; reason: CallReason; transcript: { who: "ai" | "employee"; text: string }[]; startedAt?: Date | null; endedAt?: Date | null; status: CallOutput["callStatus"] }): CallOutput {
  const rec: CallOutput["recommended"] = [];
  const urgent = st.flags.urgent;
  for (const f of st.flags.followup) rec.push({ kind: f, priority: ["harassment_report", "accident_report"].includes(f) ? "urgent" : "normal", detail: FOLLOWUP_TEXT[f] ?? f });
  if (st.slots.leaveDraft) rec.push({ kind: "leave_draft", priority: "normal", detail: `Leave request draft for HR/manager decision${st.slots.status === "half_day" ? " (half day)" : ""}.` });
  if (st.slots.eta && st.slots.status === "coming") rec.push({ kind: "expected_arrival", priority: "normal", detail: `Expected arrival ${st.slots.eta}.` });
  if (st.slots.overtime && st.slots.overtime !== "none") rec.push({ kind: "overtime_response", priority: "normal", detail: `Overtime ${st.slots.overtime}: the manager decides; nothing is approved automatically.` });
  if (st.flags.callback) rec.push({ kind: "callback", priority: "normal", detail: st.slots.callback ? `Call back ${st.slots.callback}.` : "Call back later." });
  if (st.flags.stop) rec.push({ kind: "stop_calls", priority: "normal", detail: "Employee asked for no more AI calls. Recorded as their preference." });
  const resp = response(st);
  const summaryBits = [
    `${meta.reason.replace("_", " ")} call`, `response: ${resp.replace(/_/g, " ")}`,
    st.slots.reason ? `reason: ${st.slots.reason.replace(/_/g, " ")}` : "",
    st.slots.eta ? `${st.slots.status === "still_working" ? "expects to finish" : "expected"} ${st.slots.eta}` : "",
    st.slots.leftAt ? `left about ${st.slots.leftAt}` : "",
    st.slots.leaveDraft ? "wants leave (draft for approval)" : "",
    st.slots.callback ? `callback ${st.slots.callback}` : "",
    st.flags.escalate ? `escalated${urgent ? " (urgent)" : ""}` : "",
    st.flags.stop ? "asked to stop AI calls" : "",
  ].filter(Boolean);
  const conf = st.confidences.length ? st.confidences.reduce((a, b) => a + b, 0) / st.confidences.length : 0;
  return callOutput.parse({
    organisationId: meta.organisationId, employeeId: meta.employeeId, callReason: meta.reason,
    employeeResponse: resp, reasonCategory: st.slots.reason ?? "",
    expectedArrivalTime: st.slots.status === "coming" ? st.slots.eta ?? null : null,
    leaveRequestIntent: !!st.slots.leaveDraft,
    overtimeResponse: meta.reason === "overtime" ? st.slots.overtime ?? "none" : null,
    callbackRequested: st.flags.callback, callbackTime: st.slots.callback ?? null,
    humanEscalationRequired: st.flags.escalate, escalationPriority: st.flags.escalate ? (urgent ? "urgent" : "normal") : "none",
    employeeRequestedStop: st.flags.stop,
    conversationSummary: summaryBits.join("; ").slice(0, 600),
    confidenceScore: Math.round(conf * 100) / 100,
    transcript: meta.transcript.slice(-80).map((t) => ({ who: t.who, text: t.text.slice(0, 2000) })),
    callStartTime: meta.startedAt?.toISOString() ?? null, callEndTime: meta.endedAt?.toISOString() ?? null, callStatus: meta.status,
    said: st.said.slice(-40),
    inferred: { status: st.slots.status ?? null, reason: st.slots.reason ?? null, eta: st.slots.eta ?? null, leftAt: st.slots.leftAt ?? null, tones: st.tones, intents: st.intents },
    recommended: rec.slice(0, 12),
  });
}

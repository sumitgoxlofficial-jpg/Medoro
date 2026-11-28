import type { CallReason } from "../engine";

// Scenario library format. Each category has ten distinct situations; each situation is what an employee actually says
// (primary utterance, usually Hinglish; Hindi-only and English-only categories use those), an English rendering, and
// the expected outcome in a compact, machine-checked form:
//   s=<employeeResponse>   final response (coming, absent, leave_applied, wfh, half_day, at_office, system_issue,
//                          not_scheduled, still_working, forgot_checkout, overtime_accepted, overtime_rejected,
//                          overtime_question, callback, stopped, escalated, declined, no_answer, unclear, unknown)
//   eta=HH:MM | eta=+N     expected arrival / finish (+N = N minutes after the call's time)
//   left=HH:MM             time the person left (missing check-out)
//   why=<reasonCategory>   reason the person gave (traffic, public_transport, vehicle, weather, illness, medical,
//                          family, emergency, personal, attendance_system, work)
//   cb=<label>             callback time (HH:MM, tomorrow, evening, later)
//   esc=1 | esc=urgent     human escalation (urgent for safety)
//   leave=1                a leave draft is proposed for HR/manager approval
//   next=<question>        the conversation is still open and this is the next question (ask_eta, ask_leave, ...)
//   kb=any                 an HR question: answered from approved knowledge with a source, or routed to HR (never invented)
//   stop=1                 stop-call preference recorded
// Turns inside one situation are separated by " || ". An empty turn is silence.

export type Item = [primary: string, english: string, expect: string];
export type Category = {
  id: string; name: string; reason: CallReason;
  objective: string; escalation: string;
  /** Two genuine Devanagari examples for the category (the Hindi example of its scenarios). */
  hi: [string, string];
  items: Item[];
};
export const cat = (id: string, name: string, reason: CallReason, objective: string, escalation: string, hi: [string, string], items: Item[]): Category => ({ id, name, reason, objective, escalation, hi, items });

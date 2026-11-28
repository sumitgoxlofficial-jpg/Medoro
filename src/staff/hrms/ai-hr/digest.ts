// The AI HR Assistant's weekly summary for HR: which week it covers, and the counts it reports (from database rows).
// No names or transcript text are emailed; HR opens the module for details.

export type DigestStats = {
  conversations: number; completed: number; noAnswer: number;
  byReason: { late: number; absent: number; missing_checkout: number; overtime: number; manual: number };
  coming: number; absent: number; otAccepted: number; otRejected: number; escalations: number; stops: number;
  actionsRaised: number; openActions: number; urgentOpen: number; unclear: number;
};

/** The Monday (India time) of the week `now` falls in, as YYYY-MM-DD: one summary per value. */
export function digestWeek(now: Date): string {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const back = (ist.getUTCDay() + 6) % 7; // days since Monday
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - back)).toISOString().slice(0, 10);
}

/** The summary as label/value rows, in the order HR reads them. */
export function digestFacts(s: DigestStats): [string, string][] {
  const n = (x: number) => String(x);
  return [
    ["Conversations", `${s.conversations} (${s.completed} completed, ${s.noAnswer} no answer)`],
    ["About", `late ${s.byReason.late} · absent ${s.byReason.absent} · missing check-out ${s.byReason.missing_checkout} · overtime ${s.byReason.overtime} · HR follow-up ${s.byReason.manual}`],
    ["Said they were coming", n(s.coming)],
    ["Said they were absent", n(s.absent)],
    ["Overtime accepted / declined", `${s.otAccepted} / ${s.otRejected}`],
    ["Needed a person (escalations)", n(s.escalations)],
    ["Asked the assistant to stop", n(s.stops)],
    ["Follow-ups raised this week", n(s.actionsRaised)],
    ["Waiting for HR now", s.urgentOpen ? `${s.openActions} (${s.urgentOpen} urgent)` : n(s.openActions)],
    ["Answers not understood", n(s.unclear)],
  ];
}

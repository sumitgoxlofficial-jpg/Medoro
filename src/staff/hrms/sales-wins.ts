// Real-win helpers for the Sales channel: richer win announcements, team milestones and the leaderboard ranking.
// Everything here works from real CRM records (ConversionRecord, DemoBooking). Shared by server code and the chat
// screen, so there are no server imports.

/** Sender id for team milestone posts. It is not a staff account; the chat shows it as "Sales team". */
export const TEAM_ID = "system:sales-team";
export const TEAM_NAME = "Sales team";
export const isTeamId = (id: string) => id === TEAM_ID;

export const ordinal = (n: number) => {
  const v = n % 100;
  const suf = v >= 11 && v <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suf}`;
};

/** The real counts for the person behind a win, counted up to and including that win. */
export type WinCounts = { today: number; week: number; total: number };

/** A sale announcement with the rep's real streak: first sale ever, nth today, n this week. */
export function saleBody(plan: string, c: WinCounts): string {
  const head = `Just closed a sale 🎉${plan ? ` Medoro ${plan}` : ""}`;
  if (c.total === 1) return `${head}\n🥳 First sale ever! Welcome to the board.`;
  const bits: string[] = [];
  if (c.today >= 2) bits.push(`${ordinal(c.today)} sale today${c.today >= 3 ? " 🔥" : ""}`);
  if (c.week >= 3 && c.week > c.today) bits.push(`${c.week} this week`);
  return bits.length ? `${head}\n${bits.join(" · ")}` : head;
}

/** A demo booking announcement with the real count of demos booked today. */
export function demoBody(mode: string, todayN: number): string {
  const head = `Just booked ${mode || "a demo"} call 📅`;
  return todayN >= 2 ? `${head}\n${ordinal(todayN)} demo booked today` : head;
}

export const SALE_MILESTONES = [5, 10, 15, 20, 30, 40, 50, 75, 100] as const;
export const DEMO_MILESTONES = [10, 20, 30, 50, 75, 100] as const;

/** Thresholds passed when a real daily total goes from `before` to `after`. */
export const crossed = (steps: readonly number[], before: number, after: number) => steps.filter((s) => s > before && s <= after);

export function milestoneBody(kind: "sale" | "demo", n: number): string {
  return kind === "sale" ? `🏁 Team milestone: ${n} sales closed today! Keep it rolling 🚀` : `🏁 Team milestone: ${n} demos booked today! 📅`;
}

export type BoardRow = { staffId: string; name: string; photo: string | null; sales: number; demos: number };
/** Top people by real sales, then demos booked, then name. People with nothing are left out. */
export function rankBoard(rows: BoardRow[], top = 5): BoardRow[] {
  return rows
    .filter((r) => r.sales > 0 || r.demos > 0)
    .sort((a, b) => b.sales - a.sales || b.demos - a.demos || a.name.localeCompare(b.name))
    .slice(0, top);
}

const IST = 330 * 60_000;
/** Start of the India day holding `d`, as a real instant. */
export const istDayStart = (d: Date) => new Date(Date.parse(new Date(d.getTime() + IST).toISOString().slice(0, 10) + "T00:00:00Z") - IST);
/** Start of the India week (Monday 00:00) holding `d`. */
export function istWeekStart(d: Date): Date {
  const day = istDayStart(d);
  const dow = new Date(day.getTime() + IST).getUTCDay(); // 0 = Sunday
  return new Date(day.getTime() - ((dow + 6) % 7) * 86400_000);
}

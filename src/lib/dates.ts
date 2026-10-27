// Dates for business logic are calendar days in India time (Asia/Kolkata).
const DAY = 86_400_000;
const IST_OFFSET = 330 * 60_000;

/** Today's date in IST as YYYY-MM-DD. */
export function todayISO(now = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET).toISOString().slice(0, 10);
}

/** Midnight UTC for an ISO date — how @db.Date values come back from Prisma. */
export const dateOnly = (iso: string) => new Date(iso + "T00:00:00.000Z");

export const isoOf = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(iso: string, n: number): string {
  return isoOf(new Date(dateOnly(iso).getTime() + n * DAY));
}

/** Whole days from today to the given date (negative = in the past). */
export function daysTo(date: Date | string, today = todayISO()): number {
  const iso = typeof date === "string" ? date.slice(0, 10) : isoOf(date);
  return Math.round((dateOnly(iso).getTime() - dateOnly(today).getTime()) / DAY);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 2026" */
export function monthYear(date: Date | string): string {
  const d = typeof date === "string" ? dateOnly(date.slice(0, 10)) : date;
  return MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear();
}

/** "27 Oct" or "27 Oct 2026" in IST */
export function dayMonth(date: Date, withYear = false): string {
  const d = new Date(date.getTime() + IST_OFFSET);
  return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + (withYear ? " " + d.getUTCFullYear() : "");
}

/** "14:05" in IST */
export function hhmm(date: Date): string {
  const d = new Date(date.getTime() + IST_OFFSET);
  return String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0");
}

/** Indian fiscal year code, April–March: 27 Oct 2026 → "2627". */
export function fiscalYear(iso = todayISO()): string {
  const [y, m] = iso.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return String(start % 100).padStart(2, "0") + String((start + 1) % 100).padStart(2, "0");
}

/** Start of today in IST, as a Date (for "today" queries). */
export function startOfTodayIST(now = new Date()): Date {
  return new Date(dateOnly(todayISO(now)).getTime() - IST_OFFSET);
}

export function weekdayLong(iso = todayISO()): string {
  const d = dateOnly(iso);
  return d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** Midnight IST at the start of an ISO date, as an instant (for timestamp columns). */
export const istMidnight = (iso: string) => new Date(dateOnly(iso).getTime() - IST_OFFSET);

/** IST calendar date of an instant. */
export const istDate = (d: Date) => new Date(d.getTime() + IST_OFFSET).toISOString().slice(0, 10);

// Pay cycles. Some people are paid by calendar month (everyone before pay cycles existed); a new joiner is paid on a
// monthly cycle that starts on their joining day: joined 13 Nov, the first cycle is 13 Nov to 12 Dec and the salary is
// paid on 13 Dec, then on the 13th of every month. A day the month doesn't have (the 31st in November) becomes the
// month's last day. A payslip is filed under the month the salary is PAID in.
import { addDays } from "@/lib/dates";

const pad = (n: number) => String(n).padStart(2, "0");
export const daysIn = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
export const addMonthsYm = (ym: string, n: number) => { const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; };
const dayIn = (anchor: number, ym: string) => `${ym}-${pad(Math.min(anchor, daysIn(ym)))}`;

/** The days a payslip filed under pay month `ym` pays for, and the day it is due. `anchor` 0 is the calendar month. */
export function cycleWindow(anchor: number, ym: string): { from: string; to: string; payDate: string } {
  if (!anchor) return { from: `${ym}-01`, to: `${ym}-${pad(daysIn(ym))}`, payDate: `${ym}-${pad(daysIn(ym))}` };
  const payDate = dayIn(anchor, ym);
  return { from: dayIn(anchor, addMonthsYm(ym, -1)), to: addDays(payDate, -1), payDate };
}
/** The cycle day for someone who joins on `joinDate` (YYYY-MM-DD). */
export const cycleDayOf = (joinDate: string) => Number(joinDate.slice(8, 10));
/** The pay month and date of the first salary of someone who joins on `joinDate`: a month after the joining day. */
export function firstSalary(joinDate: string) {
  const anchor = cycleDayOf(joinDate), ym = addMonthsYm(joinDate.slice(0, 7), 1);
  return { ym, ...cycleWindow(anchor, ym) };
}

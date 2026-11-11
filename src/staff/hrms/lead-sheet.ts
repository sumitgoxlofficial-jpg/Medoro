import "server-only";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { log } from "@/server/log";
import { staffAudit } from "../auth";
import { audit, need, type Me } from "./auth";
import { MAX_NEW_PER_RUN, assignWaiting, importText } from "./leads";

// The master lead list lives in a Google Sheet. HR pastes its link once; Medoro reads it as CSV (the sheet must be shared as
// "Anyone with the link can view"), adds the leads it doesn't know yet (by phone number) and, if switched on, hands the new ones
// to the sales team. It runs when HR presses Sync and, if switched on, once a day. No Google sign-in or extra permission is used.
const KEY = "leadSheet";
type Last = { at: string; by: string; added: number; assigned: number; skipped: number; more: boolean; error: string };
type Cfg = { url: string; auto: boolean; assign: boolean; last: Last | null };
const EMPTY: Cfg = { url: "", auto: false, assign: true, last: null };
const MAX_BYTES = 5_000_000;

/** Pulls the spreadsheet id (and tab) out of a Google Sheets link. Only docs.google.com sheet links are accepted. */
export function parseSheetUrl(raw: string): { id: string; gid: string } | null {
  const m = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})(?:[/?#]|$)/.exec(raw.trim());
  if (!m) return null;
  return { id: m[1], gid: /[#&?]gid=(\d{1,12})/.exec(raw)?.[1] ?? "0" };
}
const load = async (): Promise<Cfg> => ({ ...EMPTY, ...(((await db.hrSetting.findUnique({ where: { key: KEY } }))?.value ?? {}) as Partial<Cfg>) });
const save = (c: Cfg) => db.hrSetting.upsert({ where: { key: KEY }, update: { value: c as object }, create: { key: KEY, value: c as object } });

export async function sheetStatus(me: Me) {
  need(me, "leads");
  const c = await load();
  return { url: c.url, auto: c.auto, assign: c.assign, last: c.last, maxPerRun: MAX_NEW_PER_RUN };
}
export async function saveSheet(me: Me, raw: { url: string; auto: boolean; assign: boolean }) {
  need(me, "leads");
  const url = String(raw.url ?? "").trim();
  if (url && !parseSheetUrl(url)) throw new UserError("Paste the Google Sheet link (it starts with https://docs.google.com/spreadsheets/d/…).");
  const c = await load();
  await save({ ...c, url, auto: !!url && !!raw.auto, assign: !!raw.assign });
  await audit(me, url ? "Lead sheet connected" : "Lead sheet disconnected", url ? parseSheetUrl(url)!.id : "");
  return { saved: true };
}

async function fetchCsv(url: string): Promise<string> {
  const p = parseSheetUrl(url);
  if (!p) throw new UserError("Connect a Google Sheet first.");
  const r = await fetch(`https://docs.google.com/spreadsheets/d/${p.id}/export?format=csv&gid=${p.gid}`, { redirect: "follow", signal: AbortSignal.timeout(25_000) }).catch(() => null);
  const type = r?.headers.get("content-type") ?? "";
  if (!r || !r.ok || /text\/html/i.test(type)) throw new UserError("Medoro couldn’t read the sheet. Open it in Google Sheets ▸ Share ▸ General access ▸ “Anyone with the link” ▸ Viewer, then try again.");
  const text = await r.text();
  if (text.length > MAX_BYTES) throw new UserError("The sheet is too large to read in one go. Split it into tabs of up to about 20,000 rows.");
  return text;
}

/** Reads the sheet, adds the new leads, optionally gives them out. `by` is the person who pressed Sync, or "Daily sync". */
export async function runSync(by: string) {
  const c = await load();
  const at = new Date().toISOString();
  try {
    const r = await importText(await fetchCsv(c.url), { maxChars: MAX_BYTES, limit: MAX_NEW_PER_RUN });
    const assignedNow = c.assign ? await assignWaiting() : 0;
    const last: Last = { at, by, added: r.added, assigned: r.assigned + assignedNow, skipped: r.skippedCount, more: r.more, error: "" };
    await save({ ...c, last });
    return { ...last, skippedRows: r.skipped };
  } catch (e) {
    const error = e instanceof UserError ? e.message : "Couldn’t sync the sheet. Try again.";
    if (!(e instanceof UserError)) log.error("lead sheet sync failed", { err: e });
    await save({ ...c, last: { at, by, added: 0, assigned: 0, skipped: 0, more: false, error } });
    throw e instanceof UserError ? e : new UserError(error);
  }
}
export async function syncSheet(me: Me) {
  need(me, "leads");
  if (!(await load()).url) throw new UserError("Paste the Google Sheet link and save it first.");
  const r = await runSync(me.name);
  await audit(me, "Lead sheet synced", `${r.added} added · ${r.assigned} given out · ${r.skipped} skipped`);
  return r;
}
/** The daily job: syncs when the sheet is connected and automatic sync is on. */
export async function leadSheetTick() {
  const c = await load();
  if (!c.url || !c.auto) return;
  try {
    const r = await runSync("Daily sync");
    await staffAudit({ id: null, name: "Lead sheet" }, "HRMS · Lead sheet synced", `${r.added} added · ${r.assigned} given out · ${r.skipped} skipped`);
  } catch { /* the failure is saved in the status and shown on the Leads screen */ }
}

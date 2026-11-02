/**
 * Hindi for every screen. Text is written in English in the code and looked up here:
 *
 *   t("Save")                          → "सेव करें"
 *   t("Only {n} in this batch.", { n }) → the Hindi line with {n} filled in
 *   t(`Only ${have} in this batch.`)   → also works: an entry with {…} placeholders matches dynamic text
 *   t("Open", { ctx: "verb" })         → "Open@verb" when one word needs different Hindi on different screens
 *
 * Text with no Hindi entry is shown in English, so a missing line never breaks a screen. The Hindi lines live in
 * src/lib/hi/*.ts, one file per area; `i18n-coverage.test.ts` fails when a t("…") or <T>…</T> in the code has no
 * Hindi line. Works on the server and in the browser (no React here).
 *
 * The Hindi lines are large, so browsers load them only when Hindi is chosen (LangProvider calls loadHindi());
 * the server gets them all up front from src/lib/hi-load.ts.
 */
type Pattern = { re: RegExp; names: string[]; hi: string };
let patterns: Pattern[] | null = null;
let HI: Record<string, string> = {};
let loaded = false;
let loading: Promise<void> | null = null;
/** Sets the Hindi lines (src/lib/hi-load.ts does this on the server). */
export const setHindi = (d: Record<string, string>) => { HI = d; loaded = true; patterns = null; };

/** Whether the Hindi lines are here (or couldn't be fetched, in which case screens show English). */
export const hindiLoaded = () => loaded;

/** Loads the Hindi lines (once). If they can't be fetched (offline on a new device), screens stay in English. */
export function loadHindi(): Promise<void> {
  if (loaded) return Promise.resolve();
  // A failed fetch counts as done (English) so the page doesn't keep retrying; the next page load tries again.
  loading ??= import("./hi").then((m) => setHindi(m.HI), () => { loaded = true; });
  return loading;
}

export type Lang = "en" | "hi";
export type Vars = Record<string, string | number | null | undefined>;
export type TFn = (s: string, vars?: Vars) => string;

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k]))) : s);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Entries with {placeholders}, longest first so the most specific line wins. */
function compiled(): Pattern[] {
  if (patterns) return patterns;
  patterns = Object.entries(HI).filter(([k]) => /\{\w+\}/.test(k)).sort((a, b) => b[0].length - a[0].length).map(([k, hi]) => {
    const names: string[] = [];
    const re = new RegExp("^" + k.split(/(\{\w+\})/).map((part) => {
      const m = /^\{(\w+)\}$/.exec(part);
      if (!m) return esc(part);
      names.push(m[1]);
      return "([\\s\\S]+?)";
    }).join("") + "$");
    return { re, names, hi };
  });
  return patterns;
}

/** Hindi for one line of English (the line itself when there is none). */
export function hindi(s: string, vars?: Vars): string {
  // The same English word can need different Hindi on different screens ("Open" a page vs an "Open" claim):
  // t("Open", { ctx: "verb" }) looks for "Open@verb" first. English is unchanged.
  const ctx = vars?.ctx ? HI[`${s}@${vars.ctx}`] : undefined;
  const direct = ctx ?? HI[s] ?? HI[s.trim()];
  if (direct !== undefined) return fill(direct, vars);
  if (vars) return fill(s, vars);
  if (!s || !/[A-Za-z]/.test(s)) return s;
  for (const p of compiled()) {
    const m = p.re.exec(s);
    if (!m) continue;
    const got: Vars = {};
    p.names.forEach((n, i) => { const v = m[i + 1]; got[n] = HI[v] ?? v; });
    return fill(p.hi, got);
  }
  return s;
}

/** The text in the chosen language. */
export const translate = (lang: Lang, s: string, vars?: Vars) => (lang === "hi" ? hindi(s, vars) : fill(s, vars));

/** A t() for one language: `const t = tFor(ctx.lang)`. */
export const tFor = (lang: Lang): TFn => (s, vars) => translate(lang, s, vars);

/** For dates and numbers: "hi-IN" or "en-IN". */
export const localeOf = (lang: Lang) => (lang === "hi" ? "hi-IN" : "en-IN");

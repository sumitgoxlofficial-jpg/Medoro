/**
 * Hindi for every screen. Text is written in English in the code and looked up here:
 *
 *   t("Save")                          → "सेव करें"
 *   t("Only {n} in this batch.", { n }) → the Hindi line with {n} filled in
 *   t(`Only ${have} in this batch.`)   → also works: an entry with {…} placeholders matches dynamic text
 *
 * Text with no Hindi entry is shown in English, so a missing line never breaks a screen. The Hindi lines live in
 * src/lib/hi/*.ts, one file per area; `i18n-coverage.test.ts` fails when a t("…") or <T>…</T> in the code has no
 * Hindi line. Works on the server and in the browser (no React here).
 */
import { HI } from "./hi";

export type Lang = "en" | "hi";
export type Vars = Record<string, string | number | null | undefined>;
export type TFn = (s: string, vars?: Vars) => string;

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k]))) : s);

type Pattern = { re: RegExp; names: string[]; hi: string };
let patterns: Pattern[] | null = null;
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
  const direct = HI[s] ?? HI[s.trim()];
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

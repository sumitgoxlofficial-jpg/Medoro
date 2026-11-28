import { normalise } from "../nlu";
import type { CallReason } from "../engine";
import { LIB_1 } from "./lib-1";
import { LIB_2 } from "./lib-2";
import { LIB_3 } from "./lib-3";
import { LIB_4 } from "./lib-4";
import { LIB_5 } from "./lib-5";
import { LIB_6 } from "./lib-6";
import type { Category } from "./types";

export const CATEGORIES: Category[] = [...LIB_1, ...LIB_2, ...LIB_3, ...LIB_4, ...LIB_5, ...LIB_6];
export const LIBRARY_VERSION = "2027.01.2";

export type Scenario = {
  id: string; category: string; categoryName: string; callReason: CallReason;
  situation: string; opening: string; turns: string[]; english: string; hindi: string; hindiSource: "category";
  objective: string; escalation: string; expect: Record<string, string>;
  /** Every fifth scenario is held out: it is reported separately and was not used to tune the rules. */
  split: "tuning" | "held_out";
};

export function parseExpect(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.trim().split(/\s+(?=\w+=)/)) { const i = part.indexOf("="); if (i > 0) out[part.slice(0, i)] = part.slice(i + 1).trim(); }
  return out;
}

export function scenarios(): Scenario[] {
  const out: Scenario[] = [];
  for (const c of CATEGORIES) {
    c.items.forEach(([primary, english, expect], i) => {
      const turns = primary.split("||").map((t) => t.trim());
      out.push({
        id: `${c.id}-${String(i + 1).padStart(2, "0")}`, category: c.id, categoryName: c.name, callReason: c.reason,
        situation: `${c.name}: ${english.split("||")[0].trim()}`, opening: turns[0], turns, english, hindi: c.hi[i % 2], hindiSource: "category",
        objective: c.objective, escalation: c.escalation, expect: parseExpect(expect), split: i % 5 === 4 ? "held_out" : "tuning",
      });
    });
  }
  return out;
}

export type Validation = { total: number; categories: number; perCategory: Record<string, number>; duplicates: string[]; problems: string[]; valid: number };
const KEYS = new Set(["s", "eta", "left", "why", "cb", "esc", "leave", "next", "kb", "stop"]);

/** Structural validation of the library: counts, unique ids, unique utterances, known expectation keys. */
export function validateLibrary(list = scenarios()): Validation {
  const perCategory: Record<string, number> = {};
  const seen = new Map<string, string>(), ids = new Set<string>();
  const duplicates: string[] = [], problems: string[] = [];
  for (const s of list) {
    perCategory[s.category] = (perCategory[s.category] ?? 0) + 1;
    if (ids.has(s.id)) problems.push(`${s.id}: duplicate id`); ids.add(s.id);
    const k = normalise(s.turns.join(" | "));
    if (k.replace(/[|\s]/g, "") && seen.has(k)) duplicates.push(`${s.id} = ${seen.get(k)}`); else seen.set(k, s.id);
    if (!Object.keys(s.expect).length) problems.push(`${s.id}: no expectation`);
    for (const key of Object.keys(s.expect)) if (!KEYS.has(key)) problems.push(`${s.id}: unknown expectation ${key}`);
    if (!s.english.trim() || !s.hindi.trim()) problems.push(`${s.id}: missing language example`);
  }
  for (const [c, n] of Object.entries(perCategory)) if (n < 10) problems.push(`${c}: only ${n} scenarios`);
  const bad = new Set([...duplicates.map((d) => d.split(" ")[0]), ...problems.map((p) => p.split(":")[0])]);
  return { total: list.length, categories: Object.keys(perCategory).length, perCategory, duplicates, problems, valid: list.filter((s) => !bad.has(s.id)).length };
}

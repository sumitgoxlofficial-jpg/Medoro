/**
 * Every line the code marks for translation — t("…"), t(`…` without ${}), <T>…</T> — must have a Hindi line in
 * src/lib/hi/*.ts, so switching to हिंदी never leaves English behind on a screen.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HI } from "./hi";
import { hindi, translate } from "./tr";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" || n === "hi" ? [] : files(p);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

const unescape = (s: string) => s.replace(/\\(["'`\\])/g, "$1").replace(/\\n/g, "\n");

/** The marked lines in one file. */
function marked(text: string): string[] {
  // Comment lines are examples, not screen text.
  const src = text.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
  const out: string[] = [];
  for (const m of src.matchAll(/\bt\(\s*"((?:[^"\\\n]|\\.)*)"/g)) out.push(unescape(m[1]));
  for (const m of src.matchAll(/\bt\(\s*'((?:[^'\\\n]|\\.)*)'/g)) out.push(unescape(m[1]));
  for (const m of src.matchAll(/\bt\(\s*`((?:[^`\\$]|\\.)*)`/g)) out.push(unescape(m[1]));
  for (const m of src.matchAll(/<T(?:\s+vars=\{\{[^}]*\}\})?>([^<{]+)<\/T>/g)) out.push(m[1].replace(/\s+/g, " ").trim());
  for (const m of src.matchAll(/<T(?:\s+vars=\{\{[^}]*\}\})?>\{\s*"((?:[^"\\]|\\.)*)"\s*\}<\/T>/g)) out.push(unescape(m[1]));
  return out.filter((s) => /[A-Za-z]/.test(s));
}

describe("Hindi", () => {
  it("has a Hindi line for every marked English line", () => {
    const missing = new Map<string, string>();
    for (const f of files(join(__dirname, ".."))) {
      for (const s of marked(readFileSync(f, "utf8"))) if (!(s in HI) && !(s.trim() in HI)) missing.set(s, f.slice(f.indexOf("src/")));
    }
    const list = [...missing].map(([s, f]) => `${f}: ${JSON.stringify(s)}`);
    expect(list, `Add these to src/lib/hi/*.ts:\n${list.join("\n")}`).toEqual([]);
  });

  it("keeps placeholders in the Hindi lines", () => {
    const bad = Object.entries(HI).filter(([en, hi]) => {
      const names = (x: string) => [...x.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
      return names(en) !== names(hi);
    }).map(([en]) => en);
    expect(bad).toEqual([]);
  });

  it("has no empty Hindi lines", () => {
    expect(Object.entries(HI).filter(([, hi]) => !hi.trim()).map(([en]) => en)).toEqual([]);
  });

  it("translates exact lines, filled templates and dynamic text", () => {
    expect(translate("en", "Close")).toBe("Close");
    expect(translate("hi", "Close")).toBe(HI.Close);
    expect(translate("en", "Only {n} left", { n: 3 })).toBe("Only 3 left");
    expect(hindi("A line nobody wrote")).toBe("A line nobody wrote");
    const key = Object.keys(HI).find((k) => /^[^{]*\{\w+\}[^{]*$/.test(k));
    if (key) {
      const sample = key.replace(/\{\w+\}/, "42");
      expect(hindi(sample)).toContain("42");
      expect(hindi(sample)).not.toBe(sample);
    }
  });
});

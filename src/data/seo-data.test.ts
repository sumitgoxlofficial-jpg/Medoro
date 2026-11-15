import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPARISONS, CRITERIA, MEDORO } from "./comparisons";
import { FEATURES } from "./features";
import { HSN_CATEGORIES, HSN_CODES } from "./hsn-codes";
import { LOCATIONS, STATES, locationBySlug, locationPath } from "./locations";
import { COMPARE_LINKS, FEATURE_LINKS, SOLUTION_LINKS, TOOL_LINKS, TOP_CITY_LINKS } from "./site-links";
import { SOLUTIONS } from "./solutions";
import { TOOLS } from "./tools";

const app = join(__dirname, "../app");

describe("SEO page data", () => {
  it("keeps the footer link lists in step with the page data", () => {
    expect(FEATURE_LINKS).toEqual(FEATURES.map((f) => [f.name, `/features/${f.slug}`]));
    expect(COMPARE_LINKS).toEqual(COMPARISONS.map((c) => [c.name, `/compare/${c.slug}`]));
    expect(TOOL_LINKS).toEqual(TOOLS.map((t) => [t.name, `/tools/${t.slug}`]));
    expect(SOLUTION_LINKS).toEqual(SOLUTIONS.map((s) => [s.name, `/solutions/${s.slug}`]));
    for (const [name, path] of TOP_CITY_LINKS) {
      const l = LOCATIONS.find((x) => locationPath(x.slug) === path);
      expect(l?.name, path).toBe(name);
    }
  });

  it("has a route for every tool", () => {
    for (const t of TOOLS) expect(existsSync(join(app, "tools", t.slug, "page.tsx")), t.slug).toBe(true);
  });

  it("has unique slugs", () => {
    for (const list of [FEATURES, COMPARISONS, TOOLS, SOLUTIONS, LOCATIONS]) {
      const slugs = list.map((x) => x.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
    }
  });

  it("keeps titles and descriptions within what Google shows", () => {
    for (const p of [...FEATURES, ...COMPARISONS, ...TOOLS, ...SOLUTIONS]) {
      expect(`${p.title} | Medoro`.length, p.slug).toBeLessThanOrEqual(70);
      expect(p.description.length, p.slug).toBeLessThanOrEqual(165);
      expect(p.description.length, p.slug).toBeGreaterThanOrEqual(110);
    }
  });

  it("only links to pages that exist", () => {
    const features = new Set(FEATURES.map((f) => f.slug));
    const tools = new Set(TOOLS.map((t) => t.slug));
    for (const f of FEATURES) {
      for (const r of f.related) expect(features.has(r), `${f.slug} → ${r}`).toBe(true);
      for (const t of f.tools) expect(tools.has(t), `${f.slug} → ${t}`).toBe(true);
    }
    for (const s of SOLUTIONS) for (const r of s.features) expect(features.has(r), `${s.slug} → ${r}`).toBe(true);
    for (const t of TOOLS) for (const r of t.features) expect(features.has(r), `${t.slug} → ${r}`).toBe(true);
    for (const l of LOCATIONS) {
      expect(STATES[l.state], l.slug).toBeDefined();
      for (const n of l.nearby) expect(locationBySlug(n), `${l.slug} → ${n}`).toBeDefined();
    }
  });

  it("fills every comparison row for both columns", () => {
    for (const c of COMPARISONS) for (const { key } of CRITERIA) {
      expect(c.them[key]?.note, `${c.slug}.${key}`).toBeTruthy();
      expect(MEDORO[key]?.note, key).toBeTruthy();
    }
  });

  it("has a usable HSN dataset", () => {
    expect(HSN_CODES.length).toBeGreaterThanOrEqual(30);
    expect(new Set(HSN_CODES.map((h) => h.id)).size).toBe(HSN_CODES.length);
    for (const h of HSN_CODES) {
      expect(HSN_CATEGORIES).toContain(h.category);
      expect(h.hsn.replace(/\s/g, ""), h.id).toMatch(/^\d{4}(\d{2})?$/);
      if (h.hsn8) expect(h.hsn8.replace(/\s/g, ""), h.id).toMatch(/^\d{8}$/);
      expect([0, 5, 12, 18, 40]).toContain(h.gst);
    }
  });
});

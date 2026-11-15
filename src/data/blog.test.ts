import { describe, expect, it } from "vitest";
import { LANDING_LINKS } from "@/components/site/landing-links";
import { COMPARISONS } from "./comparisons";
import { FEATURES } from "./features";
import { LOCATIONS, locationPath } from "./locations";
import { POSTS, POSTS_BY_DATE, postLinks, readingMinutes, wordCount } from "./blog";
import { HUBS } from "./site-links";
import { SOLUTIONS } from "./solutions";
import { TOOLS } from "./tools";

/** Every public path an article may link to. */
const PAGES = new Set<string>([
  "/", "/trial", "/partners", "/legal", "/careers",
  ...LANDING_LINKS.map(([, path]) => path),
  ...Object.values(HUBS),
  ...FEATURES.map((f) => `/features/${f.slug}`),
  ...COMPARISONS.map((c) => `/compare/${c.slug}`),
  ...TOOLS.map((t) => `/tools/${t.slug}`),
  ...SOLUTIONS.map((s) => `/solutions/${s.slug}`),
  ...LOCATIONS.map((l) => locationPath(l.slug)),
  ...POSTS.map((p) => `/blog/${p.slug}`),
]);

describe("blog", () => {
  it("has unique slugs and valid dates", () => {
    expect(new Set(POSTS.map((p) => p.slug)).size).toBe(POSTS.length);
    for (const p of POSTS) {
      expect(p.published, p.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(p.published)), p.slug).toBe(false);
      if (p.updated) expect(p.updated >= p.published, p.slug).toBe(true);
    }
  });

  it("keeps titles and descriptions within what Google shows", () => {
    // Titles of articles already published on medoro.in are kept as they are (up to 80 characters with the suffix).
    for (const p of POSTS) {
      expect(`${p.title} | Medoro`.length, p.slug).toBeLessThanOrEqual(80);
      expect(p.description.length, p.slug).toBeLessThanOrEqual(170);
      expect(p.description.length, p.slug).toBeGreaterThanOrEqual(110);
    }
  });

  it("only links to pages that exist", () => {
    for (const p of POSTS) {
      for (const href of postLinks(p)) expect(PAGES.has(href.split("#")[0]), `${p.slug} → ${href}`).toBe(true);
      for (const t of p.tools) expect(TOOLS.some((x) => x.slug === t), `${p.slug} → ${t}`).toBe(true);
      for (const f of p.features) expect(FEATURES.some((x) => x.slug === f), `${p.slug} → ${f}`).toBe(true);
    }
  });

  it("has substantial articles with headings", () => {
    for (const p of POSTS) {
      expect(wordCount(p), p.slug).toBeGreaterThanOrEqual(250);
      expect(readingMinutes(p), p.slug).toBeGreaterThanOrEqual(1);
      expect(p.body.filter((b) => "h2" in b).length, p.slug).toBeGreaterThanOrEqual(3);
      if (p.faq) expect(p.faq.length, p.slug).toBeGreaterThanOrEqual(3);
    }
  });

  it("sorts newest first", () => {
    const dates = POSTS_BY_DATE.map((p) => p.updated ?? p.published);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});

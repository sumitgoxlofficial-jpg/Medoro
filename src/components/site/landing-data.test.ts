import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LANDINGS } from "./landing-data";
import { LANDING_LINKS } from "./landing-links";

describe("search landing pages", () => {
  it("lists the same pages in the footer links and the page data", () => {
    expect(LANDING_LINKS).toEqual(LANDINGS.map((l) => [l.name, `/${l.slug}`]));
  });

  it("has a route for every page", () => {
    for (const l of LANDINGS) expect(existsSync(join(__dirname, "../../app", l.slug, "page.tsx")), l.slug).toBe(true);
  });

  it("keeps titles and descriptions within what Google shows", () => {
    for (const l of LANDINGS) {
      expect(`${l.title} | Medoro`.length, l.slug).toBeLessThanOrEqual(70);
      expect(l.description.length, l.slug).toBeLessThanOrEqual(165);
    }
  });
});

describe("blog", async () => {
  const { POSTS } = await import("./blog-data");
  const paths = new Set(["/", "/#pricing", "/blog", ...LANDINGS.map((l) => `/${l.slug}`), ...POSTS.map((p) => `/blog/${p.slug}`)]);

  it("has unique slugs and search-sized titles and descriptions", () => {
    expect(new Set(POSTS.map((p) => p.slug)).size).toBe(POSTS.length);
    for (const p of POSTS) {
      expect(`${p.title} | Medoro`.length, p.slug).toBeLessThanOrEqual(80);
      expect(p.description.length, p.slug).toBeLessThanOrEqual(170);
    }
  });

  it("links only to pages that exist", () => {
    for (const p of POSTS) {
      const text = JSON.stringify(p.body);
      for (const m of text.matchAll(/\]\((\/[^)\s]*)\)/g)) expect(paths.has(m[1]), `${p.slug} → ${m[1]}`).toBe(true);
      expect(paths.has(p.cta.href), p.slug).toBe(true);
    }
  });
});

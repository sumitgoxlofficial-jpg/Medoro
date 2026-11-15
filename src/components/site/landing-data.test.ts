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

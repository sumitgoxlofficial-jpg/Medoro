import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// BUG-09: the tour's CSP blocks inline event handlers, and the browser parses the live <x-dc> template, so any
// `onClick="…"` there logs a CSP error. scripts/build-tour.mjs writes them as the runtime's `sc-camel-on-…` instead.
describe("product tour build", () => {
  const html = readFileSync(join(process.cwd(), "public/tour/index.html"), "utf8");
  const tpl = html.slice(html.indexOf("<x-dc>"), html.indexOf("</x-dc>"));
  it("has no inline event handler attributes in its template", () => {
    expect(tpl.length).toBeGreaterThan(1000);
    expect(tpl.match(/\son[a-z]+\s*=/gi) ?? []).toEqual([]);
  });
  it("keeps the handlers in the runtime's encoded form", () => {
    expect((tpl.match(/\ssc-camel-on-[a-z-]+=/g) ?? []).length).toBeGreaterThan(150);
  });
});

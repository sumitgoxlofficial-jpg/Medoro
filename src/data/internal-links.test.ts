import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Every static internal link in the source (href="/..." or href: "/...") must point at a real page, route handler or
 * public file. Catches links to pages that were never built (e.g. /legal/terms when the legal page uses #terms).
 */
const root = join(__dirname, "..", "..");
const appDir = join(root, "src", "app");

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Route patterns from the app directory: route groups dropped, dynamic segments as wildcards. */
function routes(): RegExp[] {
  const out: RegExp[] = [];
  for (const f of walk(appDir)) {
    if (!/\/(page|route)\.(tsx|ts)$/.test(f) && !/\/(sitemap|robots|opengraph-image)\.(ts|tsx)$/.test(f)) continue;
    let r = "/" + relative(appDir, f).replace(/\\/g, "/").replace(/\/?(page|route)\.(tsx|ts)$/, "");
    if (/(sitemap|robots|opengraph-image)\.(ts|tsx)$/.test(f)) r = r.replace(/\.(tsx|ts)$/, "").replace(/sitemap$/, "sitemap.xml").replace(/robots$/, "robots.txt");
    const segs = r.split("/").filter((s) => s && !/^\(.*\)$/.test(s));
    const pat = segs.map((s) => (/^\[\[\.\.\./.test(s) ? "(?:/.*)?" : /^\[\.\.\./.test(s) ? "/.+" : /^\[/.test(s) ? "/[^/]+" : "/" + s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("");
    out.push(new RegExp("^" + (pat || "/") + "/?$"));
  }
  return out;
}

describe("internal links", () => {
  it("every static href points at an existing page, route or public file", () => {
    const pats = routes();
    const files = walk(join(root, "src")).filter((f) => /\.(tsx|ts)$/.test(f) && !/\.test\.tsx?$/.test(f));
    const broken: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/href(?:=|:\s*)["'`](\/[^"'`\s${}]*)["'`]/g)) {
        const path = m[1].split(/[?#]/)[0] || "/";
        if (existsSync(join(root, "public", path)) && path !== "/") continue;
        if (pats.some((p) => p.test(path))) continue;
        broken.push(`${relative(root, f)}: ${m[1]}`);
      }
    }
    expect(broken).toEqual([]);
  });
});

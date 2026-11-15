/**
 * Search over the public website's own pages (/search). The index is built from the same data files as the pages
 * and the sitemap, so a new feature, comparison, city or article is searchable as soon as it is added.
 */
import { LANDINGS } from "@/components/site/landing-data";
import { POSTS } from "./blog";
import { COMPARISONS } from "./comparisons";
import { FEATURES } from "./features";
import { LOCATIONS, locationPath } from "./locations";
import { SOLUTIONS } from "./solutions";
import { TOOLS } from "./tools";

export type SearchHit = { name: string; path: string; description: string; kind: string };

const STATIC: SearchHit[] = [
  { kind: "Company", name: "About Medoro", path: "/about-medoro", description: "What Medoro (medoro.in) is, its mission, product suite, security and company details." },
  { kind: "Pricing", name: "Medoro pricing and plans", path: "/#pricing", description: "Starter, Professional and Multi-branch plans in rupees, with a 7-day free trial." },
  { kind: "Company", name: "Become a reference partner", path: "/partners", description: "Refer pharmacies to Medoro and earn on every plan they buy." },
  { kind: "Company", name: "Careers at Medoro", path: "/careers", description: "Open roles at Medoro." },
  { kind: "Help", name: "Help, contact, privacy and terms", path: "/legal", description: "Contact Medoro, help and setup, backup and recovery, privacy policy, terms, refunds and grievance officer." },
];

export const SEARCH_INDEX: SearchHit[] = [
  ...LANDINGS.map((l) => ({ kind: "Product", name: l.title, path: `/${l.slug}`, description: l.description })),
  ...FEATURES.map((f) => ({ kind: "Feature", name: f.name, path: `/features/${f.slug}`, description: f.description })),
  ...SOLUTIONS.map((s) => ({ kind: "Solution", name: s.name, path: `/solutions/${s.slug}`, description: s.description })),
  ...COMPARISONS.map((c) => ({ kind: "Comparison", name: c.name, path: `/compare/${c.slug}`, description: c.description })),
  ...TOOLS.map((t) => ({ kind: "Free tool", name: t.name, path: `/tools/${t.slug}`, description: t.description })),
  ...STATIC,
  ...POSTS.map((p) => ({ kind: "Guide", name: p.title, path: `/blog/${p.slug}`, description: p.description })),
  ...LOCATIONS.map((l) => ({ kind: "Location", name: `Pharmacy software in ${l.name}`, path: locationPath(l.slug), description: `Medoro pharmacy billing, stock and GST software for medical stores in ${l.name}.` })),
];

const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9ऀ-ॿ]+/g, " ").trim().split(" ").filter(Boolean);

/** Pages that contain every word of the query, best match first (a word in the page name counts for more). */
export function searchSite(query: string, limit = 20): SearchHit[] {
  const q = [...new Set(words(query.slice(0, 120)))].filter((w) => w !== "medoro" || words(query).length === 1);
  if (!q.length) return [];
  return SEARCH_INDEX
    .map((hit, i) => {
      const name = ` ${words(hit.name).join(" ")} `, text = ` ${words(`${hit.kind} ${hit.description} ${hit.path}`).join(" ")} `;
      let score = 0;
      for (const w of q) {
        if (name.includes(` ${w}`)) score += 3;
        else if (text.includes(` ${w}`)) score += 1;
        else return null;
      }
      return { hit, score, i };
    })
    .filter((x): x is { hit: SearchHit; score: number; i: number } => !!x)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.hit);
}

import type { MetadataRoute } from "next";
import { LANDING_LINKS } from "@/components/site/landing-links";
import { POSTS } from "@/data/blog";
import { COMPARISONS } from "@/data/comparisons";
import { FEATURES } from "@/data/features";
import { LOCATIONS, locationPath } from "@/data/locations";
import { HUBS } from "@/data/site-links";
import { SOLUTIONS } from "@/data/solutions";
import { TOOLS } from "@/data/tools";
import { absoluteUrl } from "@/lib/seo";

type Freq = NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;

/**
 * /sitemap.xml: every public page Google should index. The programmatic pages (features, comparisons, tools,
 * solutions, cities, states and blog articles) come from their data files in src/data, so a new entry there is listed automatically.
 * Other public pages are added here by hand.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const page = (path: string, priority: number, changeFrequency: Freq): MetadataRoute.Sitemap[number] => ({ url: absoluteUrl(path), changeFrequency, priority });
  return [
    page("/", 1, "weekly"),
    // The two product landing pages.
    page("/pharmacy", 1, "weekly"),
    page("/distribution", 0.9, "weekly"),
    // The category pillar pages (/medical-billing-saas, /pharmacy-billing-software,
    // /medical-store-stock-management-software and the other search landing pages).
    ...LANDING_LINKS.map(([, path]) => page(path, 0.9, "monthly")),
    page("/about-medoro", 0.8, "monthly"),
    page(HUBS.features, 0.8, "monthly"),
    ...FEATURES.map((f) => page(`/features/${f.slug}`, 0.9, "monthly")),
    page(HUBS.compare, 0.7, "monthly"),
    ...COMPARISONS.map((c) => page(`/compare/${c.slug}`, 0.8, "monthly")),
    page(HUBS.tools, 0.7, "monthly"),
    ...TOOLS.map((t) => page(`/tools/${t.slug}`, 0.8, "monthly")),
    page(HUBS.solutions, 0.7, "monthly"),
    ...SOLUTIONS.map((s) => page(`/solutions/${s.slug}`, 0.8, "monthly")),
    page(HUBS.locations, 0.6, "monthly"),
    ...LOCATIONS.map((l) => page(locationPath(l.slug), l.kind === "city" ? 0.7 : 0.6, "monthly")),
    page(HUBS.blog, 0.7, "weekly"),
    ...POSTS.map((p) => ({ ...page(`/blog/${p.slug}`, 0.7, "monthly"), lastModified: p.updated ?? p.published })),
    page("/partners", 0.6, "monthly"),
    page("/careers", 0.6, "weekly"),
    page("/legal", 0.3, "yearly"),
  ];
}

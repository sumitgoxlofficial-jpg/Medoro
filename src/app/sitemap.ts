import type { MetadataRoute } from "next";
import { LANDING_LINKS } from "@/components/site/landing-links";

const SITE = process.env.APP_URL ?? "https://medoro.in";

/** /sitemap.xml: every public page Google should index. Add new public pages here. */
export default function sitemap(): MetadataRoute.Sitemap {
  const page = (path: string, priority: number, changeFrequency: "weekly" | "monthly" | "yearly"): MetadataRoute.Sitemap[number] =>
    ({ url: `${SITE}${path}`, changeFrequency, priority });
  return [
    page("/", 1, "weekly"),
    ...LANDING_LINKS.map(([, path]) => page(path, 0.9, "monthly")),
    page("/partners", 0.6, "monthly"),
    page("/legal", 0.3, "yearly"),
  ];
}

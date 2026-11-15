import type { MetadataRoute } from "next";

const SITE = process.env.APP_URL ?? "https://medoro.in";

/** /robots.txt: the public website is crawlable; the app, staff areas, API and one-off links are not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: "*",
      allow: "/",
      disallow: ["/app", "/staff", "/api", "/print", "/device", "/support", "/offline", "/trial", "/pay", "/setup"],
    }],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}

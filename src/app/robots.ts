import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

/**
 * /robots.txt: the public website (homepage, landing, feature, comparison, tool, solution and location pages) is
 * crawlable; the app, staff areas, API and one-off links are not. /pharmacy-software-in/ is the internal address of the
 * location pages, which redirects to /pharmacy-software-in-<place>, so it is kept out too.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: "*",
      allow: "/",
      disallow: ["/app", "/staff", "/certificate", "/api", "/print", "/device", "/support", "/offline", "/trial", "/pay", "/setup", "/pharmacy-software-in/"],
    }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}

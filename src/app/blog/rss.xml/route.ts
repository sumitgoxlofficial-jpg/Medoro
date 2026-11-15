import { POSTS_BY_DATE } from "@/data/blog";
import { HUBS } from "@/data/site-links";
import { absoluteUrl } from "@/lib/seo";

/** /blog/rss.xml: RSS 2.0 feed of the blog, newest first. */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const rfc822 = (iso: string) => new Date(`${iso}T00:00:00Z`).toUTCString();

export function GET() {
  const items = POSTS_BY_DATE.map((p) => {
    const url = absoluteUrl(`/blog/${p.slug}`);
    return `<item><title>${esc(p.title)}</title><link>${url}</link><guid isPermaLink="true">${url}</guid><pubDate>${rfc822(p.published)}</pubDate><category>${esc(p.category)}</category><description>${esc(p.description)}</description></item>`;
  }).join("");
  const latest = POSTS_BY_DATE[0];
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>Medoro blog</title><link>${absoluteUrl(HUBS.blog)}</link><atom:link href="${absoluteUrl(`${HUBS.blog}/rss.xml`)}" rel="self" type="application/rss+xml"/><description>Practical guides for Indian pharmacy owners.</description><language>en-in</language>${latest ? `<lastBuildDate>${rfc822(latest.updated ?? latest.published)}</lastBuildDate>` : ""}${items}</channel></rss>`;
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}

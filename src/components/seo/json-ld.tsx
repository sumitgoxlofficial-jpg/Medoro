import type { JsonLdObject } from "@/lib/seo";

/**
 * Structured data for search engines. Renders one <script type="application/ld+json"> per call, server-side, so it is
 * in the HTML Google crawls. JSON data blocks don't execute, so the page's CSP nonce isn't needed. "<" is escaped so
 * text in the data can never close the script tag.
 */
export function JsonLd({ data }: { data: JsonLdObject | JsonLdObject[] }) {
  const list = Array.isArray(data) ? data : [data];
  const withContext = list.map((d) => ({ "@context": "https://schema.org", ...d }));
  const json = JSON.stringify(withContext.length === 1 ? withContext[0] : withContext).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}

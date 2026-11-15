import type { Metadata } from "next";

/**
 * Search metadata and structured data for the public website. Every public page builds its <head> with
 * pageMetadata() and its JSON-LD with the schema helpers below, so titles, canonicals, Open Graph and Twitter cards
 * follow one pattern. Server-only in practice (pages and generateMetadata), but has no server imports.
 */

/** The public site's address, without a trailing slash. */
export const SITE_URL = (process.env.APP_URL ?? "https://medoro.in").replace(/\/+$/, "");
export const SITE_NAME = "Medoro";

/** Absolute URL for a site path ("/features/gst-billing" → "https://medoro.in/features/gst-billing"). */
export const absoluteUrl = (path: string) => (/^https?:\/\//.test(path) ? path : `${SITE_URL}${path === "/" ? "" : path.startsWith("/") ? path : `/${path}`}`) || SITE_URL;

/** Default share image (the app's Open Graph image route). */
const DEFAULT_IMAGE: [src: string, alt: string] = ["/opengraph-image", "Medoro pharmacy billing, inventory and GST software"];

export type PageSeo = {
  /** Full <title>, shown as is (no template suffix added). Keep it within about 60 characters. */
  title: string;
  /** Meta description, within about 160 characters. */
  description: string;
  /** Site path of the page, e.g. "/compare/marg-erp-alternative". */
  path: string;
  /** Share image: a site path or absolute URL, with its alt text. */
  image?: [src: string, alt: string];
  /** Open Graph type: "website" for product pages, "article" for guides. */
  type?: "website" | "article";
  keywords?: string[];
  /** Keep the page out of the index (it can still be crawled for links). */
  noindex?: boolean;
};

/** Title, description, canonical, Open Graph and Twitter card for one public page. */
export function pageMetadata(p: PageSeo): Metadata {
  const url = absoluteUrl(p.path);
  const [img, alt] = p.image ?? DEFAULT_IMAGE;
  return {
    title: { absolute: p.title },
    description: p.description,
    keywords: p.keywords,
    alternates: { canonical: url },
    robots: p.noindex ? { index: false, follow: true } : { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
    openGraph: { type: p.type ?? "website", url, siteName: SITE_NAME, title: p.title, description: p.description, locale: "en_IN", images: [{ url: absoluteUrl(img), alt }] },
    twitter: { card: "summary_large_image", title: p.title, description: p.description, images: [absoluteUrl(img)] },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Structured data (schema.org JSON-LD). Render with <JsonLd data={...} />.

export type JsonLdObject = { "@context"?: string; "@type": string; [key: string]: unknown };

const ORG = { "@type": "Organization", name: SITE_NAME, url: SITE_URL, logo: absoluteUrl("/medoro-mark.png"), email: "hello@medoro.in", areaServed: "IN" };

/** Plans as schema.org offers (prices include GST, in rupees per month). */
const OFFERS = [
  ["Starter", 999],
  ["Professional", 2499],
  ["Multi-branch", 4499],
].map(([name, price]) => ({ "@type": "Offer", name: `${name} plan`, price: String(price), priceCurrency: "INR", url: absoluteUrl("/#pricing"), category: "subscription" }));

/** The Medoro product, for feature, comparison, location and solution pages. */
export function softwareApplicationSchema(o: { name?: string; description: string; path: string; featureList?: string[] }): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: o.name ?? "Medoro Pharmacy Software",
    description: o.description,
    url: absoluteUrl(o.path),
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "Pharmacy management software",
    operatingSystem: "Web browser, Windows, macOS, Linux, Android",
    inLanguage: ["en-IN", "hi-IN"],
    ...(o.featureList?.length ? { featureList: o.featureList } : {}),
    offers: OFFERS,
    publisher: ORG,
  };
}

/** A free in-browser tool. */
export function webApplicationSchema(o: { name: string; description: string; path: string; featureList?: string[] }): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: o.name,
    description: o.description,
    url: absoluteUrl(o.path),
    applicationCategory: "BusinessApplication",
    operatingSystem: "Any (runs in the browser)",
    browserRequirements: "Requires JavaScript",
    isAccessibleForFree: true,
    inLanguage: "en-IN",
    ...(o.featureList?.length ? { featureList: o.featureList } : {}),
    offers: { "@type": "Offer", price: "0", priceCurrency: "INR" },
    publisher: ORG,
  };
}

/** Questions and answers shown on the page (Google requires the same text to be visible). */
export function faqSchema(faq: readonly (readonly [q: string, a: string])[]): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
  };
}

export type Crumb = [name: string, path: string];

/** Breadcrumb trail; the homepage is added first. */
export function breadcrumbSchema(trail: readonly Crumb[]): JsonLdObject {
  const all: Crumb[] = [[SITE_NAME, "/"], ...trail];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: all.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: absoluteUrl(path) })),
  };
}

/** A list of pages (hub pages such as /features or /compare). */
export function itemListSchema(name: string, items: readonly Crumb[]): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    itemListElement: items.map(([n, path], i) => ({ "@type": "ListItem", position: i + 1, name: n, url: absoluteUrl(path) })),
  };
}

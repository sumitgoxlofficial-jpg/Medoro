import type { Metadata } from "next";
import { BRAND, brandProfiles } from "@/data/brand";
import { PRODUCTS } from "@/staff/constants";

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
  /** For articles: ISO dates of first publication and last update. */
  published?: string;
  modified?: string;
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
    openGraph: {
      type: p.type ?? "website", url, siteName: SITE_NAME, title: p.title, description: p.description, locale: "en_IN", images: [{ url: absoluteUrl(img), alt }],
      ...(p.type === "article" ? { publishedTime: p.published, modifiedTime: p.modified ?? p.published, authors: [`${SITE_NAME} team`] } : {}),
    },
    twitter: { card: "summary_large_image", title: p.title, description: p.description, images: [absoluteUrl(img)] },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Structured data (schema.org JSON-LD). Render with <JsonLd data={...} />.

export type JsonLdObject = { "@context"?: string; "@type": string; [key: string]: unknown };
/** Several linked entities in one block; they refer to each other by "@id". */
export type JsonLdGraph = { "@context": "https://schema.org"; "@graph": JsonLdObject[] };

/** Stable ids of the site-wide entities (brandGraph), so any page's structured data can point at them. */
export const ORG_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;
export const SOFTWARE_ID = `${SITE_URL}/#software`;
/** /logo.png is the square Medoro logo (served from public/medoro-logo.png, see next.config.ts). */
const LOGO_URL = absoluteUrl("/logo.png");

/** The publisher on every page's own structured data: the same entity as the site-wide Organization. */
const ORG = { "@type": "Organization", "@id": ORG_ID, name: SITE_NAME, url: SITE_URL, logo: LOGO_URL, email: BRAND.email, areaServed: "IN" };

/** The three subscription plans, cheapest first (rupees per month). */
const PLANS = PRODUCTS.filter((p) => !("addon" in p) && !("once" in p));

/**
 * The brand entity, on every page (root layout): who Medoro is (Organization), the site and its search (WebSite) and
 * the product with its price range (SoftwareApplication). One @graph so the three are linked rather than repeated.
 * `sameAs` lists only the official profiles that are configured (src/data/brand.ts).
 */
export function brandGraph(): JsonLdGraph {
  const sameAs = brandProfiles().map((p) => p.url);
  const prices = PLANS.map((p) => p.m);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": ORG_ID,
        name: BRAND.name,
        alternateName: [...BRAND.alternateNames],
        url: SITE_URL,
        logo: { "@type": "ImageObject", "@id": `${SITE_URL}/#logo`, url: LOGO_URL, contentUrl: LOGO_URL, width: 1254, height: 1254, caption: BRAND.name },
        image: { "@id": `${SITE_URL}/#logo` },
        description: BRAND.description,
        slogan: BRAND.tagline,
        email: BRAND.email,
        areaServed: { "@type": "Country", name: "India" },
        address: { "@type": "PostalAddress", addressRegion: "Jharkhand", addressCountry: "IN" },
        contactPoint: { "@type": "ContactPoint", contactType: "customer support", telephone: BRAND.phone, email: BRAND.email, areaServed: "IN", availableLanguage: ["en", "hi"] },
        knowsAbout: ["Medical billing SaaS", "Pharmacy billing software", "Medical store stock management", "Batch and expiry management", "GST billing for pharmacies", "Schedule H1 register"],
        mainEntityOfPage: absoluteUrl("/about-medoro"),
        ...(sameAs.length ? { sameAs } : {}),
      },
      {
        "@type": "WebSite",
        "@id": WEBSITE_ID,
        name: BRAND.name,
        alternateName: [...BRAND.alternateNames],
        url: SITE_URL,
        description: BRAND.description,
        inLanguage: ["en-IN", "hi-IN"],
        publisher: { "@id": ORG_ID },
        potentialAction: {
          "@type": "SearchAction",
          target: { "@type": "EntryPoint", urlTemplate: `${SITE_URL}/search?q={search_term_string}` },
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "SoftwareApplication",
        "@id": SOFTWARE_ID,
        name: BRAND.productName,
        alternateName: [...BRAND.alternateNames],
        url: SITE_URL,
        description: BRAND.description,
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "Medical billing SaaS, pharmacy billing and stock management software",
        operatingSystem: BRAND.operatingSystem,
        inLanguage: ["en-IN", "hi-IN"],
        image: { "@id": `${SITE_URL}/#logo` },
        featureList: ["Medical and pharmacy counter billing", "Batch-wise stock and near-expiry management", "GST billing with GSTR-1 and GSTR-3B summaries", "Schedule H1 register", "AI purchase bill import from CSV, Excel and PDF", "Accounts, ledgers and Tally export"],
        offers: {
          "@type": "AggregateOffer",
          priceCurrency: "INR",
          lowPrice: String(Math.min(...prices)),
          highPrice: String(Math.max(...prices)),
          offerCount: PLANS.length,
          url: absoluteUrl("/pharmacy#pricing"),
          offers: PLANS.map((p) => ({ "@type": "Offer", name: `${p.name} plan`, price: String(p.m), priceCurrency: "INR", category: "subscription", url: absoluteUrl("/pharmacy#pricing") })),
        },
        publisher: { "@id": ORG_ID },
      },
    ],
  };
}

/** The official "about the brand" page, tied to the Organization so it can feed Google's knowledge panel. */
export function aboutPageSchema(o: { name: string; description: string; path: string }): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    "@id": `${absoluteUrl(o.path)}#webpage`,
    url: absoluteUrl(o.path),
    name: o.name,
    description: o.description,
    inLanguage: "en-IN",
    isPartOf: { "@id": WEBSITE_ID },
    about: { "@id": ORG_ID },
    mainEntity: { "@id": ORG_ID },
  };
}

/** Plans as schema.org offers (prices include GST, in rupees per month). */
const OFFERS = PLANS.map((p) => ({ "@type": "Offer", name: `${p.name} plan`, price: String(p.m), priceCurrency: "INR", url: absoluteUrl("/pharmacy#pricing"), category: "subscription" }));

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

/** A blog article. Dates are ISO (YYYY-MM-DD). */
export function articleSchema(o: { headline: string; description: string; path: string; published: string; modified?: string; keywords?: string[]; section?: string; wordCount?: number }): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: o.headline,
    description: o.description,
    url: absoluteUrl(o.path),
    mainEntityOfPage: { "@type": "WebPage", "@id": absoluteUrl(o.path) },
    image: absoluteUrl("/opengraph-image"),
    datePublished: o.published,
    dateModified: o.modified ?? o.published,
    inLanguage: "en-IN",
    ...(o.section ? { articleSection: o.section } : {}),
    ...(o.keywords?.length ? { keywords: o.keywords.join(", ") } : {}),
    ...(o.wordCount ? { wordCount: o.wordCount } : {}),
    author: { "@type": "Organization", "@id": ORG_ID, name: `${SITE_NAME} team`, url: SITE_URL },
    publisher: ORG,
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

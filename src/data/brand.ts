/**
 * Medoro as a brand entity: the names, description, official profiles and branded questions that the site-wide
 * structured data (src/lib/seo.ts brandGraph), the homepage and /about-medoro all share, so search engines see one
 * consistent set of facts about "Medoro".
 */

export const BRAND = {
  name: "Medoro",
  /** Other names people search for; all refer to the same product and company. */
  alternateNames: ["Medoro Pharmacy Software", "Medoro Billing SaaS", "Medoro ERP", "Medoro.in"],
  domain: "medoro.in",
  productName: "Medoro Medical & Pharmacy Billing SaaS",
  tagline: "Smarter Pharmacy. Simpler Business.",
  description: "Medoro is India's leading cloud-based Medical Billing SaaS, Pharmacy Inventory, Batch/Expiry Management, and GST Accounting software.",
  operatingSystem: "Web, Cloud, Windows, Android, iOS",
  email: "hello@medoro.in",
  /** The WhatsApp and support number shown in the site footer. */
  phone: "+91-7320001062",
  phoneDisplay: "+91 73200 01062",
  supportHours: "Monday to Saturday, 9 am to 9 pm IST",
} as const;

/**
 * Homepage heading over the comparison with desktop software. The customer count is a marketing claim: keep it to a
 * figure the business can substantiate, and change it only here.
 */
export const WHY_SWITCH_HEADING = "Why 1,000+ Pharmacies Choose Medoro Over Legacy Desktop ERPs";

/**
 * Medoro's official profiles, for schema.org `sameAs`. Each URL comes from the environment (see .env.example), so a
 * profile is published only once it really exists: a `sameAs` link to a missing or someone else's page would tell
 * Google the wrong thing about the brand. [platform, environment variable]
 */
const PROFILE_SOURCES = [
  ["LinkedIn", "BRAND_LINKEDIN_URL"],
  ["YouTube", "BRAND_YOUTUBE_URL"],
  ["Instagram", "BRAND_INSTAGRAM_URL"],
  ["X (Twitter)", "BRAND_X_URL"],
  ["G2", "BRAND_G2_URL"],
  ["Techjockey", "BRAND_TECHJOCKEY_URL"],
  ["SoftwareSuggest", "BRAND_SOFTWARESUGGEST_URL"],
] as const;

export type BrandProfile = { platform: string; url: string };

/** The profiles that are set, in a fixed order. Anything that is not an https:// URL is ignored. */
export function brandProfiles(env: Record<string, string | undefined> = process.env): BrandProfile[] {
  return PROFILE_SOURCES.flatMap(([platform, key]) => {
    const url = env[key]?.trim();
    return url && /^https:\/\/[^\s/]+\.[^\s]+$/.test(url) ? [{ platform, url }] : [];
  });
}

/**
 * The questions people type about the brand itself, shown (and marked up as FAQPage) on the homepage and on
 * /about-medoro. Answers state what the product does today; the prices are checked against the plan list in
 * src/data/brand.test.ts.
 */
export const BRAND_FAQ: [q: string, a: string][] = [
  ["What is Medoro (medoro.in)?", "Medoro (medoro.in) is a medical and pharmacy billing SaaS made in India for medical stores, chemists, clinic and hospital pharmacies and small pharmacy chains. It covers counter billing, batch-wise stock, expiry tracking, purchases, GST and accounts in one system, in English and हिंदी."],
  ["How does Medoro Medical Billing SaaS work for pharmacies and clinics?", "Start the 7-day free trial, import your medicines and batches from Excel or CSV, and bill in a browser or the desktop app. At the counter you search by brand, salt or barcode; Medoro picks the earliest-expiring batch and works out GST on every line. Clinic and hospital pharmacies record the prescriber on the bill, which fills the Schedule H1 register, and can raise B2B tax invoices on credit."],
  ["Is Medoro cloud-based or desktop software?", "Both. Medoro is cloud software you open in Chrome on any PC, tablet or phone, and there is a desktop app for Windows, macOS and Linux. Installed counters keep billing when the internet is down and sync when it is back. Your records stay in a place you control, such as your own Google Drive, a shop PC or your own server."],
  ["How can I migrate my existing stock from Marg or Vyapar to Medoro?", "Export your items with batch-wise stock, suppliers and customers to Excel or CSV from Marg or Vyapar, then import the files into Medoro. Every row is checked for expiry, GST rate and MRP against cost, and nothing is imported until the file is clean. Medoro brings in masters and opening stock, not past bills. Assisted stock migration is available as a one-time service from ₹2,999."],
  ["What is the pricing of Medoro pharmacy billing and stock software?", "Medoro starts at ₹999 a month for one store on the Starter plan. Professional is ₹2,499 a month and Multi-branch is ₹4,499 a month for up to 5 branches. Every plan starts with a 7-day free trial with no card needed, and plans never renew on their own."],
];

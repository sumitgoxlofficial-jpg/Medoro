/**
 * Names and paths of the programmatic SEO pages, kept apart from their full text so the site footer (a client
 * component) doesn't ship every page's copy to the browser. src/data/seo-data.test.ts keeps these lists in step with
 * features.ts, comparisons.ts, tools.ts, solutions.ts and locations.ts.
 */
export type SiteLink = [name: string, path: string];

export const HUBS = {
  features: "/features",
  compare: "/compare",
  tools: "/tools",
  solutions: "/solutions",
  locations: "/pharmacy-software-in-india",
} as const;

export const FEATURE_LINKS: SiteLink[] = [
  ["GST billing & counter POS", "/features/gst-billing"],
  ["Batch & expiry management", "/features/expiry-management"],
  ["Inventory & reorder management", "/features/inventory-management"],
  ["Schedule H & H1 drug register", "/features/schedule-h1-compliance"],
  ["AI purchase bill import", "/features/ai-invoice-scanner"],
];

export const COMPARE_LINKS: SiteLink[] = [
  ["Medoro vs Marg ERP", "/compare/marg-erp-alternative"],
  ["Medoro vs Vyapar", "/compare/vyapar-alternative-for-pharmacy"],
  ["Medoro vs RedBook", "/compare/redbook-alternative"],
  ["Medoro vs Logic ERP", "/compare/logic-erp-alternative"],
];

export const TOOL_LINKS: SiteLink[] = [
  ["PTR, PTS & margin calculator", "/tools/pharma-margin-calculator"],
  ["Medicine HSN code & GST finder", "/tools/medicine-hsn-code-finder"],
  ["Free chemist bill generator", "/tools/free-pharmacy-invoice-generator"],
];

export const SOLUTION_LINKS: SiteLink[] = [
  ["Retail pharmacy & chemist shop", "/solutions/retail-pharmacy"],
  ["Pharmacy chains & multi-branch", "/solutions/pharmacy-chains"],
  ["Hospital & clinic pharmacy", "/solutions/hospital-pharmacy"],
  ["Ayurvedic & AYUSH stores", "/solutions/ayurvedic-stores"],
];

/** The cities shown in the footer; every location is linked from HUBS.locations. */
export const TOP_CITY_LINKS: SiteLink[] = [
  ["Mumbai", "/pharmacy-software-in-mumbai"],
  ["Delhi", "/pharmacy-software-in-delhi"],
  ["Bangalore", "/pharmacy-software-in-bangalore"],
  ["Hyderabad", "/pharmacy-software-in-hyderabad"],
  ["Kolkata", "/pharmacy-software-in-kolkata"],
  ["Chennai", "/pharmacy-software-in-chennai"],
  ["Pune", "/pharmacy-software-in-pune"],
  ["Patna", "/pharmacy-software-in-patna"],
  ["Ranchi", "/pharmacy-software-in-ranchi"],
  ["Lucknow", "/pharmacy-software-in-lucknow"],
];

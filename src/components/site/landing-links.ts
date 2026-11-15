/**
 * The search landing pages' names and paths, kept apart from their full text (landing-data.ts) so the site footer,
 * a client component, doesn't ship every page's copy to the browser. landing-data.test.ts keeps the two in step.
 */
export const LANDING_LINKS: [name: string, path: string][] = [
  ["Medical billing SaaS", "/medical-billing-saas"],
  ["Pharmacy billing software", "/pharmacy-billing-software"],
  ["Pharmacy accounting software", "/pharmacy-accounting-software"],
  ["Medical store software", "/medical-store-software"],
  ["GST billing software for pharmacy", "/gst-billing-software-for-pharmacy"],
  ["Pharmacy inventory software", "/pharmacy-inventory-software"],
  ["Medical store stock management software", "/medical-store-stock-management-software"],
];

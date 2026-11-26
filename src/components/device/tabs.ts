/** The tabs of the Drive mode counter (Billing on this device). Plain data, so server pages can read it too. */
export const TABS = [["dash", "Dashboard"], ["bill", "Billing"], ["bills", "Bills & day-end"], ["stock", "Stock"], ["recalls", "Recalls"], ["purchases", "Purchases"], ["supplier", "Supplier tools"], ["orders", "Orders"], ["customers", "Customers"], ["doctors", "Doctors"], ["accounts", "Accounts"], ["money", "UPI & Bank"], ["cheques", "Cheques"], ["reports", "Reports & GST"], ["books", "Books & registers"], ["insights", "Insights"], ["ask", "Ask"], ["activity", "Activity"], ["settings", "Counter"]] as const;
/**
 * MEDORO Distribution on the device (docs/DIST_DRIVE_PLAN.md, phase D4): the wholesale screens, plus the shared ones a
 * distributor uses too (stock, purchases, supplier tools, cheques, UPI & bank, GST, counter).
 */
export const DIST_TABS = [["wholesale", "Wholesale bill"], ["dorders", "Orders"], ["dinvoices", "Invoices & credit notes"], ["dispatch", "Dispatch"], ["receivables", "Receivables"],
  ["chemists", "Chemists"], ["products", "Products & schemes"], ["expiry", "Expiry & claims"], ["stock", "Stock"], ["purchases", "Purchases"], ["supplier", "Supplier tools"],
  ["cheques", "Cheques"], ["money", "UPI & Bank"], ["reports", "Reports & GST"], ["settings", "Counter"]] as const;
export type Tab = (typeof TABS)[number][0] | (typeof DIST_TABS)[number][0];
export const DIST_TAB_KEYS: ReadonlySet<string> = new Set(DIST_TABS.map(([k]) => k));
type DistTab = (typeof DIST_TABS)[number][0];
/** Which distribution permissions open each device screen (any one of them), the same as the distributor's menu. */
export const DIST_TAB_PERMS: Record<DistTab, readonly string[]> = {
  wholesale: ["bill"], dorders: ["order", "approve", "warehouse"], dinvoices: ["bill", "reports", "payments"], dispatch: ["dispatch", "delivery"],
  receivables: ["payments", "approve", "reports"], chemists: ["masters", "portal"], products: ["masters"], expiry: ["purchase"], stock: ["adjust", "warehouse", "purchase"],
  purchases: ["purchase"], supplier: ["purchase"], cheques: ["payments"], money: ["payments", "reports"], reports: ["reports"], settings: ["users"],
};
/** The device screens a distribution role may open. "Counter" (settings) stays for everyone: it holds this device's own lock. */
export const distTabsFor = (perms: readonly string[]): DistTab[] =>
  DIST_TABS.map(([k]) => k).filter((k) => k === "settings" || DIST_TAB_PERMS[k].some((p) => perms.includes(p)));
/** Tabs that still open by address (?tab=…) but are left out of the tab bar. Accounts is hidden from every menu; its page and data are untouched. */
export const HIDDEN_TABS: readonly Tab[] = ["accounts"];

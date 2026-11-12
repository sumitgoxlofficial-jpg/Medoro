/** The tabs of the Drive mode counter (Billing on this device). Plain data, so server pages can read it too. */
export const TABS = [["dash", "Dashboard"], ["bill", "Billing"], ["bills", "Bills & day-end"], ["stock", "Stock"], ["recalls", "Recalls"], ["purchases", "Purchases"], ["supplier", "Supplier tools"], ["orders", "Orders"], ["customers", "Customers"], ["doctors", "Doctors"], ["accounts", "Accounts"], ["money", "UPI & Bank"], ["cheques", "Cheques"], ["reports", "Reports & GST"], ["insights", "Insights"], ["ask", "Ask"], ["activity", "Activity"], ["settings", "Counter"]] as const;
export type Tab = (typeof TABS)[number][0];
/** Tabs that still open by address (?tab=…) but are left out of the tab bar. Accounts is hidden from every menu; its page and data are untouched. */
export const HIDDEN_TABS: readonly Tab[] = ["accounts"];

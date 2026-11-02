/** The tabs of the Drive mode counter (Billing on this device). Plain data, so server pages can read it too. */
export const TABS = [["dash", "Dashboard"], ["bill", "Billing"], ["bills", "Bills & day-end"], ["stock", "Stock"], ["purchases", "Purchases"], ["orders", "Orders"], ["customers", "Customers"], ["accounts", "Accounts"], ["money", "UPI & Bank"], ["reports", "Reports & GST"], ["ask", "Ask"], ["activity", "Activity"], ["settings", "Counter"]] as const;
export type Tab = (typeof TABS)[number][0];

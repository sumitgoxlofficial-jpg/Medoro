// Distribution roles and permissions. A distribution user's Ctx.perms holds these keys. The ones shared with the
// pharmacy product (purchase, payments, reports, users, integrations, adjust) keep their meaning so the shared
// services (GRN, supplier claims, cheques, bank reconciliation, ledgers) enforce the same checks.

export const DIST_PERMS = [
  "masters", // companies, principals, products, chemists, schemes, territories, godowns
  "order", // book orders for chemists
  "approve", // approve / reject orders
  "creditOverride", // release orders held by credit control
  "bill", // raise invoices, credit notes
  "cancelBill", // cancel invoices
  "warehouse", // pick and pack
  "dispatch", // plan dispatches, assign deliveries
  "delivery", // deliver and collect
  "purchase", // POs, GRN, purchase returns, supplier claims
  "adjust", // stock adjustments, transfers, racks
  "payments", // receipts, payments, collections
  "reports", // accounts, GST and MIS reports
  "insights", // AI business intelligence
  "portal", // chemist portal connections and settings
  "users", // users, roles, subscription
  "integrations", // e-invoice, backups, keys
] as const;
export type DistPerm = (typeof DIST_PERMS)[number];

export const DIST_PERM_LABEL: Record<DistPerm, string> = {
  masters: "Masters (products, chemists, schemes)",
  order: "Book orders",
  approve: "Approve orders",
  creditOverride: "Override credit holds",
  bill: "Invoices & credit notes",
  cancelBill: "Cancel invoices",
  warehouse: "Pick & pack",
  dispatch: "Dispatch planning",
  delivery: "Deliver & collect",
  purchase: "Purchases, GRN & claims",
  adjust: "Stock adjustments & transfers",
  payments: "Receipts & payments",
  reports: "Accounts & reports",
  insights: "Business intelligence",
  portal: "Chemist portal",
  users: "Users & subscription",
  integrations: "Integrations & backups",
};

export const DIST_ROLES = ["Owner", "Manager", "Accountant", "Billing", "Warehouse", "Salesman", "Delivery"] as const;
export type DistRole = (typeof DIST_ROLES)[number];

export const DIST_GRANTS: Record<DistRole, DistPerm[]> = {
  Owner: [...DIST_PERMS],
  Manager: ["masters", "order", "approve", "creditOverride", "bill", "warehouse", "dispatch", "purchase", "adjust", "payments", "reports", "insights", "portal"],
  Accountant: ["payments", "reports", "bill", "insights"],
  Billing: ["order", "approve", "bill", "dispatch"],
  Warehouse: ["warehouse", "dispatch", "adjust"],
  Salesman: ["order", "payments"],
  Delivery: ["delivery"],
};

/** Role permissions plus grants minus revokes, limited to known distribution permissions. */
export function distPerms(role: readonly string[], grants: readonly string[] = [], revokes: readonly string[] = []): DistPerm[] {
  return DIST_PERMS.filter((p) => (role.includes(p) || grants.includes(p)) && !revokes.includes(p));
}

/** Permissions that change business records: refused when the subscription has lapsed. */
export const DIST_BUSINESS: ReadonlySet<string> = new Set(["order", "approve", "creditOverride", "bill", "cancelBill", "warehouse", "dispatch", "delivery", "purchase", "adjust", "payments"]);

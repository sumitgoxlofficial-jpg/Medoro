export const PERMS = [
  "sale", "disc", "credit", "refund", "adjust", "purchase", "payments", "reports", "users", "integrations", "aiAct",
] as const;
export type Perm = (typeof PERMS)[number];

export const PERM_LABEL: Record<Perm, string> = {
  sale: "Create sales",
  disc: "Discount above 5%",
  credit: "Credit sales",
  refund: "Refunds & voids",
  adjust: "Stock adjustments & quarantine",
  purchase: "Approve purchases & GRN",
  payments: "Record payments & expenses",
  reports: "Accounting & reports",
  users: "Manage users & roles",
  integrations: "Integrations & backups",
  aiAct: "Confirm AI actions",
};

export const ROLE_NAMES = ["Owner", "Manager", "Pharmacist", "Cashier", "Accountant"] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

export const DEFAULT_GRANTS: Record<RoleName, Perm[]> = {
  Owner: [...PERMS],
  Manager: ["sale", "disc", "credit", "refund", "adjust", "purchase", "payments", "reports", "aiAct"],
  Pharmacist: ["sale", "disc", "adjust"],
  Cashier: ["sale"],
  Accountant: ["payments", "reports"],
};

/** Max discount % a user may give without approval. */
export const discountCap = (perms: readonly string[]) => (perms.includes("disc") ? 20 : 5);

export class ForbiddenError extends Error {
  status = 403;
  constructor(public perm: string) {
    super(`Your role cannot do this (needs “${PERM_LABEL[perm as Perm] ?? perm}”).`);
  }
}

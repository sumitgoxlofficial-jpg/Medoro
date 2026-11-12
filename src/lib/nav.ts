import type { Perm } from "@/domain/identity/permissions";

export type ScreenId =
  | "dash" | "own" | "pos" | "ord" | "dlv" | "ret" | "inv" | "count" | "recall" | "exp" | "intel" | "pur" | "parties" | "chq" | "bank" | "money" | "doc" | "est" | "att" | "acc"
  | "wa" | "crm" | "bak" | "sync" | "users" | "plan" | "privacy" | "help" | "admin";

export type NavDef = { id: ScreenId; href: string; icon: string; perm: Perm | null; group: "Operations" | "Intelligence" | "Business" | "Finance" | "Engagement" | "System"; abbr: string; sub: string };

export const NAV: NavDef[] = [
  { id: "dash", href: "/app", icon: "LayoutDashboard", perm: null, group: "Operations", abbr: "Home", sub: "" },
  { id: "own", href: "/app/owner", icon: "Smartphone", perm: "reports", group: "Operations", abbr: "Owner", sub: "Today across branches, on your phone" },
  { id: "pos", href: "/app/pos", icon: "ScanBarcode", perm: "sale", group: "Operations", abbr: "POS", sub: "F2 search · F4 hold · F9 complete" },
  { id: "ord", href: "/app/orders", icon: "Bike", perm: "sale", group: "Operations", abbr: "Orders", sub: "Phone, WhatsApp and counter orders for home delivery" },
  { id: "dlv", href: "/app/deliveries", icon: "Navigation", perm: "delivery", group: "Operations", abbr: "Deliver", sub: "Your deliveries: call, navigate, mark delivered" },
  { id: "att", href: "/app/attendance", icon: "Clock", perm: null, group: "Operations", abbr: "Attend", sub: "Punch in and out; managers see the team and fix a day" },
  { id: "est", href: "/app/estimates", icon: "FileText", perm: "sale", group: "Operations", abbr: "Estimate", sub: "Quotations: a priced list for a customer who isn’t buying yet" },
  { id: "ret", href: "/app/returns", icon: "Undo2", perm: "sale", group: "Operations", abbr: "Returns", sub: "Sales returns, refunds and cashier shift close" },
  { id: "inv", href: "/app/inventory", icon: "Package", perm: null, group: "Operations", abbr: "Stock", sub: "Catalogue, batches and stock ledger" },
  { id: "count", href: "/app/count", icon: "ClipboardCheck", perm: "adjust", group: "Operations", abbr: "Count", sub: "Physical count against system stock" },
  { id: "recall", href: "/app/recalls", icon: "ShieldAlert", perm: null, group: "Operations", abbr: "Recall", sub: "Verified recall notices matched to your batches" },
  { id: "exp", href: "/app/expiry", icon: "Hourglass", perm: null, group: "Intelligence", abbr: "Expiry", sub: "Batch exposure, projected loss and recovery actions" },
  { id: "intel", href: "/app/intelligence", icon: "ChartLine", perm: "reports", group: "Intelligence", abbr: "Insights", sub: "Forecasts, reorder policy, supplier prices and anomaly review" },
  { id: "pur", href: "/app/purchases", icon: "Truck", perm: "purchase", group: "Business", abbr: "Buy", sub: "Purchase orders, GRNs and invoice scanning" },
  { id: "parties", href: "/app/parties", icon: "Contact", perm: "payments", group: "Business", abbr: "Parties", sub: "Balances, terms and payments" },
  { id: "doc", href: "/app/doctors", icon: "Stethoscope", perm: "sale", group: "Business", abbr: "Doctors", sub: "Doctor master, prescriptions and sales by referring doctor" },
  { id: "acc", href: "/app/accounts", icon: "Landmark", perm: "reports", group: "Business", abbr: "A/c", sub: "Ledgers, P&L, GST summary and exports" },
  { id: "money", href: "/app/money", icon: "Wallet", perm: "payments", group: "Finance", abbr: "UPI", sub: "UPI & Bank Connect: statements, UPI checks, bill matching and connections" },
  { id: "bank", href: "/app/bank", icon: "Scale", perm: "payments", group: "Finance", abbr: "Bank", sub: "Import bank statements and match them to your books" },
  { id: "chq", href: "/app/cheques", icon: "Banknote", perm: "payments", group: "Finance", abbr: "Cheques", sub: "Cheques received and issued: post-dated, deposit, clearing and bounces" },
  { id: "wa", href: "/app/whatsapp", icon: "MessageCircle", perm: "integrations", group: "Engagement", abbr: "WhatsApp", sub: "Meta WhatsApp Business Cloud API" },
  { id: "crm", href: "/app/messaging", icon: "Megaphone", perm: "integrations", group: "Engagement", abbr: "CRM", sub: "Opt-in reminders, campaigns, loyalty and opt-outs" },
  { id: "bak", href: "/app/backup", icon: "CloudUpload", perm: "integrations", group: "System", abbr: "Backup", sub: "Encrypted Google Drive backups" },
  { id: "sync", href: "/app/sync", icon: "RefreshCw", perm: null, group: "System", abbr: "Sync", sub: "Devices, offline queue and conflict reconciliation" },
  { id: "users", href: "/app/users", icon: "ShieldCheck", perm: "users", group: "System", abbr: "Users", sub: "Roles, permissions, branches and audit trail" },
  { id: "plan", href: "/app/plan", icon: "CreditCard", perm: "users", group: "System", abbr: "Plan", sub: "Plan, entitlements, licence and Medoro invoices" },
  { id: "privacy", href: "/app/privacy", icon: "Lock", perm: "users", group: "System", abbr: "Privacy", sub: "Data ownership, external services, export and deletion" },
  { id: "help", href: "/app/help", icon: "LifeBuoy", perm: null, group: "System", abbr: "Help", sub: "Support tickets and replies from Medoro" },
];

/** Screens that are built. The rest stay hidden from navigation until they land. */
export const READY = new Set<ScreenId>(["dash", "own", "pos", "ord", "dlv", "est", "att", "ret", "inv", "count", "recall", "exp", "intel", "pur", "parties", "chq", "bank", "money", "doc", "wa", "crm", "bak", "sync", "users", "plan", "privacy", "help"]);

/**
 * A pharmacy whose records live on its counters and in its Google Drive: each screen opens the matching tab of
 * Billing (device), which works on the counter's own data. Screens with no counter tab yet are left out, and screens
 * that would open the same tab twice keep only the first.
 */
export const DRIVE_TAB: Partial<Record<ScreenId, string>> = {
  dash: "dash", pos: "bill", ord: "orders", ret: "bills", inv: "stock", exp: "reports", pur: "purchases", parties: "customers", money: "money",
  recall: "recalls", doc: "doctors", chq: "cheques", intel: "insights",
};
/** Screens that stay for Drive pharmacies as they are: WhatsApp and customer messaging, account, devices, plan, privacy, help. */
const DRIVE_KEEP = new Set<ScreenId>(["wa", "crm", "bak", "sync", "users", "plan", "privacy", "help"]);
export const driveNav = (n: NavDef): NavDef | null => DRIVE_TAB[n.id] ? { ...n, href: `/app/device-pos?tab=${DRIVE_TAB[n.id]}` } : DRIVE_KEEP.has(n.id) ? n : null;

export const navFor = (perms: string[]) => NAV.filter((n) => READY.has(n.id) && (!n.perm || perms.includes(n.perm)));

export function screenOf(path: string): NavDef | undefined {
  return [...NAV].sort((a, b) => b.href.length - a.href.length).find((n) => path === n.href || path.startsWith(n.href + "/"));
}

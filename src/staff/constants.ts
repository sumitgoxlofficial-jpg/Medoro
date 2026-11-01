// Shared by staff server code and console UI (no server imports here).

export const PRODUCTS = [
  { id: "starter", name: "Starter", m: 999 },
  { id: "pro", name: "Professional", m: 2499 },
  { id: "multi", name: "Multi-branch", m: 4499 },
  { id: "ai", name: "AI Pharmacy Manager add-on", m: 499, addon: true },
  { id: "setup", name: "Assisted setup (one-time)", m: 1999, once: true },
] as const;
export type ProductId = (typeof PRODUCTS)[number]["id"];
export const PRODUCT_IDS = PRODUCTS.map((p) => p.id) as [ProductId, ...ProductId[]];
export const product = (id: string) => PRODUCTS.find((p) => p.id === id) ?? PRODUCTS[0];

/** Price before 18% GST, in paise. List prices include GST; yearly is 10 months. */
export function amountPaise(id: string, cycle: string, discountPct = 0) {
  const p = product(id);
  const gross = ("once" in p && p.once ? p.m : cycle === "y" ? p.m * 10 : p.m) * 100;
  return Math.round((gross * (100 - discountPct)) / 118);
}

export const DEFAULT_RATES: Record<ProductId, { first: number; renew: number }> = {
  starter: { first: 15, renew: 5 }, pro: { first: 20, renew: 7 }, multi: { first: 20, renew: 8 }, ai: { first: 25, renew: 10 }, setup: { first: 10, renew: 0 },
};
export const MAX_RATE = 50;
export const TDS_PCT = 2;

export const STAGES = [
  { id: "new", label: "New", fg: "#3D454D" }, { id: "contacted", label: "Contacted", fg: "#2459C9" }, { id: "demo", label: "Demo booked", fg: "#5B45B0" },
  { id: "trial", label: "Trial", fg: "#94570A" }, { id: "won", label: "Won", fg: "#18794E" }, { id: "lost", label: "Lost", fg: "#C0362C" },
] as const;
export type StageId = (typeof STAGES)[number]["id"];
export const LEAD_SOURCES = ["Field visit", "Referral", "Website trial", "Distributor", "Pharmacy association", "Inbound call"] as const;
export const LOST_REASONS = ["Price", "Using other software", "Not ready yet", "No response", "Closed the shop"] as const;

export const ROLE_LABEL = { super_admin: "Super admin", sales: "Sales", care: "Customer care" } as const;
export type StaffRoleId = keyof typeof ROLE_LABEL;

export const CUSTOMER_STATUS = { trial: "Trial", active: "Active", grace: "Grace period", cancelled: "Cancelled" } as const;
export const SALE_STATUS = { pending: "Pending", verified: "Verified", paid: "Paid out", rejected: "Rejected" } as const;
export const TICKET_STATUS = { open: "Open", waiting: "Waiting on customer", resolved: "Resolved" } as const;
export const PRIORITY = { high: "High", medium: "Medium", low: "Low" } as const;
/** First-response targets in minutes. */
export const SLA_MIN = { high: 30, medium: 240, low: 1440 } as const;
export const TICKET_CHANNELS = ["Phone", "WhatsApp", "Email", "Chat", "App"] as const;
export const TICKET_CATEGORIES = ["General", "Billing counter", "Hardware · printer", "WhatsApp setup", "Backup", "Plan change", "Reports", "Data import"] as const;

export const MACROS = [
  { id: "printer", label: "Printer cuts receipt", t: "Medoro prints receipts through the browser. In the print window choose your thermal printer, set paper size to 80 mm (or your roll width), margins to None, and turn off headers and footers. Then print the next bill from Billing (POS). If it still cuts early, send us a photo of the receipt." },
  { id: "wa", label: "WhatsApp template rejected", t: "Meta rejects templates when the display name differs from your GST name. Fix it in Meta Business Manager and resubmit the template there; once Meta approves it, open WhatsApp in Medoro and press Sync next to Message templates." },
  { id: "pin", label: "Staff PIN reset", t: "The owner can reset a staff PIN from Users & branches: find the person and press Reset. Medoro shows a one-time reset code; the person uses it at Sign in → Pharmacy staff login → New employee to set a new PIN." },
  { id: "pay", label: "How to renew", t: "To renew, open Subscription in Medoro (under System). Pay by UPI or bank transfer with the reference shown there, then tap “I’ve paid” and enter the transaction number. Your data stays safe and nothing is deleted while we check the payment." },
] as const;

export const IFSC_BANKS: Record<string, string> = {
  HDFC: "HDFC Bank", ICIC: "ICICI Bank", SBIN: "State Bank of India", UTIB: "Axis Bank", KKBK: "Kotak Mahindra Bank", PUNB: "Punjab National Bank",
  BARB: "Bank of Baroda", CNRB: "Canara Bank", IDIB: "Indian Bank", YESB: "Yes Bank", IDFB: "IDFC FIRST Bank", MAHB: "Bank of Maharashtra",
};
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
export const MOBILE_RE = /^[6-9]\d{9}$/;
export const digits = (s: string) => s.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
export const rupees = (paise: number) => "₹" + Math.round(paise / 100).toLocaleString("en-IN");

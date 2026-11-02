import type { WaTemplate } from "./delivery";

// Texts for WhatsApp messages sent from the pharmacy's own phone (linked by QR through the WhatsApp connector).
// Meta templates don't apply there: Medoro writes the message itself from the same variables a template would get.
// The kind comes from the message's reference (see kindOf in whatsapp.ts), so it works whatever template name is set.

/** Kind of message from its reference: "campaign:…", "refill:…", a sale id for an invoice, and so on. */
export function phoneKind(ref: string) {
  for (const k of ["campaign", "refill", "feedback", "payrem", "creditnote", "loyalty", "order"] as const) if (ref.startsWith(k + ":")) return k;
  return "invoice" as const;
}
export type PhoneKind = ReturnType<typeof phoneKind>;

const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** The message text. vars are in the order the matching Meta template takes them. */
export function phoneText(kind: PhoneKind, vars: string[], pharmacy: string, opts: { pdf?: boolean } = {}) {
  const v = vars.map(clean);
  const name = v[0] || "Customer";
  const shop = clean(pharmacy) || "us";
  const text = {
    invoice: opts.pdf
      ? `Hello ${name}, thank you for shopping at ${shop}. Your invoice ${v[1]} for Rs ${v[2]} is attached.`
      : `Hello ${name}, thank you for shopping at ${shop}. Your invoice ${v[1]} for Rs ${v[2]}${v[3] ? `: ${v[3]}` : "."}`,
    creditnote: `Hello ${name}, credit note ${v[1]} for Rs ${v[2]} has been issued against invoice ${v[3]} at ${shop}.`,
    refill: `Hi ${name}, your ${v[1]} may be running out around ${v[2]}. Visit ${shop} to refill.`,
    feedback: `Hi ${name}, thank you for visiting ${shop} (invoice ${v[1]}). How was your experience? Just reply to this message.`,
    payrem: `Hi ${name}, Rs ${v[1]} is due on your account at ${v[2] || shop}. Please clear it on your next visit.`,
    campaign: `Hi ${name}, ${v[1] || `an update from ${shop}.`}${v[1] ? ` - ${shop}` : ""}`,
    loyalty: `Hi ${name}, you earned ${v[1]} points at ${shop}. Your balance is ${v[2]} points.`,
    order: `${shop}: ${v.slice(1).filter(Boolean).join(" · ")}`,
  }[kind];
  const optOut = kind === "campaign" || kind === "refill" || kind === "feedback" || kind === "loyalty" ? "\n\nReply STOP to opt out." : "";
  return (text + optOut).slice(0, 4000);
}

/**
 * Template names a phone link accepts, shown where an approved template is chosen. Any other name works too: with a
 * phone link the name only labels the message; the text above is what goes out.
 */
export const PHONE_TEMPLATES: WaTemplate[] = [
  ["invoice_share", 3, "DOCUMENT"], ["invoice_link", 4], ["credit_note", 4], ["refill_reminder", 3], ["feedback_request", 2],
  ["payment_reminder", 3], ["store_update", 2], ["loyalty_points", 3],
].map(([name, params, header]) => ({ name: name as string, language: "en", status: "approved", category: "utility", params: params as number, ...(header ? { header: header as string } : {}) }));

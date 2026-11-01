/**
 * WhatsApp from the counter, with no server and no WhatsApp Business setup: a wa.me link opens WhatsApp (app or
 * web) with the message ready for the cashier to send. Indian 10-digit mobiles get the 91 country code.
 */
import type { SaleDetail } from "./reports";
import type { Pharmacy } from "./seed";

const rs = (p: number) => `₹${(p / 100).toFixed(2)}`;

/** wa.me link for a mobile number and message; null if the number isn't a valid Indian mobile. */
export function waLink(phone: string | null | undefined, text: string): string | null {
  const d = (phone ?? "").replace(/\D/g, "").replace(/^0+/, "");
  const n = d.length === 10 ? `91${d}` : d.length === 12 && d.startsWith("91") ? d : null;
  if (!n || !/^91[6-9]\d{9}$/.test(n)) return null;
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

/** A short bill summary for WhatsApp. */
export function billText(d: SaleDetail, pharmacy: Pharmacy | null): string {
  const s = d.sale as Record<string, string | number | null>;
  const lines = d.lines.map((l) => `• ${l.name} × ${l.qty}${l.loose ? ` ${l.looseUnit}` : ""} = ${rs(l.mrpPaise * l.qty - l.discountPaise)}`);
  return [
    `${pharmacy?.tradeName || pharmacy?.name || "Your pharmacy"}`,
    `Bill ${s.invoiceNo} · ${new Date(String(s.at)).toLocaleDateString("en-IN")}`,
    ...lines,
    `Total ${rs(Number(s.totalPaise))} (incl. GST)`,
    ...d.returns.map((r) => `Credit note ${r.creditNoteNo}: −${rs(r.amountPaise)}`),
    pharmacy?.phone ? `Questions? Call ${pharmacy.phone}` : "",
    "Thank you. Get well soon.",
  ].filter(Boolean).join("\n");
}

/** A polite reminder of money due. */
export function dueText(name: string, duePaise: number, pharmacy: Pharmacy | null): string {
  return [
    `Namaste ${name},`,
    `This is a reminder from ${pharmacy?.tradeName || pharmacy?.name || "your pharmacy"}: ${rs(duePaise)} is pending on your account.`,
    "You can pay at the counter or by UPI. Please ignore if already paid. Thank you.",
  ].join("\n");
}

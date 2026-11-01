/**
 * What a bank narration says about a transaction: channel (UPI, IMPS, NEFT…), the UTR/RRN, the payer's UPI ID and
 * name. Only fields the narration states in a recognisable form are filled; anything unclear stays null. Banks
 * format UPI narrations differently (NPCI's UPI circular 43 asks for "UPI", the 12-digit RRN and the remarks), e.g.
 *   SBI    BY TRANSFER-UPI/CR/412345678901/RAHUL KUMAR/SBIN/rahul@oksbi/Payment
 *   HDFC   UPI-RAHUL KUMAR-rahul@okhdfcbank-HDFC0001234-412345678901-PAYMENT
 *   ICICI  UPI/412345678901/Payment/rahul@okicici/ICICI Bank/ICI1a2b
 *   Axis   UPI/P2A/412345678901/RAHUL KUMAR/Payment/Axis Bank
 *   Kotak  UPI/RAHUL KUMAR/412345678901/Payment
 */

export const CHANNELS = ["upi", "imps", "neft", "rtgs", "cheque", "cash", "card", "atm", "settlement", "interest", "charges", "other", "unknown"] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABEL: Record<Channel, string> = {
  upi: "UPI", imps: "IMPS", neft: "NEFT", rtgs: "RTGS", cheque: "Cheque", cash: "Cash", card: "Card / POS", atm: "ATM",
  settlement: "Provider settlement", interest: "Interest", charges: "Bank charges", other: "Other", unknown: "Not stated",
};

export type Narration = { channel: Channel; utr: string | null; vpa: string | null; name: string | null };

const word = (w: string) => new RegExp(`(^|[^A-Z])${w}([^A-Z]|$)`);
/** Payment companies whose bank credits are daily settlements of many payments, not one customer payment. */
const SETTLERS = /PAYTM|PHONEPE|BHARATPE|RAZORPAY|PINE ?LABS|MSWIPE|CASHFREE|PAYU|EZETAP|INSTAMOJO|GPAY ?SETTL|ONE97/;

export function channelOf(text: string): Channel {
  const s = text.toUpperCase();
  if (SETTLERS.test(s) && /SETTL|STLMT|SETL|PAYOUT|MERCHANT ?PAY/.test(s)) return "settlement";
  if (word("UPI").test(s)) return "upi";
  if (word("IMPS").test(s) || /MMT\/IMPS/.test(s)) return "imps";
  if (word("RTGS").test(s)) return "rtgs";
  if (word("NEFT").test(s)) return "neft";
  if (/(^|[^A-Z])(CHQ|CHEQUE|CLG|CLEARING|INWARD CLG|OW CLG|CTS)([^A-Z]|$)/.test(s)) return "cheque";
  if (/CASH ?DEP|BY CASH|CSH ?DEP|CASH DEPOSIT|CDM/.test(s)) return "cash";
  if (/(^|[^A-Z])(ATM|ATW|NWD|CASH WDL)([^A-Z]|$)/.test(s)) return "atm";
  if (/(^|[^A-Z])(POS|ECOM|PCD|VPS|IPS)([^A-Z]|$)/.test(s)) return "card";
  if (/INT\.?\s*(PD|PAID|CR|CREDIT)|INTEREST/.test(s)) return "interest";
  if (/CHRG|CHARGES|CHGS|SMS ?CHG|AMC|GST ON|MIN BAL/.test(s)) return "charges";
  return s.trim() ? "other" : "unknown";
}

const uniq = (xs: string[]) => [...new Set(xs)];

/** The transfer reference: 12-digit RRN for UPI/IMPS, NEFT/RTGS UTR. Null when absent or when two candidates disagree. */
export function utrOf(text: string, channel: Channel, refCol = ""): string | null {
  const s = `${refCol} ${text}`.toUpperCase();
  if (channel === "upi" || channel === "imps") {
    const c = uniq([...s.matchAll(/(?<![0-9])([0-9]{12})(?![0-9])/g)].map((m) => m[1]));
    return c.length === 1 ? c[0] : null;
  }
  if (channel === "neft") {
    const c = uniq([...s.matchAll(/(?<![A-Z0-9])([A-Z]{4}N[0-9]{11,13}|N[0-9]{15}|[A-Z]{4}[0-9]{12})(?![A-Z0-9])/g)].map((m) => m[1]));
    return c.length === 1 ? c[0] : null;
  }
  if (channel === "rtgs") {
    const c = uniq([...s.matchAll(/(?<![A-Z0-9])([A-Z]{4}R[A-Z0-9]{17}|[A-Z]{4}R[0-9]{10,12})(?![A-Z0-9])/g)].map((m) => m[1]));
    return c.length === 1 ? c[0] : null;
  }
  return null;
}

/** A UPI ID (VPA) named in the narration. Null when none or more than one. */
export function vpaOf(text: string): string | null {
  // No "-" in the name part: HDFC separates fields with it. "(?!\.[a-z])": an e-mail address is not a UPI ID.
  const c = uniq([...text.matchAll(/(?<![A-Za-z0-9._])([A-Za-z0-9][A-Za-z0-9._]{1,63}@[A-Za-z][A-Za-z0-9]{1,30})(?![A-Za-z0-9@]|\.[A-Za-z])/g)].map((m) => m[1].toLowerCase()));
  return c.length === 1 ? c[0] : null;
}

const nameOk = (s: string | undefined) => {
  const n = (s ?? "").trim().replace(/\s+/g, " ");
  return n.length >= 3 && n.length <= 60 && /^[A-Za-z][A-Za-z .']*$/.test(n) && !/^(PAYMENT|PAY|UPI|SENT|NA|NULL|TRANSFER)$/i.test(n) ? n : null;
};

/** The payer's name, only from the structured formats above. */
export function nameOf(text: string): string | null {
  const s = text.replace(/\s+/g, " ").trim();
  let m: RegExpExecArray | null;
  // SBI / Axis / IMPS: UPI/CR/<rrn>/<name>/…, UPI/P2A/<rrn>/<name>/…, IMPS/P2A/<rrn>/<name>/…
  if ((m = /(?:UPI|IMPS)\/(?:CR|DR|P2A|P2M|P2P)\/\d{12}\/([^/]+)\//i.exec(s))) return nameOk(m[1]);
  // HDFC: UPI-<name>-<vpa>-…
  if ((m = /UPI-([^-]+)-[A-Za-z0-9._-]+@[A-Za-z0-9]+-/i.exec(s))) return nameOk(m[1]);
  // Kotak: UPI/<name>/<rrn>/…
  if ((m = /UPI\/([^/0-9][^/]*)\/\d{12}(?:\/|$)/i.exec(s))) return nameOk(m[1]);
  return null;
}

export function parseNarration(text: string, refCol = ""): Narration {
  const channel = channelOf(`${text} ${refCol}`);
  const upiLike = channel === "upi" || channel === "imps";
  return { channel, utr: utrOf(text, channel, refCol), vpa: upiLike ? vpaOf(text) : null, name: upiLike ? nameOf(text) : null };
}

/** Upper-case letters and digits only: narrations lose punctuation and spaces in many banks' exports. */
export const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

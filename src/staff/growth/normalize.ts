// Pure helpers for lead data: phone numbers, names, websites and fuzzy matching. No server imports.

/**
 * Indian phone number → E.164 (+91 and 10 national digits), or null.
 * Accepts mobiles ("98765 43210", "+91-98765-43210", "098765 43210") and landlines with STD code ("020-2553 1234").
 * Every Indian national number is 10 digits; toll-free (1800…) and short codes are rejected.
 */
export function toE164(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  let d = s.replace(/\D/g, "");
  if (s.startsWith("+") && !d.startsWith("91")) return null; // a foreign number
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 13 && d.startsWith("091")) d = d.slice(3);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (!/^[1-9]\d{9}$/.test(d)) return null;
  if (d.startsWith("1")) return null; // 1800/1860 toll-free and service numbers
  return "+91" + d;
}

export const isMobile = (e164: string | null) => !!e164 && /^\+91[6-9]\d{9}$/.test(e164);
/** The tel: URI the dialer opens. Only built from a number toE164 accepted. */
export function telUri(e164: string): string {
  if (!/^\+91[2-9]\d{9}$/.test(e164)) throw new Error("Not a valid Indian E.164 number.");
  return "tel:" + e164;
}
export const maskPhone = (e164: string | null) => (e164 ? e164.slice(0, 3) + "•••••" + e164.slice(-5) : "");
export const maskEmail = (e: string) => { const [u, d] = e.split("@"); return d ? (u.slice(0, 1) + "•••@" + d) : ""; };
export const displayPhone = (e164: string | null) => (e164 ? `${e164.slice(0, 3)} ${e164.slice(3, 8)} ${e164.slice(8)}` : "");

export const normEmail = (raw: string | null | undefined) => {
  const v = String(raw ?? "").trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(v) ? v : "";
};

/** "https://www.ShivamMedicals.in/contact" → "shivammedicals.in". Blank for anything that isn't a web address. */
export function domainOf(raw: string | null | undefined): string {
  let v = String(raw ?? "").trim().toLowerCase();
  if (!v) return "";
  if (!/^https?:\/\//.test(v)) v = "http://" + v;
  try {
    const h = new URL(v).hostname.replace(/^www\./, "");
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) && !/^\d+(\.\d+){3}$/.test(h) ? h : "";
  } catch { return ""; }
}
/** A website as https URL, or "". */
export function normWebsite(raw: string | null | undefined): string {
  const d = domainOf(raw);
  if (!d) return "";
  const v = String(raw).trim();
  return /^https?:\/\//i.test(v) ? v.replace(/\s/g, "") : "https://" + v.replace(/\s/g, "");
}

const NOISE = /\b(medical|medicals|medicos?|general|store|stores|pharmacy|pharmacies|pharma|chemists?|druggists?|drug|house|centre|center|and|the|shop|enterprises?|agency|agencies|pvt|ltd|private|limited|llp|co)\b/g;
/** Name reduced for matching: "Shree Ganesh Medical & General Stores" → "shreeganesh". */
export function nameKey(name: string): string {
  const base = String(name ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " ").replace(/[^a-z0-9ऀ-ॿ ]/g, " ");
  const k = base.replace(NOISE, " ").replace(/\s+/g, "");
  return k || base.replace(/\s+/g, "");
}

/** Dice coefficient over character bigrams, 0..1. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string) => { const m = new Map<string, number>(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); } return m; };
  const ga = grams(a), gb = grams(b);
  let hit = 0;
  for (const [g, n] of ga) hit += Math.min(n, gb.get(g) ?? 0);
  return (2 * hit) / (a.length - 1 + (b.length - 1));
}

export const addressKey = (s: string) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
export const clean = (s: unknown, max = 200) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Who issues Medoro's own invoices (subscription payments). The contact lines are the ones the website already shows;
 * the legal name and registered address appear on the invoice only when they are configured:
 *   MEDORO_LEGAL_NAME, MEDORO_ADDRESS (lines separated by "|"), MEDORO_BILLING_EMAIL, MEDORO_PHONE, MEDORO_WEBSITE
 */
export type Biller = { name: string; legalName: string; address: string[]; email: string; phone: string; website: string };

export function biller(env: Record<string, string | undefined> = process.env): Biller {
  const v = (k: string) => env[k]?.trim() || "";
  return {
    name: "Medoro",
    legalName: v("MEDORO_LEGAL_NAME") || "Medoro",
    address: v("MEDORO_ADDRESS").split("|").map((s) => s.trim()).filter(Boolean),
    email: v("MEDORO_BILLING_EMAIL") || "billing@medoro.in",
    phone: v("MEDORO_PHONE") || "+91 62077 74673",
    website: v("MEDORO_WEBSITE") || "medoro.in",
  };
}

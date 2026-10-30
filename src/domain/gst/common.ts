// GST return building blocks shared by GSTR-1, GSTR-3B and the HSN summary. Amounts are paise.

/** One line of an invoice or credit note. Credit-note lines carry positive amounts. */
export type GstLine = { hsn: string; desc: string; uqc: string; qty: number; rate: number; taxable: number; igst: number; cgst: number; sgst: number };

export type GstDoc = {
  kind: "inv" | "cn";
  no: string;
  /** IST calendar date, YYYY-MM-DD. */
  date: string;
  /** Document value including tax and round-off. */
  value: number;
  /** Place of supply, 2-digit state code. */
  pos: string;
  /** Buyer GSTIN: registered (B2B) when set. */
  ctin: string | null;
  inter: boolean;
  branchId: string;
  lines: GstLine[];
  /** Credit notes: the invoice they reduce. */
  orig?: { no: string; date: string; value: number; inter: boolean; ctin: string | null };
};

/** Current rule: inter-state B2C invoices above ₹1 lakh are reported invoice-wise (B2CL). */
export const B2CL_THRESHOLD_PAISE = 1_00_000_00;

/** Table 12 is reported in two lists (B2B and B2C) from the May 2025 return period. */
export const hsnSplitFrom = (fp: string) => Number(fp.slice(2)) * 100 + Number(fp.slice(0, 2)) >= 202505;

export const rs = (p: number) => Math.round(p) / 100;

/** "2026-10" → "102026" */
export const fpOf = (month: string) => month.slice(5, 7) + month.slice(0, 4);

/** "2026-10-31" → "31-10-2026" */
export const dmy = (iso: string, sep = "-") => `${iso.slice(8, 10)}${sep}${iso.slice(5, 7)}${sep}${iso.slice(0, 4)}`;

/** Unit quantity code for the pack a medicine is sold in. */
export function uqcFor(form: string): string {
  const f = form.toLowerCase();
  if (/syrup|suspension|liquid|solution|drops|lotion|tonic|oil|spray|inhal/.test(f)) return "BTL";
  if (/cream|ointment|gel|paste/.test(f)) return "TUB";
  if (/tablet|capsule|strip/.test(f)) return "PAC";
  return "NOS";
}

/** Unit quantity code for a loose unit (one tablet, one ml…), for lines sold loose. */
export function uqcForLoose(form: string, looseUnit = ""): string {
  if (/^ml$|millilit/i.test(looseUnit.trim())) return "MLT";
  if (/tablet|capsule|strip/i.test(form) || /^(tab|tablet|cap|capsule)s?$/i.test(looseUnit.trim())) return "TBS";
  return "NOS";
}

const HSN_DESC: Record<string, string> = {
  "3002": "VACCINES, BLOOD FRACTIONS",
  "3003": "MEDICAMENTS NOT IN DOSES",
  "3004": "MEDICAMENTS IN MEASURED DOSES",
  "3005": "WADDING, GAUZE, BANDAGES",
  "3006": "PHARMACEUTICAL GOODS",
  "9018": "MEDICAL INSTRUMENTS",
  "9619": "SANITARY PADS, DIAPERS",
};
export const hsnDesc = (hsn: string) => HSN_DESC[hsn.slice(0, 4)] ?? "";

export type HsnRow = { b2b: boolean; hsn: string; desc: string; uqc: string; rate: number; qty: number; taxable: number; igst: number; cgst: number; sgst: number };

/** HSN-wise totals (Table 12): invoices less credit notes, by buyer type, HSN, unit and rate. */
export function hsnRows(docs: GstDoc[]): HsnRow[] {
  const m = new Map<string, HsnRow>();
  for (const d of docs) {
    const sign = d.kind === "cn" ? -1 : 1, b2b = !!(d.kind === "cn" ? d.orig?.ctin : d.ctin);
    for (const l of d.lines) {
      const k = [b2b, l.hsn, l.uqc, l.rate].join("|");
      const r = m.get(k) ?? { b2b, hsn: l.hsn, desc: l.desc || hsnDesc(l.hsn), uqc: l.uqc, rate: l.rate, qty: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
      r.qty += sign * l.qty; r.taxable += sign * l.taxable; r.igst += sign * l.igst; r.cgst += sign * l.cgst; r.sgst += sign * l.sgst;
      m.set(k, r);
    }
  }
  return [...m.values()].sort((a, b) => Number(b.b2b) - Number(a.b2b) || a.hsn.localeCompare(b.hsn) || a.rate - b.rate || a.uqc.localeCompare(b.uqc));
}

export function hsnCsv(rows: HsnRow[]): (string | number)[][] {
  const t = rows.reduce((a, r) => ({ taxable: a.taxable + r.taxable, igst: a.igst + r.igst, cgst: a.cgst + r.cgst, sgst: a.sgst + r.sgst }), { taxable: 0, igst: 0, cgst: 0, sgst: 0 });
  return [["Supply type", "HSN", "Description", "UQC", "Total quantity", "Rate %", "Total value", "Taxable value", "IGST", "CGST", "SGST", "Cess"],
    ...rows.map((r) => [r.b2b ? "B2B" : "B2C", r.hsn, r.desc, r.uqc, r.qty, r.rate, rs(r.taxable + r.igst + r.cgst + r.sgst).toFixed(2), rs(r.taxable).toFixed(2), rs(r.igst).toFixed(2), rs(r.cgst).toFixed(2), rs(r.sgst).toFixed(2), "0.00"]),
    ["Total", "", "", "", "", "", rs(t.taxable + t.igst + t.cgst + t.sgst).toFixed(2), rs(t.taxable).toFixed(2), rs(t.igst).toFixed(2), rs(t.cgst).toFixed(2), rs(t.sgst).toFixed(2), "0.00"]];
}

// GST state codes (first two digits of a GSTIN). Supplies across states carry IGST instead of CGST + SGST.
export const GST_STATES: [string, string][] = [
  ["01", "Jammu & Kashmir"], ["02", "Himachal Pradesh"], ["03", "Punjab"], ["04", "Chandigarh"], ["05", "Uttarakhand"], ["06", "Haryana"],
  ["07", "Delhi"], ["08", "Rajasthan"], ["09", "Uttar Pradesh"], ["10", "Bihar"], ["11", "Sikkim"], ["12", "Arunachal Pradesh"],
  ["13", "Nagaland"], ["14", "Manipur"], ["15", "Mizoram"], ["16", "Tripura"], ["17", "Meghalaya"], ["18", "Assam"], ["19", "West Bengal"],
  ["20", "Jharkhand"], ["21", "Odisha"], ["22", "Chhattisgarh"], ["23", "Madhya Pradesh"], ["24", "Gujarat"], ["26", "Dadra & Nagar Haveli and Daman & Diu"],
  ["27", "Maharashtra"], ["29", "Karnataka"], ["30", "Goa"], ["31", "Lakshadweep"], ["32", "Kerala"], ["33", "Tamil Nadu"], ["34", "Puducherry"],
  ["35", "Andaman & Nicobar Islands"], ["36", "Telangana"], ["37", "Andhra Pradesh"], ["38", "Ladakh"],
];

const KNOWN = new Set(GST_STATES.map(([c]) => c));

/** State code from an explicit code or a GSTIN; null when unknown. */
export function stateOf(code: string | null | undefined, gstin?: string | null): string | null {
  if (code && KNOWN.has(code)) return code;
  const g = gstin?.slice(0, 2);
  return g && KNOWN.has(g) ? g : null;
}

/** Inter-state only when both states are known and differ; unknown states stay intra-state. */
export const isInterState = (a: string | null, b: string | null) => !!a && !!b && a !== b;

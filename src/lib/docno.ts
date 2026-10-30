/**
 * GST document numbers (CGST Rule 46(b)): at most 16 characters of A–Z, 0–9, "/" and "-", unique per
 * fiscal year. Numbers are "<series><FY>-<serial>", e.g. MAI2627-000001; a series of up to 5 characters
 * keeps even the 999999th document within 16.
 */
export const GST_DOC_RE = /^[1-9A-Z][0-9A-Z/-]{0,15}$/;
export const SERIES_MAX = 5;
const SERIES_RE = /^[A-Z][A-Z0-9]{0,4}$/;

export const validSeries = (s: string) => SERIES_RE.test(s);

export function gstDocNo(series: string, fy: string, n: number, width = 6): string {
  const no = `${series}${fy}-${String(n).padStart(width, "0")}`;
  if (!GST_DOC_RE.test(no)) throw new Error(`Document number ${no} doesn’t fit the GST format (16 characters of A–Z, 0–9, / and -).`);
  return no;
}

/** Sales invoice number of a branch: its code is the series. */
export function invoiceNo(branchCode: string, fy: string, n: number): string {
  if (!validSeries(branchCode)) throw new Error(`Branch code ${branchCode} can’t be an invoice series: use 1–${SERIES_MAX} letters or digits, starting with a letter.`);
  return gstDocNo(branchCode, fy, n);
}

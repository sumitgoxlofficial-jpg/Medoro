// Drug licence and GSTIN checks for chemists. Licence numbers vary by state (e.g. "MH-PZ1-123456", "20B/KA/BNG/1234",
// "DL-20B-123-2024"); there is no national checksum, so the check is shape-only and the licence copy must be verified
// by a person (KYC) before credit is given. GSTIN uses the official checksum (domain/accounting/gst.ts).

const DL_RE = /^[A-Z0-9][A-Z0-9/\-. ]{3,38}[A-Z0-9]$/;

export function normaliseDl(s: string) {
  return s.trim().toUpperCase().replace(/\s+/g, " ");
}

export function dlProblem(no: string | null | undefined, label: string): string | null {
  const v = normaliseDl(no ?? "");
  if (!v) return `${label} is required.`;
  if (!DL_RE.test(v)) return `${label} “${v}” doesn’t look like a licence number (letters, digits, / and - only).`;
  if (!/\d{3,}/.test(v)) return `${label} “${v}” should contain the licence serial number.`;
  return null;
}

export function dlExpiryProblem(expiry: string | null | undefined, today: string): string | null {
  if (!expiry) return "Enter the licence validity date.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return "Licence validity must be a date.";
  if (expiry < today) return `The drug licence expired on ${expiry}. Ask for the renewed licence.`;
  return null;
}

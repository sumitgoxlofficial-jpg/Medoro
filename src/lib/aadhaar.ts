// Aadhaar numbers: 12 digits, the first 2 to 9, the last a Verhoeff check digit. This catches typing mistakes only;
// it does not prove the number was issued to the person (that needs UIDAI, which Medoro does not connect to).

const D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
const INV = [0,4,3,2,1,5,6,7,8,9];

/** True when the digits (check digit last) pass the Verhoeff check. */
export function verhoeff(digits: string): boolean {
  let c = 0;
  [...digits].reverse().forEach((ch, i) => { c = D[c][P[i % 8][Number(ch)]]; });
  return c === 0;
}
/** The check digit to append to `digits` so the whole passes `verhoeff`. */
export function verhoeffDigit(digits: string): number {
  let c = 0;
  [...digits].reverse().forEach((ch, i) => { c = D[c][P[(i + 1) % 8][Number(ch)]]; });
  return INV[c];
}

export const onlyDigits = (s: string) => s.replace(/\D/g, "");
export const validAadhaar = (raw: string) => { const d = onlyDigits(raw); return /^[2-9]\d{11}$/.test(d) && verhoeff(d); };
/** "XXXX XXXX 1234": only the last four digits are ever shown. */
export const maskAadhaar = (last4: string) => (last4 ? `XXXX XXXX ${last4}` : "");
/** "1234 5678 9012" for reading against the card. */
export const spacedAadhaar = (d: string) => d.replace(/(\d{4})(?=\d)/g, "$1 ").trim();

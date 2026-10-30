/** "9822041736" → "98220•••36": enough to tell customers apart at the counter, not enough to contact them. */
export function maskPhone(p: string | null | undefined) {
  if (!p) return p ?? null;
  const d = p.replace(/\D/g, "");
  if (d.length < 6) return "••••";
  return `${d.slice(0, d.length - 5)}${"•".repeat(3)}${d.slice(-2)}`;
}

export const isMasked = (p: string | null | undefined) => !!p && p.includes("•");

/** "9822041736" → "••••••1736": the last 4 digits tell customers apart at the counter, not enough to contact them. */
export function maskPhone(p: string | null | undefined) {
  if (!p) return p ?? null;
  const d = p.replace(/\D/g, "");
  if (d.length < 6) return "••••";
  return `${"•".repeat(d.length - 4)}${d.slice(-4)}`;
}

export const isMasked = (p: string | null | undefined) => !!p && p.includes("•");

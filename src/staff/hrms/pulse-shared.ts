// Shared by server code and the chat screen (no server imports here).

/** Sales Pulse bots have ids pulse:01 to pulse:45: 01-20 are the women, 21-45 the men. Their photos sit in /public/sales-pulse. */
export const isPulseId = (id: string) => id.startsWith("pulse:");
export function pulsePhoto(id: string): string | null {
  const n = Number(id.slice(6));
  if (!isPulseId(id) || !Number.isInteger(n) || n < 1 || n > 45) return null;
  return n <= 20 ? `/sales-pulse/f${String(n).padStart(2, "0")}.jpg` : `/sales-pulse/m${String(n - 20).padStart(2, "0")}.jpg`;
}

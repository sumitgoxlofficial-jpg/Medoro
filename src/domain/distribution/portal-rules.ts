// What a chemist sees of a distributor's stock, as the distributor chose: exact packs, a band, or nothing.
export type StockView = { label: string; tone: "green" | "amber" | "red" | "gray"; packs: number | null };

export function stockBand(packs: number, mode: "exact" | "band" | "none"): StockView {
  if (mode === "none") return { label: "Ask distributor", tone: "gray", packs: null };
  if (packs <= 0) return { label: "Out of stock", tone: "red", packs: mode === "exact" ? 0 : null };
  if (mode === "exact") return { label: `${packs} in stock`, tone: packs < 10 ? "amber" : "green", packs };
  return packs < 10 ? { label: "Low stock", tone: "amber", packs: null } : { label: "In stock", tone: "green", packs: null };
}

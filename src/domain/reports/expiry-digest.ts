// The expiry section of the daily report email: how much stock is near expiry, in bands, and what to look at first.
// Pure: it reads the rows of the "Expiry exposure" report.
type Row = (string | number | null)[];

export const EXPIRY_BANDS = [
  { id: "expired", label: "Already expired, still on the shelf", min: -Infinity, max: 0, todo: "Take it off sale now (Expiry ▸ Quarantine) and claim from the supplier if the window allows." },
  { id: "30", label: "Expiring within 30 days", min: 1, max: 30, todo: "Return to the supplier, discount for quick sale, or move to a busier branch." },
  { id: "60", label: "Expiring in 31 to 60 days", min: 31, max: 60, todo: "Push these first at the counter and consider a discount." },
  { id: "90", label: "Expiring in 61 to 90 days", min: 61, max: 90, todo: "Watch them; don't reorder these medicines yet." },
  { id: "180", label: "Expiring in 91 to 180 days", min: 91, max: 180, todo: "No action yet; they sell oldest-first." },
] as const;

const rupees = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

export function expiryDigest(rows: Row[]): { lines: string[]; batches: number; within30: number; atRisk30: number } {
  const head = rows[0] ?? [], col = (n: string) => head.indexOf(n);
  const iMed = col("Medicine"), iBatch = col("Batch"), iDays = col("Days left"), iQty = col("Qty"), iCost = col("Exposure at cost");
  if (iDays < 0) return { lines: [], batches: 0, within30: 0, atRisk30: 0 };
  const data = rows.slice(1).map((r) => ({ med: String(r[iMed] ?? ""), batch: String(r[iBatch] ?? ""), days: Number(r[iDays]), qty: String(r[iQty] ?? ""), cost: parseFloat(String(r[iCost] ?? 0)) || 0 })).filter((r) => Number.isFinite(r.days));
  if (!data.length) return { lines: ["Expiring stock: nothing within 180 days. Well done."], batches: 0, within30: 0, atRisk30: 0 };
  const lines = ["Expiring stock (cost at risk):"];
  for (const b of EXPIRY_BANDS) {
    const hit = data.filter((r) => r.days >= b.min && r.days <= b.max);
    if (hit.length) lines.push(`  ${b.label}: ${hit.length} batch${hit.length === 1 ? "" : "es"}, ${rupees(hit.reduce((a, r) => a + r.cost, 0))}`);
  }
  const urgent = [...data].sort((a, b) => a.days - b.days).filter((r) => r.days <= 90).slice(0, 5);
  if (urgent.length) {
    lines.push("", "Look at these first:", ...urgent.map((r) => `  ${r.med} · batch ${r.batch} · ${r.days <= 0 ? "expired" : `${r.days} day${r.days === 1 ? "" : "s"} left`} · ${r.qty} · ${rupees(r.cost)}`));
    const worst = EXPIRY_BANDS.find((b) => data.some((r) => r.days >= b.min && r.days <= b.max))!;
    lines.push("", `What to do: ${worst.todo} Everything is on the Expiry page, with return, transfer and write-off buttons.`);
  }
  const near = data.filter((r) => r.days >= 1 && r.days <= 30);
  return { lines, batches: data.length, within30: near.length, atRisk30: near.reduce((a, r) => a + r.cost, 0) };
}

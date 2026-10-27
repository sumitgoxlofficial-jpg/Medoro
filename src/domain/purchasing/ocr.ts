import "server-only";

export type OcrLine = { text: string; name?: string; batch?: string; expiry?: string; qty?: number; freeQty?: number; rate?: number; mrp?: number; confidence: number };
export type OcrResult = { invoiceNo?: string; invoiceDate?: string; total?: number; lines: OcrLine[] };

/**
 * OCR runs only when an engine is configured. OCR_ENGINE=remote posts the file to OCR_REMOTE_URL
 * (Bearer OCR_REMOTE_KEY) and expects the OcrResult JSON shape above, amounts in rupees.
 * Without an engine, invoices are entered by hand on the same review screen.
 */
export const ocrConfigured = () => process.env.OCR_ENGINE === "remote" && !!process.env.OCR_REMOTE_URL;

export async function extractInvoice(bytes: Buffer, mime: string): Promise<OcrResult> {
  if (!ocrConfigured()) throw new Error("No OCR engine is configured on this server.");
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), "invoice");
  const res = await fetch(process.env.OCR_REMOTE_URL!, { method: "POST", body: form, headers: process.env.OCR_REMOTE_KEY ? { Authorization: `Bearer ${process.env.OCR_REMOTE_KEY}` } : {}, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`OCR engine returned ${res.status}.`);
  const j = (await res.json()) as OcrResult;
  if (!Array.isArray(j.lines)) throw new Error("OCR engine returned an unexpected response.");
  // Treat extracted text strictly as data: trim and cap every field.
  const s = (v: unknown, n = 80) => (typeof v === "string" ? v.slice(0, n) : undefined);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
  return {
    invoiceNo: s(j.invoiceNo, 40), invoiceDate: s(j.invoiceDate, 10), total: num(j.total),
    lines: j.lines.slice(0, 100).map((l) => ({ text: s(l.text, 200) ?? "", name: s(l.name), batch: s(l.batch, 30), expiry: s(l.expiry, 10), qty: num(l.qty), freeQty: num(l.freeQty), rate: num(l.rate), mrp: num(l.mrp), confidence: Math.max(0, Math.min(1, num(l.confidence) ?? 0)) })),
  };
}

/** Best catalogue match by shared words; returns null below a minimal overlap. */
export function matchMedicine(name: string, catalogue: { id: string; label: string }[]) {
  const words = (x: string) => new Set(x.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 1));
  const a = words(name);
  let best: { id: string; score: number } | null = null;
  for (const c of catalogue) {
    const b = words(c.label);
    const inter = [...a].filter((w) => b.has(w)).length;
    const score = inter / Math.max(1, Math.min(a.size, b.size));
    if (!best || score > best.score) best = { id: c.id, score };
  }
  return best && best.score >= 0.5 ? best.id : null;
}

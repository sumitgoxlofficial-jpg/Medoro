import { z } from "zod";
import { endOfMonthIfMonth } from "@/domain/inventory/contracts";

const money = (msg: string) => z.union([z.string(), z.number()]).transform((v) => Math.round((parseFloat(String(v)) || 0) * 100)).refine((p) => p > 0, msg);
const int = (msg: string, min = 1) => z.union([z.string(), z.number()]).transform((v) => parseInt(String(v), 10)).refine((n) => Number.isInteger(n) && n >= min, msg);

export const grnLineSchema = z.object({
  medicineId: z.string().uuid({ message: "Match each line to a medicine in your catalogue." }),
  batchNo: z.string().trim().toUpperCase().min(1, "Batch number is required.").max(30).regex(/^[A-Z0-9/-]+$/, "Batch number: letters, digits, / and - only."),
  expiry: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, "Expiry is missing.").transform(endOfMonthIfMonth),
  qty: int("Quantity must be at least 1."),
  freeQty: int("Free quantity can’t be negative.", 0).default(0),
  rate: money("Enter the rate."), // per pack, excluding GST
  mrp: money("Enter the MRP."),
  poItemId: z.string().uuid().nullable().default(null),
});

export const grnSchema = z.object({
  supplierId: z.string().uuid({ message: "Choose the supplier." }),
  invoiceNo: z.string().trim().min(1, "Enter the supplier invoice number.").max(40),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the invoice date."),
  statedTotal: z.union([z.string(), z.number()]).transform((v) => (v === "" || v == null ? null : Math.round(parseFloat(String(v)) * 100))).nullable().default(null),
  poId: z.string().uuid().nullable().default(null),
  scanDocId: z.string().uuid().nullable().default(null),
  lines: z.array(grnLineSchema).min(1, "Add at least one line."),
});
export type GrnInput = z.input<typeof grnSchema>;

export const poSchema = z.object({
  supplierId: z.string().uuid({ message: "Choose the supplier." }),
  lines: z.array(z.object({ medicineId: z.string().uuid(), qty: int("Quantity must be at least 1."), rate: money("Enter the rate.") })).min(1, "Add at least one item."),
  source: z.enum(["manual", "intel", "ai", "seasonal"]).default("manual"),
  note: z.string().trim().max(200).default(""),
});
export type PoInput = z.input<typeof poSchema>;

/** Purchase totals: GST is added on top of the rate (supplier invoices quote rates excluding GST). */
export function grnTotals(lines: { qty: number; rate: number; gstRate: number }[]) {
  let taxable = 0, gst = 0;
  for (const l of lines) { const t = l.qty * l.rate; taxable += t; gst += Math.round((t * l.gstRate) / 100); }
  return { taxable, gst, total: taxable + gst };
}

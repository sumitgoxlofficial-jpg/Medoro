import { z } from "zod";
import { zId } from "@/lib/id";
import { endOfMonthIfMonth } from "@/domain/inventory/contracts";
import { DEFAULT_RULES, parseScheme, purchaseTotals, type PricingRules } from "./pricing";

const money = (msg: string) => z.union([z.string(), z.number()]).transform((v) => Math.round((parseFloat(String(v)) || 0) * 100)).refine((p) => p > 0, msg);
const optMoney = (msg: string) => z.union([z.string(), z.number(), z.null()]).transform((v) => (v === "" || v == null ? null : Math.round((parseFloat(String(v)) || 0) * 100))).refine((p) => p == null || p > 0, msg).default(null);
const pct = (label: string) => z.union([z.string(), z.number()]).transform((v) => (v === "" ? 0 : Math.round((parseFloat(String(v)) || 0) * 100) / 100)).refine((n) => n >= 0 && n < 100, `${label} must be from 0 to 99.99.`).default(0);
/** Pricing fields shared by PO and GRN lines: PTS, scheme ("10+2") and scheme / trade / cash discount %. */
export const pricingFields = {
  pts: optMoney("PTS must be above zero."),
  scheme: z.string().trim().max(20).refine((s) => !s || !!parseScheme(s), "Scheme looks wrong. Write it like 10+2.").default(""),
  schemePct: pct("Scheme discount %"), tradePct: pct("Trade discount %"), cashPct: pct("Cash discount %"),
};
const int = (msg: string, min = 1) => z.union([z.string(), z.number()]).transform((v) => parseInt(String(v === "" ? 0 : v), 10)).refine((n) => Number.isInteger(n) && n >= min, msg);

export const grnLineSchema = z.object({
  medicineId: zId("Match each line to a medicine in your catalogue."),
  batchNo: z.string().trim().toUpperCase().min(1, "Batch number is required.").max(30).regex(/^[A-Z0-9/-]+$/, "Batch number: letters, digits, / and - only."),
  expiry: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, "Expiry is missing.").transform(endOfMonthIfMonth),
  qty: int("Quantity must be at least 1."),
  freeQty: int("Free quantity can’t be negative.", 0).default(0),
  rate: money("Enter the rate."), // PTR per pack, excluding GST
  mrp: money("Enter the MRP."),
  poItemId: zId().nullable().default(null),
  /** Index of the OCR-extracted line this came from, and whether the user checked it against the invoice. */
  ocrIndex: z.number().int().min(0).max(999).nullable().default(null),
  verified: z.boolean().default(false),
  ...pricingFields,
  /** From a digital bill: the supplier's item code and name, remembered against the chosen medicine once posted. */
  supplierCode: z.string().trim().max(40).default(""),
  sourceName: z.string().trim().max(120).default(""),
});

/** OCR lines below this confidence must be verified by a person before the invoice can be approved. */
export const LOW_CONFIDENCE = 0.8;

export const grnSchema = z.object({
  supplierId: zId("Choose the supplier."),
  invoiceNo: z.string().trim().min(1, "Enter the supplier invoice number.").max(40),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the invoice date."),
  statedTotal: z.union([z.string(), z.number()]).transform((v) => (v === "" || v == null ? null : Math.round(parseFloat(String(v)) * 100))).refine((v) => v == null || (Number.isFinite(v) && v > 0), "Enter the total printed on the invoice as an amount.").nullable().default(null),
  poId: zId().nullable().default(null),
  scanDocId: zId().nullable().default(null),
  lines: z.array(grnLineSchema).min(1, "Add at least one line."),
});
export type GrnInput = z.input<typeof grnSchema>;

export const poSchema = z.object({
  supplierId: zId("Choose the supplier."),
  lines: z.array(z.object({
    medicineId: zId(), qty: int("Quantity must be at least 1."), rate: money("Enter the rate."),
    freeQty: int("Free quantity can’t be negative.", 0).default(0), mrp: optMoney("MRP must be above zero."), ...pricingFields,
  })).min(1, "Add at least one item."),
  source: z.enum(["manual", "intel", "ai", "seasonal"]).default("manual"),
  note: z.string().trim().max(200).default(""),
});
export type PoInput = z.input<typeof poSchema>;

/**
 * Purchase totals: GST is added on top of the rate (supplier invoices quote PTR excluding GST), after the line's
 * scheme, trade and cash discounts. `taxable` is the value GST was computed on; `net` is the purchase value.
 */
export function grnTotals(lines: { qty: number; rate: number; gstRate: number; freeQty?: number; schemePct?: number; tradePct?: number; cashPct?: number }[], rules: PricingRules = DEFAULT_RULES) {
  const t = purchaseTotals(lines, rules);
  return { taxable: t.taxable, net: t.net, disc: t.disc, gst: t.gst, total: t.total, lines: t.lines };
}

import { z } from "zod";

export const FORMS = ["Tablet", "Capsule", "Syrup", "Suspension", "Injection", "Gel", "Cream", "Ointment", "Drops", "Sachet", "Powder", "Inhaler", "Device", "Other"] as const;
export const GST_RATES = [0, 5, 12, 18, 28] as const;
/** Drug schedules: H, H1 and X (Drugs and Cosmetics Rules), G, and NDPS (narcotic and psychotropic substances). */
export const SCHEDULES = ["", "H", "H1", "X", "G", "NDPS"] as const;

const rupees = (msg: string) => z.union([z.string(), z.number()]).transform((v) => Math.round(parseFloat(String(v)) * 100)).refine((p) => Number.isFinite(p) && p > 0, msg);

export const medicineSchema = z.object({
  name: z.string().trim().min(2, "Brand name is required.").max(120),
  generic: z.string().trim().min(2, "Generic / salt is required.").max(200),
  strength: z.string().trim().min(1, "Strength is required.").max(60),
  form: z.enum(FORMS),
  manufacturer: z.string().trim().min(2, "Manufacturer is required.").max(120),
  pack: z.string().trim().max(60).default(""),
  mrp: rupees("Enter a valid MRP."),
  gstRate: z.coerce.number().refine((g) => (GST_RATES as readonly number[]).includes(g), "Choose a GST rate."),
  schedule: z.enum(SCHEDULES).default(""),
  reorderLevel: z.coerce.number().int().min(0).max(100000).default(10),
  barcode: z.string().trim().max(32).regex(/^[0-9A-Za-z-]*$/, "Barcode: digits and letters only.").default(""),
  hsn: z.string().trim().regex(/^\d{4,8}$/, "HSN is 4–8 digits.").default("3004"),
  rack: z.string().trim().max(20).default(""),
});
export type MedicineInput = z.input<typeof medicineSchema>;

export const receiveSchema = z.object({
  medicineId: z.string().uuid(),
  batchNo: z.string().trim().toUpperCase().min(1, "Batch number is required.").max(30).regex(/^[A-Z0-9/-]+$/, "Batch number: letters, digits, / and - only."),
  // Packs print expiry as MM/YYYY, meaning the end of that month.
  expiry: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, "Enter the expiry month.").transform(endOfMonthIfMonth),
  qty: z.coerce.number().int("Quantity must be a whole number.").min(1, "Quantity must be at least 1.").max(1_000_000),
  cost: rupees("Enter purchase cost per pack."),
  mrp: rupees("Enter MRP per pack."),
  supplierId: z.string().uuid().nullable().default(null),
  invoiceNo: z.string().trim().max(40).default(""),
});
export type ReceiveInput = z.input<typeof receiveSchema>;

export function endOfMonthIfMonth(v: string) {
  if (v.length === 10) return v;
  const [y, m] = v.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

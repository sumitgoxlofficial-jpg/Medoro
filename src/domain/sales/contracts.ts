import { z } from "zod";
import { GST_STATES, validGstin } from "@/domain/accounting/gst";

export const PAY_MODES = ["cash", "upi", "card", "split", "credit"] as const;

export const saleSchema = z.object({
  idempotencyKey: z.string().min(16).max(64).regex(/^[A-Za-z0-9_-]+$/),
  // qty is in `unit`: whole packs, or loose units (tabs) for medicines sold loose.
  lines: z.array(z.object({ medicineId: z.string().uuid(), batchId: z.string().uuid(), qty: z.number().int().min(1).max(10000), unit: z.enum(["pack", "loose"]).optional() })).min(1, "Cart is empty.").max(200),
  customerId: z.string().uuid().nullable(),
  discountPct: z.number().min(0, "Discount can’t be negative.").max(100),
  pay: z.object({
    // "cod" is only accepted for orders billed at packing (see domain/orders).
    mode: z.enum([...PAY_MODES, "cod"]),
    cashPaise: z.number().int().min(0).optional(), // split: cash part; rest goes to UPI
    tenderedPaise: z.number().int().min(0).optional(), // cash: what the customer handed over
    ref: z.string().trim().max(60).optional(),
  }),
  prescriber: z.string().trim().max(120).optional(),
  rxNo: z.string().trim().max(60).optional(),
  // Manager approval for a discount above the cashier's cap (see approval.ts).
  approval: z.string().max(100).optional(),
  prescriberReg: z.string().trim().max(40).optional(),
  patientName: z.string().trim().max(120).optional(),
  doctorId: z.string().uuid().nullable().optional(),
  // Loyalty points the customer redeems as part payment (see loyalty.ts).
  redeemPoints: z.number().int().min(0).max(10_000_000).optional(),
});
export type SaleInput = z.infer<typeof saleSchema>;

export const customerSchema = z.object({
  name: z.string().trim().min(2, "Enter the customer’s name.").max(120),
  phone: z.string().transform((s) => s.replace(/\D/g, "").replace(/^(91|0)(?=[6-9]\d{9}$)/, "")).refine((p) => p === "" || /^[6-9]\d{9}$/.test(p), "Enter a valid 10-digit mobile number."),
  waOptIn: z.boolean().default(false),
  smsOptIn: z.boolean().default(false),
  creditLimit: z.union([z.string(), z.number()]).transform((v) => Math.round((parseFloat(String(v || 0)) || 0) * 100)).refine((p) => p >= 0, "Credit limit can’t be negative.").default(0),
  gstin: z.string().trim().toUpperCase().refine((g) => !g || validGstin(g), "This GSTIN isn’t valid. Check all 15 characters.").default(""),
  stateCode: z.string().trim().refine((c) => !c || GST_STATES.some(([k]) => k === c), "Choose the state.").default(""),
  address: z.string().trim().max(200).default(""),
  pincode: z.string().trim().refine((p) => !p || /^[1-9]\d{5}$/.test(p), "Enter a 6-digit PIN code.").default(""),
}).refine((c) => !c.gstin || !c.stateCode || c.gstin.slice(0, 2) === c.stateCode, { message: "The state doesn’t match the GSTIN (its first two digits are the state code).", path: ["stateCode"] });
export type CustomerInput = z.input<typeof customerSchema>;

export const REFUND_MODES = ["Cash", "UPI refund", "Adjust customer credit"] as const;
export const returnSchema = z.object({
  saleId: z.string().uuid(),
  lines: z.array(z.object({ itemId: z.string().uuid(), qty: z.number().int().min(0) })),
  condition: z.enum(["sealed", "damaged"]),
  refundMode: z.enum(REFUND_MODES),
  reason: z.string().trim().min(3, "Enter the reason for the return.").max(200),
});
export type ReturnInput = z.infer<typeof returnSchema>;

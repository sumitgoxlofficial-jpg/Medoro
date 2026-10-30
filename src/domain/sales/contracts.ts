import { z } from "zod";

export const PAY_MODES = ["cash", "upi", "card", "split", "credit"] as const;

export const saleSchema = z.object({
  idempotencyKey: z.string().min(16).max(64).regex(/^[A-Za-z0-9_-]+$/),
  lines: z.array(z.object({ medicineId: z.string().uuid(), batchId: z.string().uuid(), qty: z.number().int().min(1).max(10000) })).min(1, "Cart is empty.").max(200),
  customerId: z.string().uuid().nullable(),
  discountPct: z.number().min(0, "Discount can’t be negative.").max(100),
  pay: z.object({
    mode: z.enum(PAY_MODES),
    cashPaise: z.number().int().min(0).optional(), // split: cash part; rest goes to UPI
    tenderedPaise: z.number().int().min(0).optional(), // cash: what the customer handed over
    ref: z.string().trim().max(60).optional(),
  }),
  prescriber: z.string().trim().max(120).optional(),
  rxNo: z.string().trim().max(60).optional(),
  // Manager approval for a discount above the cashier's cap (see approval.ts).
  approval: z.string().max(100).optional(),
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
});
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

import { z } from "zod";
import { GSTIN_RE } from "@/domain/identity/contracts";

const paise = (msg: string) => z.union([z.string(), z.number()]).transform((v) => Math.round((parseFloat(String(v === "" ? 0 : v)) || 0) * 100)).refine((p) => p >= 0, msg);

export const supplierSchema = z.object({
  name: z.string().trim().min(2, "Supplier name is required.").max(120),
  gstin: z.string().trim().toUpperCase().refine((g) => !g || GSTIN_RE.test(g), "GSTIN format looks wrong.").default(""),
  phone: z.string().trim().max(20).default(""),
  creditDays: z.union([z.string(), z.number()]).pipe(z.coerce.number<string | number>().int().min(0).max(365)).default(30),
  leadDays: z.union([z.string(), z.number()]).pipe(z.coerce.number<string | number>().min(0).max(60)).default(1),
  acceptsReturns: z.boolean().default(true),
  opening: paise("Opening balance can’t be negative.").default(0),
});
export type SupplierInput = z.input<typeof supplierSchema>;

export const PAY_METHODS = ["Cash", "UPI", "Bank transfer (NEFT)", "Cheque"] as const;

export const paymentSchema = z.object({
  partyId: z.string().uuid(),
  amount: paise("Enter an amount.").refine((p) => p > 0, "Enter an amount."),
  method: z.enum(PAY_METHODS),
  ref: z.string().trim().max(60).default(""),
});
export type PaymentInput = z.input<typeof paymentSchema>;

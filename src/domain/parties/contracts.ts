import { z } from "zod";
import { GSTIN_RE } from "@/domain/identity/contracts";
import { GST_STATES } from "@/domain/accounting/gst";

const paise = (msg: string) => z.union([z.string(), z.number()]).transform((v) => Math.round((parseFloat(String(v === "" ? 0 : v)) || 0) * 100)).refine((p) => p >= 0, msg);

export const supplierSchema = z.object({
  name: z.string().trim().min(2, "Supplier name is required.").max(120),
  gstin: z.string().trim().toUpperCase().refine((g) => !g || GSTIN_RE.test(g), "GSTIN format looks wrong.").default(""),
  phone: z.string().trim().max(20).default(""),
  creditDays: z.union([z.string(), z.number()]).pipe(z.coerce.number<string | number>().int().min(0).max(365)).default(30),
  leadDays: z.union([z.string(), z.number()]).pipe(z.coerce.number<string | number>().min(0).max(60)).default(1),
  acceptsReturns: z.boolean().default(true),
  stateCode: z.string().trim().refine((c) => !c || GST_STATES.some(([k]) => k === c), "Choose the supplier’s state.").default(""),
  returnWindowDays: z.union([z.string(), z.number()]).pipe(z.coerce.number<string | number>().int().min(0).max(365)).default(90),
  opening: paise("Opening balance can’t be negative.").default(0),
}).refine((s) => !s.gstin || !s.stateCode || s.gstin.slice(0, 2) === s.stateCode, { message: "The state doesn’t match the GSTIN (its first two digits are the state code).", path: ["stateCode"] });
export type SupplierInput = z.input<typeof supplierSchema>;

export const PAY_METHODS = ["Cash", "UPI", "Bank transfer (NEFT)", "Cheque"] as const;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const paymentSchema = z.object({
  partyId: z.string().uuid(),
  amount: paise("Enter an amount.").refine((p) => p > 0, "Enter an amount."),
  method: z.enum(PAY_METHODS),
  ref: z.string().trim().max(60).default(""),
  chequeNo: z.string().trim().max(12).default(""),
  bank: z.string().trim().max(60).default(""),
  chequeDate: z.string().trim().default(""),
}).superRefine((p, c) => {
  if (p.method !== "Cheque") return;
  if (!/^\d{6}$/.test(p.chequeNo)) c.addIssue({ code: "custom", path: ["chequeNo"], message: "Cheque number is the 6 digits printed on the cheque." });
  if (p.bank.length < 2) c.addIssue({ code: "custom", path: ["bank"], message: "Enter the bank the cheque is drawn on." });
  if (!ISO.test(p.chequeDate)) c.addIssue({ code: "custom", path: ["chequeDate"], message: "Enter the date written on the cheque." });
});
export type PaymentInput = z.input<typeof paymentSchema>;

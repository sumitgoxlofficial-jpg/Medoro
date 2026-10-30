import { z } from "zod";
import { DEPLOYMENTS } from "./deployment";

export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const MOBILE_RE = /^[6-9]\d{9}$/;
export const normPhone = (s: string) => s.replace(/\D/g, "").replace(/^(91|0)(?=[6-9]\d{9}$)/, "");
const EASY_PINS = ["1234", "4321", "0000", "1212", "2580", "1122"];

export const pinSchema = z.string().regex(/^\d{4}$/, "PIN must be 4 digits.")
  .refine((p) => !/^(\d)\1{3}$/.test(p) && !EASY_PINS.includes(p), "That PIN is too easy to guess. Choose another.");

// Passwords of 10+ characters that top public breach lists; checked offline.
const BREACHED = new Set([
  "1234567890", "0987654321", "1111111111", "0000000000", "123456789a", "a123456789", "1q2w3e4r5t", "1qaz2wsx3edc", "qwertyuiop", "qwerty1234",
  "qwerty12345", "qwerty123456", "password12", "password123", "password1234", "passw0rd123", "iloveyou12", "iloveyou123", "abcdefghij", "abcd123456",
  "abc1234567", "1234567890a", "12345678910", "123456789012", "1234qwerty", "123qweasdzxc", "zaq12wsxcde", "asdfghjkl1", "asdfghjkl123", "zxcvbnm123",
  "welcome123", "welcome@123", "admin12345", "admin@1234", "india12345", "india@1234", "pharmacy123", "medoro1234", "changeme123", "letmein123",
]);
const weakPassword = (p: string) => {
  const s = p.toLowerCase();
  return BREACHED.has(s) || /^(.)\1+$/.test(s) || "01234567890123456789".includes(s) || "98765432109876543210".includes(s) || /^(password|passw0rd|qwerty|admin|welcome|india|medoro|pharmacy)[\d@#!._-]*$/.test(s);
};

export const passwordSchema = z.string().min(10, "Password must be at least 10 characters.").max(200)
  .refine((p) => !weakPassword(p), "That password appears in public breach lists. Choose another.");

export const pharmacySchema = z.object({
  name: z.string().trim().min(2, "Pharmacy name is required."),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{3,8}(-[A-Z0-9]{2,8})?$/, "Pharmacy code: letters and numbers, like SANJ-PUNE."),
  gstin: z.string().trim().toUpperCase().refine((g) => !g || GSTIN_RE.test(g), "GSTIN format looks wrong (e.g. 27AAKFS3192P1Z6).").optional().default(""),
  dl: z.string().trim().min(3, "Drug licence number is required."),
  pharmacist: z.string().trim().optional().default(""),
  address: z.string().trim().optional().default(""),
  lang: z.enum(["en", "hi", "hinglish"]).default("en"),
});

export const ownerSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name."),
  email: z.string().trim().toLowerCase().email("Enter a valid email."),
  phone: z.string().transform(normPhone).refine((p) => MOBILE_RE.test(p), "Enter a valid 10-digit Indian mobile number."),
  password: passwordSchema,
});

export const ROLE_OPTIONS = ["Manager", "Pharmacist", "Cashier", "Accountant", "Delivery"] as const;

export const setupSchema = z.object({
  pharmacy: pharmacySchema,
  owner: ownerSchema,
  deployment: z.enum(DEPLOYMENTS),
  branches: z.array(z.object({ name: z.string().trim().min(2, "Branch name is required."), counters: z.number().int().min(1).max(20) })).min(1, "Add at least one branch."),
  invites: z.array(z.object({ contact: z.string().trim().min(3), role: z.enum(ROLE_OPTIONS), branch: z.string().optional() })).max(50),
  backupKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Download the recovery kit first."),
  kitAck: z.literal(true, { error: "Confirm you stored the recovery kit offline." }),
});
export type SetupInput = z.input<typeof setupSchema>;

export const inviteContact = (c: string) => {
  const p = normPhone(c);
  if (MOBILE_RE.test(p)) return { phone: p, email: null };
  if (/^\S+@\S+\.\S+$/.test(c)) return { phone: null, email: c.toLowerCase() };
  return null;
};

import { z } from "zod";
import { zId } from "@/lib/id";
import { MOBILE_RE, normPhone } from "@/domain/identity/contracts";

export const ORDER_SOURCES = ["phone", "whatsapp", "walk_in"] as const;
export const ORDER_PAY = ["cod", "prepaid", "credit"] as const;
export type OrderPay = (typeof ORDER_PAY)[number];
export type OrderStatus = "new" | "confirmed" | "packed" | "out_for_delivery" | "delivered" | "cancelled" | "returned";

export const STATUS_LABEL: Record<OrderStatus, string> = {
  new: "New", confirmed: "Confirmed", packed: "Packed & billed", out_for_delivery: "Out for delivery",
  delivered: "Delivered", cancelled: "Cancelled", returned: "Returned",
};
export const SOURCE_LABEL: Record<(typeof ORDER_SOURCES)[number], string> = { phone: "Phone", whatsapp: "WhatsApp", walk_in: "Walk-in" };
export const PAY_LABEL: Record<OrderPay, string> = { cod: "Cash on delivery", prepaid: "Prepaid (UPI)", credit: "Customer credit" };

/** Allowed moves. Packing bills the order; cancelling a packed order or returning one reverses that bill. */
export const NEXT: Record<OrderStatus, OrderStatus[]> = {
  new: ["confirmed", "cancelled"],
  confirmed: ["packed", "cancelled"],
  packed: ["out_for_delivery", "cancelled"],
  out_for_delivery: ["delivered", "returned"],
  delivered: [],
  cancelled: [],
  returned: [],
};
export const canMove = (from: OrderStatus, to: OrderStatus) => NEXT[from].includes(to);
export const isOpen = (s: OrderStatus) => NEXT[s].length > 0;

/** The POS payment mode a packed order is billed with. */
export const saleModeFor = (p: OrderPay): "cod" | "upi" | "credit" => (p === "cod" ? "cod" : p === "prepaid" ? "upi" : "credit");

const phone = z.string().transform(normPhone).refine((p) => MOBILE_RE.test(p), "Enter a valid 10-digit mobile number.");

export const orderSchema = z.object({
  source: z.enum(ORDER_SOURCES),
  customerId: zId().nullable().optional(),
  name: z.string().trim().min(2, "Enter the customer’s name.").max(120),
  phone,
  address: z.string().trim().min(8, "Enter the full delivery address.").max(500),
  slotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  slot: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(500).optional(),
  payMode: z.enum(ORDER_PAY),
  payRef: z.string().trim().max(60).optional(),
  discountPct: z.number().min(0, "Discount can’t be negative.").max(100).default(0),
  prescriber: z.string().trim().max(120).optional(),
  prescriberReg: z.string().trim().max(40).optional(),
  waConsent: z.boolean().default(false),
  items: z.array(z.object({ medicineId: zId(), qty: z.number().int().min(1, "Quantity must be at least 1.").max(1000) })).min(1, "Add at least one item.").max(100),
});
export type OrderInput = z.input<typeof orderSchema>;

export const deliverSchema = z.object({
  otp: z.string().trim().optional(),
  receivedBy: z.string().trim().max(80).optional(),
  collected: z.union([z.string(), z.number()]).transform((v) => Math.round((parseFloat(String(v || 0)) || 0) * 100)).refine((p) => p >= 0, "Amount can’t be negative.").default(0),
  collectedMode: z.enum(["cash", "upi"]).default("cash"),
});
export type DeliverInput = z.input<typeof deliverSchema>;

export const mapsLink = (address: string) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(address);

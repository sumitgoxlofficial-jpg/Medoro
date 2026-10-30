import { z } from "zod";

/** Shared between the server and the offline billing page (no server imports here). */
export const opSchema = z.object({
  id: z.string().regex(/^off_[A-Za-z0-9_-]{16,60}$/, "Bad offline bill id."),
  createdAt: z.string().datetime(),
  baseVersion: z.number().int().min(0),
  receipt: z.string().max(40),
  // Who billed it on the device; older queued bills don't carry it.
  cashierId: z.string().uuid().optional(),
  sale: z.object({
    lines: z.array(z.object({ medicineId: z.string().uuid(), batchId: z.string().uuid(), qty: z.number().int().min(1).max(10000) })).min(1).max(200),
    discountPct: z.number().min(0).max(100),
    pay: z.object({ mode: z.enum(["cash", "upi", "card"]), tenderedPaise: z.number().int().min(0).optional(), ref: z.string().trim().max(60).optional() }),
    prescriber: z.string().trim().max(120).optional(),
    rxNo: z.string().trim().max(60).optional(),
    totalPaise: z.number().int().min(0),
  }),
});
export type OfflineOpInput = z.infer<typeof opSchema>;

export type OfflineSnapshot = {
  deviceId: string; deviceName: string; takenAt: string; validDays: number;
  pharmacy: { name: string; branch: string; address: string | null; gstin: string | null; dlNo: string | null };
  cashier: string; cashierId?: string; discCap: number;
  medicines: { id: string; name: string; generic: string; strength: string; form: string; schedule: string | null; gstRate: number; barcode: string | null }[];
  batches: { id: string; medicineId: string; batchNo: string; expiry: string; mrpPaise: number; version: number; allowance: number }[];
};

export type SyncResult = { id: string; status: "posted" | "conflict"; invoiceNo?: string; message?: string };

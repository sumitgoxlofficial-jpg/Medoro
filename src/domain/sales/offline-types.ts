import { z } from "zod";
import { zId } from "@/lib/id";

/** Shared between the server and the offline billing page (no server imports here). */
export const opSchema = z.object({
  id: z.string().regex(/^off_[A-Za-z0-9_-]{16,60}$/, "Bad offline bill id."),
  createdAt: z.string().datetime(),
  baseVersion: z.number().int().min(0),
  receipt: z.string().max(40),
  // Who billed it on the device; older queued bills don't carry it.
  cashierId: zId().optional(),
  sale: z.object({
    lines: z.array(z.object({ medicineId: zId(), batchId: zId(), qty: z.number().int().min(1).max(10000), unit: z.enum(["pack", "loose"]).optional() })).min(1).max(200),
    discountPct: z.number().min(0).max(100),
    pay: z.object({ mode: z.enum(["cash", "upi", "card"]), tenderedPaise: z.number().int().min(0).optional(), ref: z.string().trim().max(60).optional() }),
    prescriber: z.string().trim().max(120).optional(),
    rxNo: z.string().trim().max(60).optional(),
    doctorId: zId().optional(),
    prescriberReg: z.string().trim().max(40).optional(),
    patientName: z.string().trim().max(120).optional(),
    totalPaise: z.number().int().min(0),
  }),
});
export type OfflineOpInput = z.infer<typeof opSchema>;

export type OfflineSnapshot = {
  deviceId: string; deviceName: string; takenAt: string; validDays: number;
  pharmacy: { name: string; branch: string; address: string | null; gstin: string | null; dlNo: string | null };
  cashier: string; cashierId?: string; discCap: number;
  medicines: { id: string; name: string; generic: string; strength: string; form: string; schedule: string | null; gstRate: number; barcode: string | null;
    composition?: string | null; rack?: string | null; packSize?: number; packUnit?: string; looseUnit?: string; allowLoose?: boolean }[];
  // allowance is in stock units (loose units for medicines sold loose).
  batches: { id: string; medicineId: string; batchNo: string; expiry: string; mrpPaise: number; version: number; allowance: number }[];
  doctors?: { id: string; name: string; regNo: string | null }[];
};

export type SyncResult = { id: string; status: "posted" | "conflict"; invoiceNo?: string; message?: string };

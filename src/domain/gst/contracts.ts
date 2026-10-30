import { z } from "zod";

export const CANCEL_REASONS = { "1": "Duplicate", "2": "Data entry mistake", "3": "Order cancelled", "4": "Other" } as const;
export const TRANSPORT_MODES = { "1": "Road", "2": "Rail", "3": "Air", "4": "Ship" } as const;

export const VEHICLE_RE = /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$|^TM[A-Z0-9]{6}$|^DF[A-Z0-9]{6}$|^TR[A-Z0-9]{6,13}$|^BP[A-Z0-9]{6}$|^NP[A-Z0-9]{6}$/;

export const transportSchema = z.object({
  distanceKm: z.union([z.string(), z.number()]).pipe(z.coerce.number<string | number>().int("Distance is whole kilometres.").min(0).max(4000)),
  mode: z.enum(["1", "2", "3", "4"]),
  vehicleNo: z.string().trim().toUpperCase().transform((v) => v.replace(/[^A-Z0-9]/g, "")).refine((v) => !v || VEHICLE_RE.test(v), "Vehicle number looks wrong (e.g. MH12AB1234).").default(""),
  transporterId: z.string().trim().toUpperCase().refine((v) => !v || /^[0-9A-Z]{15}$/.test(v), "Transporter ID is 15 characters.").default(""),
  transporterName: z.string().trim().max(100).default(""),
  transDocNo: z.string().trim().max(15).default(""),
  transDocDate: z.string().trim().refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), "Pick the transport document date.").default(""),
}).refine((t) => t.mode !== "1" || t.vehicleNo || t.transporterId, { message: "Enter the vehicle number or the transporter ID.", path: ["vehicleNo"] });
export type TransportInput = z.input<typeof transportSchema>;

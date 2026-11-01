/**
 * E-invoices for B2B bills on the counter (Drive mode, phase 6). The counter builds the invoice from its own bill,
 * Medoro's gateway passes it to the GST portal (IRP) and returns the IRN and signed QR, keeping nothing, and the
 * counter stores them here. Same rules and figures as Medoro's server e-invoicing (src/domain/gst/service.ts).
 */
import type { DriveDB } from "./client";
import { CounterError } from "./pharmacy";
import type { Pharmacy } from "./seed";
import type { EinvDoc } from "@/domain/gst/einvoice";
import { allocateHalves } from "@/domain/gst/tax";
import { uqcFor, uqcForLoose } from "@/domain/gst/common";
import { GST_DOC_RE } from "@/lib/docno";
import { taxableFromInclusive } from "@/lib/money";
import { istDate } from "@/lib/dates";

export type IrnReply = { irn: string; ackNo: string; ackDt: string; signedQr: string };
export type EinvoiceState = { irn: string; ackNo: string | null; ackDt: string | null; signedQr: string | null; cancelled: boolean } | null;

/** "Shop 4, MG Road, Pune 411001" → address, place and PIN (as on the server). */
export function splitAddress(address: string | null | undefined, fallbackPlace: string) {
  const a = (address ?? "").trim(), pin = /\b([1-9]\d{5})\b/.exec(a)?.[1];
  const parts = a.replace(/\b[1-9]\d{5}\b/, "").split(/[,\n]/).map((x) => x.trim().replace(/[-–]+$/, "").trim()).filter(Boolean);
  const place = [...parts].reverse().find((x) => /[A-Za-z]{3,}/.test(x) && !/\d/.test(x)) ?? fallbackPlace;
  return { address: a || fallbackPlace, place: place.length >= 3 ? place : fallbackPlace, pin: pin ? Number(pin) : null };
}

const n = (v: unknown) => Number(v ?? 0);

/** The bill's e-invoice: its IRN (or that it was cancelled). */
export function einvoiceOf(db: DriveDB, saleId: string): EinvoiceState {
  const rows = db.engine.all<{ kind: string; irn: string; ackNo: string | null; ackDt: string | null; signedQr: string | null }>("SELECT kind, irn, ackNo, ackDt, signedQr FROM einvoice WHERE saleId = ? ORDER BY at, rowid", [saleId]);
  const last = rows.at(-1);
  if (!last) return null;
  const irn = rows.filter((r) => r.kind === "irn").at(-1)!;
  return { irn: irn.irn, ackNo: irn.ackNo, ackDt: irn.ackDt, signedQr: last.kind === "irn" ? irn.signedQr : null, cancelled: last.kind === "cancel" };
}

/**
 * The bill as an e-invoice for the IRP. Refuses bills that can't have one: no buyer GSTIN, no billing address or
 * PIN, an invoice number over 16 characters, or one that already has (or had) an IRN.
 */
export function einvoiceDoc(db: DriveDB, saleId: string, pharmacy: Pharmacy | null): EinvDoc {
  const s = db.engine.all<Record<string, string | number | null>>(
    "SELECT s.*, c.name AS cName, c.gstin AS cGstin, c.address AS cAddress, c.pincode AS cPin, c.phone AS cPhone FROM sale s LEFT JOIN customer c ON c.id = s.customerId WHERE s.id = ?", [saleId])[0];
  if (!s) throw new CounterError("Bill not found.");
  const gstin = String(s.cGstin ?? "").toUpperCase();
  if (!gstin) throw new CounterError("E-invoices are for B2B bills: this bill’s customer has no GSTIN.");
  if (!GST_DOC_RE.test(String(s.invoiceNo))) throw new CounterError(`Invoice number ${s.invoiceNo} is longer than the GST portal allows.`);
  if (einvoiceOf(db, saleId)) throw new CounterError("This bill already has an e-invoice.");
  if (!pharmacy?.gstin) throw new CounterError("Add the pharmacy’s GSTIN on Medoro first, then copy the settings to this counter again.");
  const seller = splitAddress(pharmacy.address, pharmacy.tradeName || pharmacy.name);
  if (!seller.pin) throw new CounterError("Add the 6-digit PIN code to the pharmacy’s address on Medoro.");
  const buyer = splitAddress(String(s.cAddress ?? ""), String(s.cName ?? ""));
  const pin = s.cPin ? Number(s.cPin) : buyer.pin;
  if (!s.cAddress || !pin) throw new CounterError(`Add ${s.cName}’s billing address and PIN code first.`);
  const items = db.engine.all<{ medicineId: string; batchNo: string | null; expiryDate: string | null; qty: number; loose: number; mrpPaise: number; discountPaise: number; taxablePaise: number; gstRate: number; name: string; strength: string | null; hsn: string | null; form: string | null; looseUnit: string | null }>(
    `SELECT i.medicineId, b.batchNo, b.expiryDate, i.qty, i.loose, i.mrpPaise, i.discountPaise, i.taxablePaise, i.gstRate, m.name, m.strength, m.hsn, m.form, m.looseUnit
       FROM saleItem i JOIN medicine m ON m.id = i.medicineId LEFT JOIN batch b ON b.id = i.batchId WHERE i.saleId = ? ORDER BY i.rowid`, [saleId]);
  const inter = n(s.igstPaise) > 0;
  const taxes = items.map((i) => n(i.mrpPaise) * i.qty - n(i.discountPaise) - n(i.taxablePaise));
  const halves = inter ? [] : allocateHalves(taxes, n(s.cgstPaise));
  const buyerState = gstin.slice(0, 2);
  return {
    type: "INV", no: String(s.invoiceNo), date: istDate(new Date(String(s.at))), roundOff: n(s.roundOffPaise),
    seller: { gstin: pharmacy.gstin, legalName: pharmacy.name, tradeName: pharmacy.tradeName, address: seller.address, place: seller.place, pin: seller.pin, stateCode: pharmacy.gstin.slice(0, 2), phone: pharmacy.phone || null },
    buyer: { gstin, legalName: String(s.cName), address: buyer.address, place: buyer.place, pin, stateCode: buyerState, phone: (s.cPhone as string | null) ?? null, pos: String(s.placeOfSupply ?? (inter ? buyerState : pharmacy.gstin.slice(0, 2))) },
    items: items.map((i, k) => ({
      name: `${i.name} ${i.strength ?? ""}`.trim(), hsn: (i.hsn || "3004").replace(/\D/g, ""), qty: i.qty, unit: i.loose ? uqcForLoose(i.form ?? "", i.looseUnit ?? "") : uqcFor(i.form ?? ""),
      batch: i.batchNo ?? undefined, expiry: i.expiryDate ?? undefined, rate: i.gstRate,
      gross: taxableFromInclusive(n(i.mrpPaise) * i.qty, i.gstRate), taxable: n(i.taxablePaise), igst: inter ? taxes[k] : 0, cgst: inter ? 0 : halves[k], sgst: inter ? 0 : taxes[k] - halves[k],
    })),
  };
}

export function recordIrn(db: DriveDB, saleId: string, r: IrnReply, userId: string) {
  if (einvoiceOf(db, saleId)) throw new CounterError("This bill already has an e-invoice.");
  db.from("einvoice").insert({ saleId, kind: "irn", irn: r.irn, ackNo: r.ackNo, ackDt: r.ackDt, signedQr: r.signedQr, reason: null, userId, at: new Date().toISOString() });
  return einvoiceOf(db, saleId);
}

export function recordIrnCancel(db: DriveDB, saleId: string, reason: string, userId: string) {
  const e = einvoiceOf(db, saleId);
  if (!e || e.cancelled) throw new CounterError("This bill has no active e-invoice.");
  db.from("einvoice").insert({ saleId, kind: "cancel", irn: e.irn, ackNo: null, ackDt: null, signedQr: null, reason: reason.slice(0, 120), userId, at: new Date().toISOString() });
  return einvoiceOf(db, saleId);
}

/** Saves a B2B buyer's billing address and PIN (needed on an e-invoice). */
export function setBillingAddress(db: DriveDB, customerId: string, address: string, pincode: string) {
  const pin = pincode.replace(/\D/g, "");
  if (!/^[1-9]\d{5}$/.test(pin)) throw new CounterError("Enter the 6-digit PIN code.");
  if (address.trim().length < 5) throw new CounterError("Enter the billing address.");
  db.from("customer").eq("id", customerId).update({ address: address.trim().slice(0, 200), pincode: pin });
}

/** NIC acknowledgement time "2026-10-31 12:30:00" is IST. */
const ackTime = (s: string) => Date.parse(s.replace(" ", "T") + "+05:30");

/** An IRN can be cancelled within 24 hours, and only once the whole bill is returned (so the books match). */
export function cancelCheck(db: DriveDB, saleId: string, now = Date.now()) {
  const e = einvoiceOf(db, saleId);
  if (!e || e.cancelled) throw new CounterError("This bill has no active e-invoice.");
  if (!e.ackDt || now - ackTime(e.ackDt) > 24 * 3600_000) throw new CounterError("An e-invoice can only be cancelled within 24 hours. Issue a credit note instead.");
  const open = db.engine.all<{ left: number }>(
    "SELECT i.qty - COALESCE((SELECT SUM(r.qty) FROM salesReturnItem r WHERE r.saleItemId = i.id), 0) AS left FROM saleItem i WHERE i.saleId = ?", [saleId]).some((r) => n(r.left) > 0);
  if (open) throw new CounterError("Return the whole bill first (Bills & day-end → Return), so the books show it as cancelled too.");
  return e.irn;
}

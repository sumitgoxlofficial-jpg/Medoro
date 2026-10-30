import type { EinvDoc, EinvParty } from "../einvoice";
import type { TallyVoucher } from "../tally";

export const SELLER_PARTY: EinvParty = { gstin: "27AAPFU0939F1ZV", legalName: "Sanjeevani Medical LLP", tradeName: "Sanjeevani Medical", address: "Shop 4, FC Road, Shivajinagar, Pune 411005", place: "Pune", pin: 411005, stateCode: "27", phone: "+91 98220 41736" };

export const IRN_DOC: EinvDoc = {
  type: "INV", no: "SM/MA/000123", date: "2026-10-31", roundOff: 40, seller: SELLER_PARTY,
  buyer: { gstin: "29AAGCB7383J1Z4", legalName: "City Care Hospital", address: "12 Residency Road", place: "Bengaluru", pin: 560025, stateCode: "29", pos: "29", phone: "9845012345" },
  // Two strips of Telma 40 at MRP ₹232 less 10%: 464 → 417.60 incl. 12% GST → taxable 372.86, IGST 44.74.
  items: [
    { name: "Telma 40 40 mg", hsn: "3004", qty: 2, unit: "PAC", batch: "TL1", expiry: "2027-12-31", rate: 12, gross: 41429, taxable: 37286, igst: 4474, cgst: 0, sgst: 0 },
    { name: "Crocin 650", hsn: "30049099", qty: 1, unit: "PAC", rate: 5, gross: 3048, taxable: 3048, igst: 152, cgst: 0, sgst: 0 },
  ],
};

export const TALLY_VOUCHERS: TallyVoucher[] = [
  { no: "SV-2627-0001", date: "2026-10-03", type: "sales", narration: "Sale A/01 · City Care", lines: [
    { account: "Sundry debtors", dr: 133000, cr: 0, partyLedger: "City Care Hospital" }, { account: "Sales", dr: 0, cr: 120000 },
    { account: "Output CGST", dr: 0, cr: 6500 }, { account: "Output SGST", dr: 0, cr: 6500 }] },
  { no: "SV-2627-0002", date: "2026-10-05", type: "sales", narration: "Sale A/02 & <walk-in>", lines: [
    { account: "Cash in hand", dr: 46400, cr: 0 }, { account: "Sales", dr: 0, cr: 41429 }, { account: "Output IGST", dr: 0, cr: 4971 }] },
  { no: "PU-2627-0001", date: "2026-10-06", type: "purchase", narration: "Sai Healthcare · Inv SHD/1", lines: [
    { account: "Purchases", dr: 150000, cr: 0 }, { account: "Input CGST", dr: 9000, cr: 0 }, { account: "Input SGST", dr: 9000, cr: 0 },
    { account: "Round off", dr: 0, cr: 0 }, { account: "Sundry creditors", dr: 0, cr: 168000, partyLedger: "Sai Healthcare" }] },
  { no: "RV-2627-0001", date: "2026-10-07", type: "receipt", narration: "Receipt from City Care", lines: [
    { account: "Bank account", dr: 100000, cr: 0 }, { account: "Sundry debtors", dr: 0, cr: 100000, partyLedger: "City Care Hospital" }] },
  { no: "PV-2627-0001", date: "2026-10-08", type: "payment", narration: "Electricity · Oct bill · Cash", lines: [
    { account: "Electricity", dr: 12000, cr: 0 }, { account: "Cash in hand", dr: 0, cr: 12000 }] },
  { no: "CN-2627-0001", date: "2026-10-09", type: "credit_note", narration: "CN-2627-0001 · return against A/01", lines: [
    { account: "Sales returns", dr: 10000, cr: 0 }, { account: "Output CGST", dr: 600, cr: 0 }, { account: "Output SGST", dr: 600, cr: 0 },
    { account: "Sundry debtors", dr: 0, cr: 11200, partyLedger: "City Care Hospital" }] },
  { no: "DN-2627-0001", date: "2026-10-10", type: "debit_note", narration: "DN-2627-0001 · return to Sai Healthcare", lines: [
    { account: "Sundry creditors", dr: 16800, cr: 0, partyLedger: "Sai Healthcare" }, { account: "Purchases", dr: 0, cr: 15000 },
    { account: "Input CGST", dr: 0, cr: 900 }, { account: "Input SGST", dr: 0, cr: 900 }] },
  { no: "JV-2627-0001", date: "2026-10-11", type: "journal", narration: "Cash short at shift close", lines: [
    { account: "Cash short/excess", dr: 150, cr: 0 }, { account: "Cash in hand", dr: 0, cr: 150 }] },
];

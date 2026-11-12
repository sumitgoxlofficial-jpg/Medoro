import { FORMS, SCHEDULES } from "@/domain/inventory/contracts";
import { headerKey, type Table } from "./parse";

/** Safe to load on the counter: no server code here. A problem with the file itself, in words for the person uploading it. */
export class SheetError extends Error {}
export const MAX_ROWS = 5000;
export const IMPORT_KINDS = ["medicines", "suppliers", "customers"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

/** Template columns and the header spellings we accept for each. */
const COLS: Record<ImportKind, { key: string; label: string; required?: boolean; aliases: string[] }[]> = {
  medicines: [
    { key: "name", label: "Brand name", required: true, aliases: ["name", "brand", "brandname", "medicine", "medicinename", "product", "productname", "item", "itemname", "itemdescription", "description", "particulars", "itemdesc", "productdescription"] },
    { key: "generic", label: "Generic / salt", aliases: ["generic", "salt", "genericname", "molecule"] },
    { key: "strength", label: "Strength", aliases: ["strength", "dose", "potency"] },
    { key: "composition", label: "Composition", aliases: ["composition", "saltcomposition", "salts", "contents", "content"] },
    { key: "form", label: "Form", required: true, aliases: ["form", "dosageform", "type"] },
    { key: "manufacturer", label: "Manufacturer", required: true, aliases: ["manufacturer", "company", "mfr", "mfg", "brandowner", "mfrname", "manufacturername", "companyname", "mkt", "marketedby", "mfgname"] },
    { key: "pack", label: "Pack", aliases: ["pack", "packsize", "packing"] },
    { key: "packSize", label: "Units per pack", aliases: ["unitsperpack", "unitsperstrip", "tabsperstrip", "conversion", "packqty"] },
    { key: "packUnit", label: "Pack unit", aliases: ["packunit", "packtype"] },
    { key: "looseUnit", label: "Loose unit", aliases: ["looseunit", "baseunit"] },
    { key: "allowLoose", label: "Sell loose (yes/no)", aliases: ["allowloose", "loose", "sellloose", "loosesale"] },
    { key: "mrp", label: "MRP", required: true, aliases: ["mrp", "mrpperpack", "price", "mrprate", "maxretailprice", "mrpvalue"] },
    { key: "gstRate", label: "GST %", required: true, aliases: ["gst", "gstrate", "gstpercent", "tax", "taxrate", "gstper", "gstperc", "taxper", "taxpercent", "gstp"] },
    { key: "schedule", label: "Schedule", aliases: ["schedule", "drugschedule", "sch", "scheduletype", "drugcategory"] },
    { key: "hsn", label: "HSN", aliases: ["hsn", "hsncode"] },
    { key: "barcode", label: "Barcode", aliases: ["barcode", "ean", "upc"] },
    { key: "reorderLevel", label: "Reorder level", aliases: ["reorderlevel", "reorder", "minstock", "minimumstock"] },
    { key: "rack", label: "Rack", aliases: ["rack", "shelf", "location", "bin"] },
    { key: "batch", label: "Batch", aliases: ["batch", "batchno", "batchnumber", "lot", "lotno", "batchnum"] },
    { key: "expiry", label: "Expiry", aliases: ["expiry", "exp", "expirydate", "expdate", "expdt", "expirydt", "expirymonth", "expiryon", "expon"] },
    { key: "qty", label: "Opening qty", aliases: ["qty", "quantity", "stock", "openingqty", "openingstock", "closingstock", "closingqty", "balanceqty", "balqty", "currentstock", "stockqty", "qtyinhand", "onhand", "qtyonhand", "availableqty", "availablestock", "closing"] },
    { key: "cost", label: "Cost per pack (excl. GST)", aliases: ["cost", "costperpack", "purchaserate", "rate", "ptr", "purchaseprice", "purrate", "landingcost", "costprice", "purchasecost", "pcost", "netrate", "ptrrate"] },
  ],
  suppliers: [
    { key: "name", label: "Supplier name", required: true, aliases: ["name", "supplier", "suppliername", "party", "partyname", "distributor"] },
    { key: "gstin", label: "GSTIN", aliases: ["gstin", "gst", "gstno", "gstnumber"] },
    { key: "phone", label: "Phone", aliases: ["phone", "mobile", "contact", "phoneno"] },
    { key: "creditDays", label: "Credit days", aliases: ["creditdays", "credit", "terms", "paymentterms"] },
    { key: "leadDays", label: "Lead days", aliases: ["leaddays", "leadtime", "deliverydays"] },
    { key: "opening", label: "Opening balance (you owe)", aliases: ["opening", "openingbalance", "balance", "due", "payable", "outstanding"] },
  ],
  customers: [
    { key: "name", label: "Customer name", required: true, aliases: ["name", "customer", "customername", "patient", "party"] },
    { key: "phone", label: "Mobile", aliases: ["phone", "mobile", "mobileno", "contact", "whatsapp"] },
    { key: "creditLimit", label: "Credit limit", aliases: ["creditlimit", "limit"] },
    { key: "opening", label: "Opening balance (they owe)", aliases: ["opening", "openingbalance", "balance", "due", "receivable", "outstanding"] },
    { key: "waOptIn", label: "WhatsApp opt-in (yes/no)", aliases: ["waoptin", "whatsappoptin", "optin", "consent"] },
    { key: "gstin", label: "GSTIN (B2B)", aliases: ["gstin", "gst", "gstno", "gstnumber"] },
  ],
};

export const templateHeader = (kind: ImportKind) => COLS[kind].map((c) => c.label);
export const TEMPLATE_EXAMPLE: Record<ImportKind, string[]> = {
  medicines: ["Dolo 650", "Paracetamol", "650 mg", "Paracetamol 650mg", "Tablet", "Micro Labs", "15 tabs", "15", "strip", "tab", "yes", "33.60", "12", "", "3004", "8901234567890", "20", "A1", "DL24091", "11/2027", "40", "24.50"],
  suppliers: ["Mahavir Medical Agencies", "27AABCM1234F1Z5", "9822012345", "30", "2", "0"],
  customers: ["Ramesh Kulkarni", "9890112345", "2000", "0", "yes"],
};

export type Mapped = { line: number; v: Record<string, string> };

export function mapColumns(kind: ImportKind, t: Table) {
  if (t.length < 2) throw new SheetError("The file has no data rows under the header.");
  if (t.length - 1 > MAX_ROWS) throw new SheetError(`Up to ${MAX_ROWS.toLocaleString("en-IN")} rows per file. Split the file and import in parts.`);
  const head = t[0].map(headerKey);
  const idx: Record<string, number> = {};
  const columns = COLS[kind].map((c) => {
    const i = head.findIndex((h) => c.aliases.includes(h) || h === headerKey(c.label));
    if (i >= 0) idx[c.key] = i;
    return { label: c.label, found: i >= 0 ? t[0][i] : null, required: !!c.required };
  });
  const has = (label: string) => columns.some((c) => c.label === label && c.found);
  // A composition column ("Paracetamol 500mg + Caffeine 25mg") can stand in for generic; strength is checked per row.
  const salt = kind === "medicines" && !has("Composition") && !has("Generic / salt") ? ["Generic / salt"] : [];
  // A plain stock sheet (name, batch, expiry, quantity, MRP, cost) from an older billing program has no form, manufacturer, GST or salt
  // columns. It still imports: those are filled in sensibly and listed in the preview so the shop can check them.
  const stockSheet = kind === "medicines" && "name" in idx && "batch" in idx && "qty" in idx;
  const FILLABLE = ["Form", "Manufacturer", "GST %"];
  const missing = [...columns.filter((c) => c.required && !c.found && !(stockSheet && FILLABLE.includes(c.label))).map((c) => c.label), ...(stockSheet ? [] : salt)];
  if (missing.length) throw new SheetError(`Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Download the template to see the expected headers.`);
  const rows: Mapped[] = t.slice(1).map((r, i) => ({ line: i + 2, v: Object.fromEntries(Object.entries(idx).map(([k, j]) => [k, (r[j] ?? "").trim()])) }));
  return { columns, rows, stockSheet };
}

export const formOf = (s: string) => FORMS.find((f) => f.toLowerCase() === s.toLowerCase().replace(/s$/, "") || f.toLowerCase() === s.toLowerCase()) ?? null;
/** A guess at the dosage form from how the pack is written on a stock list: "DOLO 650 TAB", "AZEE SYP". */
export function inferForm(name: string): (typeof FORMS)[number] {
  const n = ` ${name.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const has = (...w: string[]) => w.some((x) => n.includes(` ${x} `));
  return has("tab", "tabs", "tablet", "tablets") ? "Tablet" : has("cap", "caps", "capsule", "capsules") ? "Capsule" : has("syp", "syrup", "liq", "liquid") ? "Syrup" : has("susp", "suspension", "dry syp") ? "Suspension"
    : has("inj", "injection", "vial", "amp", "ampoule") ? "Injection" : has("gel") ? "Gel" : has("cream", "crm", "lotion") ? "Cream" : has("oint", "ointment") ? "Ointment" : has("drop", "drops", "eye", "ear", "nasal") ? "Drops"
    : has("sachet", "sac") ? "Sachet" : has("powder", "pwd") ? "Powder" : has("inhaler", "rotacap", "respules") ? "Inhaler" : "Other";
}
export const scheduleOf = (s: string) => {
  const v = s.toUpperCase().replace(/SCHEDULE|SCH\.?|\s/g, "");
  const n = /^(NDPS|NARCOTICS?|PSYCHOTROPIC|NRX)$/.test(v) ? "NDPS" : v === "OTC" || v === "NONE" ? "" : v;
  return (SCHEDULES as readonly string[]).includes(n) ? n : null;
};


export type RowResult = { line: number; label: string; action: "create" | "add stock" | "skip"; note: string; errors: string[] };
export type Preview = { kind: ImportKind; columns: { label: string; found: string | null; required: boolean }[]; rows: RowResult[]; ok: number; skip: number; bad: number };


/**
 * The pharmacy database that lives on the device (and, encrypted, in the owner's Google Drive).
 * One file holds one pharmacy, so there is no tenantId. Money is integer paise; dates are ISO text;
 * `updatedAt` holds the clock stamp of the last change (used to resolve edits from two devices).
 *
 * Migrations are append-only: never edit a released one, add the next. A test checks TABLES below
 * matches what the migrations create.
 */

export type TableKind =
  /** Rows can be edited and soft-deleted; the latest clock stamp wins per field. */
  | "mutable"
  /** Rows are only ever added (bills, stock movements): no edits, no deletes. Corrections are new rows. */
  | "append";

export type TableSpec = { kind: TableKind; columns: readonly string[] };

const MUTABLE = ["updatedAt", "deletedAt"] as const;

export const TABLES = {
  medicine: {
    kind: "mutable",
    columns: ["id", "name", "generic", "strength", "form", "manufacturer", "barcode", "hsn", "gstRate", "mrpPaise", "schedule",
      "packSize", "packUnit", "looseUnit", "allowLoose", "reorderLevel", "rack", "composition", "active", ...MUTABLE],
  },
  batch: {
    kind: "mutable",
    columns: ["id", "branchId", "medicineId", "batchNo", "expiryDate", "costPaise", "mrpPaise", "supplierId", "status", ...MUTABLE],
  },
  customer: {
    kind: "mutable",
    columns: ["id", "name", "phone", "gstin", "creditLimitPaise", "address", "pincode", ...MUTABLE],
  },
  stockMovement: {
    kind: "append",
    columns: ["id", "branchId", "batchId", "qty", "type", "refType", "refId", "userId", "at", "note"],
  },
  sale: {
    kind: "append",
    columns: ["id", "branchId", "deviceId", "invoiceNo", "customerId", "patientName", "prescriber", "prescriberReg",
      "subtotalPaise", "discountPaise", "discountPct", "taxablePaise", "cgstPaise", "sgstPaise", "roundOffPaise", "totalPaise",
      "costPaise", "payMode", "userId", "at", "igstPaise", "placeOfSupply"],
  },
  saleItem: {
    kind: "append",
    columns: ["id", "saleId", "batchId", "medicineId", "qty", "loose", "packSize", "mrpPaise", "discountPaise", "taxablePaise", "gstRate", "costPaise"],
  },
  payment: {
    kind: "append",
    columns: ["id", "saleId", "mode", "amountPaise", "ref"],
  },
  supplier: {
    kind: "mutable",
    columns: ["id", "name", "phone", "gstin", "dl", "address", ...MUTABLE],
  },
  purchase: {
    kind: "append",
    columns: ["id", "branchId", "supplierId", "billNo", "billDate", "taxablePaise", "taxPaise", "totalPaise", "userId", "at"],
  },
  purchaseItem: {
    kind: "append",
    columns: ["id", "purchaseId", "batchId", "medicineId", "packs", "freePacks", "costPaise", "mrpPaise", "gstRate", "taxablePaise", "taxPaise"],
  },
  salesReturn: {
    kind: "append",
    columns: ["id", "saleId", "branchId", "deviceId", "creditNoteNo", "reason", "condition", "refundMode", "amountPaise", "taxablePaise", "userId", "at", "pointsValuePaise"],
  },
  salesReturnItem: {
    kind: "append",
    columns: ["id", "returnId", "saleItemId", "batchId", "qty", "amountPaise", "taxablePaise", "restocked"],
  },
  customerReceipt: {
    kind: "append",
    columns: ["id", "customerId", "amountPaise", "mode", "ref", "userId", "at"],
  },
  supplierPayment: {
    kind: "append",
    columns: ["id", "supplierId", "amountPaise", "mode", "ref", "userId", "at"],
  },
  expense: {
    kind: "append",
    columns: ["id", "branchId", "category", "amountPaise", "mode", "note", "userId", "at"],
  },
  loyaltyLedger: {
    kind: "append",
    columns: ["id", "customerId", "points", "kind", "refId", "at"],
  },
  deliveryOrder: {
    kind: "mutable",
    columns: ["id", "branchId", "orderNo", "customerId", "address", "note", "payment", "status", "saleId", "rider", "createdAt", ...MUTABLE],
  },
  deliveryOrderItem: {
    kind: "append",
    columns: ["id", "orderId", "medicineId", "qty", "unit"],
  },
  einvoice: {
    kind: "append",
    columns: ["id", "saleId", "kind", "irn", "ackNo", "ackDt", "signedQr", "reason", "userId", "at"],
  },
} as const satisfies Record<string, TableSpec>;

export type TableName = keyof typeof TABLES;
export const isTable = (t: string): t is TableName => Object.prototype.hasOwnProperty.call(TABLES, t);

export const MIGRATIONS: readonly string[] = [
  // 1: catalogue, stock, customers, bills, and the local sync bookkeeping.
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  -- Per-device counters (invoice series). Never synced: each counter numbers its own bills.
  CREATE TABLE sequence (name TEXT PRIMARY KEY, next INTEGER NOT NULL);
  -- Every local write, in order. Sync uploads rows with pushed = 0 to Drive.
  CREATE TABLE changeLog (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    clock TEXT NOT NULL,
    tbl TEXT NOT NULL,
    rowId TEXT NOT NULL,
    op TEXT NOT NULL CHECK (op IN ('insert', 'update', 'delete')),
    data TEXT NOT NULL,
    pushed INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX changeLog_pending ON changeLog(pushed, seq);

  CREATE TABLE medicine (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, generic TEXT NOT NULL DEFAULT '', strength TEXT NOT NULL DEFAULT '',
    form TEXT NOT NULL DEFAULT '', manufacturer TEXT NOT NULL DEFAULT '', barcode TEXT, hsn TEXT NOT NULL DEFAULT '3004',
    gstRate INTEGER NOT NULL, mrpPaise INTEGER NOT NULL, schedule TEXT,
    packSize INTEGER NOT NULL DEFAULT 1, packUnit TEXT NOT NULL DEFAULT 'pack', looseUnit TEXT NOT NULL DEFAULT 'unit',
    allowLoose INTEGER NOT NULL DEFAULT 0, reorderLevel INTEGER NOT NULL DEFAULT 0, rack TEXT, composition TEXT,
    active INTEGER NOT NULL DEFAULT 1, updatedAt TEXT NOT NULL, deletedAt TEXT
  );
  CREATE INDEX medicine_name ON medicine(name COLLATE NOCASE);
  CREATE INDEX medicine_barcode ON medicine(barcode);

  CREATE TABLE batch (
    id TEXT PRIMARY KEY, branchId TEXT NOT NULL, medicineId TEXT NOT NULL REFERENCES medicine(id), batchNo TEXT NOT NULL,
    expiryDate TEXT NOT NULL, costPaise INTEGER NOT NULL, mrpPaise INTEGER NOT NULL, supplierId TEXT,
    status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'quarantine', 'recalled', 'expired')),
    updatedAt TEXT NOT NULL, deletedAt TEXT
  );
  CREATE INDEX batch_medicine ON batch(branchId, medicineId, expiryDate);
  CREATE UNIQUE INDEX batch_no ON batch(branchId, medicineId, batchNo);

  CREATE TABLE customer (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, gstin TEXT, creditLimitPaise INTEGER NOT NULL DEFAULT 0,
    updatedAt TEXT NOT NULL, deletedAt TEXT
  );
  CREATE INDEX customer_phone ON customer(phone);

  -- Stock is the sum of movements, never a stored number, so sales from two counters add up instead of overwriting.
  CREATE TABLE stockMovement (
    id TEXT PRIMARY KEY, branchId TEXT NOT NULL, batchId TEXT NOT NULL REFERENCES batch(id), qty INTEGER NOT NULL,
    type TEXT NOT NULL, refType TEXT NOT NULL, refId TEXT NOT NULL, userId TEXT NOT NULL, at TEXT NOT NULL, note TEXT
  );
  CREATE INDEX stockMovement_batch ON stockMovement(batchId);
  CREATE INDEX stockMovement_ref ON stockMovement(refType, refId);

  CREATE TABLE sale (
    id TEXT PRIMARY KEY, branchId TEXT NOT NULL, deviceId TEXT NOT NULL, invoiceNo TEXT NOT NULL UNIQUE, customerId TEXT,
    patientName TEXT, prescriber TEXT, prescriberReg TEXT,
    subtotalPaise INTEGER NOT NULL, discountPaise INTEGER NOT NULL, discountPct REAL NOT NULL DEFAULT 0,
    taxablePaise INTEGER NOT NULL, cgstPaise INTEGER NOT NULL, sgstPaise INTEGER NOT NULL, roundOffPaise INTEGER NOT NULL,
    totalPaise INTEGER NOT NULL, costPaise INTEGER NOT NULL DEFAULT 0,
    payMode TEXT NOT NULL CHECK (payMode IN ('cash', 'upi', 'card', 'split', 'credit')), userId TEXT NOT NULL, at TEXT NOT NULL
  );
  CREATE INDEX sale_at ON sale(branchId, at);
  CREATE INDEX sale_customer ON sale(customerId);

  CREATE TABLE saleItem (
    id TEXT PRIMARY KEY, saleId TEXT NOT NULL REFERENCES sale(id), batchId TEXT NOT NULL, medicineId TEXT NOT NULL,
    qty INTEGER NOT NULL, loose INTEGER NOT NULL DEFAULT 0, packSize INTEGER NOT NULL DEFAULT 1,
    mrpPaise INTEGER NOT NULL, discountPaise INTEGER NOT NULL, taxablePaise INTEGER NOT NULL, gstRate INTEGER NOT NULL,
    costPaise INTEGER NOT NULL
  );
  CREATE INDEX saleItem_sale ON saleItem(saleId);

  CREATE TABLE payment (
    id TEXT PRIMARY KEY, saleId TEXT NOT NULL REFERENCES sale(id),
    mode TEXT NOT NULL CHECK (mode IN ('cash', 'upi', 'card', 'credit')), amountPaise INTEGER NOT NULL, ref TEXT
  );
  CREATE INDEX payment_sale ON payment(saleId);

  -- Bills and stock movements are permanent records: block edits and deletes even from raw SQL.
  CREATE TRIGGER sale_no_update BEFORE UPDATE ON sale BEGIN SELECT RAISE(ABORT, 'Bills cannot be changed'); END;
  CREATE TRIGGER sale_no_delete BEFORE DELETE ON sale BEGIN SELECT RAISE(ABORT, 'Bills cannot be deleted'); END;
  CREATE TRIGGER saleItem_no_update BEFORE UPDATE ON saleItem BEGIN SELECT RAISE(ABORT, 'Bills cannot be changed'); END;
  CREATE TRIGGER saleItem_no_delete BEFORE DELETE ON saleItem BEGIN SELECT RAISE(ABORT, 'Bills cannot be deleted'); END;
  CREATE TRIGGER payment_no_update BEFORE UPDATE ON payment BEGIN SELECT RAISE(ABORT, 'Payments cannot be changed'); END;
  CREATE TRIGGER payment_no_delete BEFORE DELETE ON payment BEGIN SELECT RAISE(ABORT, 'Payments cannot be deleted'); END;
  CREATE TRIGGER movement_no_update BEFORE UPDATE ON stockMovement BEGIN SELECT RAISE(ABORT, 'Stock movements cannot be changed'); END;
  CREATE TRIGGER movement_no_delete BEFORE DELETE ON stockMovement BEGIN SELECT RAISE(ABORT, 'Stock movements cannot be deleted'); END;
  `,
  // 2: suppliers and purchase bills, sales returns (credit notes), payments received from credit customers.
  `
  CREATE TABLE supplier (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, gstin TEXT, dl TEXT, address TEXT, updatedAt TEXT NOT NULL, deletedAt TEXT
  );
  CREATE TABLE purchase (
    id TEXT PRIMARY KEY, branchId TEXT NOT NULL, supplierId TEXT NOT NULL REFERENCES supplier(id), billNo TEXT NOT NULL, billDate TEXT NOT NULL,
    taxablePaise INTEGER NOT NULL, taxPaise INTEGER NOT NULL, totalPaise INTEGER NOT NULL, userId TEXT NOT NULL, at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX purchase_bill ON purchase(supplierId, billNo);
  CREATE TABLE purchaseItem (
    id TEXT PRIMARY KEY, purchaseId TEXT NOT NULL REFERENCES purchase(id), batchId TEXT NOT NULL REFERENCES batch(id), medicineId TEXT NOT NULL,
    packs INTEGER NOT NULL, freePacks INTEGER NOT NULL DEFAULT 0, costPaise INTEGER NOT NULL, mrpPaise INTEGER NOT NULL, gstRate INTEGER NOT NULL,
    taxablePaise INTEGER NOT NULL, taxPaise INTEGER NOT NULL
  );
  CREATE INDEX purchaseItem_purchase ON purchaseItem(purchaseId);
  CREATE TABLE salesReturn (
    id TEXT PRIMARY KEY, saleId TEXT NOT NULL REFERENCES sale(id), branchId TEXT NOT NULL, deviceId TEXT NOT NULL, creditNoteNo TEXT NOT NULL UNIQUE,
    reason TEXT NOT NULL, condition TEXT NOT NULL CHECK (condition IN ('sealed', 'opened', 'damaged')),
    refundMode TEXT NOT NULL CHECK (refundMode IN ('cash', 'upi', 'credit')), amountPaise INTEGER NOT NULL, taxablePaise INTEGER NOT NULL,
    userId TEXT NOT NULL, at TEXT NOT NULL
  );
  CREATE INDEX salesReturn_sale ON salesReturn(saleId);
  CREATE TABLE salesReturnItem (
    id TEXT PRIMARY KEY, returnId TEXT NOT NULL REFERENCES salesReturn(id), saleItemId TEXT NOT NULL REFERENCES saleItem(id), batchId TEXT NOT NULL,
    qty INTEGER NOT NULL, amountPaise INTEGER NOT NULL, taxablePaise INTEGER NOT NULL, restocked INTEGER NOT NULL
  );
  CREATE INDEX salesReturnItem_item ON salesReturnItem(saleItemId);
  CREATE TABLE customerReceipt (
    id TEXT PRIMARY KEY, customerId TEXT NOT NULL REFERENCES customer(id), amountPaise INTEGER NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('cash', 'upi', 'card')), ref TEXT, userId TEXT NOT NULL, at TEXT NOT NULL
  );
  CREATE INDEX customerReceipt_customer ON customerReceipt(customerId);
  ` + ["purchase", "purchaseItem", "salesReturn", "salesReturnItem", "customerReceipt"].map((t) =>
    `CREATE TRIGGER ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, 'Saved records cannot be changed'); END;
     CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, 'Saved records cannot be deleted'); END;`).join("\n"),
  // 3: when each field of an editable row last changed, so edits from different counters merge field by field.
  `
  CREATE TABLE fieldClock (tbl TEXT NOT NULL, rowId TEXT NOT NULL, col TEXT NOT NULL, clock TEXT NOT NULL, PRIMARY KEY (tbl, rowId, col)) WITHOUT ROWID;
  `,
  // 4: money paid to suppliers, and shop expenses (rent, salaries, electricity…).
  `
  CREATE TABLE supplierPayment (
    id TEXT PRIMARY KEY, supplierId TEXT NOT NULL REFERENCES supplier(id), amountPaise INTEGER NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('cash', 'upi', 'bank', 'cheque')), ref TEXT, userId TEXT NOT NULL, at TEXT NOT NULL
  );
  CREATE INDEX supplierPayment_supplier ON supplierPayment(supplierId);
  CREATE TABLE expense (
    id TEXT PRIMARY KEY, branchId TEXT NOT NULL, category TEXT NOT NULL, amountPaise INTEGER NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('cash', 'upi', 'bank', 'cheque')), note TEXT, userId TEXT NOT NULL, at TEXT NOT NULL
  );
  CREATE INDEX expense_at ON expense(branchId, at);
  ` + ["supplierPayment", "expense"].map((t) =>
    `CREATE TRIGGER ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, 'Saved records cannot be changed'); END;
     CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, 'Saved records cannot be deleted'); END;`).join("\n"),
  // 5: loyalty points, and home delivery orders (billed when packed; cash on delivery is collected by the rider).
  `
  CREATE TABLE loyaltyLedger (
    id TEXT PRIMARY KEY, customerId TEXT NOT NULL REFERENCES customer(id), points INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('earn', 'redeem', 'return')), refId TEXT NOT NULL, at TEXT NOT NULL
  );
  CREATE INDEX loyaltyLedger_customer ON loyaltyLedger(customerId);
  CREATE TABLE deliveryOrder (
    id TEXT PRIMARY KEY, branchId TEXT NOT NULL, orderNo TEXT NOT NULL UNIQUE, customerId TEXT NOT NULL REFERENCES customer(id),
    address TEXT NOT NULL, note TEXT, payment TEXT NOT NULL CHECK (payment IN ('cod', 'upi', 'cash')),
    status TEXT NOT NULL CHECK (status IN ('new', 'packed', 'out', 'delivered', 'cancelled')), saleId TEXT, rider TEXT,
    createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, deletedAt TEXT
  );
  CREATE INDEX deliveryOrder_status ON deliveryOrder(branchId, status);
  CREATE TABLE deliveryOrderItem (
    id TEXT PRIMARY KEY, orderId TEXT NOT NULL REFERENCES deliveryOrder(id), medicineId TEXT NOT NULL, qty INTEGER NOT NULL,
    unit TEXT NOT NULL CHECK (unit IN ('pack', 'loose'))
  );
  CREATE INDEX deliveryOrderItem_order ON deliveryOrderItem(orderId);
  -- The part of a credit note given back as loyalty points, not money.
  ALTER TABLE salesReturn ADD COLUMN pointsValuePaise INTEGER NOT NULL DEFAULT 0;
  ` + ["loyaltyLedger", "deliveryOrderItem"].map((t) =>
    `CREATE TRIGGER ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, 'Saved records cannot be changed'); END;
     CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, 'Saved records cannot be deleted'); END;`).join("\n"),
  // 6: inter-state bills moved from Medoro (all tax is IGST; place of supply is the buyer's state code).
  `
  ALTER TABLE sale ADD COLUMN igstPaise INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE sale ADD COLUMN placeOfSupply TEXT;
  `,
  // 7: e-invoices (IRN and QR from the GST portal, through Medoro's gateway) and B2B buyers' billing addresses.
  `
  ALTER TABLE customer ADD COLUMN address TEXT;
  ALTER TABLE customer ADD COLUMN pincode TEXT;
  CREATE TABLE einvoice (
    id TEXT PRIMARY KEY, saleId TEXT NOT NULL REFERENCES sale(id), kind TEXT NOT NULL CHECK (kind IN ('irn', 'cancel')),
    irn TEXT NOT NULL, ackNo TEXT, ackDt TEXT, signedQr TEXT, reason TEXT, userId TEXT NOT NULL, at TEXT NOT NULL
  );
  CREATE INDEX einvoice_sale ON einvoice(saleId);
  CREATE TRIGGER einvoice_no_update BEFORE UPDATE ON einvoice BEGIN SELECT RAISE(ABORT, 'Saved records cannot be changed'); END;
  CREATE TRIGGER einvoice_no_delete BEFORE DELETE ON einvoice BEGIN SELECT RAISE(ABORT, 'Saved records cannot be deleted'); END;
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

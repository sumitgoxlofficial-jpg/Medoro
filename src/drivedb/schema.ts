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
  // UPI & Bank (migration 8): statement imports, bank transactions, where each came from, review decisions, and
  // which bill / counter payment / receipt each credit pays.
  finImport: {
    kind: "append",
    columns: ["id", "account", "fileName", "rows", "added", "duplicates", "review", "skipped", "problems", "fromDate", "toDate", "matched", "userId", "at"],
  },
  finTxn: {
    kind: "append",
    columns: ["id", "account", "direction", "amountPaise", "bookedOn", "bookedTime", "description", "refText", "utr", "channel",
      "counterpartyName", "counterpartyVpa", "balancePaise", "source", "importId", "verified", "at"],
  },
  finSource: {
    kind: "append",
    columns: ["id", "txnId", "source", "sourceRef", "importId", "row", "rule", "at"],
  },
  finEvent: {
    kind: "append",
    columns: ["id", "txnId", "kind", "refId", "note", "userId", "at"],
  },
  finAllocation: {
    kind: "append",
    columns: ["id", "txnId", "target", "saleId", "paymentId", "receiptId", "customerId", "amountPaise", "kind", "rule", "reversesId", "userId", "at"],
  },
  // Store updates (migration 9): a customer's consent to offers, as a history (the latest row is their choice), and
  // campaigns sent from a counter with each recipient's result (the latest row per customer counts).
  customerConsent: {
    kind: "append",
    columns: ["id", "customerId", "purpose", "channel", "granted", "method", "userId", "at"],
  },
  campaign: {
    kind: "append",
    columns: ["id", "name", "message", "audience", "userId", "at"],
  },
  campaignSend: {
    kind: "append",
    columns: ["id", "campaignId", "customerId", "status", "error", "at"],
  },
  // WhatsApp messages sent from the counters (migration 10): the provider's message id and its latest status.
  messageLog: {
    kind: "mutable",
    columns: ["id", "kind", "refId", "customerId", "messageId", "status", "error", "sentAt", ...MUTABLE],
  },
  // @@TABLES doctors (migration 11)
  // Doctor master (migration 11). Bills keep the prescriber's name and registration no. as typed; reports link them
  // to a doctor by registration no., else by name.
  doctor: {
    kind: "mutable",
    columns: ["id", "name", "qualification", "regNo", "clinic", "phone", "address", "active", ...MUTABLE],
  },
  // @@TABLES recalls (migration 12)
  // Recall notices recorded from verified sources (migration 12); batch numbers are a JSON array. Only the status changes.
  recall: {
    kind: "mutable",
    columns: ["id", "ref", "source", "publishedAt", "product", "medicineId", "batchNos", "reason", "status", "userId", "createdAt", ...MUTABLE],
  },
  // @@TABLES cheques (migration 13)
  // Cheques received and issued (migration 13): the cheque, then each step (deposited, cleared, bounced, cancelled)
  // as an event row. The money effect is the customerReceipt / supplierPayment row in linkId.
  cheque: {
    kind: "append",
    columns: ["id", "direction", "customerId", "supplierId", "chequeNo", "bank", "chequeDate", "amountPaise", "linkId", "note", "userId", "at"],
  },
  chequeEvent: {
    kind: "append",
    columns: ["id", "chequeId", "kind", "day", "reason", "chargePaise", "bankChargePaise", "userId", "at"],
  },
  // @@TABLES purchase tools (migration 14)
  // Purchase tools (migration 14): pricing rules (one row, id "rules"), each supplier's return terms and e-bill column
  // mapping (id = supplier id), item codes learned from e-bills, e-bills already entered (so a file isn't entered
  // twice), and expiry / breakage claims on suppliers with each step (acknowledged, credit note, closed) as an event.
  purchaseSetting: {
    kind: "mutable",
    columns: ["id", "gstBase", "itc", "minMarginPct", ...MUTABLE],
  },
  supplierTerms: {
    kind: "mutable",
    columns: ["id", "acceptsReturns", "returnWindowDays", "ebillMapping", ...MUTABLE],
  },
  supplierItemMap: {
    kind: "append",
    columns: ["id", "supplierId", "code", "medicineId", "userId", "at"],
  },
  ebillImport: {
    kind: "append",
    columns: ["id", "supplierId", "purchaseId", "fingerprint", "fileName", "invoiceNo", "lines", "userId", "at"],
  },
  supplierClaim: {
    kind: "append",
    columns: ["id", "claimNo", "branchId", "supplierId", "batchId", "medicineId", "qty", "reason", "note", "claimPaise", "taxPaise", "userId", "at"],
  },
  claimEvent: {
    kind: "append",
    columns: ["id", "claimId", "supplierId", "kind", "amountPaise", "ref", "note", "userId", "at"],
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
  // 8: UPI & Bank. Statement imports and bank transactions (amounts positive, direction separate), the source row of
  // each (a later file with the same row is skipped), review decisions as events, and allocations of credits to bills,
  // counter UPI payments and receipts (undo = a negative allocation). Receipts may now be "bank" (NEFT, IMPS, …).
  `
  CREATE TABLE finImport (
    id TEXT PRIMARY KEY, account TEXT NOT NULL, fileName TEXT NOT NULL, rows INTEGER NOT NULL, added INTEGER NOT NULL,
    duplicates INTEGER NOT NULL, review INTEGER NOT NULL, skipped INTEGER NOT NULL, problems TEXT NOT NULL,
    fromDate TEXT, toDate TEXT, matched INTEGER NOT NULL, userId TEXT NOT NULL, at TEXT NOT NULL
  );
  CREATE TABLE finTxn (
    id TEXT PRIMARY KEY, account TEXT NOT NULL, direction TEXT NOT NULL CHECK (direction IN ('credit', 'debit')),
    amountPaise INTEGER NOT NULL CHECK (amountPaise > 0), bookedOn TEXT NOT NULL, bookedTime TEXT, description TEXT NOT NULL,
    refText TEXT, utr TEXT, channel TEXT NOT NULL, counterpartyName TEXT, counterpartyVpa TEXT, balancePaise INTEGER,
    source TEXT NOT NULL, importId TEXT, verified INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL
  );
  CREATE INDEX finTxn_booked ON finTxn(bookedOn);
  CREATE INDEX finTxn_utr ON finTxn(utr);
  CREATE INDEX finTxn_match ON finTxn(account, bookedOn, amountPaise, direction);
  CREATE TABLE finSource (
    id TEXT PRIMARY KEY, txnId TEXT NOT NULL REFERENCES finTxn(id), source TEXT NOT NULL, sourceRef TEXT NOT NULL,
    importId TEXT, row INTEGER, rule TEXT NOT NULL CHECK (rule IN ('new', 'utr', 'attributes')), at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX finSource_ref ON finSource(source, sourceRef);
  CREATE INDEX finSource_txn ON finSource(txnId);
  CREATE TABLE finEvent (
    id TEXT PRIMARY KEY, txnId TEXT NOT NULL REFERENCES finTxn(id),
    kind TEXT NOT NULL CHECK (kind IN ('duplicate', 'same_as', 'not_duplicate', 'ignore', 'unignore', 'reject')),
    refId TEXT, note TEXT, userId TEXT NOT NULL, at TEXT NOT NULL
  );
  CREATE INDEX finEvent_txn ON finEvent(txnId);
  CREATE TABLE finAllocation (
    id TEXT PRIMARY KEY, txnId TEXT NOT NULL REFERENCES finTxn(id), target TEXT NOT NULL CHECK (target IN ('bill', 'counter', 'receipt')),
    saleId TEXT, paymentId TEXT, receiptId TEXT, customerId TEXT, amountPaise INTEGER NOT NULL CHECK (amountPaise <> 0),
    kind TEXT NOT NULL CHECK (kind IN ('auto', 'approved', 'manual', 'reversal')), rule INTEGER, reversesId TEXT,
    userId TEXT NOT NULL, at TEXT NOT NULL
  );
  CREATE INDEX finAllocation_txn ON finAllocation(txnId);
  CREATE INDEX finAllocation_sale ON finAllocation(saleId);
  CREATE INDEX finAllocation_payment ON finAllocation(paymentId);
  CREATE INDEX finAllocation_receipt ON finAllocation(receiptId);

  -- Receipts by bank transfer. SQLite can't change a CHECK, so the table is rebuilt (same columns, same rows).
  CREATE TABLE customerReceipt_v8 (
    id TEXT PRIMARY KEY, customerId TEXT NOT NULL REFERENCES customer(id), amountPaise INTEGER NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('cash', 'upi', 'card', 'bank')), ref TEXT, userId TEXT NOT NULL, at TEXT NOT NULL
  );
  INSERT INTO customerReceipt_v8 (id, customerId, amountPaise, mode, ref, userId, at) SELECT id, customerId, amountPaise, mode, ref, userId, at FROM customerReceipt;
  DROP TABLE customerReceipt;
  ALTER TABLE customerReceipt_v8 RENAME TO customerReceipt;
  CREATE INDEX customerReceipt_customer ON customerReceipt(customerId);
  ` + ["customerReceipt", "finImport", "finTxn", "finSource", "finEvent", "finAllocation"].map((t) =>
    `CREATE TRIGGER ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, 'Saved records cannot be changed'); END;
     CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, 'Saved records cannot be deleted'); END;`).join("\n"),
  // 9: store updates on WhatsApp. Consent to offers is recorded per customer as a history (who, when, how); a campaign
  // keeps its text and each recipient's result, so a stopped send resumes with the people not yet reached.
  `
  CREATE TABLE customerConsent (
    id TEXT PRIMARY KEY, customerId TEXT NOT NULL REFERENCES customer(id),
    purpose TEXT NOT NULL CHECK (purpose IN ('offers')), channel TEXT NOT NULL CHECK (channel IN ('whatsapp')),
    granted INTEGER NOT NULL CHECK (granted IN (0, 1)), method TEXT NOT NULL, userId TEXT NOT NULL, at TEXT NOT NULL
  );
  CREATE INDEX customerConsent_customer ON customerConsent(customerId, at);
  CREATE TABLE campaign (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, message TEXT NOT NULL, audience INTEGER NOT NULL, userId TEXT NOT NULL, at TEXT NOT NULL
  );
  CREATE TABLE campaignSend (
    id TEXT PRIMARY KEY, campaignId TEXT NOT NULL REFERENCES campaign(id), customerId TEXT NOT NULL REFERENCES customer(id),
    status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'opted_out', 'not_on_whatsapp')), error TEXT, at TEXT NOT NULL
  );
  CREATE INDEX campaignSend_campaign ON campaignSend(campaignId, customerId);
  ` + ["customerConsent", "campaign", "campaignSend"].map((t) =>
    `CREATE TRIGGER ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, 'Saved records cannot be changed'); END;
     CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, 'Saved records cannot be deleted'); END;`).join("\n"),
  // 10: WhatsApp messages sent from the counters (bills and store updates), so the counter can show delivered / read.
  `
  CREATE TABLE messageLog (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('bill', 'campaign')), refId TEXT NOT NULL, customerId TEXT,
    messageId TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('sent', 'delivered', 'read', 'failed')), error TEXT,
    sentAt TEXT NOT NULL, updatedAt TEXT NOT NULL, deletedAt TEXT
  );
  CREATE INDEX messageLog_ref ON messageLog(kind, refId);
  CREATE INDEX messageLog_open ON messageLog(status, sentAt);
  `,
  // @@MIGRATION 11 doctors
  // 11: the doctor master. No unique registration index: two counters offline could add the same doctor, and a
  // unique index would stop the second one syncing in; the counter checks for duplicates instead.
  `
  CREATE TABLE doctor (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, qualification TEXT, regNo TEXT, clinic TEXT, phone TEXT, address TEXT,
    active INTEGER NOT NULL DEFAULT 1, updatedAt TEXT NOT NULL, deletedAt TEXT
  );
  CREATE INDEX doctor_reg ON doctor(regNo);
  CREATE INDEX doctor_name ON doctor(name COLLATE NOCASE);
  CREATE INDEX sale_prescriber ON sale(prescriberReg);
  `,
  // @@MIGRATION 12 recalls
  // 12: recall notices (never generated by Medoro; recorded by the pharmacy from CDSCO, the state drug controller or
  // the manufacturer) and their status. Blocking stock is a batch status change plus a zero-quantity movement.
  `
  CREATE TABLE recall (
    id TEXT PRIMARY KEY, ref TEXT NOT NULL, source TEXT NOT NULL, publishedAt TEXT NOT NULL, product TEXT NOT NULL, medicineId TEXT,
    batchNos TEXT NOT NULL, reason TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'investigating', 'supplier_return', 'resolved')),
    userId TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, deletedAt TEXT
  );
  CREATE INDEX recall_created ON recall(createdAt);
  `,
  // @@MIGRATION 13 cheques
  // 13: cheques received from customers and given to suppliers. Recording one is the receipt / payment (mode
  // "cheque"); a bounce or cancel is a reversing receipt / payment, never an edit. Receipts may now be "cheque".
  `
  CREATE TABLE cheque (
    id TEXT PRIMARY KEY, direction TEXT NOT NULL CHECK (direction IN ('received', 'issued')),
    customerId TEXT REFERENCES customer(id), supplierId TEXT REFERENCES supplier(id),
    chequeNo TEXT NOT NULL, bank TEXT NOT NULL, chequeDate TEXT NOT NULL, amountPaise INTEGER NOT NULL CHECK (amountPaise > 0),
    linkId TEXT NOT NULL, note TEXT, userId TEXT NOT NULL, at TEXT NOT NULL,
    CHECK ((direction = 'received' AND customerId IS NOT NULL) OR (direction = 'issued' AND supplierId IS NOT NULL))
  );
  CREATE INDEX cheque_date ON cheque(chequeDate);
  CREATE INDEX cheque_customer ON cheque(customerId);
  CREATE INDEX cheque_supplier ON cheque(supplierId);
  CREATE TABLE chequeEvent (
    id TEXT PRIMARY KEY, chequeId TEXT NOT NULL REFERENCES cheque(id),
    kind TEXT NOT NULL CHECK (kind IN ('deposited', 'cleared', 'bounced', 'cancelled')), day TEXT NOT NULL, reason TEXT,
    chargePaise INTEGER NOT NULL DEFAULT 0, bankChargePaise INTEGER NOT NULL DEFAULT 0, userId TEXT NOT NULL, at TEXT NOT NULL
  );
  CREATE INDEX chequeEvent_cheque ON chequeEvent(chequeId);

  -- Receipts by cheque. SQLite can't change a CHECK, so the table is rebuilt (same columns, same rows), as in 8.
  CREATE TABLE customerReceipt_v13 (
    id TEXT PRIMARY KEY, customerId TEXT NOT NULL REFERENCES customer(id), amountPaise INTEGER NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('cash', 'upi', 'card', 'bank', 'cheque')), ref TEXT, userId TEXT NOT NULL, at TEXT NOT NULL
  );
  INSERT INTO customerReceipt_v13 (id, customerId, amountPaise, mode, ref, userId, at) SELECT id, customerId, amountPaise, mode, ref, userId, at FROM customerReceipt;
  DROP TABLE customerReceipt;
  ALTER TABLE customerReceipt_v13 RENAME TO customerReceipt;
  CREATE INDEX customerReceipt_customer ON customerReceipt(customerId);
  ` + ["customerReceipt", "cheque", "chequeEvent"].map((t) =>
    `CREATE TRIGGER ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, 'Saved records cannot be changed'); END;
     CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, 'Saved records cannot be deleted'); END;`).join("\n"),
  // @@MIGRATION 14 purchase tools
  // 14: purchase tools. A claim takes stock out (a "supplier_return" movement) when raised; the supplier's credit note is
  // a claimEvent "credit" row, which lowers what the supplier is owed (books.supplierDues). No unique index on e-bill
  // fingerprints: two counters offline could enter the same file, and the bill-number check on purchase stops that.
  `
  CREATE TABLE purchaseSetting (
    id TEXT PRIMARY KEY, gstBase TEXT NOT NULL CHECK (gstBase IN ('net', 'before_cd', 'gross')), itc INTEGER NOT NULL DEFAULT 1,
    minMarginPct REAL NOT NULL DEFAULT 0, updatedAt TEXT NOT NULL, deletedAt TEXT
  );
  CREATE TABLE supplierTerms (
    id TEXT PRIMARY KEY, acceptsReturns INTEGER NOT NULL DEFAULT 1, returnWindowDays INTEGER NOT NULL DEFAULT 90, ebillMapping TEXT,
    updatedAt TEXT NOT NULL, deletedAt TEXT
  );
  CREATE TABLE supplierItemMap (
    id TEXT PRIMARY KEY, supplierId TEXT NOT NULL REFERENCES supplier(id), code TEXT NOT NULL, medicineId TEXT NOT NULL,
    userId TEXT NOT NULL, at TEXT NOT NULL
  );
  CREATE INDEX supplierItemMap_code ON supplierItemMap(supplierId, code, at);
  CREATE TABLE ebillImport (
    id TEXT PRIMARY KEY, supplierId TEXT NOT NULL REFERENCES supplier(id), purchaseId TEXT NOT NULL, fingerprint TEXT NOT NULL,
    fileName TEXT NOT NULL, invoiceNo TEXT NOT NULL, lines INTEGER NOT NULL, userId TEXT NOT NULL, at TEXT NOT NULL
  );
  CREATE INDEX ebillImport_fingerprint ON ebillImport(supplierId, fingerprint);
  CREATE TABLE supplierClaim (
    id TEXT PRIMARY KEY, claimNo TEXT NOT NULL, branchId TEXT NOT NULL, supplierId TEXT NOT NULL REFERENCES supplier(id),
    batchId TEXT NOT NULL REFERENCES batch(id), medicineId TEXT NOT NULL, qty INTEGER NOT NULL CHECK (qty > 0),
    reason TEXT NOT NULL CHECK (reason IN ('expiry', 'near_expiry', 'breakage', 'wrong_item')), note TEXT,
    claimPaise INTEGER NOT NULL, taxPaise INTEGER NOT NULL, userId TEXT NOT NULL, at TEXT NOT NULL
  );
  CREATE INDEX supplierClaim_supplier ON supplierClaim(supplierId);
  CREATE TABLE claimEvent (
    id TEXT PRIMARY KEY, claimId TEXT NOT NULL REFERENCES supplierClaim(id), supplierId TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('ack', 'credit', 'close')), amountPaise INTEGER NOT NULL DEFAULT 0 CHECK (amountPaise >= 0),
    ref TEXT, note TEXT, userId TEXT NOT NULL, at TEXT NOT NULL
  );
  CREATE INDEX claimEvent_claim ON claimEvent(claimId);
  CREATE INDEX claimEvent_supplier ON claimEvent(supplierId, kind);
  ` + ["supplierItemMap", "ebillImport", "supplierClaim", "claimEvent"].map((t) =>
    `CREATE TRIGGER ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, 'Saved records cannot be changed'); END;
     CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, 'Saved records cannot be deleted'); END;`).join("\n"),
];

export const SCHEMA_VERSION = MIGRATIONS.length;

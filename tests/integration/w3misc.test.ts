import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { unzipSync, strFromU8 } from "fflate";
import { db } from "@/server/db";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { commitSale, createCustomer, invoiceData, posCustomers } from "@/domain/sales/service";
import { customerConsents, listCustomers, saveCustomer, saveSupplier } from "@/domain/parties/service";
import { consentWhere, hasConsent } from "@/domain/parties/consent";
import { exportCsvFiles, fullExport, getGrievance, saveGrievance, savePrivacy } from "@/domain/system/privacy";
import { applyRetention, retentionPreview } from "@/domain/system/retention";
import { dailyJobs } from "@/domain/system/daily";
import { reportCrash, sendUsagePing } from "@/domain/system/telemetry";
import { isStrict } from "@/domain/system/strict";
import { listTeam, setUserPermission } from "@/domain/identity/admin";
import { approveSupplierInvoice, postGrnTx } from "@/domain/purchasing/service";
import { centralBuying, draftCentral } from "@/domain/intelligence/service";
import { h1Register, reportRows } from "@/domain/accounting/reports";
import { periodOf } from "@/domain/accounting/service";
import { zip } from "@/lib/zip";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const key = () => "k_" + randomUUID().replace(/-/g, "");
const ago = (days: number) => new Date(Date.now() - days * 86400_000);
const exp = addDays(todayISO(), 400).slice(0, 7);
let T = "", sup = "", azi = "", dolo = "", owner = "";

describe("privacy, consent, permissions, purchasing controls, H1 register, central buying", () => {
  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    T = ctx.tenantId; owner = ctx.userId;
    sup = await saveSupplier(ctx, null, { name: "Pune Pharma", creditDays: "30", leadDays: "2" });
    const base = { form: "Tablet" as const, manufacturer: "Cipla", pack: "10", gstRate: 12, reorderLevel: 20, barcode: "", hsn: "3004", rack: "" };
    azi = await createMedicine(ctx, { ...base, name: "Azithral 500", generic: "Azithromycin", strength: "500 mg", mrp: "120", schedule: "H1" });
    dolo = await createMedicine(ctx, { ...base, name: "Dolo 650", generic: "Paracetamol", strength: "650 mg", mrp: "33.60", schedule: "" });
    await receiveBatch(ctx, { medicineId: azi, batchNo: "AZ1", expiry: exp, qty: 5, cost: "80", mrp: "120", supplierId: sup, invoiceNo: "PP/1" });
    await receiveBatch(ctx, { medicineId: dolo, batchNo: "DL1", expiry: exp, qty: 4, cost: "20", mrp: "33.60", supplierId: sup, invoiceNo: "PP/2" });
    await receiveBatch(await ctxFor("Owner", "Second"), { medicineId: dolo, batchNo: "DL2", expiry: exp, qty: 2, cost: "20", mrp: "33.60", supplierId: sup, invoiceNo: "PP/3" });
  });

  it("records consent by purpose and channel, separately for marketing, with history", async () => {
    const ctx = await ctxFor();
    const id = await saveCustomer(ctx, null, { name: "Meena Joshi", phone: "9822000201", waOptIn: true, creditLimit: "0", marketingWa: true, consentMethod: "form" });
    let c = await db.customer.findUniqueOrThrow({ where: { id } });
    expect(hasConsent(c, "transactional", "whatsapp")).toBe(true);
    expect(hasConsent(c, "marketing", "whatsapp")).toBe(true);
    expect(hasConsent(c, "marketing", "sms")).toBe(false);
    await saveCustomer(ctx, id, { name: "Meena Joshi", phone: "9822000201", waOptIn: true, creditLimit: "0", marketingWa: false, smsOptIn: true });
    c = await db.customer.findUniqueOrThrow({ where: { id } });
    expect([c.marketingWa, c.smsOptIn]).toEqual([false, true]);
    const h = await customerConsents(ctx, id);
    expect(h.map((r) => `${r.purpose}:${r.channel}:${r.granted}`).sort()).toEqual(["marketing:whatsapp:false", "marketing:whatsapp:true", "transactional:sms:true", "transactional:whatsapp:true"]);
    expect(h.find((r) => r.purpose === "marketing" && r.granted)).toMatchObject({ method: "form", source: "parties", by: "Owner Person" });
    expect(await db.customer.count({ where: { tenantId: T, ...consentWhere("marketing", "whatsapp") } })).toBe(0);
    expect(await db.customer.count({ where: { tenantId: T, ...consentWhere("transactional", "sms") } })).toBe(1);
    await expect(db.consentRecord.deleteMany({ where: { customerId: id } })).rejects.toThrow(/append-only/);

    // POS form: marketing consent captured at the counter; strict mode records a "no" for a number without consent.
    const pos = await createCustomer(await ctxFor("Cashier"), { name: "Walk In", phone: "9822000202", waOptIn: false, creditLimit: "0", marketingWa: false });
    expect(await customerConsents(ctx, pos)).toEqual([expect.objectContaining({ purpose: "transactional", channel: "whatsapp", granted: false, source: "pos" })]);
    await expect(saveCustomer(ctx, null, { name: "No Phone", phone: "", waOptIn: false, creditLimit: "0", marketingSms: true })).rejects.toThrow(/mobile number/);
  });

  it("strict mode masks customer phones below manager, keeps the number on edit, and masks exports without a reason", async () => {
    expect(await isStrict(T)).toBe(true);
    const cashier = await ctxFor("Cashier"), manager = await ctxFor("Manager");
    const masked = (await listCustomers(cashier)).find((c) => c.name === "Meena Joshi")!;
    expect(masked.phone).toBe("••••••0201");
    expect((await listCustomers(manager)).find((c) => c.name === "Meena Joshi")!.phone).toBe("9822000201");
    expect((await posCustomers(cashier)).find((c) => c.name === "Meena Joshi")!.phone).toBe("••••••0201");
    expect((await posCustomers(manager)).find((c) => c.name === "Meena Joshi")!.phone).toBe("9822000201");
    await saveCustomer(cashier, masked.id, { name: "Meena J", phone: masked.phone!, waOptIn: true, creditLimit: "0", smsOptIn: true });
    expect((await db.customer.findUniqueOrThrow({ where: { id: masked.id } })).phone).toBe("9822000201");

    const owner = await ctxFor();
    const plain = await fullExport(owner);
    expect(plain.customers.find((c) => c.id === masked.id)!.phone).toBe("••••••0201");
    await expect(fullExport(owner, { reason: "x" })).rejects.toThrow(/reason/);
    const full = await fullExport(owner, { reason: "Moving to a new server" }, "csv");
    expect(full.customers.find((c) => c.id === masked.id)!.phone).toBe("9822000201");
    expect((await db.auditEvent.findFirstOrThrow({ where: { tenantId: T, action: "Full data export" }, orderBy: { id: "desc" } })).detail).toMatch(/CSV .*reason: Moving to a new server/);

    const rows = await reportRows(manager, "customer-dues", periodOf("month"), "branch", { showPhones: false });
    expect(rows.slice(1).every((r) => !String(r[1] ?? "").match(/\d{10}/))).toBe(true);
  });

  it("exports a ZIP with one CSV per table, including child rows", async () => {
    const ctx = await ctxFor("Cashier");
    await commitSale(ctx, { idempotencyKey: key(), lines: [{ medicineId: dolo, batchId: (await db.batch.findFirstOrThrow({ where: { batchNo: "DL1" } })).id, qty: 1 }], customerId: null, discountPct: 0, pay: { mode: "cash" } });
    const files = exportCsvFiles(await fullExport(await ctxFor()));
    const names = files.map((f) => f.name);
    for (const n of ["README.txt", "tenant.csv", "customers.csv", "sales.csv", "sales-items.csv", "sales-payments.csv", "vouchers-lines.csv", "consent-records.csv", "users.csv"]) expect(names).toContain(n);
    const out = unzipSync(new Uint8Array(zip(files)));
    const items = strFromU8(out["sales-items.csv"]).replace(/^\uFEFF/, "").split("\n");
    expect(items[0]).toMatch(/^id,saleId,batchId,medicineId,qty/);
    expect(items).toHaveLength(2);
    expect(strFromU8(out["users.csv"])).not.toMatch(/argon2|passwordHash|pinHash/);
  });

  it("per-user permission overrides: grant and revoke on top of the role, audited, owner-only for users/integrations", async () => {
    const role = await db.role.findFirstOrThrow({ where: { tenantId: T, name: "Cashier" } });
    const u = await db.user.create({ data: { tenantId: T, name: "Kiran", phone: "9850000099", roleId: role.id, employeeNo: "E-900" } });
    const ownerCtx = await ctxFor();
    expect(await setUserPermission(ownerCtx, u.id, "reports", "grant")).toBe("granted");
    expect(await setUserPermission(ownerCtx, u.id, "sale", "revoke")).toBe("revoked");
    expect(await setUserPermission(ownerCtx, u.id, "credit", "revoke")).toBe("role");
    const m = (await listTeam(ownerCtx)).users.find((x) => x.id === u.id)!;
    expect([m.grants, m.revokes]).toEqual([["reports"], ["sale"]]);
    expect(await db.auditEvent.count({ where: { tenantId: T, action: { in: ["User permission granted", "User permission revoked"] }, entityId: u.id } })).toBe(2);
    const manager = { ...(await ctxFor("Manager")), perms: [...(await ctxFor("Manager")).perms, "users"], realRole: "Manager" };
    await expect(setUserPermission(manager, u.id, "users", "grant")).rejects.toThrow(/Only the owner/);
    await expect(setUserPermission(ownerCtx, owner, "reports", "revoke")).rejects.toThrow(/your own/);
    await expect(setUserPermission(await ctxFor("Cashier"), u.id, "reports", "grant")).rejects.toThrow(/role/);
    expect(await setUserPermission(ownerCtx, u.id, "sale", "role")).toBe("role");
  });

  it("uploaded invoices: low-confidence OCR lines must be verified and the printed total must match", async () => {
    const ctx = await ctxFor();
    const doc = await db.scanDocument.create({ data: { tenantId: T, fileName: "inv.pdf", sha256: "x", status: "review", confidence: {}, createdBy: ctx.userId,
      extracted: { invoiceNo: "PP/77", lines: [{ text: "AZITHRAL 500 B:AZ9", confidence: 0.55, medicineId: azi }, { text: "DOLO 650", confidence: 0.97, medicineId: dolo }] } } });
    const lines = [
      { medicineId: azi, batchNo: "AZ9", expiry: exp, qty: 2, freeQty: 0, rate: "80", mrp: "120", poItemId: null, ocrIndex: 0, verified: false },
      { medicineId: dolo, batchNo: "DL9", expiry: exp, qty: 5, freeQty: 0, rate: "20", mrp: "33.60", poItemId: null, ocrIndex: 1, verified: false },
    ];
    const inv = { supplierId: sup, invoiceNo: "PP/77", invoiceDate: todayISO(), poId: null, scanDocId: doc.id, lines };
    // 2×80 + 5×20 = 260 + 12% GST = 291.20
    await expect(approveSupplierInvoice(ctx, { ...inv, statedTotal: "" })).rejects.toThrow(/printed on the supplier invoice/);
    await expect(postGrnTx(ctx, { ...inv, statedTotal: null })).rejects.toThrow(/total printed on the invoice/);
    await expect(approveSupplierInvoice(ctx, { ...inv, statedTotal: "291.20" })).rejects.toThrow(/Line 1 .*low confidence/);
    await expect(approveSupplierInvoice(ctx, { ...inv, statedTotal: "300", lines: [{ ...lines[0], verified: true }, lines[1]] })).rejects.toThrow(/don’t match/);
    await expect(approveSupplierInvoice(ctx, { ...inv, statedTotal: "291.20", lines: [{ ...lines[0], ocrIndex: 7, verified: true }, lines[1]] })).rejects.toThrow(/doesn’t match a line read/);
    const r = await approveSupplierInvoice(ctx, { ...inv, statedTotal: "291.20", lines: [{ ...lines[0], verified: true }, lines[1]] });
    expect(r.total).toBe(29120);
    expect((await db.scanDocument.findUniqueOrThrow({ where: { id: doc.id } })).status).toBe("approved");
    await expect(approveSupplierInvoice(ctx, { ...inv, invoiceNo: "PP/78", scanDocId: null, statedTotal: "abc" })).rejects.toThrow(/as an amount/);
  });

  it("Schedule H1 register lists H1 sales with patient and prescriber, on screen and as CSV", async () => {
    const ctx = await ctxFor("Cashier");
    const az = (await db.batch.findFirstOrThrow({ where: { batchNo: "AZ1" } })).id;
    const s = await commitSale(ctx, { idempotencyKey: key(), lines: [{ medicineId: azi, batchId: az, qty: 1 }], customerId: null, discountPct: 0, pay: { mode: "cash" }, prescriber: "Dr. S. Rao", rxNo: "RX-12", prescriberReg: "MMC-55821", patientName: "Sunita Patil" });
    const p = periodOf("month");
    const rows = await h1Register(T, ctx.branchId, p);
    expect(rows).toEqual([expect.objectContaining({ invoiceNo: s.invoiceNo, patient: "Sunita Patil", prescriber: "Dr. S. Rao", prescriberReg: "MMC-55821", rxNo: "RX-12", schedule: "H1", batchNo: "AZ1", qty: 1 })]);
    const csv = await reportRows(await ctxFor("Accountant"), "h1-register", p);
    expect(csv[0]).toContain("Prescriber reg. no.");
    expect(csv).toHaveLength(2);
  });

  it("grievance officer prints on invoices; falls back to the pharmacy phone", async () => {
    const ctx = await ctxFor();
    const sale = await db.sale.findFirstOrThrow({ where: { tenantId: T } });
    expect((await invoiceData(ctx, sale.id))!.pharmacy.grievance).toMatch(/^Questions about your data/);
    await expect(saveGrievance(ctx, { name: "Anita K", email: "", phone: "" })).rejects.toThrow(/email or phone/);
    await saveGrievance(ctx, { name: "Anita K", email: "dpo@store.in", phone: "" });
    expect(await getGrievance(T)).toMatchObject({ name: "Anita K", email: "dpo@store.in" });
    expect((await invoiceData(ctx, sale.id))!.pharmacy.grievance).toBe("Grievance officer: Anita K, dpo@store.in");
    await expect(saveGrievance(await ctxFor("Manager"), { name: "X", email: "x@y.in" })).rejects.toThrow(/role/);
  });

  it("central buying combines reorder needs per supplier and drafts one PO per branch in one go", async () => {
    const ctx = await ctxFor();
    const plan = await centralBuying(ctx, { cover: 21, safety: 2 });
    const s = plan.suppliers.find((x) => x.supplierId === sup)!;
    const d = s.lines.find((l) => l.medicineId === dolo)!;
    const [main, second] = plan.branches;
    expect(d.qty[second.id]).toBe(18); // reorder level 20, 2 in stock
    expect(d.qty[main.id]).toBeGreaterThan(0);
    expect(d.total).toBe(d.qty[main.id] + d.qty[second.id]);
    expect(plan.suppliers.find((x) => !x.supplierId)!.lines.map((l) => l.name)).toEqual(["Azithral 500"]); // never bought at Second
    await expect(draftCentral(ctx, { cover: 21, safety: 2 }, null)).rejects.toThrow(/no supplier on record/);
    const pos = await draftCentral(ctx, { cover: 21, safety: 2 }, sup);
    expect(new Set(pos.map((p) => p.branch))).toEqual(new Set(["Main", "Second"]));
    const atSecond = await db.purchaseOrder.findFirstOrThrow({ where: { tenantId: T, branchId: second.id, source: "intel" }, include: { items: true } });
    expect(atSecond.items.find((i) => i.medicineId === dolo)!.qty).toBe(18);
    expect(atSecond.items.find((i) => i.medicineId === azi)!.qty).toBe(20);
    await expect(draftCentral({ ...ctx, branches: [ctx.branches[0]] }, { cover: 21, safety: 2 }, null)).rejects.toThrow(/two or more branches/);
    await expect(draftCentral(await ctxFor("Accountant"), { cover: 21, safety: 2 }, null)).rejects.toThrow(/role/);
  });

  it("retention: preview, then anonymise inactive customers and purge old operational rows; statutory books untouched", async () => {
    const ctx = await ctxFor();
    const old = await db.customer.create({ data: { tenantId: T, name: "Old Customer", phone: "9822000301", waOptIn: true, createdAt: ago(10 * 365) } });
    const active = await db.customer.create({ data: { tenantId: T, name: "Active Customer", phone: "9822000302", createdAt: ago(10 * 365) } });
    await commitSale(await ctxFor("Cashier"), { idempotencyKey: key(), lines: [{ medicineId: dolo, batchId: (await db.batch.findFirstOrThrow({ where: { batchNo: "DL9" } })).id, qty: 1 }], customerId: active.id, discountPct: 0, pay: { mode: "cash" } });
    await db.waMessage.create({ data: { tenantId: T, invoiceId: "s-old", invoiceNo: "INV/OLD", recipient: "9822000301", idempotencyKey: "wa:old", status: "sent", createdAt: ago(400) } });
    await db.session.create({ data: { id: "old-session", userId: owner, tokenVersion: 0, expiresAt: ago(40) } });
    await db.heldCart.create({ data: { tenantId: T, branchId: ctx.branchId, userId: owner, label: "old", cart: {}, createdAt: ago(8) } });
    await db.heldCart.create({ data: { tenantId: T, branchId: ctx.branchId, userId: owner, label: "today", cart: {} } });
    await db.invite.updateMany({ where: { tenantId: T }, data: { expiresAt: ago(100) } });
    await db.otpCode.create({ data: { phone: "9822000399", codeHash: "x", purpose: "signin", expiresAt: ago(2) } });
    await db.aiConfirmation.create({ data: { token: "old-ai", tenantId: T, userId: owner, tool: "x", inputHash: "x", input: {}, preview: {}, expiresAt: ago(8) } });
    await db.supportGrant.create({ data: { tenantId: T, tokenHash: "old-grant", reason: "help", minutes: 60, createdById: owner, createdBy: "Owner", expiresAt: ago(400) } });
    await db.$executeRaw`INSERT INTO "LoginAttempt" (key, failures, "updatedAt") VALUES ('old-key', 2, ${ago(40)})`;
    const salesBefore = await db.sale.count({ where: { tenantId: T } }), vouchersBefore = await db.voucher.count({ where: { tenantId: T } }), movesBefore = await db.stockMovement.count({ where: { tenantId: T } });

    const pre = await retentionPreview(T);
    expect(pre.counts).toMatchObject({ customers: 1, whatsapp: 1, sessions: 1, heldCarts: 1, invites: 1, otpCodes: 1, aiConfirmations: 1, supportGrants: 1, loginAttempts: 1 });
    expect(await db.customer.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ phone: "9822000301" });

    const done = await applyRetention(T);
    expect(done).toMatchObject(pre.counts);
    expect(await db.customer.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ phone: null, waOptIn: false, name: expect.stringMatching(/^Inactive customer/) });
    expect((await db.customer.findUniqueOrThrow({ where: { id: active.id } })).phone).toBe("9822000302");
    expect((await db.waMessage.findUniqueOrThrow({ where: { idempotencyKey: "wa:old" } })).recipient).toBe("redacted");
    expect(await db.heldCart.count({ where: { tenantId: T } })).toBe(1);
    expect([await db.sale.count({ where: { tenantId: T } }), await db.voucher.count({ where: { tenantId: T } }), await db.stockMovement.count({ where: { tenantId: T } })]).toEqual([salesBefore, vouchersBefore, movesBefore]);
    expect((await db.auditEvent.findFirstOrThrow({ where: { tenantId: T, action: "Retention run" } })).detail).toMatch(/customers 1/);
    expect(Object.values((await retentionPreview(T)).counts).every((n) => n === 0)).toBe(true);

    // The scheduler runs it once per IST day.
    expect(await dailyJobs()).toHaveLength(1);
    expect(await dailyJobs()).toHaveLength(0);
  });

  describe("telemetry and crash reports", () => {
    let server: Server; const got: { url: string; body: Record<string, unknown> }[] = [];
    beforeAll(async () => {
      server = createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { got.push({ url: req.url!, body: JSON.parse(b) }); res.end("ok"); }); });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
      const port = (server.address() as { port: number }).port;
      process.env.TELEMETRY_URL = `http://127.0.0.1:${port}/usage`; process.env.CRASH_REPORT_URL = `http://127.0.0.1:${port}/crash`;
    });
    afterAll(async () => { delete process.env.TELEMETRY_URL; delete process.env.CRASH_REPORT_URL; server.close(); await savePrivacy(await ctxFor(), { strict: true, telemetry: false, crash: false }); });

    it("sends nothing in strict mode or when the toggle is off", async () => {
      await savePrivacy(await ctxFor(), { telemetry: true, crash: true });
      expect(await sendUsagePing(T)).toBe(false);
      expect(await reportCrash(new Error("boom"), {})).toBe(false);
      await savePrivacy(await ctxFor(), { strict: false, telemetry: false, crash: false });
      expect(await sendUsagePing(T)).toBe(false);
      expect(await reportCrash(new Error("boom"), {})).toBe(false);
      expect(got).toHaveLength(0);
    });

    it("sends an anonymous daily ping and a scrubbed crash report when allowed", async () => {
      await savePrivacy(await ctxFor(), { strict: false, telemetry: true, crash: true });
      expect(await sendUsagePing(T)).toBe(true);
      expect(await reportCrash(new Error(`Customer "Meena Joshi" 9822000201 failed for ${T}`), { method: "GET", route: "/app/parties" })).toBe(true);
      const all = JSON.stringify(got);
      expect(got.map((g) => g.url)).toEqual(["/usage", "/crash"]);
      expect(got[0].body).toMatchObject({ kind: "usage", counts: { branches: "≤5" } });
      expect(all).not.toMatch(/Test Medical Store|TEST-PUNE|Meena|9822000201/);
      expect(all).not.toContain(T);
    });
  });
});

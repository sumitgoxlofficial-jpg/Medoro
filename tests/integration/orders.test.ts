import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { seal } from "@/server/vault";
import type { Ctx } from "@/server/context";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { commitSale } from "@/domain/sales/service";
import { currentShift, openShift, processReturn } from "@/domain/sales/returns";
import { ACC } from "@/domain/accounting/accounts";
import {
  cancelOrder, confirmOrder, createOrder, deliverOrder, dispatchOrder, failedAttempt, listOrders, myDeliveries, packOrder, returnOrder, riderCash, settleRider,
} from "@/domain/orders/service";
import { ownerSnapshot } from "@/domain/reports/owner";
import { buildReportMail, reportMailTick, saveReportMail, sendReportMail, unsubSig, unsubscribe } from "@/domain/reports/mailer";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

let med = "", rxMed = "", early = "", late = "", rider: Ctx, rider2: Ctx;
const key = () => "k_" + randomUUID().replace(/-/g, "");
const qty = async (id: string) => (await db.batch.findUniqueOrThrow({ where: { id } })).qtyAvailable;
const balance = async (account: string) => {
  const r = await db.ledgerLine.aggregate({ where: { account }, _sum: { debitPaise: true, creditPaise: true } });
  return Number(r._sum.debitPaise ?? 0n) - Number(r._sum.creditPaise ?? 0n);
};
const base = { source: "phone" as const, name: "Sunita Rao", phone: "9822011122", address: "Flat 4, Lake View, Baner Road, Pune 411045", slotDate: todayISO(), slot: "15:00–18:00", payMode: "cod" as const };

async function riderCtx(name: string, phone: string): Promise<Ctx> {
  const owner = await ctxFor();
  const role = await db.role.findFirstOrThrow({ where: { tenantId: owner.tenantId, name: "Delivery" } });
  const u = await db.user.create({ data: { tenantId: owner.tenantId, name, phone, roleId: role.id } });
  return { ...owner, userId: u.id, userName: name, realRole: "Delivery", role: "Delivery", perms: [...role.permissions] };
}

/** Dispatches with SMS on the console provider and reads the delivery code from the message. */
async function dispatchWithCode(ctx: Ctx, id: string, riderId: string) {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  process.env.SMS_PROVIDER = "console";
  try {
    const r = await dispatchOrder(ctx, id, riderId);
    expect(r.channel).toBe("sms");
    const line = info.mock.calls.map((c) => String(c[0])).find((s) => s.startsWith("[sms]") && s.includes("Share code"))!;
    return /code (\d{4})/.exec(line)![1];
  } finally { delete process.env.SMS_PROVIDER; info.mockRestore(); }
}

describe("orders and home delivery", () => {
  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    med = await createMedicine(ctx, { name: "Pan 40", generic: "Pantoprazole", strength: "40 mg", form: "Tablet", manufacturer: "Alkem", pack: "15", mrp: "155", gstRate: 12, schedule: "", reorderLevel: 5, barcode: "", hsn: "3004", rack: "" });
    rxMed = await createMedicine(ctx, { name: "Azee 500", generic: "Azithromycin", strength: "500 mg", form: "Tablet", manufacturer: "Cipla", pack: "3", mrp: "120", gstRate: 12, schedule: "H", reorderLevel: 0, barcode: "", hsn: "3004", rack: "" });
    late = (await receiveBatch(ctx, { medicineId: med, batchNo: "LATE", expiry: addDays(todayISO(), 400), qty: 20, cost: "100", mrp: "155", supplierId: null, invoiceNo: "" })).batchId;
    early = (await receiveBatch(ctx, { medicineId: med, batchNo: "EARLY", expiry: addDays(todayISO(), 120), qty: 3, cost: "100", mrp: "155", supplierId: null, invoiceNo: "" })).batchId;
    await receiveBatch(ctx, { medicineId: rxMed, batchNo: "AZ1", expiry: addDays(todayISO(), 300), qty: 10, cost: "80", mrp: "120", supplierId: null, invoiceNo: "" });
    rider = await riderCtx("Ravi Rider", "9822000101");
    rider2 = await riderCtx("Other Rider", "9822000102");
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("takes a COD order, bills it at packing (FEFO), delivers with the code and settles the rider's cash", async () => {
    const cashier = await ctxFor("Cashier");
    await expect(createOrder(rider, { ...base, items: [{ medicineId: med, qty: 1 }] })).rejects.toThrow(/Create sales/);
    await expect(createOrder(cashier, { ...base, items: [{ medicineId: rxMed, qty: 1 }] })).rejects.toThrow(/prescriber/);
    const { id, no } = await createOrder(cashier, { ...base, notes: "Call first", prescriber: "Dr Mehta", items: [{ medicineId: med, qty: 5 }, { medicineId: rxMed, qty: 1 }] });
    expect(no).toMatch(/^ORD-\d{4}-00001$/);
    const cust = await db.customer.findFirstOrThrow({ where: { phone: base.phone } });
    expect(cust.name).toBe("Sunita Rao");
    const [o] = await listOrders(cashier);
    expect(o).toMatchObject({ status: "new", estimate: 5 * 15500 + 12000, items: expect.arrayContaining([expect.objectContaining({ medicineId: med, qty: 5, available: 23 })]) });

    await expect(packOrder(cashier, id)).rejects.toThrow(/is new/);
    expect((await confirmOrder(cashier, id)).channel).toBe("none");
    const sale = await packOrder(cashier, id);
    expect(sale.invoiceNo).toMatch(/-000001$/);
    expect([await qty(early), await qty(late)]).toEqual([0, 18]);
    const s = await db.sale.findUniqueOrThrow({ where: { id: sale.saleId }, include: { payments: true } });
    expect(s).toMatchObject({ payMode: "cod", customerId: cust.id, prescriber: "Dr Mehta" });
    expect(s.payments).toEqual([expect.objectContaining({ mode: "cod", amountPaise: BigInt(sale.total) })]);
    expect(await balance(ACC.codClearing)).toBe(sale.total);
    await expect(packOrder(cashier, id)).rejects.toThrow(/packed/);
    // The POS can't bill cash on delivery directly.
    await expect(commitSale(cashier, { idempotencyKey: key(), lines: [{ medicineId: med, batchId: late, qty: 1 }], customerId: null, discountPct: 0, pay: { mode: "cod" } })).rejects.toThrow(/Orders/);

    await expect(dispatchOrder(cashier, id, randomUUID())).rejects.toThrow(/delivery person/);
    const code = await dispatchWithCode(cashier, id, rider.userId);
    expect((await myDeliveries(rider)).open.map((x) => x.id)).toEqual([id]);
    expect((await myDeliveries(rider2)).open).toEqual([]);
    await expect(deliverOrder(rider2, id, { otp: code, collected: sale.total / 100 })).rejects.toThrow(/Refunds & voids/);
    await failedAttempt(rider, id, "Not at home");
    const wrong = code === "0000" ? "1111" : "0000";
    await expect(deliverOrder(rider, id, { otp: wrong, collected: sale.total / 100 })).rejects.toThrow(/Wrong code. 4 tries left/);
    await expect(deliverOrder(rider, id, { otp: code, collected: 10 })).rejects.toThrow(/Collect/);
    await deliverOrder(rider, id, { otp: code, collected: (sale.total / 100).toFixed(2), collectedMode: "cash" });
    const d = await db.deliveryOrder.findUniqueOrThrow({ where: { id } });
    expect(d).toMatchObject({ status: "delivered", proof: "otp", collectedMode: "cash", collectedPaise: BigInt(sale.total), otpHash: null, reason: null });
    expect((await myDeliveries(rider)).cashInHand).toBe(sale.total);
    expect((await db.deliveryEvent.findMany({ where: { orderId: id } })).map((e) => e.kind).sort()).toEqual(
      ["attempt_failed", "confirmed", "delivered", "new", "notified", "notified", "notified", "out_for_delivery", "packed"]);

    const mgr = await ctxFor("Manager");
    await openShift(mgr, "1000");
    const owed = await riderCash(mgr);
    expect(owed).toEqual([expect.objectContaining({ riderId: rider.userId, total: sale.total, orders: [expect.objectContaining({ id })] })]);
    const short = (sale.total - 1000) / 100;
    await expect(settleRider(mgr, rider.userId, String(short))).rejects.toThrow(/short/);
    const st = await settleRider(mgr, rider.userId, String(short), "Rider gave change");
    expect(st).toMatchObject({ expected: sale.total, counted: sale.total - 1000, diff: -1000, orders: 1 });
    expect(await balance(ACC.codClearing)).toBe(0);
    expect(await balance(ACC.cashDiff)).toBe(1000);
    expect((await currentShift(mgr)).open).toMatchObject({ cod: sale.total - 1000, expected: 100000 + sale.total - 1000 });
    expect(await riderCash(mgr)).toEqual([]);
    await expect(settleRider(mgr, rider.userId, "0")).rejects.toThrow(/no cash/);
    const rs = await db.riderSettlement.findFirstOrThrow();
    await expect(db.riderSettlement.update({ where: { id: rs.id }, data: { note: "x" } })).rejects.toThrow(/append-only/);
    await expect(db.deliveryEvent.deleteMany({ where: { orderId: id } })).rejects.toThrow(/append-only/);
    expect(await db.auditEvent.count({ where: { entity: "order", entityId: id } })).toBe(6);
  });

  it("prepaid orders bill to UPI; COD paid by UPI at the door goes straight to the bank", async () => {
    const cashier = await ctxFor("Cashier");
    const pre = await createOrder(cashier, { ...base, payMode: "prepaid", payRef: "UTR123", items: [{ medicineId: med, qty: 1 }] });
    await confirmOrder(cashier, pre.id);
    const s1 = await packOrder(cashier, pre.id);
    expect((await db.sale.findUniqueOrThrow({ where: { id: s1.saleId } })).payMode).toBe("upi");

    const cod = await createOrder(cashier, { ...base, items: [{ medicineId: med, qty: 2 }] });
    await confirmOrder(cashier, cod.id);
    const s2 = await packOrder(cashier, cod.id);
    await dispatchOrder(cashier, cod.id, rider.userId);
    const before = await balance(ACC.bank);
    await deliverOrder(rider, cod.id, { receivedBy: "Watchman", collected: s2.total / 100, collectedMode: "upi" });
    expect(await balance(ACC.bank) - before).toBe(s2.total);
    expect(await balance(ACC.codClearing)).toBe(0);
    expect(await db.deliveryOrder.findUniqueOrThrow({ where: { id: cod.id } })).toMatchObject({ proof: "signature", receivedBy: "Watchman", collectedMode: "upi" });
    expect(await riderCash(cashier)).toEqual([]);
  });

  it("returns and cancellations reverse the bill and put stock back", async () => {
    const cashier = await ctxFor("Cashier"), mgr = await ctxFor("Manager");
    const a = await createOrder(cashier, { ...base, items: [{ medicineId: med, qty: 2 }] });
    await confirmOrder(cashier, a.id);
    const s = await packOrder(cashier, a.id);
    const stock = await qty(late);
    await dispatchOrder(cashier, a.id, rider.userId);
    await expect(returnOrder(cashier, a.id, "Not at home")).rejects.toThrow(/Refunds & voids/);
    expect((await returnOrder(mgr, a.id, "Not at home twice")).undo).toBe(`voided ${s.invoiceNo}`);
    expect(await qty(late)).toBe(stock + 2);
    expect(await db.saleVoid.count({ where: { saleId: s.saleId } })).toBe(1);
    expect(await balance(ACC.codClearing)).toBe(0);
    expect((await db.deliveryOrder.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("returned");

    const b = await createOrder(cashier, { ...base, items: [{ medicineId: med, qty: 1 }] });
    await expect(cancelOrder(cashier, b.id, "x")).rejects.toThrow(/reason/);
    await cancelOrder(cashier, b.id, "Customer cancelled");
    await expect(confirmOrder(cashier, b.id)).rejects.toThrow(/cancelled/);

    const c = await createOrder(cashier, { ...base, items: [{ medicineId: med, qty: 1 }] });
    await confirmOrder(cashier, c.id);
    await packOrder(cashier, c.id);
    await expect(cancelOrder(cashier, c.id, "Changed mind")).rejects.toThrow(/Refunds & voids/);
    expect((await cancelOrder(mgr, c.id, "Changed mind")).undo).toMatch(/^voided/);

    // Older bills come back on a credit note; undelivered cash on delivery comes off the delivery staff's balance.
    const d = await createOrder(cashier, { ...base, items: [{ medicineId: med, qty: 1 }] });
    await confirmOrder(cashier, d.id);
    const sd = await packOrder(cashier, d.id);
    const item = await db.saleItem.findFirstOrThrow({ where: { saleId: sd.saleId } });
    const cn = await processReturn(mgr, { saleId: sd.saleId, lines: [{ itemId: item.id, qty: 1 }], condition: "sealed", refundMode: "Cash", reason: "Order came back" }, { codUncollected: true });
    expect(cn.mode).toBe("COD not collected");
    expect(await balance(ACC.codClearing)).toBe(0);
  });

  it("sends order updates on WhatsApp with an approved template when the customer agreed", async () => {
    const owner = await ctxFor();
    await db.integration.create({ data: { tenantId: owner.tenantId, kind: "whatsapp", connectedAt: new Date(), encryptedSecret: new Uint8Array(seal(JSON.stringify({ token: "t".repeat(40), appSecret: "a".repeat(32) }))),
      config: { wabaId: "123456789", phoneNumberId: "987654321", displayPhone: "+91", verifyToken: "v", webhookVerified: true, invoiceTemplate: "invoice_share", templateLang: "en", templates: [{ name: "order_confirmed", language: "en", status: "approved", category: "utility", params: 3 }] } } });
    const bodies: { to: string; template: { name: string; components: { parameters: { text: string }[] }[] } }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => { bodies.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 }); }));
    const o = await createOrder(owner, { ...base, source: "whatsapp", phone: "9822033344", name: "Asha Kulkarni", waConsent: true, items: [{ medicineId: med, qty: 1 }] });
    expect((await confirmOrder(owner, o.id)).channel).toBe("whatsapp");
    expect(bodies[0]).toMatchObject({ to: "919822033344", template: { name: "order_confirmed" } });
    expect(bodies[0].template.components[0].parameters.map((p) => p.text).slice(0, 2)).toEqual(["Asha", o.no]);
    expect(await db.waMessage.count({ where: { invoiceId: "order:" + o.id, status: "sent" } })).toBe(1);
    expect((await db.customer.findFirstOrThrow({ where: { phone: "9822033344" } })).waOptIn).toBe(true);
    await cancelOrder(owner, o.id, "Test over");
  });

  it("owner view: today vs yesterday, drawers, approvals and backup; needs the reports permission", async () => {
    await expect(ownerSnapshot(await ctxFor("Cashier"))).rejects.toThrow(/Accounting & reports/);
    const s = await ownerSnapshot(await ctxFor());
    expect(s.total.today).toBeGreaterThan(0);
    expect(s.branches.map((b) => b.name)).toEqual(["Main", "Second"]);
    expect(s.drawers).toEqual([expect.objectContaining({ branch: "Main", counter: "Browser counter" })]);
    expect(s.branches.map((b) => b.low)).toEqual([0, 1]);
    expect(s.backup).toMatchObject({ healthy: false, lastOk: null });
    expect(s.pending).toMatchObject({ newOrders: 0, codWithRiders: 0 });
  });

  it("emails scheduled reports with CSV attachments once a day and honours unsubscribe links", async () => {
    const owner = await ctxFor();
    await expect(saveReportMail(await ctxFor("Manager"), { enabled: true, frequency: "daily", weekday: 1, time: "08:00", recipients: ["a@x.in"], reports: ["sales"] })).rejects.toThrow(/Manage users/);
    await expect(saveReportMail(owner, { enabled: true, frequency: "daily", weekday: 1, time: "08:00", recipients: [], reports: ["sales"] })).rejects.toThrow(/email address/);
    await saveReportMail(owner, { enabled: true, frequency: "daily", weekday: 1, time: "00:00", recipients: ["Owner@Test.in", "ca@test.in"], reports: ["sales", "gst", "low-stock", "expiring", "dues"] });

    const tomorrow = new Date(Date.now() + 86400_000);
    const m = await buildReportMail(owner.tenantId, { frequency: "daily", reports: ["sales", "gst", "low-stock", "expiring", "dues"] }, tomorrow);
    expect(m.attachments.map((a) => a.filename.replace(/-\d{4}-\d{2}-\d{2}\.csv$/, ""))).toEqual(["sales-summary", "gst-summary", "low-stock", "expiring-stock", "customer-dues", "supplier-dues"]);
    const sales = String(m.attachments[0].content);
    expect(sales).toContain("Cash on delivery");
    expect(sales).toContain(`${todayISO()},Main,`);
    expect(m.body).toMatch(/Net sales: ₹[\d,]+ from \d+ bills/);

    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    process.env.MAIL_PROVIDER = "console"; process.env.APP_URL = "https://pharmacy.example.in";
    try {
      const r = await sendReportMail(owner.tenantId, owner);
      expect(r).toMatchObject({ ok: true });
      expect(info.mock.calls.filter((c) => String(c[0]).startsWith("[mail] to "))).toHaveLength(2);
      expect(String(info.mock.calls[0][0])).toContain("/api/report-mail/unsubscribe?t=");
      expect(String(info.mock.calls[0][0])).toContain("[attachments] sales-summary-");

      await reportMailTick(new Date(), {});
      await reportMailTick(new Date(), {});
      expect(await db.auditEvent.count({ where: { action: "Scheduled reports emailed", userName: "Scheduler" } })).toBe(1);
    } finally { delete process.env.MAIL_PROVIDER; delete process.env.APP_URL; info.mockRestore(); }

    expect(await unsubscribe(owner.tenantId, "ca@test.in", "x".repeat(32))).toBe(false);
    expect(await unsubscribe(owner.tenantId, "ca@test.in", unsubSig(owner.tenantId, "ca@test.in"))).toBe(true);
    const t = await db.tenant.findUniqueOrThrow({ where: { id: owner.tenantId } });
    expect((t.settings as { reportMail: { recipients: string[] } }).reportMail.recipients).toEqual(["owner@test.in"]);
    expect(await db.auditEvent.count({ where: { action: "Scheduled report emails unsubscribed" } })).toBe(1);
  });

  it("a Schedule H1 order needs the prescriber's registration no. and bills the H1 register entry", async () => {
    const owner = await ctxFor(), cashier = await ctxFor("Cashier");
    const h1 = await createMedicine(owner, { name: "Augmentin 625", generic: "Amoxicillin + Clavulanate", strength: "625 mg", form: "Tablet", manufacturer: "GSK", pack: "10", mrp: "220", gstRate: 12, schedule: "H1", reorderLevel: 0, barcode: "", hsn: "3004", rack: "" });
    await receiveBatch(owner, { medicineId: h1, batchNo: "AG1", expiry: addDays(todayISO(), 300), qty: 5, cost: "150", mrp: "220", supplierId: null, invoiceNo: "" });
    const order = { ...base, name: "Meena Kulkarni", phone: "9822011199", payMode: "prepaid" as const, payRef: "UTR1", prescriber: "Dr Rao", items: [{ medicineId: h1, qty: 1 }] };
    await expect(createOrder(cashier, order)).rejects.toThrow(/registration no\./);
    const { id } = await createOrder(cashier, { ...order, prescriberReg: "MMC-4411" });
    await confirmOrder(cashier, id);
    const sale = await packOrder(cashier, id);
    expect(await db.sale.findUniqueOrThrow({ where: { id: sale.saleId } })).toMatchObject({ patientName: "Meena Kulkarni", prescriberReg: "MMC-4411", prescriber: "Dr Rao" });
  });
});

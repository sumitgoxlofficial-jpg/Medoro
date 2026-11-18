import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { resetDb } from "./helpers";
import { distCtx, key, makeDistributor, seedBasics } from "./dist-helpers";
import { directInvoice, invoiceView } from "@/domain/distribution/billing";
import { createReturn, expiryWorkbench, raiseDistClaim, claimReconciliation } from "@/domain/distribution/returns";
import { acknowledgeClaim, creditClaim } from "@/domain/inventory/claims";
import { createDispatch, recordDelivery, startDispatch, collectPayment } from "@/domain/distribution/dispatch";
import { receivables, chemistStatement } from "@/domain/distribution/receivables";
import { distGstr1, distGstr3b } from "@/domain/distribution/gst";
import { distReport, DIST_REPORTS, distDashboard } from "@/domain/distribution/reports";
import { askAssistant, purchaseRecommendations, draftPurchaseOrders, deadStock } from "@/domain/distribution/intelligence";
import { approveConnection, portalCatalogue, portalPlaceOrder, portalOrders, portalAccountSummary, portalInvoice, requestConnection, portalLink, savePortalSettings } from "@/domain/distribution/portal";
import { approveOrder, placeOrder, listOrders } from "@/domain/distribution/orders";
import { customerBalance } from "@/domain/parties/balances";
import { listChemists, saveChemist } from "@/domain/distribution/masters";
import { addDays, todayISO, dateOnly } from "@/lib/dates";
import { hashPassword } from "@/server/auth";

beforeEach(async () => { await resetDb(); await makeDistributor(); });

describe("returns and expiry claims", () => {
  it("credit note: saleable back to stock, expired to quarantine, GST reduced, then claimed on the principal and credited", async () => {
    const ctx = await distCtx();
    const { medicineId, customerId } = await seedBasics(ctx);
    const inv = await directInvoice(ctx, { customerId, idempotencyKey: key(), lines: [{ medicineId, qty: 10 }] });
    const v = (await invoiceView(ctx.tenantId, inv.invoiceId))!;
    const line = v.lines[0];
    const r = await createReturn(ctx, { invoiceId: inv.invoiceId, reason: "Excess and broken strips", lines: [{ invoiceLineId: line.id, qty: 3, condition: "saleable" }] });
    expect(r.total).toBe(3 * 5000 + 3 * 600); // ₹150 + 12% GST
    expect(await customerBalance(db, ctx.tenantId, customerId)).toBe(56000 - 16800);
    await createReturn(ctx, { invoiceId: inv.invoiceId, reason: "Breakage in transit", lines: [{ invoiceLineId: line.id, qty: 2, condition: "damaged", creditPct: 50 }] });
    await expect(createReturn(ctx, { invoiceId: inv.invoiceId, reason: "too many", lines: [{ invoiceLineId: line.id, qty: 6, condition: "saleable" }] })).rejects.toThrow(/5 can still be returned/);
    const b = await db.batch.findFirstOrThrow({ where: { medicineId } });
    expect(b.qtyAvailable).toBe(93);
    expect(b.qtyQuarantined).toBe(2);
    // Claim the damaged packs on the principal (breakage is always eligible).
    const c = await raiseDistClaim(ctx, { batchId: b.id, qty: 2, reason: "breakage" });
    expect((await db.batch.findFirstOrThrow({ where: { id: b.id } })).qtyQuarantined).toBe(0);
    expect(c.expected).toBe(Math.round(c.value * 0.8));
    // Near-expiry claims respect the principal's window (90 days): a 400-day batch isn't eligible.
    await expect(raiseDistClaim(ctx, { batchId: b.id, qty: 1, reason: "near_expiry" })).rejects.toThrow(/Returns open 90 days before expiry/);
    await acknowledgeClaim(ctx, c.claimId);
    await creditClaim(ctx, c.claimId, { ref: "CN-778", amount: (c.expected / 100).toFixed(2), close: true, reason: "Company pays 80% on breakage" });
    const rec = await claimReconciliation(ctx);
    expect(rec.suppliers[0]).toMatchObject({ claims: 1, credited: c.expected, open: 0 });
    // GSTR-1 shows the invoice and both credit notes.
    const g = await distGstr1(ctx, "27AAKFS3192P1Z6");
    expect(g.docs.filter((d) => d.kind === "inv")).toHaveLength(1);
    expect(g.docs.filter((d) => d.kind === "cn")).toHaveLength(2);
    expect(g.json.b2cs?.length ?? 0).toBeGreaterThan(0);
    const g3 = await distGstr3b(ctx, "27AAKFS3192P1Z6");
    expect(g3.itc.cgst).toBeGreaterThan(0);
  });

  it("expiry workbench flags eligible near-expiry stock with expected credit", async () => {
    const ctx = await distCtx();
    await seedBasics(ctx, { batches: [{ no: "SOON", expiryDays: 45, qty: 10 }, { no: "LATER", expiryDays: 150, qty: 10 }] });
    const w = await expiryWorkbench(ctx);
    expect(w.find((x) => x.batchNo === "SOON")).toMatchObject({ band: "60", eligible: true, expectedCredit: 32000 }); // 10 × ₹40 × 80%
    expect(w.find((x) => x.batchNo === "LATER")?.eligible).toBe(false);
  });
});

describe("dispatch, delivery and collection", () => {
  it("dispatches, delivers with POD, collects cash at the door and closes the trip", async () => {
    const ctx = await distCtx();
    const { medicineId, customerId } = await seedBasics(ctx);
    const inv = await directInvoice(ctx, { customerId, idempotencyKey: key(), lines: [{ medicineId, qty: 10 }] });
    const d = await createDispatch(ctx, { vehicleNo: "MH12AB1234", driverName: "Ramesh", route: "Kothrud", invoiceIds: [inv.invoiceId] });
    await expect(createDispatch(ctx, { invoiceIds: [inv.invoiceId] })).rejects.toThrow(/already/);
    await startDispatch(ctx, d.dispatchId);
    const del = await db.distDelivery.findFirstOrThrow({ where: { invoiceId: inv.invoiceId } });
    await expect(recordDelivery(ctx, del.id, { outcome: "delivered" })).rejects.toThrow(/who received/);
    const r = await recordDelivery(ctx, del.id, { outcome: "delivered", receiverName: "Sai (owner)", collected: "300", mode: "Cash" });
    expect(r.receiptNo).toMatch(/^RV-/);
    expect(await customerBalance(db, ctx.tenantId, customerId)).toBe(56000 - 30000);
    expect((await db.distDispatch.findUniqueOrThrow({ where: { id: d.dispatchId } })).status).toBe("closed");
    // Office collection for the rest, then the statement balances to zero.
    await collectPayment(ctx, { customerId, amount: "260", method: "UPI", ref: "UTR123" });
    const st = await chemistStatement(ctx, customerId);
    expect(st.closing).toBe(0);
    await expect(collectPayment(ctx, { customerId, amount: "1", method: "Cash" })).rejects.toThrow(/exceeds/);
  });
});

describe("receivables, reports and intelligence", () => {
  it("ages outstanding FIFO and produces every MIS report", async () => {
    const ctx = await distCtx();
    const { medicineId, customerId } = await seedBasics(ctx);
    await directInvoice(ctx, { customerId, idempotencyKey: key(), lines: [{ medicineId, qty: 10 }] });
    await directInvoice(ctx, { customerId, idempotencyKey: key(), lines: [{ medicineId, qty: 5 }] });
    await collectPayment(ctx, { customerId, amount: "100", method: "Cash" });
    const r = (await receivables(ctx)).find((x) => x.customerId === customerId)!;
    expect(r.balance).toBe(56000 + 28000 - 10000);
    expect(r.open.map((b) => b.open)).toEqual([46000, 28000]);
    for (const [id] of DIST_REPORTS) {
      const rep = await distReport(ctx, id);
      expect(rep.columns.length).toBeGreaterThan(1);
    }
    const sales = await distReport(ctx, "sales-product");
    expect(sales.rows[0]).toEqual(["Amoxyclav 625", 15, 0, 750, 600, 150, 20]);
    const dash = await distDashboard(ctx);
    expect(dash.today.invoices).toBe(2);
    expect(dash.receivable.total).toBe(74000);
    const a = await askAssistant(ctx, "who owes us money?");
    expect(a.answer).toMatch(/outstanding from 1 chemists/);
    expect((await deadStock(ctx)).length).toBe(0);
  });

  it("suggests reorders from sales pace and only drafts POs (never places them)", async () => {
    const ctx = await distCtx();
    const { medicineId, customerId } = await seedBasics(ctx, { qty: 30 });
    await db.medicine.update({ where: { id: medicineId }, data: { reorderLevel: 50 } });
    await directInvoice(ctx, { customerId, idempotencyKey: key(), lines: [{ medicineId, qty: 10 }] });
    const recs = await purchaseRecommendations(ctx);
    expect(recs[0]).toMatchObject({ medicineId, onHand: 20 });
    expect(recs[0].packs).toBeGreaterThanOrEqual(30);
    const pos = await draftPurchaseOrders(ctx, [medicineId]);
    const po = await db.purchaseOrder.findFirstOrThrow({ where: { no: pos[0] } });
    expect(po.status).toBe("draft");
    expect(po.source).toBe("ai");
    const sales = await distCtx("DISTA-PUNE", "Salesman");
    await expect(draftPurchaseOrders(sales, [medicineId])).rejects.toThrow(/Purchases/);
  });
});

describe("chemist portal", () => {
  async function account(phone = "9876500001", email = "sai@chem.in") {
    return db.distChemistAccount.create({ data: { firmName: "Sai Chemists", ownerName: "Sai", email, phone, passwordHash: await hashPassword("long-enough-pw"), dl20b: "MH-PZ-20B-777", dl21b: "MH-PZ-21B-777", dlExpiry: dateOnly(addDays(todayISO(), 300)), address: "Shop 4, Kothrud", pincode: "411038", stateCode: "27", consentAt: new Date(), consentVersion: "2026-11" } });
  }

  it("connect → approve → browse with hidden stock → order → distributor approves → chemist sees only own records", async () => {
    const ctx = await distCtx();
    const { medicineId } = await seedBasics(ctx);
    const acc = await account();
    await expect(portalLink(acc, "DISTA-PUNE")).rejects.toThrow(/isn’t approved/);
    await requestConnection(acc, "DISTA-PUNE", true);
    const conn = await db.distConnection.findFirstOrThrow({ where: { accountId: acc.id } });
    const cid = await approveConnection(ctx, conn.id, { creditLimit: "5000", creditDays: 15 });
    const cat = await portalCatalogue(acc, "DISTA-PUNE");
    expect(cat[0]).toMatchObject({ name: "Amoxyclav 625", rate: 5000, stock: { label: "In stock", packs: null } });
    await savePortalSettings(ctx, { stock: "none", showMrp: false });
    const cat2 = await portalCatalogue(acc, "DISTA-PUNE");
    expect(cat2[0]).toMatchObject({ mrp: null, stock: { packs: null, label: "Ask distributor" } });
    const k = key();
    const o = await portalPlaceOrder(acc, "DISTA-PUNE", [{ medicineId, qty: 4 }], "urgent", k);
    expect((await portalPlaceOrder(acc, "DISTA-PUNE", [{ medicineId, qty: 4 }], "urgent", k)).replayed).toBe(true);
    const ord = await db.distOrder.findUniqueOrThrow({ where: { id: o.orderId } });
    expect(ord).toMatchObject({ source: "portal", placedByType: "chemist", customerId: cid });
    await approveOrder(ctx, o.orderId);
    expect((await portalOrders(acc, "DISTA-PUNE"))[0].status).toBe("approved");
    // Another chemist's invoice is invisible even with its id.
    const other = await saveChemist(ctx, null, { name: "Other Med", dl20b: "MH-PZ-20B-900", dl21b: "MH-PZ-21B-900", dlExpiry: addDays(todayISO(), 200), creditLimit: "10000" });
    const theirs = await directInvoice(ctx, { customerId: other, idempotencyKey: key(), lines: [{ medicineId, qty: 1 }] });
    await expect(portalInvoice(acc, "DISTA-PUNE", theirs.invoiceId)).rejects.toThrow(/not found/);
    const sum = await portalAccountSummary(acc, "DISTA-PUNE");
    expect(sum.invoices).toHaveLength(0);
    // Hidden products can't be ordered through the portal.
    await db.distProduct.update({ where: { medicineId }, data: { portalVisible: false } });
    await expect(portalPlaceOrder(acc, "DISTA-PUNE", [{ medicineId, qty: 1 }], "", key())).rejects.toThrow(/no longer offered/);
  });
});

describe("tenant isolation and permission boundaries", () => {
  it("one distributor can't read or act on another's records", async () => {
    await makeDistributor("DISTB-PUNE", "owner@dist-b.in", "9822000202");
    const a = await distCtx("DISTA-PUNE"), b = await distCtx("DISTB-PUNE");
    const { medicineId, customerId } = await seedBasics(a);
    const inv = await directInvoice(a, { customerId, idempotencyKey: key(), lines: [{ medicineId, qty: 1 }] });
    expect(await invoiceView(b.tenantId, inv.invoiceId)).toBeNull();
    await expect(directInvoice(b, { customerId, idempotencyKey: key(), lines: [{ medicineId, qty: 1 }] })).rejects.toThrow(/not found/);
    await expect(placeOrder({ kind: "user", ctx: b }, { customerId, idempotencyKey: key(), lines: [{ medicineId, qty: 1 }] })).rejects.toThrow();
    expect(await listChemists(b)).toHaveLength(0);
    expect(await listOrders(b, { status: "all" })).toHaveLength(0);
    await expect(createReturn(b, { invoiceId: inv.invoiceId, reason: "steal", lines: [{ invoiceLineId: (await db.distInvoiceLine.findFirstOrThrow()).id, qty: 1, condition: "saleable" }] })).rejects.toThrow(/not found/);
  });

  it("roles are limited to their duties", async () => {
    const owner = await distCtx();
    const { medicineId, customerId } = await seedBasics(owner);
    const wh = await distCtx("DISTA-PUNE", "Warehouse"), del = await distCtx("DISTA-PUNE", "Delivery"), acct = await distCtx("DISTA-PUNE", "Accountant");
    await expect(directInvoice(wh, { customerId, idempotencyKey: key(), lines: [{ medicineId, qty: 1 }] })).rejects.toThrow(/Invoices/);
    await expect(placeOrder({ kind: "user", ctx: del }, { customerId, idempotencyKey: key(), lines: [{ medicineId, qty: 1 }] })).rejects.toThrow(/Book orders/);
    await expect(saveChemist(acct, null, { name: "X Med", dl20b: "MH-PZ-20B-1", dl21b: "MH-PZ-21B-1", dlExpiry: addDays(todayISO(), 10) })).rejects.toThrow(/Masters/);
    // Read-only support can't change anything.
    await expect(directInvoice({ ...owner, readOnly: true }, { customerId, idempotencyKey: key(), lines: [{ medicineId, qty: 1 }] })).rejects.toThrow(/read-only/);
    // A lapsed subscription stops billing but not viewing.
    await expect(directInvoice({ ...owner, locked: true }, { customerId, idempotencyKey: key(), lines: [{ medicineId, qty: 1 }] })).rejects.toThrow(/Subscription expired/);
    expect(await receivables({ ...owner, locked: true })).toBeDefined();
  });

  it("a salesman books only for assigned chemists", async () => {
    const owner = await distCtx();
    const { medicineId, customerId } = await seedBasics(owner);
    const sales = await distCtx("DISTA-PUNE", "Salesman");
    await db.distSalesman.create({ data: { tenantId: owner.tenantId, code: "S1", name: "Vijay", userId: sales.userId } });
    await expect(placeOrder({ kind: "user", ctx: sales }, { customerId, idempotencyKey: key(), lines: [{ medicineId, qty: 1 }] })).rejects.toThrow(/isn’t assigned to you/);
    const sm = await db.distSalesman.findFirstOrThrow();
    await db.distChemist.update({ where: { customerId }, data: { salesmanId: sm.id } });
    const o = await placeOrder({ kind: "user", ctx: sales }, { customerId, idempotencyKey: key(), lines: [{ medicineId, qty: 1 }] });
    expect((await db.distOrder.findUniqueOrThrow({ where: { id: o.orderId } })).salesmanId).toBe(sm.id);
  });
});

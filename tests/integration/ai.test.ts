import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { adjustStock } from "@/domain/inventory/adjust";
import { commitSale } from "@/domain/sales/service";
import { openShift, processReturn } from "@/domain/sales/returns";
import { saveCustomer, saveSupplier } from "@/domain/parties/service";
import { savePrivacy } from "@/domain/system/privacy";
import { saveAiSettings } from "@/domain/ai/settings";
import { takeAiAsk } from "@/domain/ai/ratelimit";
import { postGrnTx } from "@/domain/purchasing/service";
import { ask, cancel, confirm } from "@/domain/ai/service";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

/** Model and limit settings come from the environment; each test starts from rules-only defaults. */
const clean = () => { for (const k of Object.keys(process.env)) if (/^(AI_|LOCAL_LLM|REMOTE_AI)/.test(k)) delete process.env[k]; process.env.AI_RATE_PER_MIN = "10000"; };
let supId = "", doloId = "";

describe("AI assistant", () => {
  afterEach(() => { vi.unstubAllGlobals(); clean(); });
  beforeAll(async () => {
    clean();
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    const sup = supId = await saveSupplier(ctx, null, { name: "Mahavir", creditDays: "30" });
    const base = { form: "Tablet" as const, manufacturer: "Micro Labs", pack: "15", schedule: "" as const, barcode: "", hsn: "3004", rack: "" };
    const dolo = doloId = await createMedicine(ctx, { ...base, name: "Dolo 650", generic: "Paracetamol", strength: "650 mg", mrp: "33.60", gstRate: 12, reorderLevel: 10 });
    // 2 in stock, reorder level 10 → needs reordering
    await postGrnTx(ctx, { supplierId: sup, invoiceNo: "MMA/1", invoiceDate: todayISO(), poId: null, scanDocId: null, statedTotal: "53.76", lines: [{ medicineId: dolo, batchNo: "DL1", expiry: addDays(todayISO(), 400).slice(0, 7), qty: 2, freeQty: 0, rate: "24", mrp: "33.60", poItemId: null }] });
  });

  it("answers read questions from the same services as the screens", async () => {
    const ctx = await ctxFor();
    const r = await ask(ctx, "What should I reorder?");
    expect(r.tool).toBe("get_low_stock_report");
    expect(r.rows?.[0].a).toBe("Dolo 650");
    expect((await ask(ctx, "stock of dolo")).rows?.[0].c).toMatch(/^2 in stock/);
    expect((await ask(ctx, "Aaj ki sale kitni hai?")).text).toMatch(/0 bills/);
    expect(await ask(ctx, "what dose of dolo for a child?")).toMatchObject({ refused: true });
  });

  it("hides money tools from roles without access", async () => {
    const r = await ask(await ctxFor("Cashier"), "Supplier payments due");
    expect(r).toMatchObject({ refused: true });
    expect(r.rows).toBeUndefined();
    expect(await db.auditEvent.findFirst({ where: { action: "AI request refused", entityId: r.tool } })).toMatchObject({ detail: expect.stringMatching(/role Cashier/) });
  });

  it("write tools preview first; the token is single-use and bound to the user", async () => {
    const ctx = await ctxFor();
    const p = await ask(ctx, "Prepare a purchase order for review");
    expect(p.confirm?.token).toBeTruthy();
    expect(await db.purchaseOrder.count()).toBe(0);
    await expect(confirm({ ...ctx, userId: "someone-else" }, p.confirm!.token)).rejects.toThrow(/isn’t valid/);
    const done = await confirm(ctx, p.confirm!.token);
    expect(done.text).toMatch(/PO-\d{4}-0001 saved as draft/);
    const po = await db.purchaseOrder.findFirstOrThrow({ include: { items: true } });
    expect(po).toMatchObject({ status: "draft", source: "ai" });
    expect(po.items[0].qty).toBeGreaterThanOrEqual(8);
    await expect(confirm(ctx, p.confirm!.token)).rejects.toThrow(/already confirmed/);
    expect(await db.auditEvent.count({ where: { action: "AI action confirmed" } })).toBe(1);
  });

  it("expired, cancelled and tampered tokens do nothing", async () => {
    const ctx = await ctxFor();
    const a = await ask(ctx, "draft po");
    await db.aiConfirmation.update({ where: { token: a.confirm!.token }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(confirm(ctx, a.confirm!.token)).rejects.toThrow(/expired/);
    const b = await ask(ctx, "draft po");
    await cancel(ctx, b.confirm!.token);
    await expect(confirm(ctx, b.confirm!.token)).rejects.toThrow(/already confirmed or cancelled/);
    const c = await ask(ctx, "draft po");
    await db.aiConfirmation.update({ where: { token: c.confirm!.token }, data: { input: { lines: [] } } });
    await expect(confirm(ctx, c.confirm!.token)).rejects.toThrow(/altered/);
    expect(await db.purchaseOrder.count()).toBe(1);
  });

  it("roles without aiAct can't create or confirm actions", async () => {
    const r = await ask(await ctxFor("Pharmacist"), "Prepare a purchase order for review");
    expect(r).toMatchObject({ refused: true });
    expect(r.confirm).toBeUndefined();
  });

  it("batch inventory: per branch, earliest expiry first, with status", async () => {
    const ctx = await ctxFor();
    const r = await ask(ctx, "Show batches of dolo");
    expect(r.tool).toBe("get_batch_inventory");
    expect(r.rows?.[0]).toMatchObject({ a: "Dolo 650 650 mg", b: expect.stringMatching(/^DL1 · exp/), c: "2 · Sellable" });
    expect((await ask(ctx, "batches of dolo at Second branch")).text).toMatch(/No stock of “dolo” at Second/);
    await expect(ask(ctx, "batches of dolo at Mars branch")).rejects.toThrow(/branch called “mars”/);
  });

  it("generate_report links to the CSV export and honours report permissions", async () => {
    const ctx = await ctxFor();
    const r = await ask(ctx, "GST report last month");
    expect(r).toMatchObject({ tool: "generate_report", link: { href: "/api/reports/gst-summary?period=last" } });
    expect((await ask(ctx, "sales register for all branches csv")).link?.href).toBe("/api/reports/sales-register?period=month&scope=all");
    expect((await ask(ctx, "customer dues report for all branches")).link?.href).toBe("/api/reports/customer-dues?period=month");
    const no = await ask(await ctxFor("Cashier"), "GST report last month");
    expect(no).toMatchObject({ refused: true });
    expect(no.link).toBeUndefined();
  });

  it("records an expense after confirmation, only for roles with payments", async () => {
    const ctx = await ctxFor();
    const p = await ask(ctx, "Record expense ₹1,250 electricity by UPI");
    expect(p).toMatchObject({ tool: "create_draft_expense", confirm: { label: "Record expense" } });
    expect(await db.voucher.count({ where: { refType: "expense" } })).toBe(0);
    expect((await confirm(ctx, p.confirm!.token)).text).toMatch(/recorded: ₹1,250\.00 under Electricity, paid by UPI/);
    const v = await db.voucher.findFirstOrThrow({ where: { refType: "expense" }, include: { lines: true } });
    expect(v.lines.find((l) => l.account === "Electricity")?.debitPaise).toBe(125000n);
    expect(await ask(await ctxFor("Pharmacist"), "Record expense ₹100 tea")).toMatchObject({ refused: true });
    expect(await db.auditEvent.count({ where: { action: "AI action proposed", entityId: "create_draft_expense" } })).toBe(1);
  });

  it("starts a backup after confirmation; integrations permission required", async () => {
    const ctx = await ctxFor();
    expect(await ask(await ctxFor("Manager"), "Take a backup now")).toMatchObject({ refused: true });
    const p = await ask(ctx, "backup le lo");
    expect(p).toMatchObject({ tool: "request_backup", confirm: { label: "Back up now" } });
    expect((await confirm(ctx, p.confirm!.token)).text).toMatch(/Backup verified/);
    expect(await db.backupManifest.findFirst({ where: { kind: "manual" } })).toMatchObject({ status: "verified" });
  });

  it("stock adjustment needs a reason and re-checks the batch quantity at confirm", async () => {
    const ctx = await ctxFor();
    await expect(ask(ctx, "adjust dolo batch DL1 by -1")).rejects.toThrow(/reason/);
    const a = await ask(ctx, "Adjust Dolo 650 batch DL1 by -1 reason damaged strip");
    expect(a).toMatchObject({ tool: "request_stock_adjustment", confirm: { label: "Adjust stock" } });
    expect(a.rows?.[0].c).toBe("2 → 1");
    const batch = await db.batch.findFirstOrThrow({ where: { batchNo: "DL1" } });
    await adjustStock(ctx, batch.id, 3, "found in store");
    await expect(confirm(ctx, a.confirm!.token)).rejects.toThrow(/changed since the preview \(2 → 5\)/);
    expect(await db.auditEvent.findFirst({ where: { action: "AI action refused at confirm", entityId: "request_stock_adjustment" } })).toBeTruthy();
    await expect(confirm(ctx, a.confirm!.token)).rejects.toThrow(/already confirmed/);
    const b = await ask(ctx, "dolo batch DL1 ka stock 1 kam karo kyunki strip toot gayi");
    expect((await confirm(ctx, b.confirm!.token)).text).toMatch(/^SA-\d{4}-\d+ posted/);
    expect((await db.batch.findUniqueOrThrow({ where: { id: batch.id } })).qtyAvailable).toBe(4);
    expect(await ask(await ctxFor("Cashier"), "Adjust Dolo 650 batch DL1 by -1 reason recount")).toMatchObject({ refused: true });
  });

  it("refunds against an invoice, re-checking returnable quantities at confirm", async () => {
    const ctx = await ctxFor();
    const med = await createMedicine(ctx, { name: "Pan 40", generic: "Pantoprazole", strength: "40 mg", form: "Tablet", manufacturer: "Alkem", pack: "15", mrp: "155", gstRate: 12, schedule: "", reorderLevel: 0, barcode: "", hsn: "3004", rack: "" });
    await receiveBatch(ctx, { medicineId: med, batchNo: "PN1", expiry: addDays(todayISO(), 300), qty: 20, cost: "100", mrp: "155", supplierId: null, invoiceNo: "" });
    const pn = await db.batch.findFirstOrThrow({ where: { batchNo: "PN1" } });
    await openShift(ctx, "1000");
    const sale = await commitSale(ctx, { idempotencyKey: "k_" + randomUUID().replace(/-/g, ""), lines: [{ medicineId: med, batchId: pn.id, qty: 4 }], customerId: null, discountPct: 0, pay: { mode: "cash" } });
    await expect(ask(ctx, `Refund invoice ${sale.invoiceNo}`)).rejects.toThrow(/reason/);
    const ask2 = () => ask(ctx, `return 2 pan 40 from invoice ${sale.invoiceNo} sealed reason wrong strength`);
    const p = await ask2();
    expect(p).toMatchObject({ tool: "request_refund", confirm: { label: "Issue refund" } });
    expect(p.rows?.[0].b).toBe("PN1 · 2 of 4");
    const item = await db.saleItem.findFirstOrThrow({ where: { saleId: sale.saleId } });
    await processReturn(ctx, { saleId: sale.saleId, lines: [{ itemId: item.id, qty: 1 }], condition: "damaged", refundMode: "Cash", reason: "counter return" });
    await expect(confirm(ctx, p.confirm!.token)).rejects.toThrow(/changed since the preview/);
    const done = await confirm(ctx, (await ask2()).confirm!.token);
    expect(done.text).toMatch(/Credit note CN-\d{4}-\d+ issued: ₹310\.00 refunded as Cash/);
    expect((await db.batch.findUniqueOrThrow({ where: { id: pn.id } })).qtyAvailable).toBe(18);
    const n = sale.invoiceNo.split(/[/-]/).pop()!.replace(/^0+/, "");
    expect((await ask(ctx, `bill ${n} ka refund karo, wajah customer ne mana kiya`)).rows?.[0].b).toBe("PN1 · 1 of 1");
    expect(await ask(await ctxFor("Cashier"), `return 1 pan 40 from invoice ${sale.invoiceNo} reason test`)).toMatchObject({ refused: true });
  });

  it("answers in Hindi for Devanagari questions and the Hindi UI", async () => {
    const ctx = await ctxFor();
    expect((await ask(ctx, "आज की बिक्री कितनी है?")).text).toMatch(/बिलों में ₹/);
    expect((await ask({ ...ctx, lang: "hi" }, "Expiring in next 30 days")).text).toMatch(/अगले 30 दिनों में/);
    expect((await ask(ctx, "बच्चे को कितनी खुराक दें?"))).toMatchObject({ refused: true, text: expect.stringMatching(/चिकित्सा सलाह/) });
    const p = await ask({ ...ctx, lang: "hi" }, "Record expense ₹50 tea");
    expect(p.confirm?.label).toBe("खर्च दर्ज करें");
    await cancel(ctx, p.confirm!.token);
  });

  it("AI on/off: owner or manager switches it; AI_ENABLED=0 switches it off for everyone", async () => {
    const ctx = await ctxFor();
    const p = await ask(ctx, "Record expense ₹10 tea");
    await expect(saveAiSettings(await ctxFor("Cashier"), { enabled: false })).rejects.toThrow(/role/);
    await saveAiSettings(await ctxFor("Manager"), { enabled: false });
    await expect(ask(ctx, "Sales today")).rejects.toThrow(/switched off for this pharmacy/);
    await expect(confirm(ctx, p.confirm!.token)).rejects.toThrow(/switched off/);
    await expect(saveAiSettings(await ctxFor("Manager"), { remoteNames: true })).rejects.toThrow(/role/);
    await saveAiSettings(ctx, { enabled: true });
    expect((await ask(ctx, "Sales today")).tool).toBe("get_sales_summary");
    process.env.AI_ENABLED = "0";
    await expect(ask(ctx, "Sales today")).rejects.toThrow(/switched off on this server/);
    expect(await db.auditEvent.count({ where: { action: "AI settings changed" } })).toBe(2);
  });

  it("rate-limits questions per user across a sliding minute", async () => {
    const ctx = await ctxFor();
    process.env.AI_RATE_PER_MIN = "3";
    await db.aiAsk.deleteMany();
    for (let i = 0; i < 3; i++) await ask(ctx, "Sales today");
    await expect(ask(ctx, "Sales today")).rejects.toThrow(/asked 3 questions in the last minute/);
    expect((await ask({ ...ctx, userId: "another-user" }, "Sales today")).tool).toBe("get_sales_summary");
    await expect(takeAiAsk(ctx.userId, new Date(Date.now() + 61_000))).resolves.toBeUndefined();
  });

  describe("with a model", () => {
    type Reply = Record<string, unknown>;
    const stub = (shape: (r: Reply) => unknown, ...replies: Reply[]) => {
      const f = vi.fn(async (...args: [string, RequestInit]) => args && new Response(JSON.stringify(shape(replies.length > 1 ? replies.shift()! : replies[0]))));
      vi.stubGlobal("fetch", f);
      return f;
    };
    const ollama = (...r: Reply[]) => stub((message) => ({ message }), ...r);
    const openai = (...r: Reply[]) => stub((message) => ({ choices: [{ message }] }), ...r);
    const local = () => Object.assign(process.env, { AI_MODE: "local", LOCAL_LLM_URL: "http://127.0.0.1:11434", LOCAL_LLM_MODEL: "qwen" });
    const call = (name: string, args: Reply = {}) => ({ content: "", tool_calls: [{ function: { name, arguments: args } }] });

    it("a local model calls tools and summarises; ungrounded answers fall back to the rules", async () => {
      const ctx = await ctxFor();
      local();
      const f = ollama(call("get_expiry_report", { days: 60 }), { content: "Nothing expires soon." });
      const r = await ask(ctx, "anything going bad soon?");
      expect(r).toMatchObject({ via: "local", tool: "get_expiry_report", text: "Nothing expires soon." });
      expect(f).toHaveBeenCalledTimes(2);
      expect(String(f.mock.calls[0][0])).toBe("http://127.0.0.1:11434/api/chat");
      expect(JSON.parse(String(f.mock.calls[1][1].body)).messages.at(-1)).toMatchObject({ role: "tool", tool_name: "get_expiry_report" });
      ollama({ content: "You sold a lot, probably." });
      expect(await ask(ctx, "Sales yesterday")).toMatchObject({ via: "rules", tool: "get_sales_summary" });
    });

    it("model write calls only preview; roles can't reach hidden tools", async () => {
      const ctx = await ctxFor();
      local();
      ollama(call("create_draft_expense", { account: "Rent", amount: 15000, method: "Bank" }));
      const p = await ask(ctx, "paid the shop rent");
      expect(p).toMatchObject({ via: "local", tool: "create_draft_expense", confirm: { label: "Record expense" } });
      await cancel(ctx, p.confirm!.token);
      const f = ollama(call("get_supplier_balances"));
      const cashier = await ctxFor("Cashier");
      expect(await ask(cashier, "who do we owe")).toMatchObject({ refused: true, tool: "get_supplier_balances" });
      expect(JSON.parse(String(f.mock.calls[0][1].body)).tools.map((t: { function: { name: string } }) => t.function.name)).not.toContain("get_supplier_balances");
    });

    it("strict mode refuses a model that isn't on localhost", async () => {
      const ctx = await ctxFor();
      Object.assign(process.env, { AI_MODE: "local", LOCAL_LLM_URL: "http://192.168.1.50:11434", LOCAL_LLM_MODEL: "qwen" });
      const f = ollama(call("get_low_stock_report"));
      expect(await ask(ctx, "Sales today")).toMatchObject({ via: "rules" });
      expect(f).not.toHaveBeenCalled();
    });

    it("remote provider: opt-in only, never in strict mode, names and phones redacted unless allowed", async () => {
      const ctx = await ctxFor();
      await saveCustomer(ctx, null, { name: "Ramesh Kumar", phone: "9822000003", waOptIn: false, creditLimit: "5000", opening: "250" });
      Object.assign(process.env, { AI_MODE: "remote", REMOTE_AI_URL: "https://ai.example.com/v1", REMOTE_AI_KEY: "sk-test", REMOTE_AI_MODEL: "gpt-x" });
      const tc = { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "get_customer_outstanding", arguments: "{}" } }] };
      let f = openai(tc, { content: "[customer 1] owes the most." });
      expect(await ask(ctx, "Who owes us? ramesh kumar called from 9822000003")).toMatchObject({ via: "rules" });
      expect(f).not.toHaveBeenCalled();

      await savePrivacy(ctx, { remoteAi: true });
      f = openai(tc, { content: "[customer 1] owes the most." });
      const r = await ask(ctx, "Who owes us? ramesh kumar called from 9822000003");
      expect(r).toMatchObject({ via: "remote", tool: "get_customer_outstanding", text: "Ramesh Kumar owes the most." });
      expect(r.rows?.[0].a).toBe("Ramesh Kumar");
      expect(String(f.mock.calls[0][0])).toBe("https://ai.example.com/v1/chat/completions");
      expect((f.mock.calls[0][1].headers as Record<string, string>).authorization).toBe("Bearer sk-test");
      const sent = f.mock.calls.map((c) => String(c[1].body)).join("\n");
      expect(sent).not.toMatch(/ramesh|9822000003/i);
      expect(sent).toContain("[customer 1]");
      expect(sent).toContain("[phone 1]");

      await saveAiSettings(ctx, { remoteNames: true });
      f = openai(tc, { content: "Ramesh Kumar owes the most." });
      await ask(ctx, "Who owes us?");
      expect(f.mock.calls.map((c) => String(c[1].body)).join("\n")).toContain("Ramesh Kumar");

      await savePrivacy(ctx, { strict: true });
      f = openai(tc);
      expect(await ask(ctx, "Who owes us?")).toMatchObject({ via: "rules" });
      expect(f).not.toHaveBeenCalled();
      await saveAiSettings(ctx, { remoteNames: false });
    });

    it("turn and tool timeouts, and at most 4 tool calls per question", async () => {
      const ctx = await ctxFor();
      local();
      process.env.AI_TURN_TIMEOUT_MS = "300";
      vi.stubGlobal("fetch", vi.fn((_u: string, init: RequestInit) => new Promise((_, rej) => init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))))));
      const t0 = Date.now();
      await expect(ask(ctx, "Sales yesterday")).rejects.toThrow(/took longer than 0.3 s/);
      expect(Date.now() - t0).toBeLessThan(5000);

      process.env.AI_TURN_TIMEOUT_MS = "20000";
      const before = await db.auditEvent.count({ where: { action: "AI query" } });
      const f = ollama(call("get_expiry_report", { days: 30 }));
      const r = await ask(ctx, "keep looking");
      expect(r.text).toMatch(/I stopped after 4 lookups/);
      expect(f).toHaveBeenCalledTimes(5);
      expect(await db.auditEvent.count({ where: { action: "AI query" } })).toBe(before + 4);

      clean();
      process.env.AI_TOOL_TIMEOUT_MS = "1";
      await expect(ask(ctx, "What should I reorder?")).rejects.toThrow(/took longer than/);
    });
  });

  it("draft PO quantities are re-checked against current stock at confirm", async () => {
    const ctx = await ctxFor();
    const p = await ask(ctx, "draft po");
    await postGrnTx(ctx, { supplierId: supId, invoiceNo: "MMA/2", invoiceDate: todayISO(), poId: null, scanDocId: null, statedTotal: "1344", lines: [{ medicineId: doloId, batchNo: "DL2", expiry: addDays(todayISO(), 500).slice(0, 7), qty: 50, freeQty: 0, rate: "24", mrp: "33.60", poItemId: null }] });
    await expect(confirm(ctx, p.confirm!.token)).rejects.toThrow(/Stock changed since the preview: Dolo 650 now needs 0, not \d+/);
    expect(await db.purchaseOrder.count()).toBe(1);
  });
});

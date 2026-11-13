import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { emailInvoice, ensureInvoiceNo, invoiceOf, invoicePdfOf, sendInvoiceQuietly } from "@/domain/system/invoice";
import { makePharmacy, resetDb } from "./helpers";

let tenantId = "";
const paid = (over: Partial<Parameters<typeof db.onlinePayment.create>[0]["data"]> = {}) =>
  db.onlinePayment.create({
    data: {
      tenantId, orderId: `order_${Math.random().toString(36).slice(2, 10)}`, paymentId: `pay_${Math.random().toString(36).slice(2, 10)}`, plan: "multi", cycle: "y",
      amountPaise: 100, gstPaise: 15, discountPaise: 249_900, couponCode: "SUMIT99", status: "paid", createdBy: "Owner Person", periodFrom: new Date("2026-11-01T00:00:00Z"), periodTo: new Date("2027-11-14T00:00:00Z"),
      paidAt: new Date("2026-11-01T06:00:00Z"), ...over,
    },
  });
/** The text drawn on a PDF's pages: inflate each content stream and read its (text) and <hex> strings. */
function pdfText(pdf: Buffer) {
  const raw = pdf.toString("latin1"), out: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body: string;
    try { body = inflateSync(Buffer.from(m[1], "latin1")).toString("latin1"); } catch { body = m[1]; }
    for (const t of body.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) out.push(t[1]);
    for (const t of body.matchAll(/<([0-9a-fA-F]+)>\s*Tj/g)) out.push(Buffer.from(t[1], "hex").toString("latin1"));
  }
  return out.join("\n");
}
const num = (no: string | null) => Number(no!.split("-")[2]);

beforeEach(async () => {
  await resetDb();
  await makePharmacy();
  tenantId = (await db.tenant.findFirstOrThrow()).id;
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("subscription invoices (no GST)", () => {
  it("numbers each paid payment once, in order, and never an unpaid or free one", async () => {
    const a = await paid(), b = await paid({ paidAt: new Date("2026-11-02T06:00:00Z") });
    const free = await paid({ amountPaise: 0, provider: "coupon" }), open = await paid({ status: "created", paidAt: null });
    const n1 = await ensureInvoiceNo(a.id), n2 = await ensureInvoiceNo(b.id);
    expect(n1).toMatch(/^MED-2026-\d{5}$/);
    expect(num(n2)).toBe(num(n1) + 1);
    expect(await ensureInvoiceNo(a.id)).toBe(n1); // asking again never makes a new number
    expect(await ensureInvoiceNo(free.id)).toBeNull();
    expect(await ensureInvoiceNo(open.id)).toBeNull();
  });

  it("shows what was paid with no tax line, the coupon as a discount, and the buyer", async () => {
    const p = await paid();
    const inv = (await invoiceOf(tenantId, p.id))!;
    expect(inv).toMatchObject({ status: "paid", totalPaise: 100, discountPaise: 249_900, listPaise: 250_000, couponCode: "SUMIT99", item: "Medoro Multi-branch plan · 1 year" });
    expect(inv.buyer).toMatchObject({ pharmacy: "Test Medical Store", name: "Owner Person", email: "owner@test.in" }); // no saved buyer email: the owner's
    expect(Object.keys(inv)).not.toContain("gstPaise");
    // Another pharmacy can't see it.
    expect(await invoiceOf("someone-else", p.id)).toBeNull();
  });

  it("uses the email saved at checkout, and marks a refunded payment", async () => {
    const p = await paid({ buyerEmail: "buyer@clinic.in", status: "refunded", refundedAt: new Date("2026-11-05T06:00:00Z") });
    const inv = (await invoiceOf(tenantId, p.id))!;
    expect(inv.buyer.email).toBe("buyer@clinic.in");
    expect(inv.status).toBe("refunded");
  });

  it("makes a one-page PDF that says no GST was charged", async () => {
    const p = await paid();
    const made = (await invoicePdfOf(tenantId, p.id))!;
    expect(made.pdf.toString("latin1").startsWith("%PDF")).toBe(true);
    const text = pdfText(made.pdf);
    expect(text).toContain(made.inv.invoiceNo);
    expect(text).toContain("Not charged");
    expect(text).toContain("Rs. 1.00");
    expect(text).toContain("Test Medical Store");
    expect((await PDFDocument.load(made.pdf)).getPageCount()).toBe(1);
  });

  it("emails the PDF to the buyer and remembers it was sent", async () => {
    vi.stubEnv("MAIL_PROVIDER", "http"); vi.stubEnv("MAIL_HTTP_URL", "https://mail.test/send"); vi.stubEnv("MAIL_FROM", "Medoro <no-reply@medoro.in>");
    const sent: { to: string; subject: string; text: string; attachments: { filename: string; contentType: string; content: string }[] }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body))); return new Response("{}", { status: 200 }); }));
    const p = await paid({ buyerEmail: "buyer@clinic.in" });
    const r = await emailInvoice(tenantId, p.id);
    expect(r.to).toBe("buyer@clinic.in");
    expect(sent).toHaveLength(1);
    const no = (await db.onlinePayment.findUniqueOrThrow({ where: { id: p.id } })).invoiceNo!;
    expect(sent[0].subject).toBe(`Your Medoro invoice ${no}`);
    expect(sent[0].text).toContain("Not charged");
    expect(sent[0].attachments[0]).toMatchObject({ filename: `Invoice-${no}.pdf`, contentType: "application/pdf" });
    expect(Buffer.from(sent[0].attachments[0].content, "base64").toString("latin1").startsWith("%PDF")).toBe(true);
    expect((await db.onlinePayment.findUniqueOrThrow({ where: { id: p.id } })).invoiceSentAt).not.toBeNull();
    // A copy to another address when asked.
    expect((await emailInvoice(tenantId, p.id, "accounts@clinic.in")).to).toBe("accounts@clinic.in");
  });

  it("says so when email isn't set up or the payment has no invoice", async () => {
    const p = await paid();
    await expect(emailInvoice(tenantId, p.id)).rejects.toThrow(UserError);
    vi.stubEnv("MAIL_PROVIDER", "http"); vi.stubEnv("MAIL_HTTP_URL", "https://mail.test/send"); vi.stubEnv("MAIL_FROM", "Medoro <no-reply@medoro.in>");
    const open = await paid({ status: "created", paidAt: null });
    await expect(emailInvoice(tenantId, open.id)).rejects.toThrow("no invoice");
  });

  it("sends the invoice once after a payment, and a failing mail server never breaks the payment", async () => {
    vi.stubEnv("MAIL_PROVIDER", "http"); vi.stubEnv("MAIL_HTTP_URL", "https://mail.test/send"); vi.stubEnv("MAIL_FROM", "Medoro <no-reply@medoro.in>");
    let ok = false, calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => { calls++; return new Response("{}", { status: ok ? 200 : 500 }); }));
    const p = await paid({ orderId: "order_x1" });
    await expect(sendInvoiceQuietly("order_x1")).resolves.toBeUndefined(); // mail down: swallowed
    expect((await db.onlinePayment.findUniqueOrThrow({ where: { id: p.id } })).invoiceSentAt).toBeNull();
    ok = true;
    await sendInvoiceQuietly("order_x1");
    await sendInvoiceQuietly("order_x1"); // already sent: nothing more goes out
    expect(calls).toBe(2);
    expect((await db.onlinePayment.findUniqueOrThrow({ where: { id: p.id } })).invoiceSentAt).not.toBeNull();
  });
});

"use server";
import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { run } from "@/server/action";
import { commitSale, createCustomer, heldCart, holdCart, invoiceData, listHeld, posCustomers, searchForSale, takeHeld } from "@/domain/sales/service";
import type { CustomerInput, SaleInput } from "@/domain/sales/contracts";
import { saleMessage, sendInvoice, waSettings } from "@/domain/comms/whatsapp";
import { db } from "@/server/db";
import type { z } from "zod";
import { approveDiscount, type approvalSchema } from "@/domain/sales/approval";

export async function searchAction(q: string) {
  const ctx = await getCtx();
  if (!ctx || !ctx.perms.includes("sale")) return [];
  return searchForSale(ctx, q);
}

export async function commitSaleAction(input: SaleInput) {
  const r = await run((ctx) => commitSale(ctx, input));
  if (r.ok) {
    revalidatePath("/app", "layout");
    // Auto-send only to customers with recorded WhatsApp consent. Runs in the background.
    const ctx = await getCtx();
    if (ctx && input.customerId && !r.data.replayed) {
      const [settings, cust] = await Promise.all([waSettings(ctx.tenantId), db.customer.findUnique({ where: { id: input.customerId } })]);
      if (settings.auto && cust?.waOptIn && cust.phone) void sendInvoice(ctx, r.data.saleId, cust.phone, true, true).catch(() => {});
    }
  }
  return r;
}

export async function sendInvoiceAction(saleId: string, phone: string, consent: boolean) {
  return run(async (ctx) => sendInvoice(ctx, saleId, phone, consent));
}

export async function messageStatusAction(saleId: string) {
  const ctx = await getCtx();
  return ctx ? saleMessage(ctx.tenantId, saleId) : null;
}

export async function invoiceAction(id: string) {
  const ctx = await getCtx();
  return ctx ? invoiceData(ctx, id) : null;
}

export async function addCustomerAction(input: CustomerInput) {
  return run(async (ctx) => { const id = await createCustomer(ctx, input); return { id, customers: await posCustomers(ctx) }; }, "Customer added.");
}

export async function approveDiscountAction(input: z.input<typeof approvalSchema>) {
  return run((ctx) => approveDiscount(ctx, input));
}

export async function holdAction(label: string, cart: unknown) {
  return run(async (ctx) => { await holdCart(ctx, label, cart); return (await listHeld(ctx)).map((h) => ({ id: h.id, label: h.label })); }, "Cart held. Recall it from the bar above the cart.");
}

export async function recallAction(id: string) {
  return run(async (ctx) => {
    const h = await heldCart(ctx, id);
    if (!h) throw new Error("gone");
    await takeHeld(ctx, id);
    return { cart: h.cart, held: (await listHeld(ctx)).map((x) => ({ id: x.id, label: x.label })) };
  });
}

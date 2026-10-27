"use server";
import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { run } from "@/server/action";
import { commitSale, createCustomer, heldCart, holdCart, invoiceData, listHeld, posCustomers, searchForSale, takeHeld } from "@/domain/sales/service";
import type { CustomerInput, SaleInput } from "@/domain/sales/contracts";

export async function searchAction(q: string) {
  const ctx = await getCtx();
  if (!ctx || !ctx.perms.includes("sale")) return [];
  return searchForSale(ctx, q);
}

export async function commitSaleAction(input: SaleInput) {
  const r = await run((ctx) => commitSale(ctx, input));
  if (r.ok) revalidatePath("/app", "layout");
  return r;
}

export async function invoiceAction(id: string) {
  const ctx = await getCtx();
  return ctx ? invoiceData(ctx, id) : null;
}

export async function addCustomerAction(input: CustomerInput) {
  return run(async (ctx) => { const id = await createCustomer(ctx, input); return { id, customers: await posCustomers(ctx) }; }, "Customer added.");
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

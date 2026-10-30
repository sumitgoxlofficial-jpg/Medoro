"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { paySupplier, receiveFromCustomer, saveCustomer, saveSupplier } from "@/domain/parties/service";
import type { PaymentInput, SupplierInput } from "@/domain/parties/contracts";
import type { CustomerInput } from "@/domain/sales/contracts";
import { getCtx } from "@/server/context";
import { customerPoints } from "@/domain/sales/loyalty";
import { sendPaymentRemindersNow } from "@/domain/comms/crm";

const fresh = <T,>(r: T) => { revalidatePath("/app", "layout"); return r; };
export async function saveSupplierAction(id: string | null, input: SupplierInput) { return fresh(await run((c) => saveSupplier(c, id, input), id ? "Supplier updated." : "Supplier added.")); }
export async function saveCustomerAction(id: string | null, input: CustomerInput & { opening?: string }) { return fresh(await run((c) => saveCustomer(c, id, input), id ? "Customer updated." : "Customer added.")); }
export async function paySupplierAction(input: PaymentInput) { return fresh(await run(async (c) => { const no = await paySupplier(c, input); return no; })); }
export async function receiveAction(input: PaymentInput) { return fresh(await run(async (c) => { const no = await receiveFromCustomer(c, input); return no; })); }
export async function remindAction(customerId: string) { return fresh(await run((c) => sendPaymentRemindersNow(c, [customerId]))); }
export async function pointsAction(customerId: string) {
  const ctx = await getCtx();
  if (!ctx || (!ctx.perms.includes("sale") && !ctx.perms.includes("payments"))) return { balance: 0, value: 0, rows: [] };
  return customerPoints(ctx, customerId);
}

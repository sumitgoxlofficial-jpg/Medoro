"use server";
import { revalidatePath } from "next/cache";
import { run, UserError } from "@/server/action";
import { paySupplier, receiveFromCustomer, saveCustomer, saveSupplier } from "@/domain/parties/service";
import type { PaymentInput, SupplierInput } from "@/domain/parties/contracts";
import type { CustomerInput } from "@/domain/sales/contracts";

function requireVersion(v: unknown) {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw new UserError("This form is out of date. Reopen it and try again.");
  return v;
}
const fresh = <T,>(r: T) => { revalidatePath("/app", "layout"); return r; };
export async function saveSupplierAction(id: string | null, input: SupplierInput, version?: number) { return fresh(await run((c) => saveSupplier(c, id, input, id ? requireVersion(version) : undefined), id ? "Supplier updated." : "Supplier added.")); }
export async function saveCustomerAction(id: string | null, input: CustomerInput & { opening?: string }, version?: number) { return fresh(await run((c) => saveCustomer(c, id, input, id ? requireVersion(version) : undefined), id ? "Customer updated." : "Customer added.")); }
export async function paySupplierAction(input: PaymentInput) { return fresh(await run(async (c) => { const no = await paySupplier(c, input); return no; })); }
export async function receiveAction(input: PaymentInput) { return fresh(await run(async (c) => { const no = await receiveFromCustomer(c, input); return no; })); }

"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { paySupplier, receiveFromCustomer, saveCustomer, saveSupplier } from "@/domain/parties/service";
import type { PaymentInput, SupplierInput } from "@/domain/parties/contracts";
import type { CustomerInput } from "@/domain/sales/contracts";

const fresh = <T,>(r: T) => { revalidatePath("/app", "layout"); return r; };
export async function saveSupplierAction(id: string | null, input: SupplierInput) { return fresh(await run((c) => saveSupplier(c, id, input), id ? "Supplier updated." : "Supplier added.")); }
export async function saveCustomerAction(id: string | null, input: CustomerInput & { opening?: string }) { return fresh(await run((c) => saveCustomer(c, id, input), id ? "Customer updated." : "Customer added.")); }
export async function paySupplierAction(input: PaymentInput) { return fresh(await run(async (c) => { const no = await paySupplier(c, input); return no; })); }
export async function receiveAction(input: PaymentInput) { return fresh(await run(async (c) => { const no = await receiveFromCustomer(c, input); return no; })); }

"use server";
import { getCtx } from "@/server/context";
import { run } from "@/server/action";
import { substitutesForSale } from "@/domain/sales/service";
import { createDoctor, listDoctors } from "@/domain/doctors/service";
import type { DoctorInput } from "@/domain/doctors/contracts";

export async function substitutesAction(medicineId: string, sort: "price" | "margin") {
  const ctx = await getCtx();
  if (!ctx || !ctx.perms.includes("sale")) return { of: null, rows: [] };
  return substitutesForSale(ctx, medicineId, sort);
}

export async function quickAddDoctorAction(input: DoctorInput) {
  return run(async (ctx) => ({ doctor: await createDoctor(ctx, input), doctors: await listDoctors(ctx) }), "Doctor added.");
}

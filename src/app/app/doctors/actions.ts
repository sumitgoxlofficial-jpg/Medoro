"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { createDoctor, updateDoctor } from "@/domain/doctors/service";
import type { DoctorInput } from "@/domain/doctors/contracts";

const done = <T,>(r: T) => { revalidatePath("/app/doctors"); return r; };

export async function addDoctorAction(input: DoctorInput) {
  return done(await run((ctx) => createDoctor(ctx, input), "Doctor added."));
}
export async function editDoctorAction(id: string, version: number, input: DoctorInput & { active?: boolean }) {
  return done(await run((ctx) => updateDoctor(ctx, id, version, input), input.active === false ? "Doctor deactivated. Past bills keep the link." : input.active ? "Doctor reactivated." : "Doctor updated."));
}

"use server";
import { headers } from "next/headers";
import { ZodError } from "zod";
import { UserError, type ActionResult } from "@/server/action";
import { clientIp } from "@/server/auth";
import { websiteLead, type websiteLeadSchema } from "@/staff/public";
import type { z } from "zod";

export async function startTrialAction(input: z.input<typeof websiteLeadSchema>): Promise<ActionResult<null>> {
  try {
    await websiteLead(input, clientIp(await headers()));
    return { ok: true, data: null };
  } catch (e) {
    if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Check the form." };
    if (e instanceof UserError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong. Please message us on WhatsApp instead." };
  }
}

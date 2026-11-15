"use server";
import { headers } from "next/headers";
import { ZodError } from "zod";
import { UserError, type ActionResult } from "@/server/action";
import { clientIp } from "@/server/auth";
import { log } from "@/server/log";
import { clearApplicant, readApplicant } from "@/server/applicant";
import { apply, sendApplicantCode, verifyApplicantCode } from "@/staff/hrms/careers";

/** A job seeker applies from /careers. No account needed; LinkedIn or Google sign-in only fills and verifies the email. */
export async function applyForJob(form: FormData): Promise<ActionResult<{ ref: string; emailed: boolean }>> {
  try {
    const r = await apply(form, await readApplicant(), clientIp(await headers()));
    return { ok: true, data: { ref: r.ref, emailed: !!("emailed" in r && r.emailed) } };
  } catch (e) {
    if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Please check the form." };
    if (e instanceof UserError) return { ok: false, error: e.message };
    log.error("careers apply failed", { err: e });
    return { ok: false, error: "Something went wrong and your application wasn't sent. Please try again." };
  }
}

async function attempt<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try { return { ok: true, data: await fn() }; } catch (e) {
    if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Please check and try again." };
    if (e instanceof UserError) return { ok: false, error: e.message };
    log.error("careers sign-in failed", { err: e });
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
export async function sendCareersCode(email: string) {
  return attempt(async () => sendApplicantCode(email, clientIp(await headers())));
}
export async function verifyCareersCode(code: string) {
  return attempt(() => verifyApplicantCode(code));
}

export async function signOutApplicant() {
  await clearApplicant();
}

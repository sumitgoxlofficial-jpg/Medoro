import "server-only";
import type { Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { maskPhone } from "@/lib/mask";
import { getPrivacy } from "./privacy";

/** What strict customer-controlled mode enforces on the server. Shown on the Privacy screen. */
export const STRICT_RULES = [
  "Remote AI providers are off; the assistant runs on this server only",
  "No usage telemetry or crash reports leave this server",
  "Customer mobile numbers are masked for everyone except the owner and managers",
  "Exports include customer mobile numbers only when a reason is recorded",
  "Every new customer mobile number gets a consent record, so the log shows a clear yes or no for messages",
] as const;

/** Strict customer-controlled mode (on by default). Other modules check this before sending data off the server. */
export async function isStrict(ctx: Pick<Ctx, "tenantId"> | string) {
  return (await getPrivacy(typeof ctx === "string" ? ctx : ctx.tenantId)).strict;
}

/** Throws when strict mode is on: for features that send pharmacy data to an outside service. */
export async function assertNotStrict(ctx: Pick<Ctx, "tenantId"> | string, what: string) {
  if (await isStrict(ctx)) throw new UserError(`Strict customer-controlled mode is on, so ${what} is off. The owner can change this under Privacy & data.`);
}

/** Owner and managers see customer mobile numbers; in strict mode everyone else sees them masked. Follows "View as". */
export const isManager = (ctx: Pick<Ctx, "role">) => ctx.role === "Owner" || ctx.role === "Manager";

export async function phoneMasker(ctx: Pick<Ctx, "tenantId" | "role">) {
  const show = isManager(ctx) || !(await isStrict(ctx));
  return (p: string | null | undefined) => (show ? (p ?? null) : maskPhone(p));
}

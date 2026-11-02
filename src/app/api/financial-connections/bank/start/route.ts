import { z } from "zod";
import { api, jsonBody } from "@/server/api";
import { startConnection } from "@/domain/finance/connections";

export const dynamic = "force-dynamic";
const body = z.object({ connector: z.string().min(1).max(60) });
/** Starts a bank or Account Aggregator authorisation; the browser then goes to `redirectUrl` (the provider's page). */
export const POST = api(async (ctx, req) => {
  const b = body.parse(await jsonBody(req));
  if (!/^(aa|bank:)/.test(b.connector)) throw new z.ZodError([{ code: "custom", path: ["connector"], message: "Not a bank connection.", input: b.connector }]);
  return startConnection(ctx, b.connector);
});

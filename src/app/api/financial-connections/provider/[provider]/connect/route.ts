import { api } from "@/server/api";
import { UserError } from "@/server/action";
import { startConnection } from "@/domain/finance/connections";

export const dynamic = "force-dynamic";
/** Starts a payment provider's authorisation (PhonePe, Paytm, …) when that provider is available. */
export const POST = api<{ provider: string }>(async (ctx, _req, { provider }) => {
  if (!/^[a-z0-9-]{2,30}$/.test(provider) || /^(aa|bank)/.test(provider)) throw new UserError("Unknown provider.");
  return startConnection(ctx, provider);
});

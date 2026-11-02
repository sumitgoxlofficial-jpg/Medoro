import { api } from "@/server/api";
import { refreshConsent } from "@/domain/finance/connections";

export const dynamic = "force-dynamic";
export const POST = api<{ id: string }>(async (ctx, _req, { id }) => refreshConsent(ctx, id));

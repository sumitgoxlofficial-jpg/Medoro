import { api } from "@/server/api";
import { revokeConnection } from "@/domain/finance/connections";

export const dynamic = "force-dynamic";
export const POST = api<{ id: string }>(async (ctx, _req, { id }) => revokeConnection(ctx, id));

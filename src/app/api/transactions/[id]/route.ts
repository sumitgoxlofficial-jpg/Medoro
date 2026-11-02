import { api } from "@/server/api";
import { getTransaction } from "@/domain/finance/server-api";

export const dynamic = "force-dynamic";
export const GET = api<{ id: string }>(async (ctx, _req, { id }) => getTransaction(ctx, id));

import { api } from "@/server/api";
import { listTransactions } from "@/domain/finance/server-api";

export const dynamic = "force-dynamic";
export const GET = api(async (ctx, req) => listTransactions(ctx, new URL(req.url).searchParams));

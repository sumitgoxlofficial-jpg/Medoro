import { api } from "@/server/api";
import { listTransactions } from "@/domain/finance/server-api";

export const dynamic = "force-dynamic";
/** ?from=&to=&q=&status=&limit= (data on this server; 409 for a Drive pharmacy). */
export const GET = api(async (ctx, req) => listTransactions(ctx, new URL(req.url).searchParams));

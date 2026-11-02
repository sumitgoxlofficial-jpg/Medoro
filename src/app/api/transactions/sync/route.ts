import { api } from "@/server/api";
import { requestSyncAll } from "@/domain/finance/connections";

export const dynamic = "force-dynamic";
/** Queues a sync of every active connection (each at most once per 10 minutes). */
export const POST = api(async (ctx) => requestSyncAll(ctx));

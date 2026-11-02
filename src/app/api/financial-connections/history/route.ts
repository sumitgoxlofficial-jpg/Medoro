import { api } from "@/server/api";
import { syncHistory } from "@/domain/finance/connections";

export const dynamic = "force-dynamic";
/** Sync runs, newest first: start, end, connection, trigger and counts (no amounts). */
export const GET = api(async (ctx) => ({ history: await syncHistory(ctx) }));

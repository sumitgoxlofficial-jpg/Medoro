import { api } from "@/server/api";
import { listConnections } from "@/domain/finance/connections";

export const dynamic = "force-dynamic";
/** All bank, Account Aggregator and provider connections of the signed-in pharmacy (no secrets). */
export const GET = api(async (ctx) => ({ connections: await listConnections(ctx) }));

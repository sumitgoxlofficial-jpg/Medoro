import { api } from "@/server/api";
import { listConnections } from "@/domain/finance/connections";

export const dynamic = "force-dynamic";
export const GET = api(async (ctx) => ({ connections: await listConnections(ctx, ["bank", "aa"]) }));

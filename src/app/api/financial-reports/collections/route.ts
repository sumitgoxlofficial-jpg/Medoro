import { api } from "@/server/api";
import { collectionsReport } from "@/domain/finance/server-api";

export const dynamic = "force-dynamic";
export const GET = api(async (ctx, req) => collectionsReport(ctx, new URL(req.url).searchParams));

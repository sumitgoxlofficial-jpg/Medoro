import { z } from "zod";
import { api, jsonBody } from "@/server/api";
import { rejectBillSuggestion } from "@/domain/finance/bills";

export const dynamic = "force-dynamic";
export const POST = api<{ id: string }>(async (ctx, req, { id }) => ({ ok: await rejectBillSuggestion(ctx, id, z.object({ saleId: z.string().min(1).max(64) }).parse(await jsonBody(req)).saleId) }));

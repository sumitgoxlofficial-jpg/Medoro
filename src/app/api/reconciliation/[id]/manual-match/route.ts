import { z } from "zod";
import { api, jsonBody } from "@/server/api";
import { allocateBill } from "@/domain/finance/bills";

export const dynamic = "force-dynamic";
const body = z.object({ saleId: z.string().min(1).max(64), amountPaise: z.number().int().positive() });
/** `id` is the statement line; body { saleId, amountPaise }. */
export const POST = api<{ id: string }>(async (ctx, req, { id }) => { const b = body.parse(await jsonBody(req)); return allocateBill(ctx, { bankLineId: id, saleId: b.saleId, amountPaise: b.amountPaise }); });

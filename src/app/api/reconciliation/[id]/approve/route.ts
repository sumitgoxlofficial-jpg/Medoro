import { z } from "zod";
import { api, jsonBody } from "@/server/api";
import { allocateBill } from "@/domain/finance/bills";

export const dynamic = "force-dynamic";
/** `id` is the statement line; body { saleId }: approves that suggestion as proposed (posts the receipt). */
export const POST = api<{ id: string }>(async (ctx, req, { id }) => allocateBill(ctx, { bankLineId: id, saleId: z.object({ saleId: z.string().min(1).max(64) }).parse(await jsonBody(req)).saleId }));

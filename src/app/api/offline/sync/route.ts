import { z } from "zod";
import { syncOps } from "@/domain/sales/offline";
import { api } from "../json";

export const dynamic = "force-dynamic";
const body = z.object({ deviceId: z.string().uuid(), ops: z.array(z.unknown()).max(200) });

/** Posts bills made offline. Resending is safe: each bill posts once. */
export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  return api(async (ctx) => { const b = body.parse(raw); return { results: await syncOps(ctx, b.deviceId, b.ops) }; });
}

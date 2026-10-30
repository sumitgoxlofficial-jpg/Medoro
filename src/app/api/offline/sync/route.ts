import { z } from "zod";
import { syncOps } from "@/domain/sales/offline";
import { rejectCrossSite } from "@/server/csrf";
import { counted } from "@/server/metrics";
import { api } from "../json";

export const dynamic = "force-dynamic";
const body = z.object({ deviceId: z.string().uuid(), ops: z.array(z.unknown()).max(200) });

/** Posts bills made offline. Resending is safe: each bill posts once. */
export const POST = counted("offline_sync", async (req: Request) => {
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const raw = await req.json().catch(() => null);
  return api(async (ctx) => { const b = body.parse(raw); return { results: await syncOps(ctx, b.deviceId, b.ops) }; });
});
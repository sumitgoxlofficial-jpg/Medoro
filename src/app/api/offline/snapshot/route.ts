import { snapshot } from "@/domain/sales/offline";
import { counted } from "@/server/metrics";
import { api } from "../json";

export const dynamic = "force-dynamic";

/** Medicines, prices and this device's stock allowance for billing offline. */
export const GET = counted("offline_snapshot", async (req: Request) => {
  const device = new URL(req.url).searchParams.get("device") ?? "";
  return api((ctx) => snapshot(ctx, device));
});
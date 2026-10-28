import { snapshot } from "@/domain/sales/offline";
import { api } from "../json";

export const dynamic = "force-dynamic";

/** Medicines, prices and this device's stock allowance for billing offline. */
export async function GET(req: Request) {
  const device = new URL(req.url).searchParams.get("device") ?? "";
  return api((ctx) => snapshot(ctx, device));
}

import { api } from "@/server/api";
import { billMatching } from "@/domain/finance/bills";
import { OnCountersError } from "@/domain/finance/server-api";
import { driveModeOn } from "@/domain/system/drive-mode";

export const dynamic = "force-dynamic";
export const GET = api(async (ctx) => {
  if (ctx.moved || ctx.mustMove || (await driveModeOn(ctx.tenantId))) throw new OnCountersError();
  return { suggested: (await billMatching(ctx)).suggested };
});

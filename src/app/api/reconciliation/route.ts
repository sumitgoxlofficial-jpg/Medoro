import { api } from "@/server/api";
import { billMatching } from "@/domain/finance/bills";
import { bankReconciliation } from "@/domain/accounting/bank";
import { OnCountersError } from "@/domain/finance/server-api";
import { driveModeOn } from "@/domain/system/drive-mode";

export const dynamic = "force-dynamic";
/** Book reconciliation (statement vs ledger) and bill matching, for data on this server. */
export const GET = api(async (ctx) => {
  if (ctx.moved || ctx.mustMove || (await driveModeOn(ctx.tenantId))) throw new OnCountersError();
  return { books: await bankReconciliation(ctx), bills: await billMatching(ctx) };
});

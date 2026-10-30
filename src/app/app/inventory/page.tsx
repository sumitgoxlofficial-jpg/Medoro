import { requireCtx, can } from "@/server/context";
import { listInventory, medicineDetail, type InvFilter } from "@/domain/inventory/service";
import { listBranchTransfers } from "@/domain/inventory/adjust";
import { racksInUse } from "@/domain/inventory/catalog";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { InventoryView } from "./view";

export const metadata = { title: "Inventory" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string; sel?: string; add?: string; tab?: string; rack?: string }> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const filter = (["all", "low", "rx", "exp"].includes(sp.filter ?? "") ? sp.filter : "all") as InvFilter;
  const tab = sp.tab === "transfers" ? "transfers" : "stock";
  const [list, detail, transfers, racks] = await Promise.all([listInventory(ctx, sp.q ?? "", filter, sp.rack ?? ""), sp.sel ? medicineDetail(ctx, sp.sel) : null, listBranchTransfers(ctx), racksInUse(ctx)]);
  return (
    <>
      <PageHead title={t(ctx.lang).inv} sub={`Catalogue, batches and stock ledger · ${ctx.branchName}`} />
      <InventoryView
        list={list} detail={detail} q={sp.q ?? ""} filter={filter} rack={sp.rack ?? ""} racks={racks} openAdd={sp.add === "1"} tab={tab} transfers={transfers}
        canEdit={can(ctx, "adjust") || can(ctx, "purchase")} canAdjust={can(ctx, "adjust")} canPurchase={can(ctx, "purchase")}
      />
    </>
  );
}
import { requireDistCtx, distView, distCan } from "@/domain/distribution/context";
import { creditRisks, deadStock, expiryRisk, productProfitability, purchaseRecommendations, salesForecast, schemeProfitability } from "@/domain/distribution/intelligence";
import { distEnt } from "@/domain/distribution/common";
import { distHas, distUpgrade } from "@/domain/distribution/plans";
import { inr } from "@/lib/money";
import { DataTable, Note, PageHead, Panel, Pill, STATUS_TONE, Tabs } from "../_ui/ui";
import { BarsChart } from "../_ui/charts";
import { Assistant, DraftPo } from "../_ui/assistant";

export const metadata = { title: "Business intelligence" };

const TABS = [["purchase", "Purchase & reorder"], ["expiry", "Expiry loss"], ["dead", "Dead stock"], ["profit", "Product profitability"], ["schemes", "Scheme profitability"], ["credit", "Credit risk"], ["forecast", "Sales forecast"]] as const;

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireDistCtx();
  distView(ctx, "insights", "purchase");
  const ent = await distEnt(ctx.tenantId);
  if (!distHas(ent, "insights")) return <><PageHead title="Business intelligence" /><Note tone="amber">{distUpgrade(ent, "insights")}</Note></>;
  const tab = (await searchParams).tab ?? "purchase";
  return (
    <>
      <PageHead title="Distribution intelligence" sub="Statistical analysis of your own invoices, stock, purchases and ledgers. Suggestions only: nothing here posts a transaction — purchase suggestions become draft POs you review and place." />
      <Panel title="Management reporting assistant" className="mb-4"><Assistant /></Panel>
      <Tabs active={tab} tabs={TABS.map(([k, l]) => ({ key: k, label: l, href: `?tab=${k}` }))} />
      <Body tab={tab} ctx={ctx} />
    </>
  );
}

async function Body({ tab, ctx }: { tab: string; ctx: Awaited<ReturnType<typeof requireDistCtx>> }) {
  if (tab === "purchase") {
    const r = await purchaseRecommendations(ctx);
    return (
      <Panel pad={false} title="Automatic reorder suggestions" sub="Demand from the last 120 days (weekday-aware model with 28+ days of history, otherwise the 60-day average), lead time, cover and safety days, less stock on hand and on order plus reservations.">
        <DataTable cols={[{ label: "Product" }, { label: "Company" }, { label: "Supplier" }, { label: "On hand", num: true }, { label: "On order", num: true }, { label: "Reserved", num: true }, { label: "Daily demand", num: true }, { label: "Lead", num: true }, { label: "Suggest", num: true }, { label: "Value", num: true }]}
          rows={r.map((x) => [x.name, x.company, x.supplier ?? <Pill key="s" tone="amber">No supplier</Pill>, x.onHand, x.onOrder, x.reserved, `${x.daily} (${x.method})`, `${x.leadDays} d`, <strong key="p">{x.packs}</strong>, inr(x.value)])} empty="Nothing needs reordering at the current sales pace." />
        {distCan(ctx, "purchase") ? <DraftPo items={r.filter((x) => x.supplierId).map((x) => ({ id: x.medicineId, label: `${x.name} × ${x.packs}` }))} /> : null}
      </Panel>
    );
  }
  if (tab === "expiry") {
    const r = await expiryRisk(ctx);
    return <Panel pad={false} title="Expiry loss prediction" sub="Batches expiring within 240 days that won't sell out at the 60-day pace (earlier batches sell first). Loss is after the principal's expected claim credit.">
      <DataTable cols={[{ label: "Product" }, { label: "Batch" }, { label: "Expiry" }, { label: "Packs", num: true }, { label: "Sells / day", num: true }, { label: "Unsold (est.)", num: true }, { label: "At risk", num: true }, { label: "Recoverable", num: true }, { label: "Loss", num: true }]}
        rows={r.map((x) => [x.name, x.batchNo, `${x.expiry} (${x.daysLeft} d)`, x.packs, x.dailyRate, x.unsold, inr(x.atRisk), inr(x.recoverable), <strong key="l">{inr(x.loss)}</strong>])} empty="No batch is expected to expire unsold." />
    </Panel>;
  }
  if (tab === "dead") {
    const r = await deadStock(ctx);
    return <Panel pad={false} title="Dead stock (no sale in 90 days)"><DataTable cols={[{ label: "Product" }, { label: "Batches", num: true }, { label: "Packs", num: true }, { label: "Value at cost", num: true }, { label: "Last sale" }]} rows={r.map((x) => [x.name, x.batches, x.packs, inr(x.value), x.lastSale ?? "Never"])} empty="No dead stock." /></Panel>;
  }
  if (tab === "profit") {
    const r = await productProfitability(ctx);
    return <div className="flex flex-col gap-4">
      <Panel title="Gross margin by product (90 days)"><BarsChart label="Gross margin by product" data={r.slice(0, 12).map((x) => ({ name: x.name.slice(0, 14), value: x.gross }))} /></Panel>
      <Panel pad={false}><DataTable cols={[{ label: "Product" }, { label: "Packs", num: true }, { label: "Free", num: true }, { label: "Sales", num: true }, { label: "Cost", num: true }, { label: "Gross margin", num: true }, { label: "Margin %", num: true }, { label: "Free goods cost", num: true }]}
        rows={r.map((x) => [x.name, x.packs, x.free, inr(x.revenue), inr(x.cost), inr(x.gross), x.grossPct ?? "—", inr(x.freeGoodsCost)])} empty="No sales in 90 days." /></Panel>
    </div>;
  }
  if (tab === "schemes") {
    const r = await schemeProfitability(ctx);
    return <Panel pad={false} title="Did the scheme pay?" sub="Gross margin during the scheme against the same number of days just before it. Margin already nets free goods and scheme discounts.">
      <DataTable cols={[{ label: "Scheme" }, { label: "Period" }, { label: "Qty before → during" }, { label: "Qty change", num: true }, { label: "Margin before", num: true }, { label: "Margin during", num: true }, { label: "Scheme cost", num: true }, { label: "Verdict" }]}
        rows={r.map((x) => [`${x.code} ${x.name}`, `${x.from} – ${x.to}`, `${x.before.qty} → ${x.during.qty}`, x.qtyChangePct == null ? "—" : `${x.qtyChangePct}%`, inr(x.before.margin), inr(x.during.margin), inr(x.schemeCost), <Pill key="v" tone={x.verdict === "profitable" ? "green" : x.verdict === "loss-making" ? "red" : "gray"}>{x.verdict}</Pill>])} empty="No schemes have run yet." />
    </Panel>;
  }
  if (tab === "credit") {
    const r = await creditRisks(ctx);
    return <Panel pad={false} title="Customer credit risk indicators" sub="0–100: limit use, overdue share, age past terms, bounced cheques, 90-day collection rate. Indicators for a person to act on; nothing is blocked automatically.">
      <DataTable cols={[{ label: "Chemist" }, { label: "Balance", num: true }, { label: "Overdue", num: true }, { label: "Score", num: true }, { label: "Level" }, { label: "Factors" }]}
        rows={r.map((x) => [x.name, inr(x.balance), inr(x.overdue), x.risk.score, <Pill key="l" tone={STATUS_TONE[x.risk.level]}>{x.risk.level}</Pill>, <span key="f" className="text-[12px]">{x.risk.factors.join("; ") || "—"}</span>])} empty="No outstanding balances." />
    </Panel>;
  }
  const f = await salesForecast(ctx);
  return <div className="grid gap-4 lg:grid-cols-2">
    <Panel title="Monthly sales and trend" sub={f.next ? `Next month ≈ ${inr(f.next.sales)} (least-squares trend of the last 6 full months)` : "Needs 3 full months of invoices."}><BarsChart label="Monthly sales" data={[...f.months.map((m) => ({ name: m.month, value: m.sales })), ...(f.next ? [{ name: "next", value: f.next.sales }] : [])]} /></Panel>
    <Panel pad={false} title="Next 30 days by product (80% range)"><DataTable dense cols={[{ label: "Product" }, { label: "Last 30 d", num: true }, { label: "Next 30 d", num: true }, { label: "Range", num: true }]} rows={f.products.map((p) => [p.name, p.last30, p.next30, `${p.low}–${p.high}`])} empty="Needs 28+ days of sales with 5+ selling days." /></Panel>
  </div>;
}

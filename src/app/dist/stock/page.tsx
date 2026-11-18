import { requireDistCtx, distView, distCan } from "@/domain/distribution/context";
import { listBranchTransfers } from "@/domain/inventory/adjust";
import { db } from "@/server/db";
import { inr } from "@/lib/money";
import { daysTo, isoOf } from "@/lib/dates";
import { DataTable, dateIN, PageHead, Panel, Pill, STATUS_TONE, Tabs } from "../_ui/ui";
import { ActButton, ActForm, F, Grid, S } from "../_ui/forms";
import { adjustAction, transferAction, transferStepAction } from "../actions";

export const metadata = { title: "Stock & transfers" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; tab?: string }> }) {
  const ctx = await requireDistCtx();
  distView(ctx, "adjust", "warehouse", "purchase");
  const sp = await searchParams;
  const tab = sp.tab ?? "stock";
  const q = (sp.q ?? "").trim();
  const batches = await db.batch.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, OR: [{ qtyAvailable: { gt: 0 } }, { qtyQuarantined: { gt: 0 } }], ...(q ? { OR: [{ medicine: { name: { contains: q, mode: "insensitive" } } }, { batchNo: { contains: q.toUpperCase() } }] } : {}) }, include: { medicine: true }, orderBy: [{ medicine: { name: "asc" } }, { expiryDate: "asc" }], take: 500 });
  const racks = await db.medicineRack.findMany({ where: { branchId: ctx.branchId, medicineId: { in: batches.map((b) => b.medicineId) } } });
  const transfers = tab === "transfers" ? await listBranchTransfers(ctx) : [];
  const others = ctx.branches.filter((b) => b.id !== ctx.branchId);
  const value = batches.reduce((a, b) => a + ((b.qtyAvailable + b.qtyQuarantined) / Math.max(1, b.medicine.packSize)) * Number(b.costPaise), 0);
  return (
    <>
      <PageHead title={`Batch-wise stock · ${ctx.branchName}`} sub={`Value at landed cost ${inr(Math.round(value))}. Stock moves only through GRNs, invoices, returns, claims, transfers and audited adjustments.`} />
      <Tabs active={tab} tabs={[{ key: "stock", label: "Stock", href: "?tab=stock" }, { key: "transfers", label: "Godown transfers", href: "?tab=transfers" }]} />
      {tab === "stock" ? (
        <>
          {distCan(ctx, "adjust") ? (
            <div className="grid gap-4 lg:grid-cols-2 mb-4">
              {others.length ? (
                <Panel title="Transfer to another godown">
                  <ActForm action={transferAction} submit="Request transfer" resetOnOk>
                    <Grid cols={3}>
                      <S label="Batch" name="batchId" options={batches.filter((b) => b.qtyAvailable > 0).map((b) => ({ value: b.id, label: `${b.medicine.name} · ${b.batchNo} (${b.qtyAvailable})` }))} />
                      <S label="To godown" name="toBranch" options={others.map((b) => ({ value: b.id, label: b.name }))} />
                      <F label="Units" name="qty" type="number" min={1} required />
                    </Grid>
                  </ActForm>
                </Panel>
              ) : null}
              <Panel title="Stock adjustment (audited)">
                <ActForm action={adjustAction} submit="Adjust" resetOnOk>
                  <Grid cols={3}>
                    <S label="Batch" name="batchId" options={batches.map((b) => ({ value: b.id, label: `${b.medicine.name} · ${b.batchNo} (${b.qtyAvailable})` }))} />
                    <F label="+ / − units" name="delta" type="number" required />
                    <F label="Reason" name="reason" required />
                  </Grid>
                </ActForm>
              </Panel>
            </div>
          ) : null}
          <Panel pad={false} title={`${batches.length} batches`} right={<form><input data-search name="q" defaultValue={q} placeholder="Product or batch" className="h-8 w-[200px] border border-input rounded px-2 text-[13px]" /></form>}>
            <DataTable dense cols={[{ label: "Product" }, { label: "Batch" }, { label: "Expiry" }, { label: "Rack" }, { label: "Packs", num: true }, { label: "Quarantined", num: true }, { label: "Cost", num: true }, { label: "MRP", num: true }, { label: "Status" }]}
              rows={batches.map((b) => { const p = Math.max(1, b.medicine.packSize), d = daysTo(b.expiryDate); return [b.medicine.name, b.batchNo, <span key="e" className={d <= 0 ? "text-[#B3261E] font-semibold" : d <= 90 ? "text-[#94570A]" : ""}>{isoOf(b.expiryDate)}</span>, racks.find((r) => r.medicineId === b.medicineId)?.rack ?? b.medicine.rack ?? "—", b.qtyAvailable / p, b.qtyQuarantined ? b.qtyQuarantined / p : "", inr(Number(b.costPaise)), inr(Number(b.mrpPaise)), <Pill key="s" tone={b.status === "ok" ? "green" : "amber"}>{b.status}</Pill>]; })} empty="No stock in this godown. Receive stock with a GRN under Purchases." />
          </Panel>
        </>
      ) : (
        <Panel pad={false}>
          <DataTable cols={[{ label: "No." }, { label: "Item" }, { label: "From → to" }, { label: "Qty", num: true }, { label: "Requested" }, { label: "Status" }, { label: "" }]}
            rows={transfers.map((t) => [t.no, t.item, `${t.from} → ${t.to}`, t.qty, dateIN(t.createdAt), <Pill key="s" tone={STATUS_TONE[t.status] ?? "blue"}>{t.status}</Pill>,
              <span key="a" className="flex gap-1 justify-end">
                {t.canApprove ? <ActButton size="sm" label="Approve & send" action={async () => { "use server"; return transferStepAction(t.id, "approve"); }} /> : null}
                {t.canReject ? <ActButton size="sm" variant="danger" label="Reject" action={async () => { "use server"; return transferStepAction(t.id, "reject"); }} /> : null}
                {t.canReceive ? <ActButton size="sm" variant="primary" label="Received" action={async () => { "use server"; return transferStepAction(t.id, "receive"); }} /> : null}
                {t.canCancel ? <ActButton size="sm" variant="danger" label="Cancel" action={async () => { "use server"; return transferStepAction(t.id, "cancel"); }} /> : null}
              </span>])} empty="No transfers." />
        </Panel>
      )}
    </>
  );
}

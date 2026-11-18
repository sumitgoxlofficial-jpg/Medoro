import { requireDistCtx, distView, distCan } from "@/domain/distribution/context";
import { claimReconciliation, expiryWorkbench } from "@/domain/distribution/returns";
import { inr } from "@/lib/money";
import { DataTable, dateIN, PageHead, Panel, Pill, Stat, STATUS_TONE, Tabs } from "../_ui/ui";
import { ActButton, ActForm, Check, F, Grid } from "../_ui/forms";
import { ackClaimAction, creditClaimAction, raiseClaimAction } from "../actions";

export const metadata = { title: "Expiry & claims" };

const BAND: Record<string, [string, string]> = { expired: ["Expired", "red"], "30": ["≤ 30 days", "red"], "60": ["31–60 days", "amber"], "90": ["61–90 days", "amber"], "180": ["91–180 days", "blue"], ok: ["> 180 days", "gray"] };

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string; claim?: string }> }) {
  const ctx = await requireDistCtx();
  distView(ctx, "purchase", "adjust", "reports");
  const sp = await searchParams;
  const tab = sp.tab ?? "workbench";
  const [w, rec] = await Promise.all([expiryWorkbench(ctx), claimReconciliation(ctx)]);
  const claimable = w.filter((x) => x.eligible);
  const sel = w.find((x) => x.batchId === sp.claim);
  return (
    <>
      <PageHead title="Expiry management & supplier claims" sub="Expiry identification → return eligibility (principal's window) → claim → acknowledgement → credit note → reconciliation." />
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-4">
        <Stat label="Expired / ≤30 days" value={inr(w.filter((x) => x.band === "expired" || x.band === "30").reduce((a, x) => a + x.value, 0))} tone="red" />
        <Stat label="Claimable now" value={inr(claimable.reduce((a, x) => a + x.value, 0))} note={`expected credit ${inr(claimable.reduce((a, x) => a + x.expectedCredit, 0))}`} tone="amber" />
        <Stat label="Claims open" value={inr(rec.suppliers.reduce((a, s) => a + s.open, 0))} />
        <Stat label="Credited (all time)" value={inr(rec.suppliers.reduce((a, s) => a + s.credited, 0))} tone="green" />
      </div>
      <Tabs active={tab} tabs={[{ key: "workbench", label: "Expiry workbench", href: "?tab=workbench", count: w.length }, { key: "claims", label: "Claims", href: "?tab=claims", count: rec.rows.filter((r) => r.open > 0).length }, { key: "recon", label: "Reconciliation", href: "?tab=recon" }]} />
      {tab === "workbench" ? (
        <>
          {sel && distCan(ctx, "purchase") ? (
            <Panel title={`Claim ${sel.medicine} · ${sel.batchNo}`} sub={sel.why} className="mb-4">
              <ActForm action={raiseClaimAction} submit="Raise claim" inline redirectTo="/dist/expiry?tab=claims">
                <input type="hidden" name="batchId" value={sel.batchId} />
                <F label="Packs" name="qty" type="number" min={1} max={sel.onShelf + sel.quarantined} defaultValue={sel.onShelf + sel.quarantined} className="w-[100px]" />
                <label className="flex flex-col gap-1 text-[12px] font-medium text-[#4A5A73]">Reason<select name="reason" defaultValue={sel.daysLeft <= 0 ? "expiry" : "near_expiry"} className="h-[36px] rounded-md border border-[#C9D2DE] px-2 text-[13px]"><option value="expiry">Expired</option><option value="near_expiry">Near expiry</option><option value="breakage">Breakage</option></select></label>
                <F label="Note" name="note" className="w-[220px]" />
              </ActForm>
            </Panel>
          ) : null}
          <Panel pad={false}>
            <DataTable cols={[{ label: "Product" }, { label: "Company" }, { label: "Batch" }, { label: "Expiry" }, { label: "Band" }, { label: "On shelf", num: true }, { label: "Returned (quarantine)", num: true }, { label: "Value", num: true }, { label: "Claim" }, { label: "" }]}
              rows={w.map((x) => [x.medicine, x.company, x.batchNo, dateIN(x.expiry), <Pill key="b" tone={BAND[x.band][1]}>{BAND[x.band][0]}</Pill>, x.onShelf, x.quarantined || "", inr(x.value),
                x.eligible ? <span key="e" className="text-[12px] text-[#1E7F4F]">Eligible · expect {inr(x.expectedCredit)} ({x.creditPct}%)</span> : <span key="e" className="text-[12px] text-[#5B6B82]">{x.why}</span>,
                x.eligible && distCan(ctx, "purchase") ? <a key="c" href={`?claim=${x.batchId}`}>Claim</a> : ""])} empty="Nothing expires in the next 180 days." />
          </Panel>
        </>
      ) : tab === "claims" ? (
        <Panel pad={false}>
          <DataTable cols={[{ label: "Claim" }, { label: "Supplier" }, { label: "Item" }, { label: "Packs", num: true }, { label: "Reason" }, { label: "Raised" }, { label: "Claim", num: true }, { label: "Credited", num: true }, { label: "Open", num: true }, { label: "Status" }, { label: "" }]}
            rows={rec.rows.map((r) => [r.no, r.supplier, r.item, r.packs, r.reason, `${dateIN(r.raisedAt)} (${r.ageDays} d)`, inr(r.claim), inr(r.credited), inr(r.open), <Pill key="s" tone={STATUS_TONE[r.status]}>{r.status}</Pill>,
              r.open > 0 && distCan(ctx, "purchase") ? (
                <div key="a" className="flex flex-col gap-1 min-w-[220px]">
                  {r.status === "raised" ? <ActButton size="sm" label="Supplier acknowledged" action={async () => { "use server"; return ackClaimAction(r.id); }} /> : null}
                  <details><summary className="cursor-pointer text-[12.5px] text-[#0B2545] font-semibold">Record credit note</summary>
                    <ActForm action={creditClaimAction} submit="Save" className="mt-1">
                      <input type="hidden" name="id" value={r.id} />
                      <Grid cols={2}><F label="CN no." name="ref" /><F label="Amount ₹" name="amount" inputMode="decimal" /></Grid>
                      <Check name="close" label="Close claim (write off the rest)" />
                      <F label="Reason for write-off" name="reason" />
                    </ActForm>
                  </details>
                </div>) : ""])} empty="No claims yet." />
        </Panel>
      ) : (
        <Panel pad={false} title="Claim reconciliation by supplier">
          <DataTable cols={[{ label: "Supplier" }, { label: "Claims", num: true }, { label: "Claimed", num: true }, { label: "Credited", num: true }, { label: "Written off", num: true }, { label: "Open", num: true }, { label: "Oldest open", num: true }, { label: "Recovery %", num: true }]}
            rows={rec.suppliers.map((s) => [s.supplier, s.claims, inr(s.claimed), inr(s.credited), inr(s.writtenOff), inr(s.open), s.oldestOpenDays ? `${s.oldestOpenDays} d` : "—", s.claimed ? `${Math.round((s.credited / s.claimed) * 100)}%` : "—"])} empty="No claims yet." />
        </Panel>
      )}
    </>
  );
}

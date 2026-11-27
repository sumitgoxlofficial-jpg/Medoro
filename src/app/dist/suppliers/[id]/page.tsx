import { notFound } from "next/navigation";
import { requireDistCtx, distCan } from "@/domain/distribution/context";
import { payables, supplierStatement } from "@/domain/distribution/payables";
import { db } from "@/server/db";
import { inr } from "@/lib/money";
import { DataTable, dateIN, PageHead, Panel, Stat } from "../../_ui/ui";
import { ActForm, F, Grid, S } from "../../_ui/forms";
import { paySupplierAction } from "../../actions";

export const metadata = { title: "Supplier ledger" };

/** One supplier: what we owe, the ledger statement from the books, recent GRNs, and paying the supplier. */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const ctx = await requireDistCtx();
  const { id } = await params;
  const sp = await searchParams;
  const s = (await payables(ctx)).find((x) => x.id === id);
  if (!s) notFound();
  const [st, grns] = await Promise.all([
    supplierStatement(ctx, id, sp.from, sp.to),
    db.grn.findMany({ where: { tenantId: ctx.tenantId, supplierId: id }, orderBy: { invoiceDate: "desc" }, take: 15 }),
  ]);
  return (
    <>
      <PageHead title={s.name} back={{ href: "/dist/companies", label: "Companies, principals & suppliers" }} sub={`${s.gstin ? "GSTIN " + s.gstin + " · " : ""}${s.creditDays} credit days · lead time ${s.leadDays} days`} />
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-4">
        <Stat label="We owe" value={inr(s.balance)} tone={s.balance > 0 ? "amber" : "navy"} />
        <Stat label="Credit days" value={String(s.creditDays)} />
        <Stat label="Last purchase" value={s.lastPurchase ? dateIN(s.lastPurchase) : "—"} />
        <Stat label="Last payment" value={s.lastPayment ? dateIN(s.lastPayment) : "—"} />
      </div>
      {distCan(ctx, "payments") ? (
        <Panel title="Pay supplier" sub="Posts a payment voucher and settles the oldest bills first. Cheques go to Cheques issued until they clear." className="mb-4">
          <ActForm action={paySupplierAction} submit="Record payment" resetOnOk confirm="Record this payment to the supplier?">
            <input type="hidden" name="partyId" value={id} />
            <Grid cols={4}>
              <F label="Amount ₹" name="amount" inputMode="decimal" required />
              <S label="Mode" name="method" options={["Bank transfer (NEFT)", "Cheque", "UPI", "Cash"].map((m) => ({ value: m, label: m }))} />
              <F label="UTR / reference" name="ref" />
              <F label="Cheque no." name="chequeNo" />
              <F label="Bank" name="bank" />
              <F label="Cheque date" name="chequeDate" type="date" />
            </Grid>
          </ActForm>
        </Panel>
      ) : null}
      <Panel title="Ledger statement" sub={`Opening ${inr(st.opening)} · closing ${inr(st.closing)} (credit = we owe)`} pad={false} className="mb-4"
        right={<form className="flex gap-1.5"><input type="date" name="from" defaultValue={sp.from} aria-label="From" className="h-8 border border-input rounded px-1 text-[12.5px]" /><input type="date" name="to" defaultValue={sp.to} aria-label="To" className="h-8 border border-input rounded px-1 text-[12.5px]" /><button className="h-8 px-2.5 border border-input rounded text-[12.5px] font-semibold">Show</button></form>}>
        <DataTable dense cols={[{ label: "Date" }, { label: "Voucher" }, { label: "Particulars" }, { label: "Debit", num: true }, { label: "Credit", num: true }, { label: "Balance", num: true }]}
          rows={st.rows.map((r) => [dateIN(r.date), r.no, r.narration, r.dr ? inr(r.dr) : "", r.cr ? inr(r.cr) : "", inr(r.balance)])} empty="No entries in this period." />
      </Panel>
      <Panel title="Recent GRNs" pad={false}>
        <DataTable dense cols={[{ label: "GRN" }, { label: "Supplier invoice" }, { label: "Date" }, { label: "Total", num: true }]}
          rows={grns.map((g) => [g.no, g.supplierInvoiceNo, dateIN(g.invoiceDate.toISOString().slice(0, 10)), inr(Number(g.totalPaise))])} empty="No purchases yet." />
      </Panel>
    </>
  );
}

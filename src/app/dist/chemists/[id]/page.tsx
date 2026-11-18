import { notFound } from "next/navigation";
import Link from "next/link";
import { requireDistCtx, distCan } from "@/domain/distribution/context";
import { listChemists } from "@/domain/distribution/masters";
import { chemistStatement, receivables } from "@/domain/distribution/receivables";
import { listInvoices } from "@/domain/distribution/billing";
import { listOrders } from "@/domain/distribution/orders";
import { listProducts } from "@/domain/distribution/masters";
import { db } from "@/server/db";
import { inr } from "@/lib/money";
import { isoOf } from "@/lib/dates";
import { DataTable, dateIN, PageHead, Panel, Pill, Stat, STATUS_TONE } from "../../_ui/ui";
import { ActButton, ActForm, F, Grid, S } from "../../_ui/forms";
import { chemistStatusAction, specialRateAction, verifyKycAction } from "../../actions";

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const ctx = await requireDistCtx();
  const { id } = await params;
  const sp = await searchParams;
  const c = (await listChemists(ctx)).find((x) => x.id === id);
  if (!c) notFound();
  const [st, rec, invs, orders, rates, products] = await Promise.all([
    chemistStatement(ctx, id, sp.from, sp.to), receivables(ctx).then((r) => r.find((x) => x.customerId === id)), listInvoices(ctx, { customerId: id, take: 30 }), listOrders(ctx, { customerId: id, status: "all", take: 20 }),
    db.distSpecialRate.findMany({ where: { tenantId: ctx.tenantId, customerId: id } }), distCan(ctx, "masters") ? listProducts(ctx, { take: 2000 }) : Promise.resolve([]),
  ]);
  const verify = verifyKycAction.bind(null, id);
  return (
    <>
      <PageHead title={c.name} back={{ href: "/dist/chemists", label: "Chemists" }} sub={`${c.dl20b} / ${c.dl21b} · licence valid to ${c.dlExpiry}${c.gstin ? " · GSTIN " + c.gstin : ""}`}
        actions={distCan(ctx, "masters") ? <>
          {!c.kycVerified ? <ActButton action={async () => { "use server"; return verify(); }} label="Mark licence verified" confirm="Have you checked the licence copy against these numbers?" /> : <Pill tone="green">Licence verified</Pill>}
          {c.status !== "active" ? <ActButton action={async (r) => { "use server"; return chemistStatusAction(id, "active", r); }} label="Release hold" ask="Note (optional)" /> : <ActButton action={async (r) => { "use server"; return chemistStatusAction(id, "hold", r); }} label="Put on hold" ask="Why is this account on hold?" />}
          {c.status !== "blocked" ? <ActButton variant="danger" action={async (r) => { "use server"; return chemistStatusAction(id, "blocked", r); }} label="Block" ask="Why is this account blocked?" /> : null}
          <Link href={`/dist/chemists?edit=${id}`} className="h-[36px] inline-flex items-center px-3 border border-[#C9D2DE] rounded-lg text-[13px] font-semibold">Edit</Link>
        </> : null} />
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5 mb-4">
        <Stat label="Balance" value={inr(rec?.balance ?? 0)} />
        <Stat label="Overdue" value={inr(rec?.overdue ?? 0)} tone={rec?.overdue ? "amber" : "navy"} />
        <Stat label="Credit limit" value={inr(c.creditLimit)} note={`${c.creditDays} days + ${c.graceDays} grace`} />
        <Stat label="Oldest open bill" value={`${rec?.oldestDays ?? 0} d`} />
        <Stat label="Credit risk" value={<Pill tone={STATUS_TONE[rec?.risk.level ?? "low"]}>{`${rec?.risk.level ?? "low"} · ${rec?.risk.score ?? 0}`}</Pill>} note={rec?.risk.factors.join("; ")} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2 mb-4">
        <Panel title="Open bills (FIFO)" pad={false}>
          <DataTable dense cols={[{ label: "Bill" }, { label: "Date" }, { label: "Due" }, { label: "Open", num: true }, { label: "Overdue", num: true }]}
            rows={(rec?.open ?? []).map((b) => [b.id === "opening" ? b.no : <Link key="b" href={`/dist/invoices/${b.id}`}>{b.no}</Link>, dateIN(b.date), dateIN(b.dueDate), inr(b.open), b.overdueDays ? `${b.overdueDays} d` : "—"])} empty="Nothing outstanding." />
        </Panel>
        <Panel title="Recent orders" pad={false}>
          <DataTable dense cols={[{ label: "Order" }, { label: "Placed" }, { label: "Source" }, { label: "Value", num: true }, { label: "Status" }]}
            rows={orders.map((o) => [<Link key="o" href={`/dist/orders/${o.id}`}>{o.no}</Link>, dateIN(o.placedAt), o.source, inr(o.estimate), <Pill key="s" tone={STATUS_TONE[o.status]}>{o.status}</Pill>])} empty="No orders yet." />
        </Panel>
      </div>
      <Panel title="Ledger statement" sub={`Opening ${inr(st.opening)} · closing ${inr(st.closing)}`} pad={false} right={<form className="flex gap-1.5"><input type="date" name="from" defaultValue={sp.from} className="h-8 border border-[#C9D2DE] rounded px-1 text-[12px]" /><input type="date" name="to" defaultValue={sp.to} className="h-8 border border-[#C9D2DE] rounded px-1 text-[12px]" /><button className="h-8 px-2 border border-[#C9D2DE] rounded text-[12px]">Show</button></form>} className="mb-4">
        <DataTable dense cols={[{ label: "Date" }, { label: "Voucher" }, { label: "Particulars" }, { label: "Debit", num: true }, { label: "Credit", num: true }, { label: "Balance", num: true }]}
          rows={st.rows.map((r) => [dateIN(r.date), r.no, r.narration, r.dr ? inr(r.dr) : "", r.cr ? inr(r.cr) : "", inr(r.balance)])} empty="No entries in this period." />
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Recent invoices" pad={false}>
          <DataTable dense cols={[{ label: "Invoice" }, { label: "Date" }, { label: "Total", num: true }, { label: "" }]}
            rows={invs.map((i) => [<Link key="i" href={`/dist/invoices/${i.id}`}>{i.no}</Link>, dateIN(i.date), inr(i.total), i.cancelled ? <Pill key="c" tone="gray">Cancelled</Pill> : ""])} />
        </Panel>
        {distCan(ctx, "masters") ? (
          <Panel title="Special rates" sub="Net rate for this chemist; overrides PTR / PTS.">
            <ActForm action={specialRateAction} submit="Save rate" resetOnOk>
              <input type="hidden" name="customerId" value={id} />
              <Grid cols={3}>
                <S label="Product" name="medicineId" options={products.filter((p) => p.distReady).map((p) => ({ value: p.id, label: `${p.name} (PTR ${inr(p.ptr)})` }))} />
                <F label="Rate ₹ (ex-GST)" name="rate" inputMode="decimal" required />
                <F label="Valid until" name="validTo" type="date" />
              </Grid>
            </ActForm>
            <ul className="mt-3 text-[13px] list-none p-0 m-0 flex flex-col gap-1">
              {rates.map((r) => <li key={r.id}>{products.find((p) => p.id === r.medicineId)?.name}: <strong>{inr(Number(r.ratePaise))}</strong>{r.validTo ? ` until ${isoOf(r.validTo)}` : ""}</li>)}
            </ul>
          </Panel>
        ) : null}
      </div>
    </>
  );
}

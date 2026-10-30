import { notFound } from "next/navigation";
import { requireCtx, can } from "@/server/context";
import { db } from "@/server/db";
import { big, inr } from "@/lib/money";
import { priceLine } from "@/domain/purchasing/pricing";
import { AutoPrint } from "../../invoice/[id]/auto-print";

export const metadata = { title: "Purchase order" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  if (!can(ctx, "purchase")) notFound();
  const { id } = await params;
  const po = await db.purchaseOrder.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { items: true, supplier: true } });
  if (!po) notFound();
  const [tenant, branch, meds] = await Promise.all([
    db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }), db.branch.findUniqueOrThrow({ where: { id: po.branchId } }),
    db.medicine.findMany({ where: { id: { in: po.items.map((i) => i.medicineId) } } }),
  ]);
  const net = (i: (typeof po.items)[number]) => priceLine({ qty: i.qty, rate: big(i.ratePaise), gstRate: 0, schemePct: Number(i.schemePct), tradePct: Number(i.tradePct), cashPct: Number(i.cashPct) }).net;
  const deal = (i: (typeof po.items)[number]) => [i.scheme || (i.freeQty ? `+${i.freeQty} free` : ""), ...([["Sch", i.schemePct], ["TD", i.tradePct], ["CD", i.cashPct]] as const).filter(([, v]) => Number(v)).map(([k, v]) => `${k} ${Number(v)}%`)].filter(Boolean).join(" · ");
  const total = po.items.reduce((a, i) => a + net(i), 0);
  return (
    <div className="a4">
      <style>{`@page{size:A4;margin:14mm}body{background:#fff}.a4{max-width:186mm;margin:0 auto;font-size:12px;color:#111}.a4 table{width:100%;border-collapse:collapse}.a4 th,.a4 td{border:1px solid #bbb;padding:5px 6px;text-align:left}.a4 th{background:#f2f4f5}.num{text-align:right!important}@media screen{body{background:#F5F6F7}.a4{background:#fff;padding:14mm;margin:20px auto}}`}</style>
      <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "2px solid #0B5E5B", paddingBottom: 8, marginBottom: 12 }}>
        <div><div style={{ fontSize: 18, fontWeight: 700 }}>{tenant.name}</div><div>{branch.address}</div><div>{branch.gstin ? `GSTIN ${branch.gstin}` : ""}{branch.drugLicence ? ` · DL ${branch.drugLicence}` : ""}</div></div>
        <div style={{ textAlign: "right" }}><div style={{ fontSize: 16, fontWeight: 700 }}>PURCHASE ORDER</div><div style={{ fontFamily: "monospace" }}>{po.no}</div><div>{po.createdAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}</div></div>
      </div>
      <div style={{ marginBottom: 10 }}><strong>To:</strong> {po.supplier.name}{po.supplier.gstin ? ` · GSTIN ${po.supplier.gstin}` : ""}{po.supplier.phone ? ` · ${po.supplier.phone}` : ""}</div>
      <table>
        <thead><tr><th>#</th><th>Item</th><th>Pack</th><th className="num">Qty</th><th className="num">PTR (ex-GST)</th><th>Scheme / discount</th><th className="num">Value</th></tr></thead>
        <tbody>{po.items.map((i, n) => { const m = meds.find((x) => x.id === i.medicineId)!; return <tr key={i.id}><td>{n + 1}</td><td>{m.name} {m.strength}</td><td>{m.pack}</td><td className="num">{i.qty}</td><td className="num">{inr(big(i.ratePaise))}</td><td>{deal(i)}</td><td className="num">{inr(net(i))}</td></tr>; })}</tbody>
        <tfoot><tr><th colSpan={6}>Total after discounts (excluding GST)</th><th className="num">{inr(total)}</th></tr></tfoot>
      </table>
      <p style={{ marginTop: 12 }}>Please supply batches with at least 12 months to expiry where possible and quote the PO number on your invoice.</p>
      <AutoPrint />
    </div>
  );
}

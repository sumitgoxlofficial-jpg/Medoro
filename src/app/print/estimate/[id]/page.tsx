import { notFound } from "next/navigation";
import { requireCtx } from "@/server/context";
import { estimateData } from "@/domain/sales/estimate";
import { inr } from "@/lib/money";
import { AutoPrint } from "../../invoice/[id]/auto-print";

export const metadata = { title: "Estimate" };

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const e = await estimateData(ctx, (await params).id);
  if (!e) notFound();
  return (
    <div className="a4">
      <style>{`@page{size:A4;margin:14mm}body{background:#fff}.a4{max-width:186mm;margin:0 auto;font-size:11.5px;color:#111}.a4 table{width:100%;border-collapse:collapse}.a4 th,.a4 td{border:1px solid #bbb;padding:4px 6px;text-align:left}.a4 .num{text-align:right}`}</style>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, borderBottom: "2px solid #0B5E5B", paddingBottom: 8, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{e.pharmacy.legalName ?? e.pharmacy.name}</div>
          {e.pharmacy.address ? <div>{e.pharmacy.address}</div> : null}
          {e.pharmacy.gstin ? <div>GSTIN {e.pharmacy.gstin}</div> : null}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>ESTIMATE</div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{e.no}</div>
          <div>{fmtDate(e.createdAt)}</div>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 10 }}>
        <div><strong>For:</strong> {e.customerName || "Customer"}{e.phone ? ` · ${e.phone}` : ""}</div>
        <div><strong>Valid until:</strong> {fmtDate(e.validUntil)}</div>
      </div>
      <table>
        <thead><tr><th>#</th><th>Item</th><th className="num">Qty</th><th className="num">MRP</th><th className="num">Amount</th></tr></thead>
        <tbody>
          {e.lines.map((l, i) => <tr key={i}><td>{i + 1}</td><td>{l.name}{l.strength ? ` ${l.strength}` : ""}</td><td className="num">{l.qty}</td><td className="num">{inr(l.mrpPaise)}</td><td className="num">{inr(l.amountPaise)}</td></tr>)}
        </tbody>
        <tfoot><tr><th colSpan={4} className="num">Estimated total (inclusive of GST)</th><th className="num" style={{ fontSize: 14 }}>{inr(e.total)}</th></tr></tfoot>
      </table>
      {e.notes ? <div style={{ marginTop: 10 }}><strong>Notes:</strong> {e.notes}</div> : null}
      <div style={{ marginTop: 10, color: "#555" }}>This is an estimate, not a tax invoice. Prices are the MRP today and stock is confirmed when the bill is made. Prepared by {e.by}.</div>
      <AutoPrint />
    </div>
  );
}

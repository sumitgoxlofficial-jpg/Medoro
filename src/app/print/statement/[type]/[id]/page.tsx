import { notFound } from "next/navigation";
import { requireCtx } from "@/server/context";
import { UserError } from "@/server/action";
import { db } from "@/server/db";
import { partyStatement, type PartyType } from "@/domain/parties/statement";
import { inr } from "@/lib/money";
import { dayMonth } from "@/lib/dates";
import { AutoPrint } from "../../../invoice/[id]/auto-print";

export const metadata = { title: "Statement of account" };

export default async function Page({ params, searchParams }: { params: Promise<{ type: string; id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const ctx = await requireCtx();
  const { type, id } = await params;
  if (type !== "supplier" && type !== "customer") notFound();
  const sp = await searchParams;
  let s;
  try { s = await partyStatement(ctx, type as PartyType, id, sp.from, sp.to); } catch (e) { if (e instanceof UserError || (e instanceof Error && "status" in e)) notFound(); throw e; }
  const [tenant, branch] = await Promise.all([db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }), db.branch.findUniqueOrThrow({ where: { id: ctx.branchId } })]);
  const gstin = branch.gstin ?? tenant.gstin;
  return (
    <div className="a4">
      <style>{`@page{size:A4;margin:14mm}body{background:#fff}.a4{max-width:186mm;margin:0 auto;font-size:12px;color:#111}.a4 table{width:100%;border-collapse:collapse}.a4 th,.a4 td{border:1px solid #bbb;padding:5px 6px;text-align:left;vertical-align:top}.a4 th{background:#f2f4f5}.num{text-align:right!important;white-space:nowrap}@media screen{body{background:#F5F6F7}.a4{background:#fff;padding:14mm;margin:20px auto}}`}</style>
      <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "2px solid #0B5E5B", paddingBottom: 8, marginBottom: 12 }}>
        <div><div style={{ fontSize: 18, fontWeight: 700 }}>{tenant.name}</div><div>{branch.address}</div><div>{gstin ? `GSTIN ${gstin}` : ""}</div></div>
        <div style={{ textAlign: "right" }}><div style={{ fontSize: 16, fontWeight: 700 }}>STATEMENT OF ACCOUNT</div><div>{s.fromDay} to {s.toDay}</div></div>
      </div>
      <div style={{ marginBottom: 10 }}><strong>{type === "supplier" ? "Supplier" : "Customer"}:</strong> {s.party.name}{s.party.gstin ? ` · GSTIN ${s.party.gstin}` : ""}{s.party.phone ? ` · ${s.party.phone}` : ""}</div>
      <table>
        <thead><tr><th>Date</th><th>Voucher</th><th>Type</th><th>Particulars</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
        <tbody>
          <tr><td>{s.fromDay}</td><td colSpan={5}><strong>Opening balance</strong></td><td className="num">{inr(s.opening)}</td></tr>
          {s.rows.map((r) => <tr key={r.id}><td>{dayMonth(new Date(r.date), true)}</td><td style={{ fontFamily: "monospace" }}>{r.no}</td><td>{r.kind}</td><td>{r.narration}</td><td className="num">{r.debit ? inr(r.debit) : ""}</td><td className="num">{r.credit ? inr(r.credit) : ""}</td><td className="num">{inr(r.balance)}</td></tr>)}
        </tbody>
        <tfoot><tr><th colSpan={4}>Closing balance · {type === "supplier" ? "payable to supplier" : "receivable from customer"}</th><th className="num">{inr(s.debit)}</th><th className="num">{inr(s.credit)}</th><th className="num">{inr(s.closing)}</th></tr></tfoot>
      </table>
      <p style={{ marginTop: 12 }}>Please report any difference within 15 days of receiving this statement. Computer-generated statement; no signature required.</p>
      <AutoPrint />
    </div>
  );
}

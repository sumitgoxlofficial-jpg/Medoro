import { requireDistCtx, distView } from "@/domain/distribution/context";
import { distGstr1, distGstr3b, distRegistrations } from "@/domain/distribution/gst";
import { inr } from "@/lib/money";
import { todayISO } from "@/lib/dates";
import { DataTable, Note, PageHead, Panel, Stat } from "../_ui/ui";

export const metadata = { title: "GST returns" };

export default async function Page({ searchParams }: { searchParams: Promise<{ month?: string; gstin?: string }> }) {
  const ctx = await requireDistCtx();
  distView(ctx, "reports");
  const sp = await searchParams;
  const regs = await distRegistrations(ctx);
  const gstin = sp.gstin ?? regs.list[0]?.gstin;
  const month = sp.month ?? todayISO().slice(0, 7);
  if (!gstin) return <><PageHead title="GST returns" /><Note tone="amber">Add your GSTIN to the godown or business settings to prepare returns.</Note></>;
  const [g1, g3] = await Promise.all([distGstr1(ctx, gstin, month), distGstr3b(ctx, gstin, month)]);
  const inv = g1.docs.filter((d) => d.kind === "inv"), cn = g1.docs.filter((d) => d.kind === "cn");
  const sum = (ds: typeof inv, k: "taxable" | "igst" | "cgst" | "sgst") => ds.reduce((a, d) => a + d.lines.reduce((x, l) => x + l[k], 0), 0);
  const q = `gstin=${gstin}&month=${month}`;
  return (
    <>
      <PageHead title="GST reports & returns" sub="GSTR-1 and GSTR-3B from posted wholesale invoices, credit notes and GRNs. Download the JSON for the GSTN offline tool; filing is done on the GST portal." actions={<>
        <a href={`/api/dist/gst?kind=gstr1&${q}`} className="h-[36px] inline-flex items-center px-3 border border-input rounded-lg text-[13px] font-semibold">GSTR-1 JSON</a>
        <a href={`/api/dist/gst?kind=gstr3b&${q}`} className="h-[36px] inline-flex items-center px-3 border border-input rounded-lg text-[13px] font-semibold">GSTR-3B JSON</a>
        <a href={`/api/dist/gst?kind=hsn&${q}`} className="h-[36px] inline-flex items-center px-3 border border-input rounded-lg text-[13px] font-semibold">HSN CSV</a>
      </>} />
      <form className="flex gap-2 mb-4 flex-wrap"><select name="gstin" defaultValue={gstin} className="h-9 border border-input rounded px-2 text-[13px]">{regs.list.map((r) => <option key={r.gstin} value={r.gstin}>{r.gstin} · {r.state}</option>)}</select><input type="month" name="month" defaultValue={month} className="h-9 border border-input rounded px-2 text-[13px]" /><button className="h-9 px-3 border border-input rounded text-[13px]">Show</button></form>
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-4">
        <Stat label="Invoices" value={inv.length} note={`${inv.filter((d) => d.ctin).length} B2B · ${g1.cancelled.length} cancelled`} />
        <Stat label="Taxable value" value={inr(sum(inv, "taxable") - sum(cn, "taxable"))} note="after credit notes" />
        <Stat label="Output tax" value={inr(sum(inv, "igst") + sum(inv, "cgst") + sum(inv, "sgst") - sum(cn, "igst") - sum(cn, "cgst") - sum(cn, "sgst"))} />
        <Stat label="Input tax credit" value={inr(g3.itc.igst + g3.itc.cgst + g3.itc.sgst - g3.itc.revIgst - g3.itc.revCgst - g3.itc.revSgst)} note="from GRNs less reversals" tone="green" />
      </div>
      <Panel title="HSN summary (Table 12)" pad={false} className="mb-4">
        <DataTable dense cols={[{ label: "Type" }, { label: "HSN" }, { label: "UQC" }, { label: "Rate", num: true }, { label: "Qty", num: true }, { label: "Taxable", num: true }, { label: "IGST", num: true }, { label: "CGST", num: true }, { label: "SGST", num: true }]}
          rows={g1.hsn.map((h) => [h.b2b ? "B2B" : "B2C", h.hsn, h.uqc, `${h.rate}%`, h.qty, inr(h.taxable), inr(h.igst), inr(h.cgst), inr(h.sgst)])} empty="No supplies this month." />
      </Panel>
      <Note tone="blue">E-invoicing (IRN) and e-way bills need your own NIC or GSP credentials; see Settings → Integrations for the real status. Returns here are prepared, not filed.</Note>
    </>
  );
}

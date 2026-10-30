import { requireCtx } from "@/server/context";
import { labelRows } from "@/domain/inventory/catalog";
import { barcodeSvg } from "@/lib/barcode";
import { inr } from "@/lib/money";
import { monthYear } from "@/lib/dates";
import { AutoPrint } from "../invoice/[id]/auto-print";

export const metadata = { title: "Labels" };

const ids = (s?: string) => (s ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 500);

// 50 × 25 mm thermal roll, one label per page; or an A4 sheet of 3 × 10 labels (63.5 × 25.4 mm).
const CSS = {
  thermal: `@page{size:50mm 25mm;margin:0}.sheet{display:block}.lbl{width:50mm;height:25mm;page-break-after:always;break-after:page}`,
  a4: `@page{size:A4;margin:10.7mm 7.2mm}.sheet{display:grid;grid-template-columns:repeat(3,63.5mm);grid-auto-rows:25.4mm;column-gap:2.5mm}.lbl{width:63.5mm;height:25.4mm}.lbl:nth-child(30n){break-after:page}`,
};

export default async function Page({ searchParams }: { searchParams: Promise<{ b?: string; m?: string; size?: string; copies?: string }> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const size = sp.size === "a4" ? "a4" : "thermal";
  const rows = await labelRows(ctx, { batchIds: ids(sp.b), medicineIds: ids(sp.m) }, Number(sp.copies) || 1);
  return (
    <div>
      <style>{`body{background:#fff;margin:0}${CSS[size]}.lbl{box-sizing:border-box;padding:1.2mm 2mm;overflow:hidden;font-family:Arial,sans-serif;color:#000;display:flex;flex-direction:column;gap:.3mm}
.n{font-weight:700;font-size:8.5pt;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.m{font-size:6.5pt;display:flex;justify-content:space-between;gap:2mm;white-space:nowrap}
.bc{flex:1;min-height:0;display:flex;justify-content:center}.bc svg{height:100%;width:auto;max-width:100%}.none{font-size:6.5pt;color:#555;align-self:center}
@media screen{body{background:#F5F6F7}.sheet{padding:16px;gap:8px}.lbl{background:#fff;outline:1px dashed #bbb;margin-bottom:${size === "thermal" ? "8px" : "0"}}}`}</style>
      <div className="sheet">
        {rows.map((r) => (
          <div key={r.key} className="lbl">
            <div className="n">{r.name} {r.strength}</div>
            <div className="m"><span>{r.batchNo ? `B: ${r.batchNo}` : r.pack}</span><span>{r.expiry ? `Exp ${monthYear(r.expiry)}` : ""}</span><span><b>MRP {inr(r.mrp)}</b></span></div>
            {r.code ? <div className="bc" dangerouslySetInnerHTML={{ __html: barcodeSvg(r.code, { height: 34, module: 1 }).svg }} /> : <div className="none">No barcode</div>}
            {r.rack ? <div className="m"><span>Rack {r.rack}</span><span>{r.batchNo ? r.pack : ""}</span></div> : null}
          </div>
        ))}
      </div>
      {rows.length ? <AutoPrint /> : <p style={{ padding: 24 }}>Nothing to print: no batches with stock at this branch for the selected items.</p>}
    </div>
  );
}

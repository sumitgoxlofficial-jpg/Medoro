import { inr } from "@/lib/money";
import { rupeesInWords } from "@/lib/words";
import type { DistInvoiceView } from "@/domain/distribution/billing";

/** A4 wholesale GST tax invoice. Printed with the browser (Ctrl+P). */
export function InvoiceDoc({ v }: { v: DistInvoiceView }) {
  return (
    <article className="bg-white border border-line rounded-[10px] p-6 print:border-0 print:p-0 text-[12px] text-[#111]">
      <header className="flex flex-wrap justify-between gap-4 border-b-2 border-teal pb-3">
        <div>
          <div className="text-[18px] font-bold text-teal">{v.seller.name}</div>
          <div>{v.seller.address}</div>
          <div>GSTIN {v.seller.gstin ?? "—"} · DL {v.seller.dl ?? "—"}{v.seller.phone ? ` · ${v.seller.phone}` : ""}</div>
        </div>
        <div className="text-right">
          <div className="text-[15px] font-bold tracking-[0.06em]">TAX INVOICE</div>
          <div>No. <strong>{v.no}</strong></div>
          <div>Date {v.date} · Due {v.dueDate}</div>
          <div>Place of supply: {v.placeOfSupply} {v.pos}</div>
          {v.irn ? <div className="text-[10px] break-all max-w-[320px]">IRN {v.irn}</div> : null}
        </div>
      </header>
      {v.cancelled ? <div className="my-3 text-center text-[16px] font-bold text-[#B3261E] border-2 border-[#B3261E] rounded py-1">CANCELLED — {v.cancelled.reason}</div> : null}
      <section className="py-3 border-b border-[#ddd]">
        <div className="text-[11px] uppercase text-[#666]">Bill to</div>
        <div className="font-semibold text-[14px]">{v.buyer.name}</div>
        <div>{[v.buyer.address, v.buyer.pincode].filter(Boolean).join(", ")}</div>
        <div>GSTIN {v.buyer.gstin ?? "Unregistered"} · DL {v.buyer.dl}{v.buyer.phone ? ` · ${v.buyer.phone}` : ""}</div>
      </section>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse mt-2 text-[11.5px]">
          <thead><tr className="border-b border-[#999] text-left">{["#", "Product", "Mfr", "HSN", "Batch", "Exp", "Qty", "Free", "MRP", "Rate", "Disc", "Taxable", "GST %", "GST"].map((h) => <th key={h} className={`py-1 px-1 ${["Qty", "Free", "MRP", "Rate", "Disc", "Taxable", "GST %", "GST"].includes(h) ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
          <tbody>{v.lines.map((l, i) => (
            <tr key={l.id} className="border-b border-[#eee]">
              <td className="py-1 px-1">{i + 1}</td><td className="px-1">{l.name} <span className="text-[#666]">{l.pack}</span></td><td className="px-1">{l.company}</td><td className="px-1">{l.hsn}</td><td className="px-1">{l.batchNo}</td><td className="px-1">{l.expiry.slice(5, 7)}/{l.expiry.slice(2, 4)}</td>
              <td className="px-1 text-right">{l.qty}</td><td className="px-1 text-right">{l.freeQty || ""}</td><td className="px-1 text-right">{inr(l.mrp)}</td><td className="px-1 text-right">{inr(l.rate)}</td><td className="px-1 text-right">{l.discPct ? `${l.discPct}%` : ""}</td>
              <td className="px-1 text-right">{inr(l.taxable)}</td><td className="px-1 text-right">{l.gstRate}</td><td className="px-1 text-right">{inr(l.tax)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <footer className="grid sm:grid-cols-2 gap-4 mt-3">
        <div className="text-[11px]">
          <div><strong>Amount in words:</strong> {rupeesInWords(v.total)}</div>
          <div className="mt-2 text-[#555]">Goods once sold are subject to the return policy agreed with the distributor. Expired goods are accepted as per company policy. Subject to local jurisdiction.</div>
        </div>
        <dl className="grid grid-cols-2 m-0 gap-y-0.5 text-right">
          <dt>Gross</dt><dd className="m-0">{inr(v.gross)}</dd><dt>Discount</dt><dd className="m-0">−{inr(v.disc)}</dd><dt>Taxable</dt><dd className="m-0">{inr(v.taxable)}</dd>
          {v.igst ? <><dt>IGST</dt><dd className="m-0">{inr(v.igstAmt)}</dd></> : <><dt>CGST</dt><dd className="m-0">{inr(v.cgst)}</dd><dt>SGST</dt><dd className="m-0">{inr(v.sgst)}</dd></>}
          <dt>Round off</dt><dd className="m-0">{inr(v.roundOff)}</dd><dt className="font-bold text-[14px]">Total</dt><dd className="m-0 font-bold text-[14px]">{inr(v.total)}</dd>
        </dl>
      </footer>
    </article>
  );
}

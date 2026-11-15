"use client";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Printer, RotateCcw, Trash2 } from "lucide-react";
import { cartTotals, inr, toPaise } from "@/lib/money";
import { rupeesInWords } from "@/lib/words";
import { Field, btnGhost, btnPrimary, card, input } from "./ui";

/**
 * Free chemist bill generator. Runs entirely in the browser: nothing typed here is sent or stored. Totals use the same
 * maths as Medoro's own billing (src/lib/money.ts cartTotals): GST back-calculated from MRP per line, CGST = floor of
 * half, grand total rounded to the rupee. Printing renders a copy of the bill straight under <body> and hides
 * everything else (globals.css, "Free invoice generator print").
 */
type Line = { id: number; name: string; hsn: string; batch: string; exp: string; qty: string; mrp: string; gst: string };
type Head = { pharmacy: string; address: string; phone: string; dl: string; gstin: string; invoice: string; date: string; patient: string; patientPhone: string; doctor: string; doctorReg: string; payment: string };

const SAMPLE_HEAD: Head = {
  pharmacy: "Shree Ram Medical Store", address: "12, Main Road, Sector 4, Bokaro Steel City, Jharkhand 827004", phone: "+91 98765 43210",
  dl: "RLF20/BOK/1234/2024, RLF21/BOK/1234/2024", gstin: "20ABCDE1234F1Z5", invoice: "INV-0001", date: "", patient: "Ramesh Kumar", patientPhone: "", doctor: "Dr. A. Sinha", doctorReg: "", payment: "Cash",
};
const SAMPLE_LINES: Omit<Line, "id">[] = [
  { name: "Dolo 650 Tablet 15's", hsn: "3004", batch: "DOBS3021", exp: "08/27", qty: "2", mrp: "33.60", gst: "5" },
  { name: "Pan-D Capsule 15's", hsn: "3004", batch: "PDK24117", exp: "03/27", qty: "1", mrp: "199.00", gst: "5" },
  { name: "Volini Gel 30g", hsn: "3004", batch: "VLG8812", exp: "12/27", qty: "1", mrp: "155.00", gst: "5" },
];
const EMPTY_LINE: Omit<Line, "id"> = { name: "", hsn: "3004", batch: "", exp: "", qty: "1", mrp: "", gst: "5" };
const GST_OPTIONS = ["0", "5", "12", "18"];
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fmtDate = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso); return m ? `${m[3]}/${m[2]}/${m[1]}` : iso; };
const qtyOf = (s: string) => { const n = parseInt(s, 10); return Number.isFinite(n) && n > 0 ? n : 0; };

let nextId = 1;
const withId = (l: Omit<Line, "id">): Line => ({ ...l, id: nextId++ });

function Invoice({ head, lines, totals, discount }: { head: Head; lines: Line[]; totals: ReturnType<typeof cartTotals>; discount: number }) {
  const used = lines.filter((l) => l.name.trim() && qtyOf(l.qty) > 0);
  const slabs = new Map<number, { taxable: number; tax: number }>();
  used.forEach((l, i) => {
    const t = totals.lines[i], g = Number(l.gst);
    const s = slabs.get(g) ?? { taxable: 0, tax: 0 };
    slabs.set(g, { taxable: s.taxable + t.taxable, tax: s.tax + t.tax });
  });
  const cell = "border border-[#CBD2D0] px-1.5 py-1";
  return (
    <div className="bg-white text-[#111] text-[12px] leading-[1.4] p-5 font-sans">
      <div className="flex justify-between gap-4 border-b-2 border-[#111] pb-2">
        <div className="min-w-0">
          <div className="text-[18px] font-bold">{head.pharmacy || "Your pharmacy name"}</div>
          {head.address ? <div>{head.address}</div> : null}
          {head.phone ? <div>Phone: {head.phone}</div> : null}
        </div>
        <div className="text-right flex-none">
          <div className="text-[14px] font-bold">TAX INVOICE</div>
          {head.gstin ? <div>GSTIN: {head.gstin}</div> : null}
          {head.dl ? <div>D.L. No.: {head.dl}</div> : null}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 py-2 border-b border-[#CBD2D0]">
        <div>
          <div><b>Patient:</b> {head.patient || "—"}{head.patientPhone ? ` · ${head.patientPhone}` : ""}</div>
          <div><b>Doctor:</b> {head.doctor || "—"}{head.doctorReg ? ` (Reg. ${head.doctorReg})` : ""}</div>
        </div>
        <div className="text-right">
          <div><b>Invoice:</b> {head.invoice || "—"}</div>
          <div><b>Date:</b> {fmtDate(head.date) || "—"}</div>
          <div><b>Payment:</b> {head.payment}</div>
        </div>
      </div>
      <table className="w-full border-collapse mt-2 tabular-nums">
        <thead>
          <tr className="bg-[#F1F4F3]">
            {["#", "Medicine", "HSN", "Batch", "Exp", "Qty", "MRP", "GST", "Amount"].map((h) => <th key={h} className={`${cell} text-left font-semibold`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {used.length ? used.map((l, i) => (
            <tr key={l.id}>
              <td className={cell}>{i + 1}</td><td className={cell}>{l.name}</td><td className={cell}>{l.hsn}</td><td className={cell}>{l.batch}</td><td className={cell}>{l.exp}</td>
              <td className={`${cell} text-right`}>{qtyOf(l.qty)}</td><td className={`${cell} text-right`}>{inr(toPaise(l.mrp))}</td><td className={`${cell} text-right`}>{l.gst}%</td><td className={`${cell} text-right`}>{inr(totals.lines[i].amount)}</td>
            </tr>
          )) : <tr><td colSpan={9} className={`${cell} text-center text-[#666]`}>Add medicines to see them here</td></tr>}
        </tbody>
      </table>
      <div className="grid grid-cols-[1fr_auto] gap-6 mt-3 items-start">
        <table className="border-collapse tabular-nums self-start">
          <thead><tr className="bg-[#F1F4F3]">{["GST", "Taxable", "CGST", "SGST"].map((h) => <th key={h} className={`${cell} text-left font-semibold`}>{h}</th>)}</tr></thead>
          <tbody>
            {[...slabs].sort(([a], [b]) => a - b).map(([g, s]) => {
              const c = Math.floor(s.tax / 2);
              return <tr key={g}><td className={cell}>{g}%</td><td className={`${cell} text-right`}>{inr(s.taxable)}</td><td className={`${cell} text-right`}>{inr(c)}</td><td className={`${cell} text-right`}>{inr(s.tax - c)}</td></tr>;
            })}
          </tbody>
        </table>
        <table className="tabular-nums text-right min-w-[220px]">
          <tbody>
            <tr><td className="pr-4 py-0.5 text-left">Total (MRP)</td><td>{inr(totals.mrpTotal)}</td></tr>
            {totals.discount ? <tr><td className="pr-4 py-0.5 text-left">Discount ({discount}%)</td><td>−{inr(totals.discount)}</td></tr> : null}
            <tr><td className="pr-4 py-0.5 text-left">Taxable value</td><td>{inr(totals.taxable)}</td></tr>
            <tr><td className="pr-4 py-0.5 text-left">CGST + SGST</td><td>{inr(totals.cgst)} + {inr(totals.sgst)}</td></tr>
            <tr><td className="pr-4 py-0.5 text-left">Round off</td><td>{totals.roundOff >= 0 ? "" : "−"}{inr(Math.abs(totals.roundOff))}</td></tr>
            <tr className="text-[15px] font-bold border-t-2 border-[#111]"><td className="pr-4 pt-1 text-left">Net payable</td><td className="pt-1">{inr(totals.total)}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="mt-2"><b>Amount in words:</b> {rupeesInWords(totals.total)}</div>
      <div className="flex justify-between items-end gap-4 mt-6 text-[11px] text-[#444]">
        <div>Prices include GST. Goods once sold are subject to the pharmacy&rsquo;s return policy. Please check batch and expiry before use.</div>
        <div className="text-center flex-none"><div className="h-8" /><div className="border-t border-[#111] pt-1 px-6">Pharmacist&rsquo;s signature</div></div>
      </div>
    </div>
  );
}

export function InvoiceGenerator() {
  const [head, setHead] = useState<Head>(SAMPLE_HEAD);
  const [lines, setLines] = useState<Line[]>(() => SAMPLE_LINES.map(withId));
  const [discount, setDiscount] = useState("0");
  const [printing, setPrinting] = useState(false);

  // The date is filled in on the device, so the server-rendered page doesn't carry the build or request date.
  useEffect(() => { setHead((h) => (h.date ? h : { ...h, date: today() })); }, []);

  useEffect(() => {
    if (!printing) return;
    const html = document.documentElement;
    html.classList.add("print-invoice");
    const done = () => { html.classList.remove("print-invoice"); setPrinting(false); };
    window.addEventListener("afterprint", done, { once: true });
    const t = setTimeout(() => window.print(), 50);
    return () => { clearTimeout(t); window.removeEventListener("afterprint", done); html.classList.remove("print-invoice"); };
  }, [printing]);

  const d = Math.min(100, Math.max(0, parseFloat(discount) || 0));
  const used = useMemo(() => lines.filter((l) => l.name.trim() && qtyOf(l.qty) > 0), [lines]);
  const totals = useMemo(() => cartTotals(used.map((l) => ({ mrpPaise: Math.max(0, toPaise(l.mrp)), qty: qtyOf(l.qty), gstRate: Number(l.gst) })), d), [used, d]);

  const set = (k: keyof Head) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setHead((h) => ({ ...h, [k]: e.target.value }));
  const setLine = (id: number, k: keyof Omit<Line, "id">, v: string) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, [k]: v } : l)));
  const cellInput = "h-10 w-full min-w-0 rounded-md border border-[#C9D1CF] bg-white px-2 text-[15px] text-[var(--s-ink)] outline-none focus:border-[var(--s-brand)] focus:ring-2 focus:ring-[var(--s-brand)]/20";

  const headFields: [keyof Head, string, string?][] = [
    ["pharmacy", "Pharmacy name"], ["phone", "Phone"], ["address", "Address"], ["gstin", "GSTIN", "15 characters, e.g. 20ABCDE1234F1Z5"], ["dl", "Drug licence no(s).", "Form 20 / 21 numbers"],
    ["invoice", "Invoice no."], ["date", "Date"], ["patient", "Patient name"], ["patientPhone", "Patient phone"], ["doctor", "Doctor name"], ["doctorReg", "Doctor reg. no."],
  ];
  const gstinOk = !head.gstin || /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(head.gstin.trim().toUpperCase());

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="ig-details" className={`${card} flex flex-col gap-4`}>
        <h2 id="ig-details" className="m-0 text-[18px] font-semibold text-[var(--s-ink)]">Pharmacy, patient and doctor</h2>
        <div className="grid gap-3 grid-cols-1 min-[560px]:grid-cols-2 min-[960px]:grid-cols-3">
          {headFields.map(([k, name, hint]) => (
            <Field key={k} id={`ig-${k}`} name={name} hint={k === "gstin" && !gstinOk ? "This doesn't look like a valid GSTIN." : hint}>
              <input id={`ig-${k}`} type={k === "date" ? "date" : "text"} className={`${input} ${k === "gstin" && !gstinOk ? "border-[#B3261E]" : ""}`} value={head[k]} onChange={set(k)} aria-invalid={k === "gstin" ? !gstinOk : undefined} autoComplete="off" />
            </Field>
          ))}
          <Field id="ig-payment" name="Payment mode">
            <select id="ig-payment" className={input} value={head.payment} onChange={set("payment")}>{["Cash", "UPI", "Card", "Credit"].map((p) => <option key={p}>{p}</option>)}</select>
          </Field>
        </div>
      </section>

      <section aria-labelledby="ig-items" className={`${card} flex flex-col gap-4`}>
        <div className="flex flex-wrap gap-3 justify-between items-center">
          <h2 id="ig-items" className="m-0 text-[18px] font-semibold text-[var(--s-ink)]">Medicines</h2>
          <div className="flex gap-2">
            <button type="button" className={btnGhost} onClick={() => { setLines([withId(EMPTY_LINE)]); setHead((h) => ({ ...h, patient: "", patientPhone: "", doctor: "", doctorReg: "" })); }}><RotateCcw size={16} aria-hidden />Clear</button>
            <button type="button" className={btnGhost} onClick={() => setLines((ls) => [...ls, withId(EMPTY_LINE)])}><Plus size={16} aria-hidden />Add row</button>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <div aria-hidden className="hidden min-[900px]:grid grid-cols-[minmax(0,3fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,.8fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.2fr)_44px] gap-2 text-[12.5px] font-semibold uppercase tracking-[.05em] text-[var(--s-muted)]">
            <span>Medicine</span><span>HSN</span><span>Batch</span><span>Exp (MM/YY)</span><span>Qty</span><span>MRP ₹</span><span>GST</span><span className="text-right">Amount</span><span />
          </div>
          {lines.map((l, i) => {
            const amount = toPaise(l.mrp) * qtyOf(l.qty);
            const lbl = (s: string) => <span className="min-[900px]:hidden text-[12px] font-semibold text-[var(--s-muted)]">{s}</span>;
            return (
              <div key={l.id} className="grid gap-2 items-end grid-cols-2 min-[560px]:grid-cols-4 min-[900px]:grid-cols-[minmax(0,3fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,.8fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.2fr)_44px] max-[899px]:border-t max-[899px]:border-[var(--s-line)] max-[899px]:pt-3">
                <label className="flex flex-col gap-1 col-span-2 min-[560px]:col-span-4 min-[900px]:col-span-1">{lbl(`Medicine ${i + 1}`)}<input aria-label={`Medicine ${i + 1} name`} className={cellInput} value={l.name} onChange={(e) => setLine(l.id, "name", e.target.value)} placeholder="e.g. Dolo 650 Tablet 15's" /></label>
                <label className="flex flex-col gap-1">{lbl("HSN")}<input aria-label={`Medicine ${i + 1} HSN`} className={cellInput} value={l.hsn} onChange={(e) => setLine(l.id, "hsn", e.target.value)} inputMode="numeric" /></label>
                <label className="flex flex-col gap-1">{lbl("Batch")}<input aria-label={`Medicine ${i + 1} batch`} className={cellInput} value={l.batch} onChange={(e) => setLine(l.id, "batch", e.target.value.toUpperCase())} /></label>
                <label className="flex flex-col gap-1">{lbl("Exp (MM/YY)")}<input aria-label={`Medicine ${i + 1} expiry`} className={cellInput} value={l.exp} onChange={(e) => setLine(l.id, "exp", e.target.value)} placeholder="MM/YY" /></label>
                <label className="flex flex-col gap-1">{lbl("Qty")}<input aria-label={`Medicine ${i + 1} quantity`} className={cellInput} value={l.qty} onChange={(e) => setLine(l.id, "qty", e.target.value)} inputMode="numeric" /></label>
                <label className="flex flex-col gap-1">{lbl("MRP ₹")}<input aria-label={`Medicine ${i + 1} MRP`} className={cellInput} value={l.mrp} onChange={(e) => setLine(l.id, "mrp", e.target.value)} inputMode="decimal" /></label>
                <label className="flex flex-col gap-1">{lbl("GST")}<select aria-label={`Medicine ${i + 1} GST rate`} className={cellInput} value={l.gst} onChange={(e) => setLine(l.id, "gst", e.target.value)}>{GST_OPTIONS.map((g) => <option key={g} value={g}>{g}%</option>)}</select></label>
                <div className="flex flex-col gap-1 min-[900px]:items-end">{lbl("Amount")}<span className="h-10 flex items-center text-[15px] font-semibold tabular-nums text-[var(--s-ink)]">{inr(amount)}</span></div>
                <button type="button" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.id !== l.id) : [withId(EMPTY_LINE)]))} className="size-10 rounded-md flex items-center justify-center text-[var(--s-muted)] hover:bg-[#FDECEA] hover:text-[#B3261E] justify-self-end" aria-label={`Remove medicine ${i + 1}`}><Trash2 size={17} aria-hidden /></button>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-4 justify-between items-end border-t border-[var(--s-line)] pt-4">
          <div className="w-[160px]"><Field id="ig-discount" name="Bill discount %"><input id="ig-discount" className={input} inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field></div>
          <dl className="m-0 flex flex-wrap gap-x-6 gap-y-1 text-[15px] tabular-nums">
            <div className="flex gap-2"><dt className="text-[var(--s-muted)]">Taxable</dt><dd className="m-0 font-semibold">{inr(totals.taxable)}</dd></div>
            <div className="flex gap-2"><dt className="text-[var(--s-muted)]">GST</dt><dd className="m-0 font-semibold">{inr(totals.tax)}</dd></div>
            <div className="flex gap-2"><dt className="text-[var(--s-muted)]">Net payable</dt><dd className="m-0 text-[18px] font-bold text-[var(--s-brand-ink)]">{inr(totals.total)}</dd></div>
          </dl>
        </div>
      </section>

      <section aria-labelledby="ig-preview" className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3 justify-between items-center">
          <h2 id="ig-preview" className="m-0 text-[18px] font-semibold text-[var(--s-ink)]">Bill preview</h2>
          <button type="button" className={btnPrimary} onClick={() => setPrinting(true)} disabled={!used.length}><Printer size={17} aria-hidden />Print bill / Save PDF</button>
        </div>
        <div className="rounded-xl border border-[var(--s-line)] shadow-[0_24px_60px_-28px_rgba(14,22,20,.35)] overflow-x-auto">
          <div className="min-w-[680px]"><Invoice head={head} lines={lines} totals={totals} discount={d} /></div>
        </div>
      </section>

      {printing ? createPortal(<div id="invoice-print-root"><Invoice head={head} lines={lines} totals={totals} discount={d} /></div>, document.body) : null}
    </div>
  );
}

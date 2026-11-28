"use client";
// The letter as on paper, for the screen: used in the HRMS and on the public page where a candidate signs an offer (so it imports nothing
// from the HRMS actions).
import { useEffect, useRef, useState } from "react";
import type { Letter } from "@/staff/hrms/letters";
import { clauseParas, listLabel } from "@/staff/hrms/letters";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/** The company mark, faint, behind the text: once per printed page's height on screen, the way the PDF has it on every page. */
function Watermark({ name }: { name: string }) {
  const ref = useRef<HTMLDivElement>(null), [n, setN] = useState(1);
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setN(Math.max(1, Math.round(el.offsetHeight / 1120))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} aria-hidden className="absolute inset-0 pointer-events-none select-none overflow-hidden print:hidden">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center opacity-[.05]" style={{ top: 330 + i * 1120 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/medoro-mark.png" alt="" className="w-[260px] max-w-[60vw] h-auto" />
          <div className="text-[52px] max-[560px]:text-[30px] font-extrabold tracking-[.12em] text-[#0B5E5B] mt-2">{name.toUpperCase()}</div>
        </div>
      ))}
    </div>
  );
}

/** An e-signature (a small inline PNG; next/image has nothing to optimise). */
function SigImg({ png, alt }: { png: string; alt: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`data:image/png;base64,${png}`} alt={alt} className="max-h-11 w-auto" />;
}

/** The letter as on paper: letterhead, reference and date, numbered clauses with sub-clauses, tables, annexures, signature boxes and the watermark. */
export function LetterSheet({ l }: { l: Letter }) {
  const form = l.form ?? "letter";
  return (
    <div className="print-area relative bg-white text-[13px] leading-[1.7] border border-[#E2E8F0] rounded-xl overflow-hidden text-[#0f172a]">
      <div className="h-[7px] bg-[#0B5E5B]" />
      <Watermark name={l.company} />
      <div className="relative px-10 py-8 max-[560px]:px-4 max-[560px]:py-5">
        <div className="flex items-center gap-3 pb-4 border-b-[1.5px] border-[#0B5E5B] flex-wrap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/medoro-mark.png" alt="" className="h-[54px] w-auto flex-none" />
          <div className="flex-1 min-w-[180px]"><div className="text-[28px] font-extrabold text-[#0B5E5B] leading-none tracking-[-.01em]">{l.company}</div><div className="text-[9.5px] tracking-[.16em] text-[#64748B] mt-1.5">BILLING&nbsp; |&nbsp; INVENTORY&nbsp; |&nbsp; GST COMPLIANCE</div></div>
          <div className="text-right text-[11px] text-[#64748B] leading-[1.5] max-w-[260px] ml-auto"><div className="text-[9px] font-bold tracking-[.12em] text-[#0B5E5B]">REGISTERED OFFICE</div>{l.address ? <div>{l.address}</div> : null}{l.contact ? <div>{l.contact}</div> : null}</div>
        </div>
        <div className="flex justify-between text-[12px] text-[#64748B] mt-5 mb-4 gap-3 flex-wrap"><span>Ref: {l.ref}</span><span>Date: {l.date}</span></div>
        {form === "letter" ? (
          <>
            {l.confidential ? <div className="text-[10px] font-bold tracking-[.14em] text-[#0B5E5B] mb-3">STRICTLY PRIVATE AND CONFIDENTIAL</div> : null}
            <div className="font-bold text-[14px]">{l.to}</div>
            {l.toLine ? <div className="text-[12.5px] text-[#64748B]">{l.toLine}</div> : null}
            {l.toAddress ? <div className="text-[12.5px] text-[#64748B] max-w-[360px]">{l.toAddress}</div> : null}
            <div className="font-bold text-[14px] mt-5 mb-4">Subject: {l.subject}</div>
          </>
        ) : (
          <div className="text-center mb-6">
            {l.confidential ? <div className="text-[10px] font-bold tracking-[.14em] text-[#0B5E5B] mb-2">STRICTLY PRIVATE AND CONFIDENTIAL</div> : null}
            <div className="text-[20px] font-bold tracking-[.04em]">{l.title.toUpperCase()}</div>
            <div className="w-14 h-[2px] bg-[#0B5E5B] mx-auto mt-2" />
            {form === "certificate" ? <div className="text-left font-bold mt-6">{l.subject.toUpperCase()}</div> : null}
          </div>
        )}
        <div className="text-justify">
          {l.blocks.map((b, i) => {
            if (b.k === "p") return <p key={i} className={cx("mb-3 whitespace-pre-wrap", b.bold && "font-bold", b.center && "text-center")}>{b.t}</p>;
            if (b.k === "h") return <div key={i} className="mt-6 mb-3 pb-2 border-b border-[#E2E8F0] break-after-avoid"><div className="text-[10px] font-bold tracking-[.14em] text-[#0B5E5B]">{b.t.toUpperCase()}</div>{b.sub ? <div className="text-[18px] font-bold">{b.sub}</div> : null}</div>;
            if (b.k === "list") return <ol key={i} className="mb-3">{b.items.map((t, j) => <li key={j} className="flex gap-3 mb-1.5"><span className="w-7 flex-none">{listLabel(b.style, j)}</span><span className="flex-1">{t}</span></li>)}</ol>;
            if (b.k === "clause" || b.k === "sec") return (
              <div key={i} className="mb-3">
                <div className="flex gap-3 font-bold text-[#0B5E5B] text-[12.5px] tracking-[.03em] break-after-avoid"><span className="w-8 flex-none">{b.n}.</span><span>{b.title.toUpperCase()}</span></div>
                {clauseParas(b).map((x, j) => x.item
                  ? <div key={j} className="flex gap-2 pl-11 mt-1"><span className="w-7 flex-none">{x.label}</span><span className="flex-1">{x.text}</span></div>
                  : <div key={j} className="flex gap-3 mt-1.5"><span className="w-8 flex-none font-bold">{x.label}</span><span className="flex-1 whitespace-pre-wrap">{x.text}</span></div>)}
              </div>
            );
            if (b.k === "facts") return (
              <div key={i} className="mb-5 break-inside-avoid">{b.title ? <div className="text-[10px] font-bold tracking-[.14em] text-[#0B5E5B] mb-1.5">{b.title.toUpperCase()}</div> : null}
                <table className="w-full border-collapse text-[12.5px] border-y-[1.5px] border-[#0B5E5B] text-left"><tbody>{b.rows.map(([k, v]) => <tr key={k} className="border-b border-[#E2E8F0] last:border-b-0"><td className="bg-[#E8F4F2] font-semibold px-3 py-1.5 w-[34%]">{k}</td><td className="px-3 py-1.5">{v}</td></tr>)}</tbody></table></div>
            );
            if (b.k === "table") {
              const al = b.align ?? b.head.map((_, j) => (j ? "r" : "l")), cls = (j: number) => (al[j] === "r" ? "text-right" : al[j] === "c" ? "text-center" : "text-left");
              return (
                <div key={i} className="mb-5 break-inside-avoid overflow-x-auto">
                  <table className="w-full border-collapse text-[12.5px]">
                    {b.widths ? <colgroup>{b.widths.map((w, j) => <col key={j} style={{ width: `${w * 100}%` }} />)}</colgroup> : null}
                    <thead><tr>{b.head.map((h, j) => <th key={h} className={cx("bg-[#0B5E5B] text-white px-3 py-2 font-bold", cls(j))}>{h}</th>)}</tr></thead>
                    <tbody>{b.rows.map((r, k) => <tr key={r[0]} className={cx("border-b border-[#E2E8F0]", k % 2 === 1 && "bg-[#F4F8F8]")}>{r.map((c, j) => <td key={j} className={cx("px-3 py-2 align-top", cls(j))}>{c}</td>)}</tr>)}
                      {b.foot ? <tr className="border-b-[1.5px] border-[#0B5E5B] bg-[#E8F4F2]">{b.foot.map((c, j) => <td key={j} className={cx("px-3 py-2 font-bold", cls(j))}>{c}</td>)}</tr> : null}</tbody>
                  </table>
                  {b.note ? <p className="text-[11.5px] italic text-[#64748B] mt-2 text-left">{b.note}</p> : null}
                </div>
              );
            }
            if (b.k === "sign") return (
              <div key={i} className="grid gap-x-10 gap-y-6 mt-6 mb-4 break-inside-avoid text-left" style={{ gridTemplateColumns: `repeat(${Math.min(b.boxes.length, 2)},minmax(0,1fr))` }}>
                {b.boxes.map((x) => <div key={x.title} className="max-w-[300px]"><div className="font-bold text-[#0B5E5B]">{x.title}</div>{x.lines.map((t, k) => (t === "" ? <div key={k} className="h-12 border-b border-[#64748B] mb-1.5 flex items-end">{x.img ? <SigImg png={x.img} alt={`Signature of ${l.to}`} /> : null}</div> : <div key={k} className={cx("mt-1", k === 1 && !t.includes(":") && "font-bold")}>{t}</div>))}</div>)}
              </div>
            );
            return b.unless ? <div key={i} className="h-4" /> : <div key={i} className="break-before-page my-8 border-t border-dashed border-[#CBD5E1]" />;
          })}
        </div>
        <div className="mt-8 pt-3 border-t border-[#0B5E5B] text-[10.5px] text-[#94A3B8] leading-[1.5] flex justify-between gap-4 flex-wrap"><span>{l.registration}<br />{[l.address, "medoro.in"].filter(Boolean).join("  |  ")}</span><span className="text-right">{l.ref}{l.initials ? <><br />Each page of the PDF carries a box for the employee’s initials.</> : null}</span></div>
      </div>
    </div>
  );
}


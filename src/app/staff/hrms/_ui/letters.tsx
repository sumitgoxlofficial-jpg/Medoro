"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Letter } from "@/staff/hrms/letters";
import { DATED_LETTERS, EXIT_LETTERS, JOINING_LETTERS, LETTER_TYPES, PROMOTION_LETTER, clauseParas, letterLabel, listLabel, type LetterType } from "@/staff/hrms/letters";
import { emailOffer, getLetter, getOfferLetter, sendLetters } from "../actions";
import { Empty, Field, Modal, Pill, Tabs, btnCls, cx, inputCls, primaryCls, useRun } from "./kit";
import { useOnChange } from "@/lib/react-state";

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
                {b.boxes.map((x) => <div key={x.title} className="max-w-[300px]"><div className="font-bold text-[#0B5E5B]">{x.title}</div>{x.lines.map((t, k) => (t === "" ? <div key={k} className="h-12 border-b border-[#64748B] mb-1.5" /> : <div key={k} className={cx("mt-1", k === 1 && !t.includes(":") && "font-bold")}>{t}</div>))}</div>)}
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

/** The same PDF, shown in the browser (to print) instead of downloaded. */
const viewUrl = (pdf: string) => `${pdf}${pdf.includes("?") ? "&" : "?"}view=1`;

const LOAD_FAILED = "Couldn’t load the letter. Refresh the page (Ctrl+Shift+R) and try again.";

/** One letter in a window with Print / Save as PDF and a PDF download. */
export function LetterModal({ letter, pdf, onClose, extra }: { letter: Letter; pdf: string; onClose: () => void; extra?: React.ReactNode }) {
  return (
    <Modal title={letter.title} onClose={onClose} wide>
      <LetterSheet l={letter} />
      <div className="flex gap-2 flex-wrap">
        <a className={primaryCls} href={viewUrl(pdf)} target="_blank" rel="noopener">Open PDF to print</a>
        <a className={btnCls} href={pdf} download>↓ Download PDF</a>
        {extra}
        <button className={`${btnCls} ml-auto`} onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

/** Fetches one letter on demand (for "Read" buttons). */
export function useLetterView() {
  const { toast } = useRun();
  const [open, setOpen] = useState<{ letter: Letter; pdf: string } | null>(null), [busy, setBusy] = useState(false);
  const show = useCallback(async (get: () => ReturnType<typeof getLetter>, pdf: string) => {
    setBusy(true);
    const r = await get().catch(() => null);
    setBusy(false);
    if (!r) { toast(LOAD_FAILED, "red"); return; }
    if (!r.ok) { toast(r.error, "red"); return; }
    setOpen({ letter: r.data, pdf });
  }, [toast]);
  return { open, busy, show, close: () => setOpen(null) };
}

type Sent = { id: string; type: string; label: string; lastDay: string; sentAt: string; unread: boolean };
/** An employee's own letters: the joining letters (offer, appointment, NDA) and anything else HR has sent, with a "New" tag until opened. */
export function MyLetters({ sent = [] }: { sent?: Sent[] }) {
  const v = useLetterView();
  const exit = sent.filter((x) => DATED_LETTERS.includes(x.type as LetterType)); // exit and promotion letters, once HR sends them
  const fresh = new Set(sent.filter((x) => x.unread).map((x) => x.type + x.lastDay));
  return (
    <>
      <div className="flex gap-2 flex-wrap items-center">
        {JOINING_LETTERS.map((t) => <button key={t} className={btnCls} disabled={v.busy} onClick={() => void v.show(() => getLetter("me", t), `/staff/hrms/letter/me/${t}`)}>📄 {letterLabel(t)}{fresh.has(t) ? <Pill tone="green">New</Pill> : null}</button>)}
        {exit.map((x) => <button key={x.id} className={btnCls} disabled={v.busy} onClick={() => void v.show(() => getLetter("me", x.type, x.lastDay), `/staff/hrms/letter/me/${x.type}?day=${x.lastDay}`)}>📄 {x.label}{fresh.has(x.type + x.lastDay) ? <Pill tone="green">New</Pill> : null}</button>)}
      </div>
      {v.open ? <LetterModal letter={v.open.letter} pdf={v.open.pdf} onClose={v.close} /> : null}
    </>
  );
}

type Promo = { effective: string; toDesig: string };
/** HR: every letter for one employee, written from their record, and sending them to the employee's own screen (and email). */
export function LettersPanel({ staffId, name, mail = false, onClose, promotions = [], promotion }: { staffId: string; name: string; mail?: boolean; onClose: () => void; promotions?: Promo[]; promotion?: string }) {
  const { toast } = useRun();
  const [type, setType] = useState<LetterType>(promotion ? PROMOTION_LETTER : "offer"), [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [promoDay, setPromoDay] = useState(promotion ?? promotions[0]?.effective ?? "");
  const [letter, setLetter] = useState<Letter | null>(null), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<Set<LetterType>>(new Set(JOINING_LETTERS)), [email, setEmail] = useState(mail), [sendOpen, setSendOpen] = useState(false);
  const promo = type === PROMOTION_LETTER, exit = EXIT_LETTERS.includes(type), anyExit = [...pick].some((t) => EXIT_LETTERS.includes(t));
  const forDay = promo ? promoDay : exit ? day : undefined;
  useOnChange([staffId, type, forDay], () => { setLetter(null); setErr(""); });
  useEffect(() => {
    let live = true;
    getLetter(staffId, type, forDay)
      .then((r) => { if (!live) return; if (r.ok) setLetter(r.data); else setErr(r.error); })
      .catch(() => { if (live) setErr(LOAD_FAILED); });
    return () => { live = false; };
  }, [staffId, type, forDay]);
  // The day comes from a date field or the promotion picker: encode it so nothing typed there can change the link.
  const pdf = `/staff/hrms/letter/${encodeURIComponent(staffId)}/${encodeURIComponent(type)}${forDay ? `?day=${encodeURIComponent(forDay)}` : ""}`;
  const toggle = (t: LetterType) => setPick((s) => { const n = new Set(s); if (!n.delete(t)) n.add(t); return n; });
  const tabs = LETTER_TYPES.filter((l) => l.id !== PROMOTION_LETTER || promotions.length);
  const send = async () => {
    setBusy(true);
    const r = await (promo ? sendLetters(staffId, [PROMOTION_LETTER], promoDay, email) : sendLetters(staffId, [...pick].filter((t) => t !== PROMOTION_LETTER), day, email)).catch(() => null);
    setBusy(false);
    if (!r) { toast(LOAD_FAILED, "red"); return; }
    if (!r.ok) { toast(r.error, "red"); return; }
    toast(`${r.data.sent} letter${r.data.sent === 1 ? "" : "s"} sent to ${name}. ${r.data.emailed.length ? `Emailed to ${r.data.emailed.join(", ")}. ` : ""}They see ${r.data.sent === 1 ? "it" : "them"} on their screen under My documents.`, "green");
    setSendOpen(false);
  };
  return (
    <Modal title={`Letters · ${name}`} onClose={onClose} wide>
      <Tabs value={type} options={tabs.map((l) => [l.id, l.label] as [LetterType, string])} onChange={setType} />
      {exit ? <Field label="Last working day"><input className={`${inputCls} !w-48`} type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field> : null}
      {promo && promotions.length > 1 ? <Field label="Promotion"><select className={`${inputCls} !w-auto`} value={promoDay} onChange={(e) => setPromoDay(e.target.value)}>{promotions.map((x) => <option key={x.effective} value={x.effective}>{x.toDesig} · from {x.effective}</option>)}</select></Field> : null}
      {err ? <p role="alert" className="text-[13px] text-[#B3261E] bg-[#FDECEA] rounded-lg px-3 py-2">{err}</p> : letter ? <LetterSheet l={letter} /> : <Empty>Writing the letter…</Empty>}
      <div className="flex gap-2 flex-wrap">
        <a className={primaryCls} href={letter ? viewUrl(pdf) : undefined} aria-disabled={!letter} target="_blank" rel="noopener">Open PDF to print</a>
        <a className={btnCls} href={letter ? pdf : undefined} aria-disabled={!letter} download>↓ Download PDF</a>
        <button className={btnCls} onClick={() => setSendOpen((o) => !o)} aria-expanded={sendOpen}>✉ Send to {name.split(" ")[0]}…</button>
        <button className={`${btnCls} ml-auto`} onClick={onClose}>Close</button>
      </div>
      {sendOpen ? (
        <div className="border border-[#a8b6c8] rounded-xl p-4 flex flex-col gap-3 bg-[#F8FAFC]">
          <div className="text-[13.5px] font-bold">Send to {name}: shows on their screen and they get a notification</div>
          {promo ? <div className="text-[13px]">Letter of promotion{promoDay ? ` (effective ${promoDay})` : ""}</div> : <div className="flex gap-x-5 gap-y-1 flex-wrap">{LETTER_TYPES.filter((l) => l.id !== PROMOTION_LETTER).map((l) => <label key={l.id} className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={pick.has(l.id)} onChange={() => toggle(l.id)} />{l.label}</label>)}</div>}
          {anyExit && !promo ? <Field label="Last working day (for exit letters)"><input className={`${inputCls} !w-48`} type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field> : null}
          <label className={cx("flex items-center gap-2 text-[13px]", !mail && "opacity-60")}><input type="checkbox" checked={email} disabled={!mail} onChange={(e) => setEmail(e.target.checked)} />Also email the PDFs to their email address{mail ? "" : " (email isn’t set up on this server yet)"}</label>
          <div>{promo ? <button className={primaryCls} disabled={busy || !promoDay} onClick={() => void send()}>Send letter of promotion</button> : <button className={primaryCls} disabled={busy || !pick.size} onClick={() => void send()}>Send {pick.size} letter{pick.size === 1 ? "" : "s"}</button>}</div>
        </div>
      ) : null}
    </Modal>
  );
}

/** Recruitment: the offer prepared for a candidate, as a proper letter, with email. */
export function OfferModal({ id, sent, onClose, onSent }: { id: string; sent: string | null; onClose: () => void; onSent: () => void }) {
  const { toast } = useRun();
  const [letter, setLetter] = useState<Letter | null>(null), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { getOfferLetter(id).then((r) => { if (r.ok) setLetter(r.data); else setErr(r.error); }).catch(() => setErr(LOAD_FAILED)); }, [id]);
  return (
    <Modal title="Offer letter" onClose={onClose} wide>
      {err ? <p role="alert" className="text-[13px] text-[#B3261E] bg-[#FDECEA] rounded-lg px-3 py-2">{err}</p> : letter ? <LetterSheet l={letter} /> : <Empty>Writing the letter…</Empty>}
      <div className="flex gap-2 flex-wrap items-center">
        <a className={primaryCls} href={letter ? viewUrl(`/staff/hrms/letter/offer/${encodeURIComponent(id)}`) : undefined} aria-disabled={!letter} target="_blank" rel="noopener">Open PDF to print</a>
        <a className={btnCls} href={letter ? `/staff/hrms/letter/offer/${encodeURIComponent(id)}` : undefined} download>↓ Download PDF</a>
        <button className={btnCls} disabled={!letter || busy} onClick={async () => { setBusy(true); const r = await emailOffer(id).catch(() => null); setBusy(false); if (!r) { toast(LOAD_FAILED, "red"); return; } if (r.ok) { toast(`Offer sent to ${r.data.sentTo}. Acceptance pending.`, "green"); onSent(); } else toast(r.error, "red"); }}>✉ {sent ? "Send again" : "Email to candidate"}</button>
        {sent ? <span className="text-[12px] text-[#0B5E5B] font-semibold">Sent {sent} · acceptance pending</span> : null}
        <button className={`${btnCls} ml-auto`} onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

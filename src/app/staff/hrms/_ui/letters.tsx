"use client";
import { useCallback, useEffect, useState } from "react";
import type { Letter } from "@/staff/hrms/letters";
import { EXIT_LETTERS, JOINING_LETTERS, LETTER_TYPES, letterLabel, type LetterType } from "@/staff/hrms/letters";
import { emailOffer, getLetter, getOfferLetter, sendLetters } from "../actions";
import { Empty, Field, Modal, Pill, Tabs, btnCls, cx, inputCls, primaryCls, useRun } from "./kit";

/** The letter as it prints: letterhead with the logo, reference and date, the terms, numbered clauses, tables and signature boxes. */
export function LetterSheet({ l }: { l: Letter }) {
  return (
    <div className="print-area bg-white text-[13px] leading-[1.65] border border-[#E2E8F0] rounded-xl p-8 max-[560px]:p-4 text-[#0f172a]">
      <div className="flex items-start gap-3 pb-3 border-b-[3px] border-[#0B5E5B] flex-wrap">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/medoro-mark.png" alt="" className="h-[50px] w-auto flex-none" />
        <div className="flex-1 min-w-[200px]"><div className="text-[26px] font-extrabold text-[#0B5E5B] leading-none">{l.company}</div><div className="text-[11px] text-[#64748B] mt-1.5">Billing, stock and GST software for Indian medical stores</div></div>
        <div className="text-right text-[11px] text-[#64748B] leading-[1.5] max-w-[260px] ml-auto">{l.address ? <div>{l.address}</div> : null}{l.contact ? <div>{l.contact}</div> : null}</div>
      </div>
      <div className="flex justify-between text-[12px] text-[#64748B] mt-4 mb-3 gap-3 flex-wrap"><span>Ref: {l.ref}</span><span>Date: {l.date}</span></div>
      {l.confidential ? <div className="text-[10.5px] font-bold tracking-[.14em] text-[#64748B] mb-3">STRICTLY PRIVATE AND CONFIDENTIAL</div> : null}
      <div className="font-bold text-[14px]">{l.to}</div>
      {l.toLine ? <div className="text-[12.5px] text-[#64748B]">{l.toLine}</div> : null}
      {l.toAddress ? <div className="text-[12.5px] text-[#64748B] max-w-[360px]">{l.toAddress}</div> : null}
      <div className="font-bold text-[14px] mt-5 mb-3 border-b border-[#E2E8F0] pb-2">Subject: {l.subject}</div>
      {l.blocks.map((b, i) => {
        if (b.k === "p") return <p key={i} className={cx("mb-3 whitespace-pre-wrap", b.bold && "font-bold")}>{b.t}</p>;
        if (b.k === "clause") return <div key={i} className="mb-3 break-inside-avoid"><div className="font-bold text-[#0B5E5B] text-[13.5px]">{b.n}.&nbsp; {b.title}</div>{b.t.map((t, j) => <p key={j} className="pl-5 mt-1 whitespace-pre-wrap">{t}</p>)}</div>;
        if (b.k === "facts") return (
          <div key={i} className="mb-4 break-inside-avoid">{b.title ? <div className="text-[10.5px] font-bold tracking-[.12em] text-[#64748B] mb-1.5">{b.title.toUpperCase()}</div> : null}
            <table className="w-full border-collapse text-[12.5px]"><tbody>{b.rows.map(([k, v]) => <tr key={k}><td className="border border-[#CBD5E1] bg-[#F0FDFA] font-semibold px-3 py-1.5 w-[38%]">{k}</td><td className="border border-[#CBD5E1] px-3 py-1.5">{v}</td></tr>)}</tbody></table></div>
        );
        if (b.k === "table") return (
          <div key={i} className="mb-4 break-inside-avoid"><div className="text-[16px] font-bold text-[#0B5E5B] mb-2">{b.title}</div>
            <table className="w-full border-collapse text-[12.5px]"><thead><tr>{b.head.map((h, j) => <th key={h} className={cx("border border-[#CBD5E1] bg-[#F0FDFA] px-3 py-2 font-bold", j ? "text-right" : "text-left")}>{h}</th>)}</tr></thead>
              <tbody>{b.rows.map((r) => <tr key={r[0]}>{r.map((c, j) => <td key={j} className={cx("border border-[#CBD5E1] px-3 py-2", j > 0 && "text-right")}>{c}</td>)}</tr>)}
                {b.foot ? <tr>{b.foot.map((c, j) => <td key={j} className={cx("border border-[#CBD5E1] bg-[#F0FDFA] px-3 py-2 font-bold", j > 0 && "text-right")}>{c}</td>)}</tr> : null}</tbody></table>
            {b.note ? <p className="text-[11.5px] italic text-[#64748B] mt-2">{b.note}</p> : null}</div>
        );
        if (b.k === "sign") return (
          <div key={i} className="grid gap-8 mt-8 mb-2 break-inside-avoid" style={{ gridTemplateColumns: `repeat(${Math.min(b.boxes.length, 2)},minmax(0,1fr))` }}>
            {b.boxes.map((x) => <div key={x.title}><div className="font-bold text-[#0B5E5B]">{x.title}</div>{x.lines.map((t, k) => (t === "" ? <div key={k} className="h-10 border-b border-[#64748B] mb-1.5" /> : <div key={k} className={cx("mt-1.5", k === 1 && b.boxes.length === 1 && "font-bold")}>{t}</div>))}</div>)}
          </div>
        );
        return <div key={i} className="break-before-page" />;
      })}
      <div className="mt-8 pt-3 border-t border-[#E2E8F0] text-[10.5px] text-[#94A3B8] leading-[1.5]">{l.registration}<br />This is a system-generated letter from Medoro HRMS. Ref {l.ref}.</div>
    </div>
  );
}

const LOAD_FAILED = "Couldn’t load the letter. Refresh the page (Ctrl+Shift+R) and try again.";

/** One letter in a window with Print / Save as PDF and a PDF download. */
export function LetterModal({ letter, pdf, onClose, extra }: { letter: Letter; pdf: string; onClose: () => void; extra?: React.ReactNode }) {
  return (
    <Modal title={letter.title} onClose={onClose} wide>
      <LetterSheet l={letter} />
      <div className="flex gap-2 flex-wrap">
        <button className={primaryCls} onClick={() => window.print()}>Print / save as PDF</button>
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
  const exit = sent.filter((x) => EXIT_LETTERS.includes(x.type as LetterType));
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

/** HR: every letter for one employee, written from their record, and sending them to the employee's own screen (and email). */
export function LettersPanel({ staffId, name, mail = false, onClose }: { staffId: string; name: string; mail?: boolean; onClose: () => void }) {
  const { toast } = useRun();
  const [type, setType] = useState<LetterType>("offer"), [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [letter, setLetter] = useState<Letter | null>(null), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<Set<LetterType>>(new Set(JOINING_LETTERS)), [email, setEmail] = useState(false), [sendOpen, setSendOpen] = useState(false);
  const exit = EXIT_LETTERS.includes(type), anyExit = [...pick].some((t) => EXIT_LETTERS.includes(t));
  useEffect(() => {
    let live = true;
    setLetter(null); setErr("");
    getLetter(staffId, type, exit ? day : undefined)
      .then((r) => { if (!live) return; if (r.ok) setLetter(r.data); else setErr(r.error); })
      .catch(() => { if (live) setErr(LOAD_FAILED); });
    return () => { live = false; };
  }, [staffId, type, day, exit]);
  const pdf = `/staff/hrms/letter/${staffId}/${type}${exit ? `?day=${day}` : ""}`;
  const toggle = (t: LetterType) => setPick((s) => { const n = new Set(s); if (!n.delete(t)) n.add(t); return n; });
  const send = async () => {
    setBusy(true);
    const r = await sendLetters(staffId, [...pick], day, email).catch(() => null);
    setBusy(false);
    if (!r) { toast(LOAD_FAILED, "red"); return; }
    if (!r.ok) { toast(r.error, "red"); return; }
    toast(`${r.data.sent} letter${r.data.sent === 1 ? "" : "s"} sent to ${name}. ${r.data.emailed.length ? `Emailed to ${r.data.emailed.join(", ")}. ` : ""}They see ${r.data.sent === 1 ? "it" : "them"} on their screen under My documents.`, "green");
    setSendOpen(false);
  };
  return (
    <Modal title={`Letters · ${name}`} onClose={onClose} wide>
      <Tabs value={type} options={LETTER_TYPES.map((l) => [l.id, l.label] as [LetterType, string])} onChange={setType} />
      {exit ? <Field label="Last working day"><input className={`${inputCls} !w-48`} type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field> : null}
      {err ? <p role="alert" className="text-[13px] text-[#B3261E] bg-[#FDECEA] rounded-lg px-3 py-2">{err}</p> : letter ? <LetterSheet l={letter} /> : <Empty>Writing the letter…</Empty>}
      <div className="flex gap-2 flex-wrap">
        <button className={primaryCls} disabled={!letter} onClick={() => window.print()}>Print / save as PDF</button>
        <a className={btnCls} href={letter ? pdf : undefined} aria-disabled={!letter} download>↓ Download PDF</a>
        <button className={btnCls} onClick={() => setSendOpen((o) => !o)} aria-expanded={sendOpen}>✉ Send to {name.split(" ")[0]}…</button>
        <button className={`${btnCls} ml-auto`} onClick={onClose}>Close</button>
      </div>
      {sendOpen ? (
        <div className="border border-[#a8b6c8] rounded-xl p-4 flex flex-col gap-3 bg-[#F8FAFC]">
          <div className="text-[13.5px] font-bold">Send to {name}: shows on their screen and they get a notification</div>
          <div className="flex gap-x-5 gap-y-1 flex-wrap">{LETTER_TYPES.map((l) => <label key={l.id} className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={pick.has(l.id)} onChange={() => toggle(l.id)} />{l.label}</label>)}</div>
          {anyExit ? <Field label="Last working day (for exit letters)"><input className={`${inputCls} !w-48`} type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field> : null}
          <label className={cx("flex items-center gap-2 text-[13px]", !mail && "opacity-60")}><input type="checkbox" checked={email} disabled={!mail} onChange={(e) => setEmail(e.target.checked)} />Also email the PDFs{mail ? "" : " (email isn’t set up on this server yet)"}</label>
          <div><button className={primaryCls} disabled={busy || !pick.size} onClick={() => void send()}>Send {pick.size} letter{pick.size === 1 ? "" : "s"}</button></div>
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
        <button className={primaryCls} disabled={!letter} onClick={() => window.print()}>Print / save as PDF</button>
        <a className={btnCls} href={letter ? `/staff/hrms/letter/offer/${id}` : undefined} download>↓ Download PDF</a>
        <button className={btnCls} disabled={!letter || busy} onClick={async () => { setBusy(true); const r = await emailOffer(id).catch(() => null); setBusy(false); if (!r) { toast(LOAD_FAILED, "red"); return; } if (r.ok) { toast(`Offer sent to ${r.data.sentTo}. Acceptance pending.`, "green"); onSent(); } else toast(r.error, "red"); }}>✉ {sent ? "Send again" : "Email to candidate"}</button>
        {sent ? <span className="text-[12px] text-[#0B5E5B] font-semibold">Sent {sent} · acceptance pending</span> : null}
        <button className={`${btnCls} ml-auto`} onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

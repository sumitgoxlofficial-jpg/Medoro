"use client";
import { useCallback, useEffect, useState } from "react";
import type { Letter } from "@/staff/hrms/letters";
import { DATED_LETTERS, EXIT_LETTERS, JOINING_LETTERS, LETTER_TYPES, PROMOTION_LETTER, letterLabel, type LetterType } from "@/staff/hrms/letters";
import { LetterSheet } from "./letter-sheet";
export { LetterSheet };
import { emailOffer, getLetter, getOfferLetter, getOfferSigning, retryOfferHire, sendLetters, sendOfferForSignature } from "../actions";
import { Empty, Field, Modal, Pill, Tabs, btnCls, cx, inputCls, primaryCls, useRun } from "./kit";
import { useOnChange } from "@/lib/react-state";

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
type Signing = NonNullable<Extract<Awaited<ReturnType<typeof getOfferSigning>>, { ok: true }>["data"]>;
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

/** Recruitment: the offer prepared for a candidate, as a proper letter; sending it for e-signature, and what happened after. */
export function OfferModal({ id, sent, onClose, onSent }: { id: string; sent: string | null; onClose: () => void; onSent: () => void }) {
  const { toast } = useRun();
  const [letter, setLetter] = useState<Letter | null>(null), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const [sig, setSig] = useState<Signing | null>(null), [link, setLink] = useState("");
  const loadSig = useCallback(() => { getOfferSigning(id).then((r) => { if (r.ok) setSig(r.data); }).catch(() => {}); }, [id]);
  useEffect(() => { getOfferLetter(id).then((r) => { if (r.ok) setLetter(r.data); else setErr(r.error); }).catch(() => setErr(LOAD_FAILED)); loadSig(); }, [id, loadSig]);
  const signed = sig?.status === "signed";
  const pdf = `/staff/hrms/letter/offer/${encodeURIComponent(id)}${signed ? "?signed=1" : ""}`;
  const act = async <T,>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, ok: (d: T) => void) => {
    setBusy(true); const r = await fn().catch(() => null); setBusy(false);
    if (!r) { toast(LOAD_FAILED, "red"); return; }
    if (r.ok) ok(r.data); else toast(r.error, "red");
  };
  return (
    <Modal title="Offer letter" onClose={onClose} wide>
      {sig ? (
        <div className={cx("rounded-xl border px-4 py-3 text-[13px] flex flex-col gap-1", signed ? "border-[#BBF7D0] bg-[#F0FDF4]" : sig.status === "declined" ? "border-[#FECACA] bg-[#FEF2F2]" : "border-[#BFDBFE] bg-[#EFF6FF]")}>
          <div className="font-bold text-[13.5px]">{signed ? "✓ Signed electronically" : sig.status === "declined" ? `Declined by the candidate${sig.declineReason ? `: “${sig.declineReason}”` : ""}` : sig.status === "expired" ? "Signing link expired" : sig.status === "cancelled" ? "Signing link cancelled (the offer was edited)" : sig.status === "viewed" ? "Opened by the candidate, not yet signed" : "Sent for e-signature, not yet opened"}</div>
          <div className="text-[#475569]">Sent {when(sig.sentAt)} to {sig.email}{sig.viewedAt ? ` · opened ${when(sig.viewedAt)}` : ""}{!signed && sig.status !== "cancelled" && sig.status !== "declined" ? ` · link valid until ${when(sig.expiresAt)}` : ""}</div>
          {signed ? <div>Signed by <strong>{sig.signer}</strong> on {when(sig.signedAt!)} at {sig.place}{sig.lat != null && sig.lng != null ? <> · <a className="text-[#0B5E5B] font-semibold" href={`https://www.openstreetmap.org/?mlat=${sig.lat}&mlon=${sig.lng}#map=16/${sig.lat}/${sig.lng}`} target="_blank" rel="noreferrer">location {sig.lat.toFixed(4)}, {sig.lng.toFixed(4)} ↗</a></> : null}</div> : null}
          {signed && sig.empNo ? <div>Employee <strong>{sig.empNo}</strong> created ({sig.officialEmail}); the welcome email and signed letter went to the candidate.</div> : null}
          {signed && !sig.empNo ? <div className="text-[#B45309]">The employee record wasn’t created: {sig.hireError || "unknown reason"} <button className={cx(btnCls, "ml-2")} disabled={busy} onClick={() => void act(() => retryOfferHire(id), (r) => { toast(`Employee ${r.empNo} created.`, "green"); loadSig(); onSent(); })}>Retry</button></div> : null}
        </div>
      ) : null}
      {link ? <div className="text-[12.5px] bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-3 py-2 break-all">Signing link (personal to the candidate; share only with them): <span className="font-mono">{link}</span> <button className="text-[#0B5E5B] font-semibold ml-1" onClick={() => void navigator.clipboard?.writeText(link).then(() => toast("Link copied.", "green"))}>Copy</button></div> : null}
      {err ? <p role="alert" className="text-[13px] text-[#B3261E] bg-[#FDECEA] rounded-lg px-3 py-2">{err}</p> : letter ? <LetterSheet l={letter} /> : <Empty>Writing the letter…</Empty>}
      <div className="flex gap-2 flex-wrap items-center">
        <a className={primaryCls} href={letter ? viewUrl(pdf) : undefined} aria-disabled={!letter} target="_blank" rel="noopener">{signed ? "Open signed PDF" : "Open PDF to print"}</a>
        <a className={btnCls} href={letter ? pdf : undefined} download>↓ Download {signed ? "signed " : ""}PDF</a>
        {!signed ? <button className={btnCls} disabled={!letter || busy} onClick={() => void act(() => sendOfferForSignature(id), (r) => { setLink(r.url); toast(r.emailed ? `Sent to ${r.to} for e-signature.` : "Signing link made. Email isn’t set up, so share the link with the candidate.", "green"); loadSig(); onSent(); })}>✍ {sig && sig.status !== "cancelled" && sig.status !== "declined" ? "Send for e-signature again" : "Send for e-signature"}</button> : null}
        {!signed ? <button className={btnCls} disabled={!letter || busy} onClick={() => void act(() => emailOffer(id), (r) => { toast(`Offer emailed to ${r.sentTo} (to accept by reply).`, "green"); onSent(); })}>✉ Email only</button> : null}
        {sent && !sig ? <span className="text-[12px] text-[#0B5E5B] font-semibold">Emailed {sent} · acceptance pending</span> : null}
        <button className={`${btnCls} ml-auto`} onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

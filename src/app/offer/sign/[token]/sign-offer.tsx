"use client";
import { useEffect, useRef, useState } from "react";
import { LetterSheet } from "@/app/staff/hrms/_ui/letter-sheet";
import type { SigningView } from "@/staff/hrms/offer-sign";
import { declineOfferAction, sendOfferCode, submitOfferSignature, verifyOfferCode } from "../actions";

// The candidate's signing experience, laid out the way enterprise e-signature services do it: a disclosure to accept first, the document,
// then identity verification, signer details, adopting a signature, and the consents, with a clear record of what is captured and why.

const input = "w-full border border-[#CBD5E1] rounded-md px-3 py-2.5 text-[14px] bg-white focus:outline-none focus:border-[#0B5E5B] focus:ring-2 focus:ring-[#0B5E5B]/15 disabled:bg-[#F8FAFC]";
const primary = "inline-flex items-center justify-center gap-2 rounded-md bg-[#0B5E5B] text-white font-semibold px-5 py-2.5 text-[14px] disabled:opacity-45 disabled:cursor-not-allowed hover:bg-[#094c4a] transition-colors";
const plain = "inline-flex items-center justify-center gap-2 rounded-md border border-[#CBD5E1] bg-white text-[#0f172a] font-semibold px-4 py-2 text-[13.5px] disabled:opacity-45 hover:bg-[#F8FAFC] transition-colors";
const label = "text-[12px] font-semibold text-[#334155] uppercase tracking-[.06em]";
const FONTS = [
  { label: "Great Vibes", css: "'Great Vibes', cursive", size: 40 },
  { label: "Dancing Script", css: "'Dancing Script', cursive", size: 34, weight: "600" },
  { label: "Allura", css: "Allura, cursive", size: 42 },
];
const dateIN = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
const initials = (n: string) => n.trim().split(/\s+/).map((w) => w[0]?.toUpperCase() ?? "").join("").slice(0, 4);

async function typedPng(text: string, f: (typeof FONTS)[number]) {
  try { await document.fonts.load(`${f.weight ?? "400"} 80px ${f.css}`); } catch { /* the fallback cursive font is used */ }
  const c = document.createElement("canvas"); c.width = 600; c.height = 200;
  const x = c.getContext("2d")!;
  let size = 96;
  do { x.font = `${f.weight ?? "400"} ${size}px ${f.css}`; size -= 4; } while (x.measureText(text).width > 550 && size > 28);
  x.fillStyle = "#0A1A3A"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(text, 300, 108);
  return c.toDataURL("image/png");
}

/** A box to sign in with a finger, stylus or mouse. */
function Pad({ onChange }: { onChange: (png: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null), last = useRef<{ x: number; y: number } | null>(null), strokes = useRef(0);
  useEffect(() => {
    const c = ref.current!, r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    c.width = r.width * dpr; c.height = r.height * dpr;
    const g = c.getContext("2d")!; g.scale(dpr, dpr); g.lineWidth = 2.6; g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = "#0A1A3A";
  }, []);
  const at = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const out = () => {
    const o = document.createElement("canvas"); o.width = 600; o.height = 200;
    o.getContext("2d")!.drawImage(ref.current!, 0, 0, 600, 200);
    onChange(strokes.current > 3 ? o.toDataURL("image/png") : null);
  };
  return (
    <div className="relative">
      <canvas ref={ref} aria-label="Draw your signature here" className="w-full h-[170px] rounded-md bg-white border border-[#CBD5E1] touch-none cursor-crosshair"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); last.current = at(e); }}
        onPointerMove={(e) => { if (!last.current) return; const p = at(e), g = ref.current!.getContext("2d")!; g.beginPath(); g.moveTo(last.current.x, last.current.y); g.lineTo(p.x, p.y); g.stroke(); last.current = p; strokes.current++; }}
        onPointerUp={() => { last.current = null; out(); }} onPointerCancel={() => { last.current = null; }} />
      <div className="absolute left-5 right-5 bottom-10 border-b border-[#94A3B8] pointer-events-none" aria-hidden><span className="absolute -top-5 left-0 text-[18px] text-[#94A3B8]">×</span></div>
      <button type="button" className="absolute top-2 right-3 text-[12.5px] text-[#0B5E5B] font-semibold" onClick={() => { const c = ref.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); strokes.current = 0; onChange(null); }}>Clear</button>
    </div>
  );
}

/** The Electronic Records and Signature Disclosure, with the Indian law behind signing electronically. */
function Disclosure({ company }: { company: string }) {
  const items: [string, string][] = [
    ["Agreement to use electronic records", `${company} would like to provide this offer to you, and receive your acceptance, electronically. If you agree, the offer letter, its annexures and your signed copy will be provided to you as electronic records, and your electronic signature will be used to record your acceptance.`],
    ["Legal effect under Indian law", "Under section 10A of the Information Technology Act, 2000, a contract is not unenforceable merely because electronic means were used to communicate the proposal and its acceptance. An offer of employment is not among the documents excluded by the First Schedule to that Act. Your acceptance forms a contract under the Indian Contract Act, 1872 on the terms of the letter."],
    ["Type of signature", "You will sign with a simple electronic signature: your name in a signature style, or a signature drawn on screen, after confirming your identity with a one-time code sent to your email. It is not an Aadhaar eSign or a Digital Signature Certificate under section 3A of the Information Technology Act, 2000."],
    ["Evidence and audit trail", "The signed document, with a certificate recording when it was sent, opened, verified and signed, your IP address, device, place and location, and a SHA-256 fingerprint of the document, is kept as an electronic record that may be produced as evidence under the Bharatiya Sakshya Adhiniyam, 2023."],
    ["Your personal data", "The details recorded with your signature are processed under the Digital Personal Data Protection Act, 2023 only to evidence your signature and to set up your employment, are kept for as long as the law requires, and are not shared except as required by law. You may exercise your rights as a data principal by writing to HR."],
    ["Paper copy and withdrawal", `You may ask ${company} for a paper copy of the offer and sign it by hand instead, at no cost, by replying to the offer email. You may withdraw your agreement to sign electronically at any time before you sign, by declining here or by contacting HR. Withdrawal does not affect anything signed before it.`],
    ["What you need", "A current version of Chrome, Edge, Safari or Firefox; access to the email address to which this offer was sent; and location services turned on for your browser. A copy of the signed document will be emailed to you."],
  ];
  return (
    <ol className="m-0 p-0 list-none flex flex-col gap-3 text-[13.5px] leading-[1.6] text-[#334155]">
      {items.map(([t, d], i) => <li key={t} className="flex gap-3"><span className="flex-none w-6 h-6 rounded-full bg-[#E6F2F1] text-[#0B5E5B] text-[12px] font-bold grid place-items-center mt-0.5">{i + 1}</span><div><div className="font-semibold text-[#0f172a]">{t}</div><div>{d}</div></div></li>)}
    </ol>
  );
}

function Step({ n, title, done, active, children, aside }: { n: number; title: string; done: boolean; active: boolean; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className={`relative pl-12 max-[560px]:pl-0 ${active || done ? "" : "opacity-55"}`}>
      <div className={`absolute left-0 top-0 w-8 h-8 rounded-full grid place-items-center text-[13px] font-bold max-[560px]:hidden ${done ? "bg-[#0B5E5B] text-white" : active ? "bg-white text-[#0B5E5B] border-2 border-[#0B5E5B]" : "bg-[#E2E8F0] text-[#64748B]"}`}>{done ? "✓" : n}</div>
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3"><h3 className="text-[16px] font-bold m-0"><span className="hidden max-[560px]:inline">{n}. </span>{title}</h3>{aside}</div>
      {children}
    </section>
  );
}

type Loc = { lat: number; lng: number; accuracy: number; at: string };
export function SignOffer({ token, view }: { token: string; view: SigningView }) {
  const [agreed, setAgreed] = useState(view.verified), [ersd, setErsd] = useState(false);
  const [verified, setVerified] = useState(view.verified), [sentTo, setSentTo] = useState(""), [code, setCode] = useState("");
  const [name, setName] = useState(view.name), [phone, setPhone] = useState(view.phone), [place, setPlace] = useState("");
  const [loc, setLoc] = useState<Loc | null>(null), [locMsg, setLocMsg] = useState(""), [locBusy, setLocBusy] = useState(false);
  const [mode, setMode] = useState<"typed" | "drawn">("typed"), [font, setFont] = useState(0), [drawn, setDrawn] = useState<string | null>(null);
  const [consent, setConsent] = useState(false), [dataConsent, setDataConsent] = useState(false);
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [declining, setDeclining] = useState(false), [reason, setReason] = useState("");
  const [result, setResult] = useState<{ kind: "signed"; empNo: string | null } | { kind: "declined" } | null>(view.state === "signed" ? { kind: "signed", empNo: view.empNo } : view.state === "declined" ? { kind: "declined" } : null);
  const panel = useRef<HTMLDivElement>(null);
  const first = view.name.split(" ")[0];
  const details = name.trim().length >= 3 && /^\+?\d[\d\s-]{9,13}$/.test(phone.trim()) && place.trim().length >= 2 && !!loc;
  const sig = mode === "typed" ? name.trim().length >= 3 : !!drawn;
  const ready = verified && details && sig && consent && dataConsent;

  const call = async <T,>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>) => {
    setBusy(true); setErr("");
    const r = await fn().catch(() => ({ ok: false as const, error: "Couldn’t reach the server. Check your connection and try again." }));
    setBusy(false);
    if (!r.ok) { setErr(r.error); return null; }
    return r.data;
  };
  const locate = () => {
    if (!("geolocation" in navigator)) { setLocMsg("This browser can’t share a location. Please open the link in Chrome, Edge, Safari or Firefox."); return; }
    setLocBusy(true); setLocMsg("");
    navigator.geolocation.getCurrentPosition(
      (p) => { setLocBusy(false); setLoc({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: new Date().toISOString() }); },
      (e) => { setLocBusy(false); setLocMsg(e.code === e.PERMISSION_DENIED ? "Location permission was refused. Allow location for this site (the icon to the left of the address bar), then try again." : "Couldn’t get your location. Turn on location services on your device and try again."); },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  };
  const submit = async () => {
    if (!loc) return;
    const png = mode === "drawn" ? drawn : await typedPng(name.trim(), FONTS[font]);
    if (!png) { setErr("Adopt a signature first."); return; }
    const r = await call(() => submitOfferSignature(token, { name, phone, place, lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy, type: mode, png, consent, dataConsent }));
    if (r) { setResult({ kind: "signed", empNo: r.empNo }); window.scrollTo({ top: 0, behavior: "smooth" }); }
  };
  const decline = async () => { const r = await call(() => declineOfferAction(token, reason)); if (r) { setDeclining(false); setResult({ kind: "declined" }); window.scrollTo({ top: 0 }); } };

  const header = (
    <header className="bg-white border-b border-[#E2E8F0] sticky top-0 z-20">
      <div className="max-w-[960px] mx-auto px-4 h-[60px] flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/medoro-mark.png" alt="" className="h-8 w-auto" />
        <div className="min-w-0 flex-1"><div className="text-[14.5px] font-bold leading-tight truncate">{view.company}</div><div className="text-[11.5px] text-[#64748B] truncate">Offer of Employment · Ref {view.ref}</div></div>
        <div className="hidden min-[720px]:flex items-center gap-2 text-[12px] font-semibold text-[#64748B]">
          {["Review", "Verify", "Sign"].map((t, i) => { const on = [agreed, verified, !!result][i]; return <span key={t} className={`flex items-center gap-1.5 ${on ? "text-[#0B5E5B]" : ""}`}>{i ? <span className="w-6 h-px bg-[#CBD5E1]" /> : null}<span className={`w-5 h-5 rounded-full grid place-items-center text-[10.5px] ${on ? "bg-[#0B5E5B] text-white" : "bg-[#E2E8F0]"}`}>{on ? "✓" : i + 1}</span>{t}</span>; })}
        </div>
        {agreed && !result ? <button className={`${primary} !py-2 !px-4`} onClick={() => panel.current?.scrollIntoView({ behavior: "smooth" })}>Sign</button> : null}
      </div>
    </header>
  );
  const trust = (
    <div className="flex flex-wrap justify-center gap-x-6 gap-y-1.5 text-[11.5px] text-[#64748B] py-6">
      <span>🔒 Encrypted connection (HTTPS)</span><span>✉ Identity verified by one-time code</span><span>⧉ Tamper-evident SHA-256 fingerprint</span><span>☰ Complete audit trail</span>
    </div>
  );

  if (result) return (
    <>{header}
      <div className="max-w-[640px] mx-auto px-4 pt-12">
        <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-sm p-8 text-center">
          {result.kind === "signed" ? <>
            <div className="mx-auto w-14 h-14 rounded-full bg-[#DCFCE7] text-[#15803D] grid place-items-center text-[26px]" aria-hidden>✓</div>
            <h1 className="text-[22px] font-bold mt-4 mb-1">Thank you, {first}. Your offer is signed.</h1>
            <p className="text-[14.5px] text-[#475569] m-0">Welcome to {view.company}.</p>
            {result.empNo ? <div className="mt-6 inline-flex flex-col items-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-8 py-4"><span className={label}>Your employee ID</span><span className="text-[26px] font-bold text-[#0B5E5B] tracking-[.04em]">{result.empNo}</span></div> : null}
            <p className="text-[14px] text-[#475569] mt-6 mb-0">{result.empNo ? "We have emailed you the signed offer letter, with its certificate of electronic signature, and the details to sign in to your employee account." : "HR will email you your employee ID and the details to sign in to your employee account shortly, with a copy of the signed offer letter."}</p>
          </> : <>
            <h1 className="text-[21px] font-bold m-0">You have declined this offer</h1>
            <p className="text-[14.5px] text-[#475569] mt-2 mb-0">We have let the HR team at {view.company} know. Thank you for considering us. If you change your mind, please contact HR.</p>
          </>}
        </div>
        {trust}
      </div>
    </>
  );
  if (view.state === "expired") return (
    <>{header}<div className="max-w-[640px] mx-auto px-4 pt-12"><div className="bg-white rounded-xl border border-[#E2E8F0] p-8 text-center"><h1 className="text-[20px] font-bold m-0">This offer has lapsed</h1><p className="text-[14px] text-[#475569] mt-2 mb-0">The signing link was valid until {dateIN(view.expiresAt)}. Please contact HR at {view.company} for a new link.</p></div></div></>
  );

  // First, the disclosure: nothing is shown or recorded as signed until the candidate agrees to do business electronically.
  if (!agreed) return (
    <>{header}
      <div className="max-w-[760px] mx-auto px-4 pt-8 pb-4">
        <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-sm overflow-hidden">
          <div className="px-7 py-6 border-b border-[#E2E8F0] max-[560px]:px-4">
            <div className={label}>Please review and sign</div>
            <h1 className="text-[22px] font-bold mt-1 mb-2">{view.position}: offer of employment</h1>
            <p className="text-[14px] text-[#475569] m-0">{view.sentBy ? `${view.sentBy} of ` : ""}{view.company} has sent you an offer letter to review and sign electronically. Sent on {dateIN(view.sentAt)}; open until {dateIN(view.expiresAt)}.</p>
          </div>
          <div className="px-7 py-6 max-[560px]:px-4">
            <h2 className="text-[15px] font-bold m-0 mb-1">Electronic Records and Signature Disclosure</h2>
            <p className="text-[13px] text-[#64748B] mt-0 mb-4">Please read this disclosure before you continue.</p>
            {ersd ? <Disclosure company={view.company} /> : <button className="text-[13.5px] font-semibold text-[#0B5E5B]" onClick={() => setErsd(true)}>Read the disclosure ▸</button>}
            <label className="flex gap-3 items-start mt-5 text-[14px] leading-[1.55] cursor-pointer">
              <input type="checkbox" className="mt-1 w-4 h-4 flex-none accent-[#0B5E5B]" checked={ersd && agreed} disabled={!ersd} onChange={(e) => setAgreed(e.target.checked)} />
              <span className={ersd ? "" : "text-[#94A3B8]"}>I have read the Electronic Records and Signature Disclosure and agree to use electronic records and signatures.</span>
            </label>
            {!ersd ? <p className="text-[12px] text-[#94A3B8] m-0 mt-1 pl-7">Open the disclosure to continue.</p> : null}
          </div>
          <div className="px-7 py-4 bg-[#F8FAFC] border-t border-[#E2E8F0] flex gap-3 justify-end flex-wrap max-[560px]:px-4">
            <button className={plain} onClick={() => setDeclining(true)}>Decline to sign</button>
          </div>
        </div>
        {declining ? <DeclineBox reason={reason} setReason={setReason} busy={busy} err={err} onCancel={() => setDeclining(false)} onDecline={() => void decline()} /> : null}
        {trust}
      </div>
    </>
  );

  return (
    <>{header}
      <div className="max-w-[960px] mx-auto px-4 pt-5 max-[560px]:px-2">
        <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg px-4 py-3 mb-4 text-[13.5px] text-[#1E3A8A]">Please read the offer letter and all its annexures. The signing section is at the end of the document.</div>
        <LetterSheet l={view.letter} />

        <div ref={panel} className="bg-white rounded-xl border border-[#E2E8F0] shadow-sm mt-6 scroll-mt-20 overflow-hidden">
          <div className="px-7 py-5 border-b border-[#E2E8F0] max-[560px]:px-4"><div className={label}>Signing</div><h2 className="text-[20px] font-bold m-0 mt-0.5">Accept and sign your offer</h2></div>
          <div className="px-7 py-6 flex flex-col gap-8 max-[560px]:px-4">
            <Step n={1} title="Verify your identity" done={verified} active={!verified} aside={verified ? <span className="text-[12.5px] font-semibold text-[#15803D]">Verified</span> : null}>
              {verified ? <p className="text-[13.5px] text-[#475569] m-0">Your email {view.email} has been confirmed with a one-time code.</p> : (
                <div className="flex flex-col gap-3">
                  <p className="text-[13.5px] text-[#475569] m-0">For your security, we will send a 6-digit code to <strong>{view.email}</strong>.</p>
                  <div className="flex gap-2 flex-wrap items-center">
                    <button className={sentTo ? plain : primary} disabled={busy} onClick={async () => { const r = await call(() => sendOfferCode(token)); if (r) setSentTo(r.to); }}>{sentTo ? "Resend code" : "Send code"}</button>
                    {sentTo ? <>
                      <input className={`${input} !w-44 tracking-[.4em] text-center text-[17px] font-semibold`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="••••••" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} aria-label="6-digit code" />
                      <button className={primary} disabled={busy || code.length !== 6} onClick={async () => { const r = await call(() => verifyOfferCode(token, code)); if (r) setVerified(true); }}>Verify</button>
                    </> : null}
                  </div>
                  {sentTo ? <p className="text-[12.5px] text-[#64748B] m-0">Code sent to {sentTo}. It is valid for 10 minutes. Check your spam folder if it doesn’t arrive.</p> : null}
                </div>
              )}
            </Step>

            <Step n={2} title="Confirm your details" done={verified && details} active={verified && !details}>
              <fieldset disabled={!verified} className="border-0 p-0 m-0 grid grid-cols-2 max-[640px]:grid-cols-1 gap-4">
                <label className="flex flex-col gap-1.5"><span className={label}>Full legal name</span><input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" /><span className="text-[11.5px] text-[#64748B]">As on your PAN or Aadhaar.</span></label>
                <label className="flex flex-col gap-1.5"><span className={label}>Mobile number</span><input className={input} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={14} autoComplete="tel" placeholder="10-digit mobile" /></label>
                <label className="flex flex-col gap-1.5"><span className={label}>Place of signing</span><input className={input} value={place} onChange={(e) => setPlace(e.target.value)} maxLength={80} placeholder="City or town" autoComplete="address-level2" /></label>
                <div className="flex flex-col gap-1.5"><span className={label}>Current location</span>
                  {loc ? <div className="text-[13px] border border-[#BBF7D0] bg-[#F0FDF4] rounded-md px-3 py-2.5 flex items-center gap-2 flex-wrap"><span className="text-[#15803D] font-semibold">✓ Captured</span><span className="font-mono text-[12.5px]">{loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}</span><span className="text-[#64748B]">±{Math.round(loc.accuracy)} m</span><button type="button" className="text-[#0B5E5B] font-semibold ml-auto" onClick={locate}>Update</button></div>
                    : <button type="button" className={`${plain} !justify-start !py-2.5`} disabled={locBusy || !verified} onClick={locate}>{locBusy ? "Locating…" : "📍 Share current location"}</button>}
                  {locMsg ? <span className="text-[12px] text-[#B45309]">{locMsg}</span> : <span className="text-[11.5px] text-[#64748B]">Recorded once, with your signature.</span>}
                </div>
              </fieldset>
            </Step>

            <Step n={3} title="Adopt your signature" done={verified && details && sig} active={verified && details && !sig}
              aside={<div className="flex rounded-md border border-[#CBD5E1] overflow-hidden text-[13px] font-semibold" role="tablist">{(["typed", "drawn"] as const).map((m) => <button key={m} type="button" role="tab" aria-selected={mode === m} disabled={!verified} className={`px-4 py-1.5 ${mode === m ? "bg-[#0B5E5B] text-white" : "bg-white text-[#334155]"}`} onClick={() => setMode(m)}>{m === "typed" ? "Choose style" : "Draw"}</button>)}</div>}>
              <fieldset disabled={!verified} className="border-0 p-0 m-0 flex flex-col gap-3">
                {mode === "typed" ? (
                  <div className="flex flex-col gap-2" role="radiogroup" aria-label="Signature style">
                    {FONTS.map((f, i) => (
                      <label key={f.label} className={`flex items-center gap-4 rounded-md border px-4 py-3 cursor-pointer ${font === i ? "border-[#0B5E5B] bg-[#F3FAF9] ring-1 ring-[#0B5E5B]" : "border-[#E2E8F0] hover:border-[#CBD5E1]"}`}>
                        <input type="radio" name="sigfont" className="accent-[#0B5E5B]" checked={font === i} onChange={() => setFont(i)} />
                        <span className="flex-1 truncate text-[#0A1A3A] leading-[1.2]" style={{ fontFamily: f.css, fontSize: f.size, fontWeight: f.weight ? Number(f.weight) : 400 }}>{name.trim() || "Your name"}</span>
                        <span className="text-[#0A1A3A] w-16 text-right" style={{ fontFamily: f.css, fontSize: f.size * 0.75, fontWeight: f.weight ? Number(f.weight) : 400 }}>{initials(name) || "YN"}</span>
                      </label>
                    ))}
                  </div>
                ) : <Pad onChange={setDrawn} />}
                {/* How it will appear: the signer box the way e-signature certificates mark it. */}
                <div className="flex items-center gap-4 flex-wrap">
                  <span className={label}>Preview</span>
                  <div className="relative border-l-[3px] border-[#0B5E5B] pl-3 pr-4 py-1 rounded-sm min-w-[240px]">
                    <div className="text-[10.5px] text-[#0B5E5B] font-semibold">Signed by:</div>
                    {mode === "typed" ? <div className="text-[#0A1A3A] leading-[1.15] truncate" style={{ fontFamily: FONTS[font].css, fontSize: 32, fontWeight: FONTS[font].weight ? Number(FONTS[font].weight) : 400 }}>{name.trim() || "Your name"}</div>
                      // eslint-disable-next-line @next/next/no-img-element
                      : drawn ? <img src={drawn} alt="Your drawn signature" className="h-11 w-auto" /> : <div className="h-11 text-[12px] text-[#94A3B8] flex items-center">Draw in the box above</div>}
                    <div className="text-[10px] text-[#64748B] font-mono">{view.fingerprint.slice(0, 16).toUpperCase()}…</div>
                  </div>
                </div>
              </fieldset>
            </Step>

            <Step n={4} title="Review and agree" done={false} active={verified && details && sig}>
              <fieldset disabled={!verified} className="border-0 p-0 m-0 flex flex-col gap-3">
                <label className="flex gap-3 items-start text-[13.5px] leading-[1.6] cursor-pointer">
                  <input type="checkbox" className="mt-1 w-4 h-4 flex-none accent-[#0B5E5B]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span>I have read and understood the offer letter (Ref {view.ref}) and all its annexures, and I accept the offer on those terms. I agree that my electronic signature is the legal equivalent of my handwritten signature for this document, under section 10A of the Information Technology Act, 2000 and the Indian Contract Act, 1872.</span>
                </label>
                <label className="flex gap-3 items-start text-[13.5px] leading-[1.6] cursor-pointer">
                  <input type="checkbox" className="mt-1 w-4 h-4 flex-none accent-[#0B5E5B]" checked={dataConsent} onChange={(e) => setDataConsent(e.target.checked)} />
                  <span>I consent, under the Digital Personal Data Protection Act, 2023, to {view.company} recording my name, mobile number, email, place and location of signing, IP address, device and the time of each step, to evidence this signature and to set up my employment.</span>
                </label>
              </fieldset>
            </Step>

            {err ? <p role="alert" className="text-[13px] text-[#B3261E] bg-[#FDECEA] rounded-md px-3 py-2 m-0">{err}</p> : null}
          </div>
          <div className="px-7 py-5 bg-[#F8FAFC] border-t border-[#E2E8F0] flex items-center gap-3 flex-wrap max-[560px]:px-4">
            <button className={primary} disabled={busy || !ready} onClick={() => void submit()}>{busy ? "Signing…" : "Finish and sign"}</button>
            <button className="text-[13.5px] font-semibold text-[#64748B] hover:text-[#B3261E]" onClick={() => setDeclining(true)}>Decline to sign</button>
            <span className="text-[12px] text-[#64748B] ml-auto max-[640px]:ml-0">{ready ? "Your signature and initials will be applied to the document." : "Complete the steps above to sign."}</span>
          </div>
        </div>
        {declining ? <DeclineBox reason={reason} setReason={setReason} busy={busy} err={err} onCancel={() => setDeclining(false)} onDecline={() => void decline()} /> : null}
        {trust}
      </div>
    </>
  );
}

function DeclineBox({ reason, setReason, busy, err, onCancel, onDecline }: { reason: string; setReason: (s: string) => void; busy: boolean; err: string; onCancel: () => void; onDecline: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="decline-title" className="fixed inset-0 z-30 bg-[#0f172a]/45 grid place-items-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-[480px] p-6 flex flex-col gap-3">
        <h2 id="decline-title" className="text-[18px] font-bold m-0">Decline to sign?</h2>
        <p className="text-[13.5px] text-[#475569] m-0">The offer will be declined and HR will be told. You won’t be able to sign this link afterwards.</p>
        <label className="flex flex-col gap-1.5"><span className={label}>Reason (optional)</span><textarea className={input} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example, I have accepted another offer." /></label>
        {err ? <p role="alert" className="text-[13px] text-[#B3261E] bg-[#FDECEA] rounded-md px-3 py-2 m-0">{err}</p> : null}
        <div className="flex gap-2 justify-end"><button className={plain} onClick={onCancel}>Cancel</button><button className={`${primary} !bg-[#B3261E] hover:!bg-[#8f1e18]`} disabled={busy} onClick={onDecline}>Decline offer</button></div>
      </div>
    </div>
  );
}

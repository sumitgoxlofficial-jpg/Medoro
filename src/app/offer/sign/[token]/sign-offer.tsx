"use client";
import { useEffect, useRef, useState } from "react";
import { LetterSheet } from "@/app/staff/hrms/_ui/letter-sheet";
import type { SigningView } from "@/staff/hrms/offer-sign";
import { sendOfferCode, submitOfferSignature, verifyOfferCode } from "../actions";

const input = "w-full border border-[#CBD5E1] rounded-lg px-3 py-2.5 text-[14px] bg-white focus:outline-none focus:border-[#0B5E5B] focus:ring-2 focus:ring-[#0B5E5B]/15";
const primary = "inline-flex items-center justify-center gap-2 rounded-lg bg-[#0B5E5B] text-white font-semibold px-5 py-2.5 text-[14px] disabled:opacity-50 hover:bg-[#094c4a]";
const plain = "inline-flex items-center justify-center gap-2 rounded-lg border border-[#CBD5E1] bg-white text-[#0f172a] font-semibold px-4 py-2 text-[13.5px] disabled:opacity-50 hover:bg-[#F8FAFC]";
const CONSENT = "I have read the offer letter and all its annexures. I agree to sign it electronically, and I intend my electronic signature to have the same effect as my handwritten signature. I understand that this is a simple electronic signature (typed or drawn) under the Information Technology Act, 2000, and that my name, mobile number, place, location, IP address and device will be recorded with it.";
/** Signature styles from fonts already on the device (no web fonts are loaded). */
const STYLES = [
  { label: "Script", font: '"Segoe Script","Snell Roundhand","Apple Chancery","Brush Script MT",cursive', weight: "400" },
  { label: "Brush", font: '"Brush Script MT","Lucida Handwriting","Bradley Hand",cursive', weight: "400" },
  { label: "Classic", font: 'Georgia,"Times New Roman",serif', weight: "italic 400" },
];

function typedPng(text: string, style: number) {
  const c = document.createElement("canvas"); c.width = 600; c.height = 200;
  const x = c.getContext("2d")!, s = STYLES[style];
  let size = 84;
  do { x.font = `${s.weight} ${size}px ${s.font}`; size -= 4; } while (x.measureText(text).width > 560 && size > 24);
  x.fillStyle = "#0A1A3A"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(text, 300, 104);
  return c.toDataURL("image/png");
}

/** A box to sign in with a finger, pen or mouse. */
function Pad({ onChange }: { onChange: (png: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null), last = useRef<{ x: number; y: number } | null>(null), strokes = useRef(0);
  useEffect(() => {
    const c = ref.current!, r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    c.width = r.width * dpr; c.height = r.height * dpr;
    const g = c.getContext("2d")!; g.scale(dpr, dpr); g.lineWidth = 2.4; g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = "#0A1A3A";
  }, []);
  const at = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const out = () => {
    const c = ref.current!, o = document.createElement("canvas"); o.width = 600; o.height = 200;
    o.getContext("2d")!.drawImage(c, 0, 0, 600, 200);
    onChange(strokes.current ? o.toDataURL("image/png") : null);
  };
  return (
    <div>
      <canvas ref={ref} aria-label="Draw your signature here" className="w-full h-[160px] border border-dashed border-[#94A3B8] rounded-lg bg-white touch-none cursor-crosshair"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); last.current = at(e); }}
        onPointerMove={(e) => { if (!last.current) return; const p = at(e), g = ref.current!.getContext("2d")!; g.beginPath(); g.moveTo(last.current.x, last.current.y); g.lineTo(p.x, p.y); g.stroke(); last.current = p; strokes.current++; }}
        onPointerUp={() => { last.current = null; out(); }} onPointerCancel={() => { last.current = null; }} />
      <button type="button" className="text-[12.5px] text-[#0B5E5B] font-semibold mt-1" onClick={() => { const c = ref.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); strokes.current = 0; onChange(null); }}>Clear</button>
    </div>
  );
}

type Loc = { lat: number; lng: number; accuracy: number };
export function SignOffer({ token, view }: { token: string; view: SigningView }) {
  const [verified, setVerified] = useState(view.verified), [sentTo, setSentTo] = useState(""), [code, setCode] = useState("");
  const [name, setName] = useState(view.name), [phone, setPhone] = useState(view.phone), [place, setPlace] = useState("");
  const [loc, setLoc] = useState<Loc | null>(null), [locMsg, setLocMsg] = useState(""), [locBusy, setLocBusy] = useState(false);
  const [mode, setMode] = useState<"typed" | "drawn">("typed"), [style, setStyle] = useState(0), [drawn, setDrawn] = useState<string | null>(null);
  const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const [done, setDone] = useState<{ empNo: string | null } | null>(view.state === "signed" ? { empNo: view.empNo } : null);
  const panel = useRef<HTMLDivElement>(null);

  const call = async <T,>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>) => {
    setBusy(true); setErr("");
    const r = await fn().catch(() => ({ ok: false as const, error: "Couldn’t reach the server. Check your connection and try again." }));
    setBusy(false);
    if (!r.ok) { setErr(r.error); return null; }
    return r.data;
  };
  const locate = () => {
    if (!("geolocation" in navigator)) { setLocMsg("This browser can’t share a location. Please open the link in Chrome, Safari or Edge."); return; }
    setLocBusy(true); setLocMsg("");
    navigator.geolocation.getCurrentPosition(
      (p) => { setLocBusy(false); setLoc({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }); },
      (e) => { setLocBusy(false); setLocMsg(e.code === e.PERMISSION_DENIED ? "Location permission was refused. Allow location for this site in your browser settings (the lock icon next to the address), then try again." : "Couldn’t get your location. Turn on location (GPS) on your device and try again."); },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  };
  const sigPng = () => (mode === "drawn" ? drawn : name.trim() ? typedPng(name.trim(), style) : null);
  const submit = async () => {
    const png = sigPng();
    if (!loc) { setErr("Share your current location first."); return; }
    if (!png) { setErr(mode === "drawn" ? "Draw your signature in the box." : "Type your full name."); return; }
    const r = await call(() => submitOfferSignature(token, { name, phone, place, lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy, type: mode, png, consent }));
    if (r) { setDone({ empNo: r.empNo }); window.scrollTo({ top: 0, behavior: "smooth" }); }
  };

  if (done) return (
    <div className="bg-white rounded-2xl border border-[#E2E8F0] p-8 text-center mt-10">
      <div className="mx-auto w-14 h-14 rounded-full bg-[#DCFCE7] text-[#15803D] grid place-items-center text-[28px]" aria-hidden>✓</div>
      <h1 className="text-[22px] font-bold mt-4 mb-1">Thank you, {view.name.split(" ")[0]}. Your offer is signed.</h1>
      <p className="text-[14.5px] text-[#475569] m-0">Welcome to {view.company}.</p>
      {done.empNo ? <p className="text-[14.5px] mt-4">Your employee ID is <strong className="text-[#0B5E5B]">{done.empNo}</strong>. We have emailed you the signed offer letter and the details to sign in to your employee account.</p>
        : <p className="text-[14.5px] mt-4">HR will email you your employee ID and the details to sign in to your employee account shortly, with a copy of the signed offer letter.</p>}
    </div>
  );
  if (view.state === "expired") return (
    <div className="bg-white rounded-2xl border border-[#E2E8F0] p-8 text-center mt-10"><h1 className="text-[20px] font-bold m-0">This offer has lapsed</h1><p className="text-[14px] text-[#475569] mt-2">The signing link was valid until {new Date(view.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}. Please contact HR at {view.company} for a new link.</p></div>
  );

  return (
    <>
      <div className="bg-white rounded-2xl border border-[#E2E8F0] px-5 py-4 mb-4 flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[220px]"><div className="text-[17px] font-bold">Your offer from {view.company}</div><div className="text-[13px] text-[#64748B]">Read the letter and annexures below, then sign at the end. Open until {new Date(view.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}.</div></div>
        <button className={primary} onClick={() => panel.current?.scrollIntoView({ behavior: "smooth" })}>Go to signing ↓</button>
      </div>
      <LetterSheet l={view.letter} />
      <div ref={panel} id="sign" className="bg-white rounded-2xl border-2 border-[#0B5E5B] p-6 max-[560px]:p-4 mt-5 mb-10 flex flex-col gap-5 scroll-mt-4">
        <div><h2 className="text-[19px] font-bold m-0">Sign your offer</h2><p className="text-[13.5px] text-[#64748B] m-0 mt-1">Your signature will be placed on the acceptance and verification pages of the letter, with a certificate recording these details.</p></div>

        <section className="flex flex-col gap-2">
          <div className="text-[14px] font-bold">1. Confirm your email</div>
          {verified ? <div className="text-[13.5px] text-[#15803D] font-semibold">✓ Email {view.email} confirmed</div> : (
            <div className="flex flex-col gap-2">
              <p className="text-[13.5px] text-[#475569] m-0">We will send a 6-digit code to {view.email}.</p>
              <div className="flex gap-2 flex-wrap items-center">
                <button className={plain} disabled={busy} onClick={async () => { const r = await call(() => sendOfferCode(token)); if (r) setSentTo(r.to); }}>{sentTo ? "Send a new code" : "Send code"}</button>
                {sentTo ? <>
                  <input className={`${input} !w-40 tracking-[.3em] text-center`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} aria-label="6-digit code" />
                  <button className={primary} disabled={busy || code.length !== 6} onClick={async () => { const r = await call(() => verifyOfferCode(token, code)); if (r) setVerified(true); }}>Confirm</button>
                </> : null}
              </div>
              {sentTo ? <p className="text-[12.5px] text-[#64748B] m-0">Code sent to {sentTo}. Check your spam folder if it doesn’t arrive in a minute.</p> : null}
            </div>
          )}
        </section>

        <fieldset disabled={!verified} className={`flex flex-col gap-5 border-0 p-0 m-0 ${verified ? "" : "opacity-50"}`}>
          <section className="flex flex-col gap-3">
            <div className="text-[14px] font-bold">2. Your details</div>
            <div className="grid grid-cols-2 max-[600px]:grid-cols-1 gap-3">
              <label className="flex flex-col gap-1 text-[13px] font-semibold">Full name (as on your ID)<input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" /></label>
              <label className="flex flex-col gap-1 text-[13px] font-semibold">Mobile number<input className={input} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={14} autoComplete="tel" placeholder="10-digit mobile" /></label>
              <label className="flex flex-col gap-1 text-[13px] font-semibold">Place of signing (city or town)<input className={input} value={place} onChange={(e) => setPlace(e.target.value)} maxLength={80} placeholder="e.g. Bokaro Steel City" autoComplete="address-level2" /></label>
              <div className="flex flex-col gap-1 text-[13px] font-semibold">Current location
                {loc ? <div className="text-[13px] font-normal border border-[#BBF7D0] bg-[#F0FDF4] rounded-lg px-3 py-2.5">✓ {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)} <span className="text-[#64748B]">(within about {Math.round(loc.accuracy)} m)</span> <button type="button" className="text-[#0B5E5B] font-semibold ml-1" onClick={locate}>Refresh</button></div>
                  : <button type="button" className={plain} disabled={locBusy} onClick={locate}>{locBusy ? "Getting your location…" : "📍 Share my current location"}</button>}
              </div>
            </div>
            {locMsg ? <p className="text-[12.5px] text-[#B45309] m-0">{locMsg}</p> : null}
          </section>

          <section className="flex flex-col gap-2">
            <div className="text-[14px] font-bold">3. Your signature</div>
            <div className="flex gap-2" role="tablist">
              <button type="button" role="tab" aria-selected={mode === "typed"} className={mode === "typed" ? primary : plain} onClick={() => setMode("typed")}>Type</button>
              <button type="button" role="tab" aria-selected={mode === "drawn"} className={mode === "drawn" ? primary : plain} onClick={() => setMode("drawn")}>Draw</button>
            </div>
            {mode === "typed" ? (
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-3 max-[600px]:grid-cols-1 gap-2">
                  {STYLES.map((s, i) => <button key={s.label} type="button" aria-pressed={style === i} onClick={() => setStyle(i)} className={`h-[70px] rounded-lg border bg-white text-[26px] text-[#0A1A3A] overflow-hidden px-2 ${style === i ? "border-[#0B5E5B] ring-2 ring-[#0B5E5B]/20" : "border-[#CBD5E1]"}`} style={{ font: `${s.weight} 28px ${s.font}` }}>{name.trim() || "Your name"}</button>)}
                </div>
                <p className="text-[12px] text-[#64748B] m-0">Your typed name in the selected style will be used as your signature.</p>
              </div>
            ) : <Pad onChange={setDrawn} />}
          </section>

          <label className="flex gap-3 items-start text-[13px] leading-[1.55] bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-3">
            <input type="checkbox" className="mt-1 w-4 h-4 flex-none" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>{CONSENT}</span>
          </label>

          {err && verified ? <p role="alert" className="text-[13px] text-[#B3261E] bg-[#FDECEA] rounded-lg px-3 py-2 m-0">{err}</p> : null}
          <div className="flex items-center gap-3 flex-wrap">
            <button className={primary} disabled={busy || !consent || !loc || !place.trim()} onClick={() => void submit()}>{busy ? "Signing…" : "Accept and sign the offer"}</button>
            <span className="text-[12px] text-[#64748B]">By signing you accept the offer on the terms in the letter.</span>
          </div>
        </fieldset>
        {!verified && err ? <p role="alert" className="text-[13px] text-[#B3261E] bg-[#FDECEA] rounded-lg px-3 py-2 m-0">{err}</p> : null}
      </div>
    </>
  );
}

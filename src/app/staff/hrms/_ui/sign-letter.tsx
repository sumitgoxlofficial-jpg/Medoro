"use client";
import { useEffect, useState } from "react";
import type { Letter } from "@/staff/hrms/letters";
import { letterLabel } from "@/staff/hrms/letters";
import { getLetter, signMyLetter } from "../actions";
import { Disclosure, FONTS, Pad, initials, input, label, plain, primary, typedPng } from "./esign-kit";
import { Empty, Modal } from "./kit";
import { LetterSheet } from "./letter-sheet";

type Loc = { lat: number; lng: number; accuracy: number };
/**
 * An employee e-signs their own appointment letter or NDA: the letter, then the disclosure, place and live location, an adopted signature
 * (a handwriting style or drawn) and the two consents. They are already signed in, so their account identifies them.
 */
export function SignLetterModal({ type, name, onClose, onSigned }: { type: "appointment" | "nda"; name: string; onClose: () => void; onSigned: () => void }) {
  const [letter, setLetter] = useState<Letter | null>(null), [loadErr, setLoadErr] = useState("");
  const [signer, setSigner] = useState(name), [place, setPlace] = useState("");
  const [loc, setLoc] = useState<Loc | null>(null), [locMsg, setLocMsg] = useState(""), [locBusy, setLocBusy] = useState(false);
  const [mode, setMode] = useState<"typed" | "drawn">("typed"), [font, setFont] = useState(0), [drawn, setDrawn] = useState<string | null>(null);
  const [ersd, setErsd] = useState(false), [consent, setConsent] = useState(false), [dataConsent, setDataConsent] = useState(false);
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  useEffect(() => { getLetter("me", type).then((r) => (r.ok ? setLetter(r.data) : setLoadErr(r.error))).catch(() => setLoadErr("Couldn’t load the letter. Refresh the page and try again.")); }, [type]);
  const title = letterLabel(type);
  const ready = signer.trim().length >= 3 && place.trim().length >= 2 && !!loc && (mode === "typed" || !!drawn) && consent && dataConsent;

  const locate = () => {
    if (!("geolocation" in navigator)) { setLocMsg("This browser can’t share a location. Please use Chrome, Edge, Safari or Firefox."); return; }
    setLocBusy(true); setLocMsg("");
    navigator.geolocation.getCurrentPosition(
      (p) => { setLocBusy(false); setLoc({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }); },
      (e) => { setLocBusy(false); setLocMsg(e.code === e.PERMISSION_DENIED ? "Location permission was refused. Allow location for this site (the icon to the left of the address bar), then try again." : "Couldn’t get your location. Turn on location services and try again."); },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  };
  const sign = async () => {
    if (!loc) return;
    const png = mode === "drawn" ? drawn : await typedPng(signer.trim(), FONTS[font]);
    if (!png) { setErr("Adopt a signature first."); return; }
    setBusy(true); setErr("");
    const r = await signMyLetter(type, { name: signer, place, lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy, type: mode, png, consent, dataConsent }).catch(() => null);
    setBusy(false);
    if (!r) { setErr("Couldn’t reach the server. Check your connection and try again."); return; }
    if (!r.ok) { setErr(r.error); return; }
    onSigned();
  };

  return (
    <Modal title={`Sign your ${title.toLowerCase()}`} onClose={onClose} wide>
      {loadErr ? <p role="alert" className="text-[13px] text-[#B3261E] bg-[#FDECEA] rounded-lg px-3 py-2">{loadErr}</p> : letter ? <LetterSheet l={letter} /> : <Empty>Loading the letter…</Empty>}
      <div className="rounded-xl border border-[#E2E8F0] bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E2E8F0]"><div className={label}>Signing</div><div className="text-[17px] font-bold">Accept and sign your {title.toLowerCase()}</div></div>
        <div className="px-5 py-5 flex flex-col gap-6">
          <section className="flex flex-col gap-2">
            <div className="text-[14px] font-bold">1. Electronic Records and Signature Disclosure</div>
            {ersd ? <Disclosure company={letter?.company ?? "Medoro"} what="letter" /> : <button type="button" className="self-start text-[13.5px] font-semibold text-[#0B5E5B]" onClick={() => setErsd(true)}>Read the disclosure ▸</button>}
          </section>

          <section className="flex flex-col gap-3">
            <div className="text-[14px] font-bold">2. Your details</div>
            <div className="grid grid-cols-3 max-[760px]:grid-cols-1 gap-3">
              <label className="flex flex-col gap-1.5"><span className={label}>Full legal name</span><input className={input} value={signer} onChange={(e) => setSigner(e.target.value)} maxLength={80} /></label>
              <label className="flex flex-col gap-1.5"><span className={label}>Place of signing</span><input className={input} value={place} onChange={(e) => setPlace(e.target.value)} maxLength={80} placeholder="City or town" /></label>
              <div className="flex flex-col gap-1.5"><span className={label}>Current location</span>
                {loc ? <div className="text-[13px] border border-[#BBF7D0] bg-[#F0FDF4] rounded-md px-3 py-2.5 flex items-center gap-2"><span className="text-[#15803D] font-semibold">✓ Captured</span><span className="text-[#64748B]">±{Math.round(loc.accuracy)} m</span><button type="button" className="text-[#0B5E5B] font-semibold ml-auto" onClick={locate}>Update</button></div>
                  : <button type="button" className={`${plain} !justify-start !py-2.5`} disabled={locBusy} onClick={locate}>{locBusy ? "Locating…" : "📍 Share current location"}</button>}
              </div>
            </div>
            {locMsg ? <p className="text-[12.5px] text-[#B45309] m-0">{locMsg}</p> : null}
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 flex-wrap"><div className="text-[14px] font-bold">3. Adopt your signature</div>
              <div className="flex rounded-md border border-[#CBD5E1] overflow-hidden text-[13px] font-semibold" role="tablist">{(["typed", "drawn"] as const).map((m) => <button key={m} type="button" role="tab" aria-selected={mode === m} className={`px-4 py-1.5 ${mode === m ? "bg-[#0B5E5B] text-white" : "bg-white text-[#334155]"}`} onClick={() => setMode(m)}>{m === "typed" ? "Choose style" : "Draw"}</button>)}</div>
            </div>
            {mode === "typed" ? (
              <div className="flex flex-col gap-2" role="radiogroup" aria-label="Signature style">
                {FONTS.map((f, i) => (
                  <label key={f.label} className={`flex items-center gap-3 rounded-md border px-3 py-2.5 cursor-pointer ${font === i ? "border-[#0B5E5B] bg-[#F3FAF9] ring-1 ring-[#0B5E5B]" : "border-[#E2E8F0]"}`}>
                    <input type="radio" name="letter-sigfont" className="accent-[#0B5E5B]" checked={font === i} onChange={() => setFont(i)} />
                    <span className="flex-1 truncate text-[#0A1A3A] leading-[1.2]" style={{ fontFamily: f.css, fontSize: f.size, fontWeight: f.weight ? Number(f.weight) : 400 }}>{signer.trim() || "Your name"}</span>
                    <span className="text-[#0A1A3A] w-16 text-right" style={{ fontFamily: f.css, fontSize: f.size * 0.75, fontWeight: f.weight ? Number(f.weight) : 400 }}>{initials(signer)}</span>
                  </label>
                ))}
              </div>
            ) : <Pad onChange={setDrawn} />}
          </section>

          <section className="flex flex-col gap-2.5">
            <div className="text-[14px] font-bold">4. Review and agree</div>
            <label className="flex gap-3 items-start text-[13.5px] leading-[1.6] cursor-pointer">
              <input type="checkbox" className="mt-1 w-4 h-4 flex-none accent-[#0B5E5B]" checked={consent} disabled={!ersd} onChange={(e) => setConsent(e.target.checked)} />
              <span className={ersd ? "" : "text-[#94A3B8]"}>I have read the Electronic Records and Signature Disclosure and the {title.toLowerCase()}{letter ? ` (Ref ${letter.ref})` : ""}, and I agree to its terms. I agree that my electronic signature is the legal equivalent of my handwritten signature for this document, under section 10A of the Information Technology Act, 2000 and the Indian Contract Act, 1872.{ersd ? "" : " (Open the disclosure first.)"}</span>
            </label>
            <label className="flex gap-3 items-start text-[13.5px] leading-[1.6] cursor-pointer">
              <input type="checkbox" className="mt-1 w-4 h-4 flex-none accent-[#0B5E5B]" checked={dataConsent} onChange={(e) => setDataConsent(e.target.checked)} />
              <span>I consent, under the Digital Personal Data Protection Act, 2023, to the recording of my name, employee account, place and location of signing, IP address, device and the time of signing, to evidence this signature.</span>
            </label>
          </section>
          {err ? <p role="alert" className="text-[13px] text-[#B3261E] bg-[#FDECEA] rounded-md px-3 py-2 m-0">{err}</p> : null}
        </div>
        <div className="px-5 py-4 bg-[#F8FAFC] border-t border-[#E2E8F0] flex items-center gap-3 flex-wrap">
          <button className={primary} disabled={busy || !ready || !letter} onClick={() => void sign()}>{busy ? "Signing…" : "Finish and sign"}</button>
          <button className={plain} onClick={onClose}>Cancel</button>
          <span className="text-[12px] text-[#64748B] ml-auto">Your signature and initials will be applied to the document, with a certificate of electronic signature.</span>
        </div>
      </div>
    </Modal>
  );
}

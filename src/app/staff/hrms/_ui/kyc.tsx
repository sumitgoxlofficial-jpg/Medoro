"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { kycStatus, saveKyc, uploadDoc } from "../actions";
import { Card, Field, Pill, btnCls, inputCls, primaryCls, useRun } from "./kit";

type Status = NonNullable<Awaited<ReturnType<typeof kycStatus>> extends infer R ? (R extends { ok: true; data: infer D } ? D : never) : never>;

const Tick = ({ done }: { done: boolean }) => <span className={`inline-flex size-5 rounded-full items-center justify-center flex-none ${done ? "bg-[#0B5E5B] text-white" : "bg-[#E2E8F0] text-[#94A3B8]"}`}>{done ? <Check size={12} /> : null}</span>;

/**
 * The Aadhaar and PAN step. Numbers first (with consent), then proof: the Aadhaar through DigiLocker (checked
 * automatically) or an uploaded card (checked by HR), and an uploaded PAN card (checked by HR).
 */
export function KycStep() {
  const { run, busy, toast } = useRun();
  const router = useRouter();
  const [st, setSt] = useState<Status | null>(null);
  const [aadhaar, setAadhaar] = useState(""), [pan, setPan] = useState(""), [consent, setConsent] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const aFile = useRef<HTMLInputElement>(null), pFile = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => { const r = await kycStatus(); if (r.ok) setSt(r.data); }, []);
  useEffect(() => { void load(); }, [load]);
  // DigiLocker sends the person back with ?digilocker=…
  useEffect(() => {
    const q = new URLSearchParams(window.location.search), r = q.get("digilocker");
    if (!r) return;
    setNotice(r === "verified" ? { tone: "ok", text: "Your Aadhaar is verified through DigiLocker." } : r === "review" ? { tone: "warn", text: (q.get("why") || "We couldn’t match your DigiLocker Aadhaar.") + " Upload your Aadhaar card below and HR will check it." } : r === "denied" ? { tone: "warn", text: "You didn’t allow DigiLocker access. You can try again, or upload your Aadhaar card." } : { tone: "warn", text: q.get("why") || "DigiLocker didn’t work this time. Try again, or upload your Aadhaar card." });
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  const sendDoc = (kind: "Aadhaar card" | "PAN card", ref: React.RefObject<HTMLInputElement | null>) => {
    const f = ref.current?.files?.[0];
    if (!f) return toast("Choose a file first.", "red");
    const fd = new FormData(); fd.set("kind", kind); fd.set("file", f);
    run(() => uploadDoc(fd), () => { if (ref.current) ref.current.value = ""; void load().then(() => router.refresh()); });
  };
  if (!st) return <Card title="Aadhaar & PAN" pad><div className="text-[13px] text-[#64748B]">Loading…</div></Card>;
  const needNumbers = !st.aadhaar.entered || !st.pan.entered;
  const aadhaarProof = st.aadhaar.digilocker || st.aadhaar.doc !== "none";
  return (
    <Card title="Verify your identity" sub="Medoro needs your Aadhaar and PAN for every employee. They are stored encrypted and shown masked." pad>
      <div className="flex flex-col gap-4">
        {st.note ? <div role="alert" className="text-[13px] rounded-lg px-3 py-2 bg-[#FDECEA] text-[#B3261E]"><strong>HR sent this back.</strong> {st.note} Fix it below and you can carry on.</div> : null}
        {notice ? <div role="status" className={`text-[13px] rounded-lg px-3 py-2 ${notice.tone === "ok" ? "bg-[#D6F3EF] text-[#0B5E5B]" : "bg-[#FEF3C7] text-[#92400E]"}`}>{notice.text}</div> : null}

        <section className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2"><Tick done={st.aadhaar.entered && st.pan.entered} /><strong className="text-[14px]">1. Your numbers</strong></div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="Aadhaar number" hint={st.aadhaar.entered ? `Saved: ${st.aadhaar.masked}. Type a new one only to change it.` : "12 digits"}><input className={inputCls} inputMode="numeric" autoComplete="off" placeholder={st.aadhaar.entered ? st.aadhaar.masked : "1234 5678 9012"} value={aadhaar} onChange={(e) => setAadhaar(e.target.value.replace(/[^\d ]/g, "").slice(0, 14))} /></Field>
            <Field label="PAN" hint={st.pan.entered ? `Saved: ${st.pan.masked}. Type a new one only to change it.` : "e.g. ABCDE1234F"}><input className={inputCls} autoComplete="off" placeholder={st.pan.entered ? st.pan.masked : "ABCDE1234F"} value={pan} onChange={(e) => setPan(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10))} /></Field>
          </div>
          <label className="flex items-start gap-2 text-[12.5px] text-[#475569]"><input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>I allow Medoro to keep my Aadhaar and PAN, encrypted, to verify my identity for employment and salary tax. Only HR can open them, and every opening is logged.</span></label>
          <div><button className={primaryCls} disabled={busy || (!aadhaar && !pan)} onClick={() => run(() => saveKyc({ aadhaar, pan, consent }), () => { setAadhaar(""); setPan(""); void load().then(() => router.refresh()); })}>Save numbers</button></div>
        </section>

        <section className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2"><Tick done={aadhaarProof} /><strong className="text-[14px]">2. Aadhaar proof</strong>{st.aadhaar.digilocker ? <Pill tone="green">Verified with DigiLocker</Pill> : st.aadhaar.doc === "verified" ? <Pill tone="green">Verified by HR</Pill> : st.aadhaar.doc === "uploaded" ? <Pill tone="amber">Waiting for HR</Pill> : null}</div>
          {!st.aadhaar.digilocker ? (
            <>
              {st.digilocker ? <div className="flex items-center gap-3 flex-wrap">
                {/* A server route that redirects to DigiLocker, not a page: a plain link on purpose. */}
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a className={primaryCls + (st.aadhaar.entered ? "" : " pointer-events-none opacity-50")} href="/staff/hrms/digilocker/start" aria-disabled={!st.aadhaar.entered}>Verify with DigiLocker</a>
                <span className="text-[12.5px] text-[#64748B]">You sign in on DigiLocker with your Aadhaar OTP. Medoro checks the last four digits, your name and date of birth, and keeps nothing else from it.{!st.aadhaar.entered ? " Save your Aadhaar number first." : ""}</span>
              </div> : null}
              <div className="flex items-end gap-2 flex-wrap">
                <Field label={st.digilocker ? "Or upload your Aadhaar card (HR checks it)" : "Upload your Aadhaar card (HR checks it)"}><input ref={aFile} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="text-[12.5px]" aria-label="Aadhaar card file" /></Field>
                <button className={btnCls} disabled={busy} onClick={() => sendDoc("Aadhaar card", aFile)}>Upload</button>
              </div>
            </>
          ) : <p className="text-[12.5px] text-[#64748B]">Matched against your own DigiLocker Aadhaar. No upload needed.</p>}
        </section>

        <section className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2"><Tick done={st.pan.doc !== "none"} /><strong className="text-[14px]">3. PAN card</strong>{st.pan.doc === "verified" ? <Pill tone="green">Verified by HR</Pill> : st.pan.doc === "uploaded" ? <Pill tone="amber">Waiting for HR</Pill> : null}</div>
          <div className="flex items-end gap-2 flex-wrap">
            <Field label="Upload your PAN card (HR checks it)"><input ref={pFile} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="text-[12.5px]" aria-label="PAN card file" /></Field>
            <button className={btnCls} disabled={busy} onClick={() => sendDoc("PAN card", pFile)}>Upload</button>
          </div>
        </section>

        {needNumbers ? <p className="text-[12px] text-[#64748B]">Save both numbers to continue.</p> : !aadhaarProof || st.pan.doc === "none" ? <p className="text-[12px] text-[#64748B]">Add the proof for each to continue.</p> : null}
        <p className="text-[12px] text-[#64748B]">You don’t wait for HR: once both numbers and proofs are in, you go to the next step. HR checks them later and tells you if anything needs fixing.</p>
      </div>
    </Card>
  );
}

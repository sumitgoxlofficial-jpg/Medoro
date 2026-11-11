"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { idleEnd, idleStart } from "../actions";
import { Modal, btnCls, primaryCls } from "./kit";

/** Opens the camera, takes one small JPEG and hands it back. The picture is only sent when the person presses the button. */
export function SelfieModal({ title, busy, onClose, onDone }: { title: string; busy: boolean; onClose: () => void; onDone: (dataUrl: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [shot, setShot] = useState<string | null>(null), [err, setErr] = useState(""), [ready, setReady] = useState(false);
  useEffect(() => {
    let stream: MediaStream | null = null, stopped = false;
    if (!navigator.mediaDevices?.getUserMedia) { setErr("This browser can’t use the camera. Use Chrome, Edge or Safari on a secure (https) page."); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
      .then((s) => { if (stopped) { s.getTracks().forEach((t) => t.stop()); return; } stream = s; if (video.current) { video.current.srcObject = s; void video.current.play().then(() => setReady(true)).catch(() => setReady(true)); } })
      .catch(() => setErr("The camera isn’t available. Allow camera access for this site in your browser, then try again, or ask HR to mark your attendance."));
    return () => { stopped = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, []);
  const capture = () => {
    const v = video.current; if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas"); c.width = 320; c.height = Math.round((320 * v.videoHeight) / v.videoWidth);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    setShot(c.toDataURL("image/jpeg", 0.7));
  };
  return (
    <Modal title={title} onClose={onClose}>
      {err ? <p role="alert" className="text-[13.5px] text-[#B3261E] bg-[#FDECEA] rounded-lg px-3 py-2">{err}</p> : (
        <div className="relative rounded-xl overflow-hidden bg-black aspect-[4/3]">
          {/* The live picture is mirrored like a mirror; the saved picture is not. */}
          <video ref={video} playsInline muted className={shot ? "hidden" : "w-full h-full object-cover -scale-x-100"} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {shot ? <img src={shot} alt="Your selfie" className="w-full h-full object-cover" /> : null}
        </div>
      )}
      <p className="text-[12px] text-[#64748B]">Your selfie is a photo for the attendance record. Nothing is analysed or matched. It is kept for 30 days and only you and HR can see it.</p>
      <div className="flex gap-2">
        {shot ? <><button className={btnCls} onClick={() => setShot(null)} disabled={busy}>Retake</button><button className={primaryCls} disabled={busy} onClick={() => onDone(shot)}>Use this photo</button></>
          : <button className={primaryCls} onClick={capture} disabled={!ready || !!err}>Take photo</button>}
      </div>
    </Modal>
  );
}

/**
 * Idle-time monitoring, only mounted when the super admin switched it on. It looks at mouse, keyboard, scroll and touch in THIS tab
 * while the person is checked in and not on a break. After `minutes` without activity it asks "still working?"; if there is no
 * answer in two minutes the stretch is recorded as idle from the last activity until they come back. A hidden tab isn't counted
 * (work in another window is invisible to us), nothing is typed or captured, and no other app is watched.
 */
export function IdleWatcher({ minutes, active }: { minutes: number; active: boolean }) {
  const last = useRef(Date.now()), idle = useRef(false), asked = useRef(0);
  const [ask, setAsk] = useState<{ left: number } | null>(null), [since, setSince] = useState<number | null>(null);
  useEffect(() => {
    if (!active || minutes <= 0) return;
    const resume = () => { last.current = Date.now(); if (idle.current) { idle.current = false; setSince(null); void idleEnd(); } if (asked.current) { asked.current = 0; setAsk(null); } };
    const onVis = () => { if (document.visibilityState === "visible") last.current = Date.now(); };
    const events = ["mousemove", "mousedown", "keydown", "scroll", "wheel", "touchstart"] as const;
    const onAct = () => { if (!asked.current) last.current = Date.now(); if (idle.current) resume(); };
    events.forEach((e) => window.addEventListener(e, onAct, { passive: true }));
    document.addEventListener("visibilitychange", onVis);
    const tick = setInterval(() => {
      if (document.visibilityState !== "visible" || idle.current) return;
      if (asked.current) {
        const left = 120 - Math.floor((Date.now() - asked.current) / 1000);
        if (left <= 0) { asked.current = 0; idle.current = true; setAsk(null); setSince(last.current); void idleStart(new Date(last.current).toISOString()); } else setAsk({ left });
      } else if (Date.now() - last.current >= minutes * 60_000) { asked.current = Date.now(); setAsk({ left: 120 }); }
    }, 1000);
    return () => { clearInterval(tick); events.forEach((e) => window.removeEventListener(e, onAct)); document.removeEventListener("visibilitychange", onVis); };
  }, [active, minutes]);
  if (!active || minutes <= 0) return null;
  const here = () => { last.current = Date.now(); asked.current = 0; idle.current = false; setAsk(null); setSince(null); void idleEnd(); };
  if (since) return <Modal title="You were away" onClose={here}><p className="text-[14px]">No activity was seen since {new Date(since).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })}, so that time was recorded as idle.</p><div className="flex gap-2"><button className={primaryCls} onClick={here}>I’m back</button></div></Modal>;
  if (ask) return <Modal title="Still working?" onClose={here}><p className="text-[14px]">You have been inactive for {minutes} minute{minutes > 1 ? "s" : ""}. If you don’t answer in <strong>{ask.left}s</strong>, this time is recorded as idle.</p><div className="flex gap-2 flex-wrap"><button className={primaryCls} onClick={here}>Yes, I’m here</button><Link className={btnCls} href="/staff/hrms/attendance" onClick={here}>Go to attendance</Link></div></Modal>;
  return null;
}

/** One stored selfie, loaded through the access-checked route. */
export function Selfie({ id, label }: { id: string; label: string }) {
  return (
    <figure className="m-0 text-center text-[12px] text-[#64748B]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/staff/hrms/selfie/${id}`} alt={`${label} selfie`} className="w-40 rounded-lg border border-[#E2E8F0]" />
      {label}
    </figure>
  );
}

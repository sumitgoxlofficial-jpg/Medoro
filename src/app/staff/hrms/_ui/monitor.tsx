"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toMin } from "@/staff/hrms/constants";
import { checkIn, idleEnd, idleStart } from "../actions";
import { Modal, btnCls, primaryCls, useRun } from "./kit";

/** Opens the camera, takes one small JPEG and hands it back. The picture is only sent when the person presses the button. */
export function SelfieModal({ title, busy, onClose, onDone, note }: { title: string; busy: boolean; onClose: () => void; onDone: (dataUrl: string) => void; note?: string }) {
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
      {note ? <p className="text-[13px] font-semibold text-[#0B5E5B] bg-[#F0FDFA] rounded-lg px-3 py-2">{note}</p> : null}
      <p className="text-[12px] text-[#64748B]">Your selfie is a photo for the attendance record. Nothing is analysed or matched. It is kept for 30 days and only you and HR can see it.</p>
      <div className="flex gap-2">
        {shot ? <><button className={btnCls} onClick={() => setShot(null)} disabled={busy}>Retake</button><button className={primaryCls} disabled={busy} onClick={() => onDone(shot)}>Use this photo</button></>
          : <button className={primaryCls} onClick={capture} disabled={!ready || !!err}>Take photo</button>}
      </div>
    </Modal>
  );
}

/**
 * When photo check-in is on and the person hasn't checked in on a working day, this asks for the photo as soon as they open the HRMS
 * (any page). Taking it checks them in. The close button only snoozes it for 10 minutes (for a broken camera); it comes back.
 */
export function PhotoCheckin({ lateAfter }: { lateAfter: string }) {
  const { run, busy } = useRun();
  const [until, setUntil] = useState(0), [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);
  if (Date.now() < until) return null;
  return (
    <SelfieModal title="Check in: take your photo" busy={busy} note={`Take a photo to check in for today. Check-in after ${lateAfter} counts as late. If your camera isn’t working, ask HR to mark your attendance.`}
      onClose={() => setUntil(Date.now() + 10 * 60_000)} onDone={(img) => run(() => checkIn(img), (x) => (x.status === "late" ? `Checked in (late: after ${lateAfter}).` : "Checked in. Have a great day."))} />
  );
}

/** A short warning sound made in the browser (three beeps), so no audio file is needed. */
function warnBeep(ctx: AudioContext) {
  [0, 0.4, 0.8].forEach((t) => {
    const o = ctx.createOscillator(), g = ctx.createGain(), at = ctx.currentTime + t;
    o.type = "square"; o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.25, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
    o.connect(g).connect(ctx.destination); o.start(at); o.stop(at + 0.32);
  });
}
const inLunch = (lunch: { from: string; to: string }) => {
  const ist = new Date(Date.now() + 5.5 * 3600_000), m = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return m >= toMin(lunch.from) && m < toMin(lunch.to);
};

/**
 * Idle-time monitoring, only mounted when the super admin switched it on. It looks at mouse, keyboard, scroll and touch in THIS tab
 * while the person is checked in and not on a break. After `minutes` without activity it asks "still working?" with a warning sound, a browser
 * notification and a flashing title; moving the mouse or pressing a key answers it. If there is no
 * answer in two minutes the stretch is recorded as idle from the last activity until they come back. A hidden tab isn't counted
 * (work in another window is invisible to us), nothing is typed or captured, and no other app is watched.
 */
export function IdleWatcher({ minutes, active, lunch }: { minutes: number; active: boolean; lunch: { from: string; to: string } }) {
  const last = useRef(Date.now()), idle = useRef(false), asked = useRef(0), audio = useRef<AudioContext | null>(null);
  const [ask, setAsk] = useState<{ left: number } | null>(null), [since, setSince] = useState<number | null>(null);
  useEffect(() => {
    if (!active || minutes <= 0) return;
    const resume = () => { last.current = Date.now(); if (idle.current) { idle.current = false; setSince(null); void idleEnd(); } if (asked.current) { asked.current = 0; setAsk(null); } };
    const onVis = () => { if (document.visibilityState === "visible") last.current = Date.now(); };
    const events = ["mousemove", "mousedown", "keydown", "scroll", "wheel", "touchstart"] as const;
    const onAct = () => {
      if (asked.current || idle.current) resume(); else last.current = Date.now(); // moving the mouse or pressing a key answers "Still working?" and stops the warning
      // The first click or key press lets the page play the warning sound and ask once for permission to show notifications.
      if (!audio.current) { try { audio.current = new AudioContext(); void audio.current.resume(); } catch { /* no audio */ } if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission().catch(() => {}); }
    };
    events.forEach((e) => window.addEventListener(e, onAct, { passive: true }));
    document.addEventListener("visibilitychange", onVis);
    const tick = setInterval(() => {
      if (document.visibilityState !== "visible" || idle.current) return;
      if (inLunch(lunch)) { last.current = Date.now(); asked.current = 0; setAsk(null); return; } // the lunch hour is not work and is never counted as idle
      if (asked.current) {
        const left = 120 - Math.floor((Date.now() - asked.current) / 1000);
        if (left <= 0) { asked.current = 0; idle.current = true; setAsk(null); setSince(last.current); void idleStart(new Date(last.current).toISOString()); } else setAsk({ left });
      } else if (Date.now() - last.current >= minutes * 60_000) {
        asked.current = Date.now(); setAsk({ left: 120 });
        try { if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("Medoro HRMS: are you still working?", { body: `No activity for ${minutes} minute${minutes > 1 ? "s" : ""}. Move the mouse or press a key within 2 minutes.`, tag: "medoro-idle", requireInteraction: true }); } catch { /* notifications unavailable */ }
      }
    }, 1000);
    return () => { clearInterval(tick); events.forEach((e) => window.removeEventListener(e, onAct)); document.removeEventListener("visibilitychange", onVis); };
  }, [active, minutes, lunch]);
  // While "Still working?" is on screen: a warning sound every few seconds and a flashing page title, until the person answers.
  const asking = !!ask;
  useEffect(() => {
    if (!asking) return;
    const title = document.title; let flip = false;
    const ring = () => { if (audio.current) { try { warnBeep(audio.current); } catch { /* ignore */ } } };
    ring();
    const r = setInterval(ring, 6000), f = setInterval(() => { flip = !flip; document.title = flip ? "⚠ Still working? · Medoro HRMS" : title; }, 900);
    return () => { clearInterval(r); clearInterval(f); document.title = title; };
  }, [asking]);
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

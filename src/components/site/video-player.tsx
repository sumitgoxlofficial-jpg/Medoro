"use client";
import { useRef, useState } from "react";
import { clock } from "@/data/tour-videos";

export type PlayerPart = { slug: string; src: string; captions: string; title: string; at: number };

/**
 * The watch page player. A part plays one MP4; a guide (the complete tour included) plays its parts one after another,
 * and its chapters jump to a part. Hinglish captions are on by default; ?t=<seconds> starts from that point.
 */
export function VideoPlayer({ parts, poster, title, total }: { parts: PlayerPart[]; poster: string; title: string; total: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [idx, setIdx] = useState(0);
  const [local, setLocal] = useState(0);
  const [failed, setFailed] = useState(false);
  // Set when the next part should start playing (and from where) as soon as it has loaded.
  const pending = useRef<{ at: number; play: boolean } | null>(null);
  const part = parts[idx];
  const now = part.at + local;
  const go = (k: number, at = 0, play = true) => {
    if (k === idx && ref.current) { ref.current.currentTime = at; if (play) void ref.current.play().catch(() => undefined); return; }
    pending.current = { at, play }; setFailed(false); setLocal(at); setIdx(k);
  };
  const seekGlobal = (t: number, play = true) => {
    const k = parts.reduce((c, p, i) => (p.at <= t ? i : c), 0);
    go(k, t - parts[k].at, play);
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-black shadow-[0_20px_60px_rgba(11,58,120,.18)]">
        <video key={part.slug} ref={ref} controls preload="metadata" playsInline poster={idx === 0 ? poster : undefined} className="absolute inset-0 w-full h-full" aria-label={parts.length > 1 ? `${title}: ${part.title}` : title}
          onTimeUpdate={(e) => setLocal(e.currentTarget.currentTime)}
          onEnded={() => { if (idx + 1 < parts.length) go(idx + 1); }}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            const p = pending.current;
            pending.current = null;
            if (p) { if (p.at > 0 && p.at < v.duration) v.currentTime = p.at; if (p.play) void v.play().catch(() => undefined); return; }
            const t = Number(new URL(window.location.href).searchParams.get("t"));
            if (t > 0 && idx === 0) seekGlobal(t, false);
          }}>
          <source src={part.src} type="video/mp4" onError={() => setFailed(true)} />
          <track kind="subtitles" src={part.captions} srcLang="hi-Latn" label="Hinglish" default />
        </video>
        {failed ? (
          <div role="note" className="absolute inset-x-3 bottom-14 rounded-lg bg-black/75 text-white text-[14px] px-3 py-2">
            This video couldn’t load right now. Please try again in a moment, or message us on WhatsApp for a live demo.
          </div>
        ) : null}
      </div>
      {parts.length > 1 ? (
        <div className="flex items-center justify-between gap-3 text-[14px] text-[var(--s-muted)]">
          <span>Playing part {idx + 1} of {parts.length}: <strong className="text-[var(--s-ink)] font-semibold">{part.title}</strong></span>
          <span className="tabular-nums whitespace-nowrap">{clock(now)} / {clock(total)}</span>
        </div>
      ) : null}
      {parts.length > 1 ? (
        <div className="rounded-xl border border-[var(--s-line)] bg-white">
          <div className="px-4 py-3 border-b border-[var(--s-line)] text-[15px] font-semibold text-[var(--s-ink)]">Chapters</div>
          <ol className="m-0 p-0 list-none max-h-[360px] overflow-auto">
            {parts.map((c, i) => (
              <li key={c.slug}>
                <button onClick={() => go(i)} aria-current={i === idx ? "true" : undefined}
                  className={`w-full text-left flex gap-3 items-baseline px-4 py-2.5 cursor-pointer border-b border-[var(--s-line)] last:border-b-0 transition-colors ${i === idx ? "bg-[var(--s-brand-tint)]" : "hover:bg-[var(--s-soft)]"}`}>
                  <span className="text-[13px] font-semibold text-[var(--s-brand)] tabular-nums w-14 flex-none">{clock(c.at)}</span>
                  <span className="text-[14.5px] text-[var(--s-ink)]">{c.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

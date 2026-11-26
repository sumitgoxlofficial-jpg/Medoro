"use client";
import { useEffect, useRef, useState } from "react";
import { clock } from "@/data/tour-videos";

export type PlayerPart = { slug: string; src: string; title: string; at: number; youtube?: string };

/** The bits of the YouTube IFrame Player API this page uses. */
type YTPlayer = {
  loadVideoById(o: { videoId: string; startSeconds?: number }): void;
  cueVideoById(o: { videoId: string; startSeconds?: number }): void;
  getCurrentTime(): number;
  destroy(): void;
};
type YTNamespace = { Player: new (el: HTMLElement, o: Record<string, unknown>) => YTPlayer };
declare global { interface Window { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void } }

let ytApi: Promise<YTNamespace> | null = null;
/** Loads YouTube's IFrame Player API once per page. */
function loadYouTube(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  ytApi ??= new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT!); };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => { ytApi = null; reject(new Error("YouTube player could not load")); };
    document.head.appendChild(s);
  });
  return ytApi;
}

/** ?t=<seconds> from the address bar, for links that start part-way through a video. */
const startParam = () => { const t = Number(new URL(window.location.href).searchParams.get("t")); return t > 0 ? t : 0; };

/**
 * The watch page player. A part plays one video; a guide (the complete tour included) plays its parts one after
 * another, and its chapters jump to a part. Parts play from YouTube when every part has a YouTube ID, otherwise
 * from the MP4 files. The Hinglish subtitles are part of the picture. ?t=<seconds> starts from that point.
 */
export function VideoPlayer({ parts, poster, title, total }: { parts: PlayerPart[]; poster: string; title: string; total: number }) {
  // YouTube unless a part has no ID, or YouTube is blocked or fails on this network: then the MP4 files take over.
  const [ytBroken, setYtBroken] = useState(false);
  const youtube = !ytBroken && parts.every((p) => p.youtube);
  const [idx, setIdx] = useState(0);
  const [local, setLocal] = useState(0);
  const [failed, setFailed] = useState(false);
  // Asks the active player to show part k from second `at`; set by whichever player is mounted.
  const jumpRef = useRef<(k: number, at: number, play: boolean) => void>(() => undefined);
  const part = parts[idx];
  const now = part.at + local;
  /** The part and offset for a time on the guide's overall clock. */
  const locate = (t: number) => { const k = parts.reduce((c, p, i) => (p.at <= t ? i : c), 0); return { k, at: t - parts[k].at }; };

  return (
    <div className="flex flex-col gap-4">
      <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-black shadow-[0_20px_60px_rgba(11,58,120,.18)]">
        {youtube
          ? <YouTubeFrame parts={parts} idx={idx} setIdx={setIdx} setLocal={setLocal} setFailed={setFailed} jumpRef={jumpRef} locate={locate} onBroken={() => setYtBroken(true)} />
          : <FileVideo parts={parts} idx={idx} setIdx={setIdx} setLocal={setLocal} setFailed={setFailed} jumpRef={jumpRef} locate={locate} poster={poster} title={title} />}
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
                <button onClick={() => jumpRef.current(i, 0, true)} aria-current={i === idx ? "true" : undefined}
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

type Inner = {
  parts: PlayerPart[]; idx: number; setIdx: (k: number) => void; setLocal: (s: number) => void; setFailed: (f: boolean) => void;
  jumpRef: React.MutableRefObject<(k: number, at: number, play: boolean) => void>; locate: (t: number) => { k: number; at: number };
};

/** Plays the parts from YouTube (privacy-enhanced embed) and moves to the next part when one ends. */
function YouTubeFrame({ parts, idx, setIdx, setLocal, jumpRef, locate, onBroken }: Inner & { onBroken: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const currentRef = useRef(idx);
  useEffect(() => { currentRef.current = idx; }, [idx]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = locate(startParam());
    if (start.k) setIdx(start.k);
    loadYouTube().then((YT) => {
      if (!alive || !host.current) return;
      const mount = document.createElement("div");
      host.current.appendChild(mount);
      player.current = new YT.Player(mount, {
        host: "https://www.youtube-nocookie.com",
        videoId: parts[start.k].youtube,
        width: "100%", height: "100%",
        // The Hinglish subtitles are burned into the picture, so captions stay off.
        playerVars: { rel: 0, playsinline: 1, start: Math.floor(start.at) },
        events: {
          onStateChange: (e: { data: number }) => {
            // 0 = ended: carry on with the next part of the guide.
            if (e.data === 0 && currentRef.current + 1 < parts.length) jumpRef.current(currentRef.current + 1, 0, true);
          },
          onError: () => onBroken(),
        },
      });
      timer = setInterval(() => { const t = player.current?.getCurrentTime?.(); if (typeof t === "number") setLocal(t); }, 1000);
    }).catch(() => onBroken());
    // The API script can also hang (a filtered network): fall back if no player has appeared within 8 seconds.
    const watchdog = setTimeout(() => { if (alive && !player.current) onBroken(); }, 8000);
    jumpRef.current = (k, at, play) => {
      const p = player.current;
      setIdx(k); setLocal(at);
      if (!p) return;
      const o = { videoId: parts[k].youtube!, startSeconds: at };
      if (play) p.loadVideoById(o); else p.cueVideoById(o);
    };
    return () => { alive = false; clearInterval(timer); clearTimeout(watchdog); player.current?.destroy(); player.current = null; };
    // The player is created once per page; parts never change on a watch page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="absolute inset-0 [&>iframe]:w-full [&>iframe]:h-full" />;
}

/** Plays the MP4 files, one part after another. */
function FileVideo({ parts, idx, setIdx, setLocal, setFailed, jumpRef, locate, poster, title }: Inner & { poster: string; title: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  // Set when the next part should start playing (and from where) as soon as it has loaded.
  const pending = useRef<{ at: number; play: boolean } | null>(null);
  const part = parts[idx];
  useEffect(() => {
    jumpRef.current = (k, at = 0, play = true) => {
      if (k === idx && ref.current) { ref.current.currentTime = at; if (play) void ref.current.play().catch(() => undefined); return; }
      pending.current = { at, play }; setFailed(false); setLocal(at); setIdx(k);
    };
  });
  return (
    <video key={part.slug} ref={ref} controls preload="metadata" playsInline poster={idx === 0 ? poster : undefined} className="absolute inset-0 w-full h-full" aria-label={parts.length > 1 ? `${title}: ${part.title}` : title}
      onTimeUpdate={(e) => setLocal(e.currentTarget.currentTime)}
      onEnded={() => { if (idx + 1 < parts.length) jumpRef.current(idx + 1, 0, true); }}
      onLoadedMetadata={(e) => {
        const v = e.currentTarget;
        const p = pending.current;
        pending.current = null;
        if (p) { if (p.at > 0 && p.at < v.duration) v.currentTime = p.at; if (p.play) void v.play().catch(() => undefined); return; }
        const t = startParam();
        if (t > 0 && idx === 0) { const s = locate(t); jumpRef.current(s.k, s.at, false); }
      }}>
      <source src={part.src} type="video/mp4" onError={() => setFailed(true)} />
    </video>
  );
}

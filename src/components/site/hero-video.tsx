"use client";
import { useEffect, useRef } from "react";

/**
 * Where the hero footage is served from: /site on this site, or, when NEXT_PUBLIC_VIDEO_BASE_URL points at the video
 * host (on Vercel, the Supabase Storage bucket tour-videos), its site/ folder. See .vercelignore.
 */
const VIDEO_HOST = (process.env.NEXT_PUBLIC_VIDEO_BASE_URL ?? "").replace(/\/$/, "");
const HERO_BASE = VIDEO_HOST ? `${VIDEO_HOST}/site` : "/site";

/**
 * The main page hero's background video: a looping, muted street of Indian medical stores at dusk with medicines
 * swirling through it. The poster shows first and stays for visitors who ask for reduced motion.
 */
export function HeroVideo() {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current; if (!v) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => { if (mq.matches) v.pause(); else void v.play().catch(() => {}); };
    apply(); mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <video ref={ref} className="absolute inset-0 w-full h-full object-cover" poster="/site/hero-poster.webp" muted loop playsInline preload="auto" disablePictureInPicture tabIndex={-1}>
        <source src={`${HERO_BASE}/hero-loop.mp4`} type="video/mp4" />
        <source src={`${HERO_BASE}/hero-loop.webm`} type="video/webm" />
      </video>
      {/* The footage is a street at dusk: a dark wash, deepest behind the headline, keeps the white text readable. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_55%_at_50%_45%,rgba(6,20,18,.72),rgba(6,20,18,.5)_60%,rgba(6,20,18,.3)_100%)] max-[640px]:bg-[rgba(6,20,18,.6)]" />
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-[rgba(6,20,18,.55)]" />
    </div>
  );
}

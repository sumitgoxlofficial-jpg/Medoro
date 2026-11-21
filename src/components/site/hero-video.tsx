"use client";
import { useEffect, useRef } from "react";

/**
 * The main page hero's background video: a looping, muted 3D render of medicines (made by
 * scripts/hero-video/render.mjs). The poster shows first and stays for visitors who ask for reduced motion.
 * A soft white wash on top keeps the headline easy to read.
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
        <source src="/site/hero-loop.webm" type="video/webm" />
        <source src="/site/hero-loop.mp4" type="video/mp4" />
      </video>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_52%_48%_at_50%_45%,rgba(255,255,255,.88),rgba(255,255,255,.6)_55%,rgba(255,255,255,.12)_85%)] max-[640px]:bg-white/70" />
    </div>
  );
}

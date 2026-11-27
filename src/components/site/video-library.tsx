"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Play, Search } from "lucide-react";
import { TOUR_VIDEOS, clock, thumbUrl, type TourVideo } from "@/data/tour-videos";

type Filter = "all" | "guide" | "part";
const FILTERS: [Filter, string][] = [["all", "All videos"], ["guide", "Full guides"], ["part", "Step-by-step parts"]];

/** One video card: thumbnail with duration, title and the Hinglish line, like a video site's grid. */
export function VideoCard({ v, size = "md" }: { v: TourVideo; size?: "md" | "sm" }) {
  const sm = size === "sm";
  return (
    <Link href={`/videos/${v.slug}`} className={`group no-underline text-inherit flex ${sm ? "flex-row gap-3" : "flex-col gap-3"}`}>
      <span className={`relative block overflow-hidden rounded-xl bg-[var(--s-soft)] border border-[var(--s-line)] ${sm ? "w-[168px] flex-none" : "w-full"} aspect-video`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- small static WebP thumbnails, already sized */}
        <img src={thumbUrl(v)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
        <span className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors flex items-center justify-center">
          <span className="size-12 rounded-full bg-white/95 text-[var(--s-brand)] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"><Play size={22} fill="currentColor" aria-hidden /></span>
        </span>
        <span className="absolute right-1.5 bottom-1.5 rounded-md bg-black/80 text-white text-[12px] font-semibold px-1.5 py-0.5 tabular-nums">{clock(v.seconds)}</span>
      </span>
      <span className="flex flex-col gap-1 min-w-0">
        <span className={`font-semibold text-[var(--s-ink)] leading-snug group-hover:text-[var(--s-brand)] ${sm ? "text-[14px] line-clamp-2" : "text-[16px]"}`}>{v.title}</span>
        <span className={`text-[var(--s-muted)] ${sm ? "text-[12.5px] line-clamp-1" : "text-[14px] line-clamp-2"}`}>{v.subtitle}</span>
        <span className="text-[12.5px] text-[var(--s-muted)]">{v.kind === "guide" ? (v.sources.length > 1 ? `Full guide · ${v.sources.length} parts` : "Full guide") : `Part ${String(v.part).padStart(2, "0")} of 26`} · Hindi-English</span>
      </span>
    </Link>
  );
}

/** The whole library: filter chips, a search box and the grid of all videos. */
export function VideoLibrary({ videos = TOUR_VIDEOS }: { videos?: TourVideo[] } = {}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return videos.filter((v) => (filter === "all" || v.kind === filter) && words.every((w) => `${v.title} ${v.subtitle} ${v.description}`.toLowerCase().includes(w)));
  }, [filter, q, videos]);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter videos">
          {FILTERS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
              className={`h-9 px-4 rounded-full text-[14px] font-medium cursor-pointer transition-colors ${filter === k ? "bg-[var(--s-ink)] text-white" : "bg-[var(--s-soft)] text-[var(--s-ink)] hover:bg-[var(--s-line)]"}`}>
              {label} <span className="opacity-70">({k === "all" ? videos.length : videos.filter((v) => v.kind === k).length})</span>
            </button>
          ))}
        </div>
        <label className="ml-auto relative w-full max-w-[340px] max-[640px]:max-w-none">
          <Search size={16} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--s-muted)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: billing, GST, expiry, Hindi…" aria-label="Search videos"
            className="w-full h-10 pl-9 pr-3 rounded-full border border-[var(--s-line)] bg-white text-[15px] outline-none focus:border-[var(--s-brand)]" />
        </label>
      </div>
      {shown.length ? (
        <div className="grid gap-x-5 gap-y-8 grid-cols-1 min-[560px]:grid-cols-2 min-[960px]:grid-cols-3 min-[1240px]:grid-cols-4">
          {shown.map((v) => <VideoCard key={v.slug} v={v} />)}
        </div>
      ) : <p className="m-0 text-[16px] text-[var(--s-muted)]">No video matches “{q}”.</p>}
    </div>
  );
}

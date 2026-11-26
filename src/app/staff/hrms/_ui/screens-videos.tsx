"use client";
import { useEffect, useRef, useState } from "react";
import type { Data } from "@/staff/hrms/screens";
import { HR_VIDEO_GROUPS, type HrVideo } from "@/staff/hrms/video-catalog";
import { Card, Empty, btnCls, cx } from "./kit";

const mins = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.max(1, Math.round(s / 60))} min`);
type Links = Record<string, { video: string; thumb: string }>;

/** Training Videos: the HRMS how-to videos this person's role may watch. They sit in a private bucket; the screen asks
 *  the HRMS for short-lived signed links (staff only, per role) and renews them before they run out. */
export function VideosScreen({ d }: { d: Data<"hrvideos"> }) {
  const [links, setLinks] = useState<Links | "wait" | "fail">("wait");
  const [open, setOpen] = useState<HrVideo | null>(null);
  const player = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    const get = () => fetch("/staff/hrms/videos/links", { method: "POST", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null)).then((j: { links?: Links } | null) => alive && setLinks(j?.links ?? "fail"), () => alive && setLinks("fail"));
    void get();
    const t = setInterval(get, 3 * 3_600_000); // links last 4 hours
    return () => { alive = false; clearInterval(t); };
  }, []);
  const play = (v: HrVideo) => { setOpen(v); setTimeout(() => player.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); };
  if (!d.videos.length) return <Card pad><Empty>No training videos for your role yet.</Empty></Card>;
  if (links === "fail") return <Card pad><Empty>The videos couldn’t be opened. Reload the page; if it keeps happening, tell HR.</Empty></Card>;
  if (links === "wait") return <Card pad><Empty>Loading videos…</Empty></Card>;
  const L = links;
  return <div className="flex flex-col gap-4">
    {open ? <div ref={player}><Card title={open.title} sub={`${open.about} · ${mins(open.seconds)}`} right={<button className={btnCls} onClick={() => setOpen(null)}>Close</button>}>
      <video key={open.slug} className="w-full rounded-lg bg-black aspect-video" src={L[open.slug]?.video} poster={L[open.slug]?.thumb || undefined} controls autoPlay playsInline controlsList="nodownload" preload="metadata" />
      <p className="text-[12px] text-[#64748B] mt-2">Hinglish voice with subtitles. Recorded with demo employees; real people’s details are blurred.</p>
    </Card></div> : null}
    {HR_VIDEO_GROUPS.map((g) => {
      const list = d.videos.filter((v) => v.group === g.id && L[v.slug]);
      if (!list.length) return null;
      return <Card key={g.id} title={g.label} pad>
        <div className="grid grid-cols-3 gap-3 max-[1100px]:grid-cols-2 max-[620px]:grid-cols-1">
          {list.map((v) => <button key={v.slug} type="button" onClick={() => play(v)} aria-label={`Play ${v.title}`}
            className={cx("text-left rounded-xl border border-[#d6dee8] bg-white overflow-hidden cursor-pointer p-0 hover:shadow-md transition-shadow", open?.slug === v.slug && "ring-2 ring-[#14B8A6]")}>
            <span className="relative block aspect-video bg-[#E6F4F1]">
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed link to private storage, not for the image optimiser */}
              {L[v.slug]?.thumb ? <img src={L[v.slug].thumb} alt="" className="w-full h-full object-cover" loading="lazy" /> : null}
              <span className="absolute right-2 bottom-2 text-[11px] font-semibold text-white bg-black/70 rounded px-1.5 py-0.5">{mins(v.seconds)}</span>
            </span>
            <span className="block px-3 py-2.5">
              <span className="block text-[13.5px] font-semibold text-[#0F172A]">{v.title}</span>
              <span className="block text-[12px] text-[#64748B] mt-0.5">{v.about}</span>
            </span>
          </button>)}
        </div>
      </Card>;
    })}
  </div>;
}

"use client";
import { useEffect, useRef, useState } from "react";
import type { Data } from "@/staff/hrms/screens";
import { HR_VIDEO_GROUPS, type HrVideo } from "@/staff/hrms/video-catalog";
import { Card, Empty, btnCls, cx } from "./kit";

const mins = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.max(1, Math.round(s / 60))} min`);
const src = (slug: string, kind: "files" | "thumbs") => `/hrms-videos/${kind}/${slug}.${kind === "files" ? "mp4" : "jpg"}`;

/** Training Videos: the HRMS how-to videos this person's role may watch. The files load only after the HRMS gives the
 *  browser a short-lived video pass (staff only); the pass is renewed when it is about to run out. */
export function VideosScreen({ d }: { d: Data<"hrvideos"> }) {
  const [pass, setPass] = useState<"wait" | "ok" | "fail">("wait");
  const [open, setOpen] = useState<HrVideo | null>(null);
  const player = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    const get = () => fetch("/staff/hrms/videos/pass", { method: "POST", cache: "no-store" }).then((r) => alive && setPass(r.ok ? "ok" : "fail"), () => alive && setPass("fail"));
    void get();
    const t = setInterval(get, 3 * 3_600_000); // the pass lasts 4 hours
    return () => { alive = false; clearInterval(t); };
  }, []);
  const play = (v: HrVideo) => { setOpen(v); setTimeout(() => player.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); };
  if (!d.videos.length) return <Card pad><Empty>No training videos for your role yet.</Empty></Card>;
  if (pass === "fail") return <Card pad><Empty>The videos couldn’t be opened. Reload the page; if it keeps happening, sign in again.</Empty></Card>;
  if (pass === "wait") return <Card pad><Empty>Loading videos…</Empty></Card>;
  return <div className="flex flex-col gap-4">
    {open ? <div ref={player}><Card title={open.title} sub={`${open.about} · ${mins(open.seconds)}`} right={<button className={btnCls} onClick={() => setOpen(null)}>Close</button>}>
      <video key={open.slug} className="w-full rounded-lg bg-black aspect-video" src={src(open.slug, "files")} poster={src(open.slug, "thumbs")} controls autoPlay playsInline controlsList="nodownload" preload="metadata" />
      <p className="text-[12px] text-[#64748B] mt-2">Hinglish voice with subtitles. Recorded with demo employees; real people’s details are blurred.</p>
    </Card></div> : null}
    {HR_VIDEO_GROUPS.map((g) => {
      const list = d.videos.filter((v) => v.group === g.id);
      if (!list.length) return null;
      return <Card key={g.id} title={g.label} pad>
        <div className="grid grid-cols-3 gap-3 max-[1100px]:grid-cols-2 max-[620px]:grid-cols-1">
          {list.map((v) => <button key={v.slug} type="button" onClick={() => play(v)} aria-label={`Play ${v.title}`}
            className={cx("text-left rounded-xl border border-[#d6dee8] bg-white overflow-hidden cursor-pointer p-0 hover:shadow-md transition-shadow", open?.slug === v.slug && "ring-2 ring-[#14B8A6]")}>
            <span className="relative block aspect-video bg-[#E6F4F1]">
              {/* eslint-disable-next-line @next/next/no-img-element -- pass-gated static file, not for the image optimiser */}
              <img src={src(v.slug, "thumbs")} alt="" className="w-full h-full object-cover" loading="lazy" />
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

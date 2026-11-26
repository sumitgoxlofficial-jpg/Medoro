import Link from "next/link";
import { ArrowRight, Play } from "lucide-react";
import { TOUR_VIDEOS, clock, thumbUrl } from "@/data/tour-videos";
import { VideoCard } from "./video-library";
import type { tFor } from "@/lib/tr";

/**
 * "Watch Medoro in action": the full product tour as a large tile, six topic guides, and a link to the whole video
 * library (/videos) with every guide and step-by-step part. Used on the home page and the Pharmacy page.
 */
export function VideoShowcase({ t, soft = false }: { t: ReturnType<typeof tFor>; soft?: boolean }) {
  const tour = TOUR_VIDEOS[0];
  const guides = TOUR_VIDEOS.filter((v) => v.kind === "guide").slice(1, 7);
  return (
    <section id="videos" aria-labelledby="videos-title" className={soft ? "bg-[var(--s-soft)] border-y border-[var(--s-line)]" : "relative isolate"}>
      <div className="max-w-[1200px] mx-auto px-6 max-[640px]:px-4 py-[clamp(72px,10vw,128px)] flex flex-col gap-10">
        <div className="grid grid-cols-12 gap-x-6 gap-y-5 items-end">
          <div data-reveal className="col-span-12 min-[1000px]:col-span-7 flex flex-col gap-5">
            <span className="text-[14px] font-semibold text-[var(--s-brand)]">{t("Video tutorials")}</span>
            <h2 id="videos-title" className="site-display m-0 text-[clamp(34px,4.4vw,56px)] text-[var(--s-ink)]">{t("Watch Medoro Pharmacy in action.")}</h2>
          </div>
          <p data-reveal className="m-0 text-[clamp(17px,1.4vw,19px)] leading-[1.6] text-[var(--s-ink-2)] col-span-12 min-[1000px]:col-span-5">
            {t("{n} videos in simple Hindi-English: the full tour, a guide for each job, and every step from sign-up to GST.", { n: TOUR_VIDEOS.length })}
          </p>
        </div>
        <div className="grid gap-6 min-[1000px]:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start">
          <Link href={`/videos/${tour.slug}`} data-reveal className="group no-underline text-inherit flex flex-col gap-3">
            <span className="relative block aspect-video rounded-2xl overflow-hidden border border-[var(--s-line)] shadow-[0_24px_70px_rgba(11,58,120,.16)]">
              {/* eslint-disable-next-line @next/next/no-img-element -- static WebP thumbnail */}
              <img src={thumbUrl(tour)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.02]" />
              <span className="absolute inset-0 flex items-center justify-center bg-black/10 group-hover:bg-black/25 transition-colors">
                <span className="size-[72px] rounded-full bg-white text-[var(--s-brand)] flex items-center justify-center shadow-xl"><Play size={30} fill="currentColor" aria-hidden /></span>
              </span>
              <span className="absolute right-3 bottom-3 rounded-md bg-black/80 text-white text-[13px] font-semibold px-2 py-0.5 tabular-nums">{clock(tour.seconds)}</span>
            </span>
            <span className="text-[20px] font-semibold text-[var(--s-ink)] group-hover:text-[var(--s-brand)]">{t("The complete product tour")}</span>
            <span className="text-[15px] text-[var(--s-muted)]">{t("All 26 parts in one video, with chapters you can jump to.")}</span>
          </Link>
          <div className="grid gap-5 grid-cols-1 min-[560px]:grid-cols-2">
            {guides.map((v) => <div key={v.slug} data-reveal><VideoCard v={v} /></div>)}
          </div>
        </div>
        <Link href="/videos" className="self-start site-link-arrow inline-flex items-center gap-2 h-12 px-5 rounded-lg bg-[var(--s-brand)] text-white text-[15.5px] font-semibold no-underline hover:bg-[var(--s-brand-ink)] hover:text-white">
          {t("See all {n} videos", { n: TOUR_VIDEOS.length })}<ArrowRight size={18} aria-hidden />
        </Link>
      </div>
    </section>
  );
}

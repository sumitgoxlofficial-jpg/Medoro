import Link from "next/link";
import { ArrowRight, Play, ScanBarcode, Warehouse } from "lucide-react";
import { TOUR_VIDEOS, clock, thumbUrl, type TourVideo } from "@/data/tour-videos";
import { DIST_VIDEOS } from "@/data/dist-tour-videos";
import type { tFor } from "@/lib/tr";

/**
 * "Watch our products in action": one place on the home page that opens both video libraries, so a visitor can learn
 * either product before talking to us. Each card plays that product's complete tour or opens its whole library.
 */
const TOURS: { id: string; Icon: typeof Play; name: string; for: string; library: string; videos: TourVideo[]; topics: string[] }[] = [
  { id: "pharmacy", Icon: ScanBarcode, name: "Medoro Pharmacy", for: "For medical stores, pharmacy chains and hospital pharmacies", library: "/videos", videos: TOUR_VIDEOS,
    topics: ["Counter billing", "Batch and expiry stock", "Purchases", "GST returns"] },
  { id: "distribution", Icon: Warehouse, name: "Medoro Distribution", for: "For distributors, stockists, super stockists and C&F agents", library: "/videos/distribution", videos: DIST_VIDEOS,
    topics: ["Orders and credit control", "Picking and dispatch", "Schemes and GST billing", "Collections"] },
];

export function ProductTours({ t }: { t: ReturnType<typeof tFor> }) {
  return (
    <section id="videos" aria-labelledby="tours-title" className="bg-[var(--s-soft)] border-y border-[var(--s-line)] scroll-mt-20">
      <div className="max-w-[1200px] mx-auto px-6 max-[640px]:px-4 py-[clamp(72px,10vw,128px)] flex flex-col gap-10">
        <div className="grid grid-cols-12 gap-x-6 gap-y-5 items-end">
          <div data-reveal className="col-span-12 min-[1000px]:col-span-7 flex flex-col gap-5">
            <span className="text-[14px] font-semibold text-[var(--s-brand)]">{t("Video tours")}</span>
            <h2 id="tours-title" className="site-display m-0 text-[clamp(34px,4.4vw,56px)] text-[var(--s-ink)]">{t("See our products in action.")}</h2>
          </div>
          <p data-reveal className="m-0 text-[clamp(17px,1.4vw,19px)] leading-[1.6] text-[var(--s-ink-2)] col-span-12 min-[1000px]:col-span-5">
            {t("Simple Hindi-English videos of the real product. Watch the complete tour, or open the library and jump to the part you need.")}
          </p>
        </div>
        <div className="grid gap-6 min-[900px]:grid-cols-2">
          {TOURS.map((p, i) => {
            const tour = p.videos[0];
            return (
              <article key={p.id} data-reveal style={{ ["--d" as string]: i }} className="site-lift rounded-2xl border border-[var(--s-line)] bg-white overflow-hidden flex flex-col">
                <Link href={`/videos/${tour.slug}`} aria-label={t("Play the complete {name} tour", { name: p.name })} className="group relative block aspect-video bg-[var(--s-dark)]">
                  {/* eslint-disable-next-line @next/next/no-img-element -- static WebP thumbnail */}
                  <img src={thumbUrl(tour)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.02]" />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/10 group-hover:bg-black/25 transition-colors">
                    <span className="size-[68px] rounded-full bg-white text-[var(--s-brand)] flex items-center justify-center shadow-xl"><Play size={28} fill="currentColor" aria-hidden /></span>
                  </span>
                  <span className="absolute right-3 bottom-3 rounded-md bg-black/80 text-white text-[13px] font-semibold px-2 py-0.5 tabular-nums">{clock(tour.seconds)}</span>
                </Link>
                <div className="p-[clamp(20px,3vw,32px)] flex flex-col gap-4 flex-1">
                  <div className="flex items-center gap-3">
                    <span className="size-11 rounded-xl bg-[var(--s-brand-tint)] text-[var(--s-brand)] flex items-center justify-center flex-none"><p.Icon size={22} aria-hidden /></span>
                    <div className="flex flex-col min-w-0">
                      <h3 className="m-0 text-[23px] font-semibold tracking-[-.01em] text-[var(--s-ink)]">{t(p.name)}</h3>
                      <span className="text-[14.5px] text-[var(--s-muted)]">{t(p.for)}</span>
                    </div>
                  </div>
                  <p className="m-0 text-[16px] text-[var(--s-ink-2)]">{t("{n} videos: the complete tour, a guide for each job and every step.", { n: p.videos.length })}</p>
                  <ul className="m-0 p-0 list-none flex flex-wrap gap-2">
                    {p.topics.map((x) => <li key={x} className="rounded-full bg-[var(--s-brand-tint)] text-[var(--s-brand-ink)] text-[13.5px] font-medium px-3 py-1">{t(x)}</li>)}
                  </ul>
                  <div className="mt-auto pt-2 flex flex-wrap gap-3">
                    <Link href={`/videos/${tour.slug}`} className="site-link-arrow inline-flex items-center gap-2 h-11 px-4 rounded-lg bg-[var(--s-brand)] text-white text-[15px] font-semibold no-underline hover:bg-[var(--s-brand-ink)] hover:text-white">
                      <Play size={16} fill="currentColor" aria-hidden />{t("Watch the full tour")}
                    </Link>
                    <Link href={p.library} className="inline-flex items-center gap-2 h-11 px-4 rounded-lg border border-[var(--s-line)] text-[var(--s-ink)] text-[15px] font-semibold no-underline hover:border-[var(--s-brand)] hover:text-[var(--s-ink)]">
                      {t("All {n} videos", { n: p.videos.length })}<ArrowRight size={16} aria-hidden />
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

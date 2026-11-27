import Link from "next/link";
import { Play } from "lucide-react";
import { CtaBand, MarketingShell } from "@/components/seo/blocks";
import { VideoLibrary } from "@/components/site/video-library";
import { clock, thumbUrl } from "@/data/tour-videos";
import { DIST_VIDEOS } from "@/data/dist-tour-videos";
import { absoluteUrl, pageMetadata, type Crumb } from "@/lib/seo";

/** Medoro Distribution video library: the full product tour, topic guides and all 26 step-by-step parts. */
const PATH = "/videos/distribution";
export const metadata = pageMetadata({
  title: "Medoro Distribution Video Tutorials (Hindi-English) | Medoro",
  description: "Watch Medoro Distribution in action: a 90-minute product tour, topic guides and 26 step-by-step videos on orders, credit control, schemes, GST invoicing, picking, dispatch, expiry claims and collections, in Hindi-English.",
  path: PATH,
  keywords: ["Medoro Distribution video", "pharma distribution software tutorial Hindi", "pharma wholesale ERP demo", "distributor billing software video"],
});
const crumbs: Crumb[] = [["Videos", "/videos"], ["Distribution", PATH]];
const wrap = "max-w-[1320px] mx-auto px-6 max-[640px]:px-4";

export default function DistributionVideos() {
  const tour = DIST_VIDEOS[0];
  const total = DIST_VIDEOS.length;
  const listLd = {
    "@type": "ItemList", name: "Medoro Distribution video tutorials",
    itemListElement: DIST_VIDEOS.map((v, i) => ({ "@type": "ListItem", position: i + 1, url: absoluteUrl(`/videos/${v.slug}`), name: v.title })),
  };
  return (
    <MarketingShell crumbs={crumbs} jsonLd={[listLd]}>
      <section className="relative isolate border-b border-[var(--s-line)]">
        <div className={`${wrap} pt-[clamp(28px,5vw,64px)] pb-12 grid gap-10 min-[1000px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-center`}>
          <div className="flex flex-col gap-5">
            <span className="text-[14px] font-semibold text-[var(--s-brand)]">Medoro Distribution · {total} videos</span>
            <h1 className="site-display m-0 text-[clamp(34px,4.4vw,54px)]">See Medoro Distribution in action.</h1>
            <p className="m-0 text-[clamp(16px,1.3vw,18px)] leading-[1.6] text-[var(--s-ink-2)]">
              Real screens, a demo distributor and simple Hindi-English. Start with the full tour, pick a guide for your team,
              or jump straight to one step: orders and credit control, schemes, GST invoices, picking, dispatch, collections and more.
            </p>
            <div className="flex gap-3 flex-wrap">
              <Link href={`/videos/${tour.slug}`} className="site-link-arrow inline-flex items-center gap-2 h-12 px-5 rounded-lg bg-[var(--s-brand)] text-white text-[16px] font-semibold hover:bg-[var(--s-brand-ink)] hover:text-white no-underline"><Play size={17} fill="currentColor" aria-hidden />Watch the full tour ({clock(tour.seconds)})</Link>
              <a href="/distributor-signup" className="inline-flex items-center h-12 px-5 rounded-lg border border-[#C9D1CF] text-[16px] font-semibold text-[var(--s-ink)] hover:border-[var(--s-ink)] no-underline">Start 7-day free trial</a>
            </div>
            <p className="m-0 text-[13.5px] text-[var(--s-muted)]">Recorded on a demo distributor with made-up data. Hinglish subtitles on every video. Pharmacy videos are at <Link href="/videos">/videos</Link>.</p>
          </div>
          <Link href={`/videos/${tour.slug}`} className="group relative block aspect-video rounded-2xl overflow-hidden border border-[var(--s-line)] shadow-[0_24px_70px_rgba(11,58,120,.18)]" aria-label={`Play: ${tour.title}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- static WebP thumbnail */}
            <img src={thumbUrl(tour)} alt="" className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.02]" />
            <span className="absolute inset-0 flex items-center justify-center bg-black/10 group-hover:bg-black/25 transition-colors">
              <span className="size-20 rounded-full bg-white text-[var(--s-brand)] flex items-center justify-center shadow-xl"><Play size={34} fill="currentColor" aria-hidden /></span>
            </span>
            <span className="absolute right-3 bottom-3 rounded-md bg-black/80 text-white text-[13px] font-semibold px-2 py-0.5">{clock(tour.seconds)}</span>
          </Link>
        </div>
      </section>
      <section aria-label="All videos" className={`${wrap} py-12`}>
        <VideoLibrary videos={DIST_VIDEOS} />
      </section>
      <CtaBand title="Seen enough? Try it on your own distribution business." />
    </MarketingShell>
  );
}

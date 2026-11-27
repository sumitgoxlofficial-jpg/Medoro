import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CtaBand, MarketingShell } from "@/components/seo/blocks";
import { VideoCard } from "@/components/site/video-library";
import { VideoPlayer } from "@/components/site/video-player";
import { ALL_VIDEOS, clock, libraryOf, partUrl, thumbUrl, videoBySlug } from "@/data/tour-videos";
import { youtubeId } from "@/data/tour-youtube";
import { absoluteUrl, pageMetadata, type Crumb } from "@/lib/seo";

export const dynamicParams = false;
export const generateStaticParams = () => ALL_VIDEOS.map((v) => ({ slug: v.slug }));
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const v = videoBySlug((await params).slug);
  if (!v) return {};
  const lib = libraryOf(v);
  return pageMetadata({ title: `${v.title} | ${lib.name} video`, description: `${v.description} Hindi-English, ${clock(v.seconds)}.`, path: `/videos/${v.slug}`, keywords: ["Medoro", v.product === "distribution" ? "pharma distribution software video" : "pharmacy software video", v.title] });
}

const iso = (s: number) => `PT${Math.floor(s / 60)}M${s % 60}S`;
const wrap = "max-w-[1320px] mx-auto px-6 max-[640px]:px-4";

export default async function Watch({ params }: Props) {
  const v = videoBySlug((await params).slug);
  if (!v) notFound();
  const lib = libraryOf(v);
  const LIST = lib.videos;
  const i = LIST.indexOf(v);
  // Up next: the following part (or the first parts of a guide), then the other videos.
  const partsOf = v.kind === "guide" ? v.sources.map((slug) => videoBySlug(slug)!) : [];
  // What the player plays: the part itself, or each part of the guide with where it starts.
  const player = v.sources.map((slug, k) => ({ slug, src: partUrl(slug), title: videoBySlug(slug)!.title, at: v.chapters[k]?.at ?? 0, youtube: youtubeId(slug) }));
  const yt = v.kind === "part" ? youtubeId(v.slug) : undefined;
  const rest = [...partsOf, ...LIST.slice(i + 1), ...LIST.slice(0, i)].filter((x, k, a) => x !== v && a.indexOf(x) === k).slice(0, 12);
  const crumbs: Crumb[] = v.product === "distribution" ? [["Videos", "/videos"], ["Distribution", lib.href], [v.title, `/videos/${v.slug}`]] : [["Videos", "/videos"], [v.title, `/videos/${v.slug}`]];
  const ld = {
    "@type": "VideoObject", name: v.title, description: v.description, thumbnailUrl: [absoluteUrl(thumbUrl(v))], uploadDate: "2026-11-26",
    duration: iso(v.seconds), url: absoluteUrl(`/videos/${v.slug}`), ...(v.kind === "part" ? { contentUrl: absoluteUrl(partUrl(v.slug)) } : {}), ...(yt ? { embedUrl: `https://www.youtube.com/embed/${yt}` } : {}), inLanguage: "hi-IN",
    ...(v.chapters.length > 1 ? { hasPart: v.chapters.map((c, k) => ({ "@type": "Clip", name: c.label, startOffset: c.at, endOffset: v.chapters[k + 1]?.at ?? v.seconds, url: absoluteUrl(`/videos/${v.slug}?t=${c.at}`) })) } : {}),
  };
  return (
    <MarketingShell crumbs={crumbs} jsonLd={[ld]}>
      <div className={`${wrap} pt-6 pb-14 grid gap-8 min-[1100px]:grid-cols-[minmax(0,1fr)_380px]`}>
        <div className="flex flex-col gap-5 min-w-0">
          <VideoPlayer parts={player} poster={thumbUrl(v)} title={v.title} total={v.seconds} />
          <div className="flex flex-col gap-2">
            <h1 className="m-0 text-[clamp(22px,2.4vw,30px)] font-semibold tracking-[-.01em] text-[var(--s-ink)]">{v.title}</h1>
            <p className="m-0 text-[16px] text-[var(--s-brand)] font-medium">{v.subtitle}</p>
            <p className="m-0 text-[14px] text-[var(--s-muted)]">{clock(v.seconds)} · Hindi-English with Hinglish subtitles · {lib.name}</p>
          </div>
          <div className="rounded-xl bg-[var(--s-soft)] border border-[var(--s-line)] p-4 flex flex-col gap-3">
            <p className="m-0 text-[16px] leading-[1.6] text-[var(--s-ink-2)]">{v.description}</p>
            {partsOf.length > 1 ? (
              <div className="flex flex-wrap gap-2">{partsOf.map((p) => <Link key={p.slug} href={`/videos/${p.slug}`} className="text-[13.5px] rounded-full bg-white border border-[var(--s-line)] px-3 py-1 no-underline text-[var(--s-ink)] hover:border-[var(--s-brand)]">{p.title}</Link>)}</div>
            ) : null}
            <p className="m-0 text-[13px] text-[var(--s-muted)]">Recorded on {lib.demo} with made-up data. GST reports shown are for guidance; have your CA review them before filing.</p>
            <div className="flex gap-3 flex-wrap pt-1">
              <a href={v.product === "distribution" ? "/distributor-signup" : "/trial"} className="inline-flex items-center h-11 px-4 rounded-lg bg-[var(--s-brand)] text-white text-[15px] font-semibold no-underline hover:bg-[var(--s-brand-ink)] hover:text-white">Start 7-day free trial</a>
              <Link href={lib.href} className="inline-flex items-center h-11 px-4 rounded-lg border border-[#C9D1CF] text-[15px] font-semibold text-[var(--s-ink)] no-underline hover:border-[var(--s-ink)]">All {LIST.length} videos</Link>
            </div>
          </div>
        </div>
        <aside aria-label="Up next" className="flex flex-col gap-4">
          <h2 className="m-0 text-[17px] font-semibold text-[var(--s-ink)]">Up next</h2>
          {rest.map((x) => <VideoCard key={x.slug} v={x} size="sm" />)}
        </aside>
      </div>
      <CtaBand />
    </MarketingShell>
  );
}

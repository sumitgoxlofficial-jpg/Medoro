import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CardGrid, CtaBand, FaqSection, Hero, LinkGrid, MarketingShell, Section } from "@/components/seo/blocks";
import { featureBySlug } from "@/data/features";
import { HUBS, SOLUTION_LINKS } from "@/data/site-links";
import { SOLUTIONS, solutionBySlug } from "@/data/solutions";
import { toolBySlug } from "@/data/tools";
import { pageMetadata, softwareApplicationSchema, type Crumb } from "@/lib/seo";

export const dynamicParams = false;
export const generateStaticParams = () => SOLUTIONS.map((s) => ({ niche: s.slug }));

type Props = { params: Promise<{ niche: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const s = solutionBySlug((await params).niche);
  if (!s) return {};
  return pageMetadata({ title: `${s.title} | Medoro`, description: s.description, path: `/solutions/${s.slug}`, keywords: s.keywords });
}

export default async function SolutionPage({ params }: Props) {
  const s = solutionBySlug((await params).niche);
  if (!s) notFound();
  const path = `/solutions/${s.slug}`;
  const crumbs: Crumb[] = [["Solutions", HUBS.solutions], [s.name, path]];
  const features = s.features.map((slug) => featureBySlug(slug)!).map((f) => [f.name, `/features/${f.slug}`, f.description] as [string, string, string]);
  const tools = s.tools.map((slug) => toolBySlug(slug)!).map((t) => [t.name, `/tools/${t.slug}`] as [string, string]);
  const others = SOLUTION_LINKS.filter(([, p]) => p !== path);
  return (
    <MarketingShell crumbs={crumbs} jsonLd={[softwareApplicationSchema({ name: `Medoro for ${s.name.toLowerCase()}`, description: s.description, path })]}>
      <Hero crumbs={crumbs} eyebrow={s.eyebrow} h1={s.h1} intro={s.intro} />

      <Section id="day" title="A day with Medoro" soft>
        <ol className="m-0 p-0 list-none grid gap-4 grid-cols-1 min-[760px]:grid-cols-2 min-[1100px]:grid-cols-4">
          {s.dayInLife.map((d, i) => (
            <li key={d.task} data-reveal style={{ ["--d" as string]: i }} className="flex flex-col gap-2 rounded-xl bg-white border border-[var(--s-line)] p-5">
              <span className="text-[13px] font-semibold uppercase tracking-[.08em] text-[var(--s-brand)]">{d.time}</span>
              <h3 className="m-0 text-[18px] font-semibold text-[var(--s-ink)]">{d.task}</h3>
              <p className="m-0 text-[15.5px] leading-[1.55] text-[var(--s-ink-2)]">{d.how}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="outcomes" title="What changes">
        <CardGrid items={s.outcomes} />
        <div className="rounded-xl border border-[var(--s-brand)] bg-[var(--s-brand-tint)]/40 p-6 flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold uppercase tracking-[.08em] text-[var(--s-brand)]">Plan that usually fits</span>
          <p className="m-0 text-[18px] font-semibold text-[var(--s-ink)]">{s.plan[0]}</p>
          <p className="m-0 text-[15.5px] leading-[1.55] text-[var(--s-ink-2)]">{s.plan[1]} <Link href="/#pricing" className="underline underline-offset-4">Compare plans</Link>.</p>
        </div>
      </Section>

      <Section id="features" title="Features you'll use most" soft>
        <LinkGrid links={features} cols={2} />
      </Section>

      <FaqSection faq={s.faq} />

      <Section id="more" title="Free tools and other solutions">
        <LinkGrid links={[...tools, ...others]} />
      </Section>

      <CtaBand />
    </MarketingShell>
  );
}

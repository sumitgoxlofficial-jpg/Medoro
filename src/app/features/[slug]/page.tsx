import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CardGrid, CtaBand, FaqSection, Hero, LinkGrid, MarketingShell, ProblemSolution, Section } from "@/components/seo/blocks";
import { MockupWindow } from "@/components/seo/mockup-window";
import { FEATURES, featureBySlug } from "@/data/features";
import { FEATURE_LINKS, HUBS } from "@/data/site-links";
import { toolBySlug } from "@/data/tools";
import { pageMetadata, softwareApplicationSchema, type Crumb } from "@/lib/seo";

export const dynamicParams = false;
export const generateStaticParams = () => FEATURES.map((f) => ({ slug: f.slug }));

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const f = featureBySlug((await params).slug);
  if (!f) return {};
  return pageMetadata({ title: `${f.title} | Medoro`, description: f.description, path: `/features/${f.slug}`, keywords: f.keywords });
}

export default async function FeaturePage({ params }: Props) {
  const f = featureBySlug((await params).slug);
  if (!f) notFound();
  const path = `/features/${f.slug}`;
  const crumbs: Crumb[] = [["Features", HUBS.features], [f.name, path]];
  const related = FEATURE_LINKS.filter(([, p]) => f.related.some((r) => p === `/features/${r}`));
  const tools = f.tools.map((slug) => toolBySlug(slug)!).map((t) => [t.name, `/tools/${t.slug}`, t.description] as [string, string, string]);
  return (
    <MarketingShell crumbs={crumbs} jsonLd={[softwareApplicationSchema({ name: `Medoro: ${f.name}`, description: f.description, path, featureList: f.highlights.flatMap((h) => h.points) })]}>
      <Hero crumbs={crumbs} eyebrow={f.eyebrow} h1={f.h1} intro={f.intro} />

      <Section id="preview" title="See it in Medoro" lead="A sample screen with illustrative data. Switch tabs to see each view.">
        <MockupWindow title={f.mockup.window} views={f.mockup.views} />
      </Section>

      <Section id="problems" title="The problem, and how Medoro fixes it" lead={`The everyday problems at an Indian chemist counter, and what changes with Medoro's ${f.name}.`} soft>
        <ProblemSolution items={f.problems} />
      </Section>

      <Section id="highlights" title="What you get" lead={`Included from the ${f.plan} plan. The 7-day free trial has every feature.`}>
        <CardGrid items={f.highlights} />
      </Section>

      <FaqSection faq={f.faq} />

      <Section id="tools" title="Free tools for pharmacies" lead="Work it out now with our free calculators and generators; no sign-up needed.">
        <LinkGrid links={tools} />
      </Section>

      <Section id="related" title="Related features" soft>
        <LinkGrid links={related} />
        <p className="m-0 text-[16px] text-[var(--s-ink-2)]">See <Link href={HUBS.features} className="underline underline-offset-4">all features</Link>, <Link href={HUBS.compare} className="underline underline-offset-4">how Medoro compares</Link> or <Link href="/#pricing" className="underline underline-offset-4">pricing</Link>.</p>
      </Section>

      <CtaBand />
    </MarketingShell>
  );
}

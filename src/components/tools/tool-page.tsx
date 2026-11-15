import Link from "next/link";
import { CtaBand, FaqSection, Hero, LinkGrid, MarketingShell, Section, wrap } from "@/components/seo/blocks";
import { postsForTool } from "@/data/blog";
import { featureBySlug } from "@/data/features";
import { HUBS, TOOL_LINKS } from "@/data/site-links";
import { toolBySlug, type ToolSlug } from "@/data/tools";
import { pageMetadata, webApplicationSchema, type Crumb } from "@/lib/seo";
import { ToolCta } from "./ui";

/** Metadata for a free tool page. */
export function toolMetadata(slug: ToolSlug) {
  const t = toolBySlug(slug)!;
  return pageMetadata({ title: `${t.title} | Medoro`, description: t.description, path: `/tools/${t.slug}`, keywords: t.keywords });
}

/**
 * Layout for a free tool: hero, the tool itself with the sticky Medoro call to action, then the explainer, FAQ and
 * links into the product. The page text is server-rendered; only the tool is a client component.
 */
export function ToolPage({ slug, children }: { slug: ToolSlug; children: React.ReactNode }) {
  const t = toolBySlug(slug)!;
  const path = `/tools/${t.slug}`;
  const crumbs: Crumb[] = [["Free tools", HUBS.tools], [t.name, path]];
  const features = t.features.map((f) => featureBySlug(f)!).map((f) => [f.name, `/features/${f.slug}`, f.description] as [string, string, string]);
  const others = TOOL_LINKS.filter(([, p]) => p !== path);
  const reading = postsForTool(slug).map((p) => [p.title, `/blog/${p.slug}`, p.description] as [string, string, string]);
  return (
    <MarketingShell crumbs={crumbs} jsonLd={[webApplicationSchema({ name: t.name, description: t.description, path, featureList: t.featureList })]}>
      <Hero crumbs={crumbs} eyebrow="Free pharmacy tool" h1={t.h1} intro={t.intro} note="Free, no sign-up. Runs in your browser; nothing you type is sent anywhere." />
      <section aria-label={t.name} className="bg-[var(--s-soft)] border-y border-[var(--s-line)]">
        <div className={`${wrap} py-[clamp(28px,4vw,48px)] flex flex-col gap-6`}>
          {children}
          <ToolCta />
        </div>
      </section>
      <Section id="guide" title="How it works">
        <div className="grid gap-x-8 gap-y-8 grid-cols-1 min-[900px]:grid-cols-3">
          {t.guide.map((g) => (
            <article key={g.h} className="flex flex-col gap-2.5 border-t border-[var(--s-line)] pt-5">
              <h3 className="m-0 text-[19px] font-semibold text-[var(--s-ink)]">{g.h}</h3>
              <p className="m-0 text-[15.5px] leading-[1.65] text-[var(--s-ink-2)]">{g.p}</p>
            </article>
          ))}
        </div>
      </Section>
      <FaqSection faq={t.faq} />
      {reading.length ? (
        <Section id="reading" title="Related guides">
          <LinkGrid links={reading} cols={2} />
        </Section>
      ) : null}
      <Section id="next" title="Do this automatically with Medoro" lead="The free tool handles one calculation at a time. Medoro does it on every bill, purchase and medicine in your store.">
        <LinkGrid links={features} cols={2} />
        <LinkGrid links={others} cols={2} />
        <p className="m-0 text-[16px] text-[var(--s-ink-2)]">See <Link href={HUBS.tools} className="underline underline-offset-4">all free tools</Link> or <Link href={HUBS.features} className="underline underline-offset-4">every Medoro feature</Link>.</p>
      </Section>
      <CtaBand />
    </MarketingShell>
  );
}

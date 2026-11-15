import { CtaBand, Hero, LinkGrid, MarketingShell, Section } from "@/components/seo/blocks";
import { FEATURE_LINKS, HUBS } from "@/data/site-links";
import { TOOLS } from "@/data/tools";
import { itemListSchema, pageMetadata, type Crumb } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Free Pharmacy Tools: PTR Calculator, HSN Finder, Bill Maker | Medoro",
  description: "Free tools for Indian chemists: PTR, PTS and margin calculator, medicine HSN code and GST finder, and a GST chemist bill generator. No sign-up, runs in your browser.",
  path: HUBS.tools,
});

const crumbs: Crumb[] = [["Free tools", HUBS.tools]];

export default function ToolsHub() {
  const links = TOOLS.map((t) => [t.name, `/tools/${t.slug}`, t.description] as [string, string, string]);
  return (
    <MarketingShell crumbs={crumbs} jsonLd={[itemListSchema("Free pharmacy tools", links.map(([n, p]) => [n, p]))]}>
      <Hero crumbs={crumbs} eyebrow="Free pharmacy tools" h1="Free tools for chemists and pharmacy owners." intro="Quick answers to the questions that come up at the counter and with distributors: what the PTR should be, which HSN code and GST rate to use, and a clean GST bill when you need one. No sign-up, and nothing you type leaves your browser." note="Free, no sign-up." />
      <Section id="all" title="Tools">
        <LinkGrid links={links} />
      </Section>
      <Section id="features" title="Do it automatically with Medoro" soft>
        <LinkGrid links={FEATURE_LINKS} />
      </Section>
      <CtaBand />
    </MarketingShell>
  );
}

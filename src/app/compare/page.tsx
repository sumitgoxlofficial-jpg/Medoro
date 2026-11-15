import { CtaBand, Hero, LinkGrid, MarketingShell, Section } from "@/components/seo/blocks";
import { COMPARISONS } from "@/data/comparisons";
import { FEATURE_LINKS, HUBS } from "@/data/site-links";
import { itemListSchema, pageMetadata, type Crumb } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Pharmacy Software Comparisons: Marg, Vyapar & More | Medoro",
  description: "Honest comparisons of Medoro with Marg ERP, Vyapar, RedBook and Logic ERP for Indian pharmacies: cloud access, upkeep, bill import, expiry, H1 register, pricing.",
  path: HUBS.compare,
});

const crumbs: Crumb[] = [["Compare", HUBS.compare]];

export default function CompareHub() {
  const links = COMPARISONS.map((c) => [c.name, `/compare/${c.slug}`, c.description] as [string, string, string]);
  return (
    <MarketingShell crumbs={crumbs} jsonLd={[itemListSchema("Medoro comparisons", links.map(([n, p]) => [n, p]))]}>
      <Hero crumbs={crumbs} eyebrow="Compare" h1="How Medoro compares with the software you use now." intro="Side-by-side tables, honest pros and cons for both sides, and the steps to switch in a day. Where we couldn't verify a competitor's feature, we say so instead of guessing." />
      <Section id="all" title="Comparisons">
        <LinkGrid links={links} cols={2} />
      </Section>
      <Section id="features" title="Medoro features" soft>
        <LinkGrid links={FEATURE_LINKS} />
      </Section>
      <CtaBand />
    </MarketingShell>
  );
}

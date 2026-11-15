import { CtaBand, Hero, LinkGrid, MarketingShell, Section } from "@/components/seo/blocks";
import { LANDING_LINKS } from "@/components/site/landing-links";
import { HUBS } from "@/data/site-links";
import { SOLUTIONS } from "@/data/solutions";
import { itemListSchema, pageMetadata, type Crumb } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Pharmacy Software Solutions by Store Type | Medoro",
  description: "Medoro for retail chemist shops, pharmacy chains, hospital and clinic pharmacies and Ayurvedic stores: the features, plan and daily workflow that fit each one.",
  path: HUBS.solutions,
});

const crumbs: Crumb[] = [["Solutions", HUBS.solutions]];

export default function SolutionsHub() {
  const links = SOLUTIONS.map((s) => [s.name, `/solutions/${s.slug}`, s.description] as [string, string, string]);
  return (
    <MarketingShell crumbs={crumbs} jsonLd={[itemListSchema("Medoro solutions", links.map(([n, p]) => [n, p]))]}>
      <Hero crumbs={crumbs} eyebrow="Solutions" h1="Pharmacy software for every kind of store." intro="A neighbourhood chemist, a five-branch chain, a hospital pharmacy and an Ayurvedic store all sell medicines, but their days look different. Pick yours to see how Medoro fits." />
      <Section id="all" title="By type of pharmacy">
        <LinkGrid links={links} cols={2} />
      </Section>
      <Section id="guides" title="Pharmacy software guides" soft>
        <LinkGrid links={LANDING_LINKS} />
      </Section>
      <CtaBand />
    </MarketingShell>
  );
}

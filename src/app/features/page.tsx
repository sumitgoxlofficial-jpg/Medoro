import { CtaBand, Hero, LinkGrid, MarketingShell, Section } from "@/components/seo/blocks";
import { FEATURES } from "@/data/features";
import { HUBS, SOLUTION_LINKS, TOOL_LINKS } from "@/data/site-links";
import { itemListSchema, pageMetadata, type Crumb } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Pharmacy Software Features: Billing, Expiry, Stock & GST | Medoro",
  description: "Every Medoro feature for Indian pharmacies: GST billing and counter POS, batch and expiry management, inventory and reorder, Schedule H1 register and bill import.",
  path: HUBS.features,
});

const crumbs: Crumb[] = [["Features", HUBS.features]];

export default function FeaturesHub() {
  const links = FEATURES.map((f) => [f.name, `/features/${f.slug}`, f.description] as [string, string, string]);
  return (
    <MarketingShell crumbs={crumbs} jsonLd={[itemListSchema("Medoro features", links.map(([n, p]) => [n, p]))]}>
      <Hero crumbs={crumbs} eyebrow="Features" h1="Pharmacy software features, one page each." intro="Billing, stock, expiry, prescriptions and purchases are where a pharmacy's day goes. Here is how Medoro handles each of them, with sample screens and answers to the questions owners ask most." />
      <Section id="all" title="All features">
        <LinkGrid links={links} />
      </Section>
      <Section id="more" title="Solutions and free tools" soft>
        <LinkGrid links={[...SOLUTION_LINKS, ...TOOL_LINKS]} cols={4} />
      </Section>
      <CtaBand />
    </MarketingShell>
  );
}

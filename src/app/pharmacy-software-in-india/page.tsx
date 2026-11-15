import { CtaBand, Hero, LinkGrid, MarketingShell, Section } from "@/components/seo/blocks";
import { LOCATIONS, STATES, locationPath } from "@/data/locations";
import { HUBS } from "@/data/site-links";
import { itemListSchema, pageMetadata, type Crumb } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Pharmacy Software in India: Cities & States | Medoro",
  description: "Pharmacy billing and medical store software across India, with local GST, distributor bill and drug licence notes for Mumbai, Delhi, Bangalore, Patna and more.",
  path: HUBS.locations,
});

const crumbs: Crumb[] = [["Pharmacy software in India", HUBS.locations]];

export default function LocationsHub() {
  const link = (kind: "city" | "state") => LOCATIONS.filter((l) => l.kind === kind).map((l) => [`Pharmacy software in ${l.name}`, locationPath(l.slug), kind === "city" ? `${STATES[l.state].name} · GST state code ${STATES[l.state].gstCode}` : `GST state code ${STATES[l.state].gstCode}`] as [string, string, string]);
  const all = LOCATIONS.map((l) => [`Pharmacy software in ${l.name}`, locationPath(l.slug)] as [string, string]);
  return (
    <MarketingShell crumbs={crumbs} jsonLd={[itemListSchema("Medoro pharmacy software by location", all)]}>
      <Hero crumbs={crumbs} eyebrow="Across India" h1="Pharmacy software for medical stores across India." intro="Medoro runs in the browser and on the desktop, so a chemist in Patna gets the same software and support as one in Mumbai. Each page below covers what's local: the state's GST code, how distributor bills arrive and who licenses pharmacies." />
      <Section id="cities" title="Cities">
        <LinkGrid links={link("city")} cols={3} />
      </Section>
      <Section id="states" title="States" soft>
        <LinkGrid links={link("state")} cols={3} />
      </Section>
      <CtaBand />
    </MarketingShell>
  );
}

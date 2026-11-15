import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, FileSpreadsheet, Languages, Landmark, ReceiptIndianRupee } from "lucide-react";
import { CardGrid, CtaBand, FaqSection, Hero, LinkGrid, MarketingShell, Section } from "@/components/seo/blocks";
import { LOCATIONS, STATES, locationBySlug, locationPath, type Location } from "@/data/locations";
import { COMPARE_LINKS, FEATURE_LINKS, HUBS, TOOL_LINKS } from "@/data/site-links";
import { pageMetadata, softwareApplicationSchema, type Crumb } from "@/lib/seo";

/**
 * Local landing pages. Served at /pharmacy-software-in-<slug>: next.config.ts rewrites that address to this route and
 * redirects this route's own address there, so each page has exactly one URL.
 */
export const dynamicParams = false;
export const generateStaticParams = () => LOCATIONS.map((l) => ({ location: l.slug }));

type Props = { params: Promise<{ location: string }> };

const title = (l: Location) => `Best Pharmacy Billing & Medical Store Software in ${l.name} | Medoro`;
const description = (l: Location) => {
  const s = STATES[l.state];
  const where = l.kind === "city" ? `${l.name}, ${s.name}` : l.name;
  return `Pharmacy billing & medical store software for chemists in ${where}: GST billing (state code ${s.gstCode}), batch & expiry alerts, distributor bill import.`;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const l = locationBySlug((await params).location);
  if (!l) return {};
  return pageMetadata({
    title: title(l), description: description(l), path: locationPath(l.slug),
    keywords: [`pharmacy software in ${l.name.toLowerCase()}`, `medical store software ${l.name.toLowerCase()}`, `pharmacy billing software ${l.name.toLowerCase()}`, `chemist software ${l.name.toLowerCase()}`],
  });
}

function faq(l: Location): [string, string][] {
  const s = STATES[l.state];
  return [
    [`What is the best pharmacy billing software in ${l.name}?`, `The best fit depends on your store, but look for fast keyboard billing, automatic batch and expiry picking, GST-correct invoices for ${s.name}, a Schedule H1 register, distributor bill import and backups you don't have to think about. Medoro does all of these and you can try it free for 7 days with your own stock.`],
    [`Does Medoro handle GST for pharmacies in ${s.name}?`, `Yes. Your GSTIN (starting with ${s.gstCode} for ${s.name}) sets the place of supply. Sales inside ${s.name} are split into CGST and SGST, sales to buyers in other states are billed with IGST, and purchases from out-of-state distributors record IGST input tax. GSTR-1 and GSTR-3B are prepared per GSTIN every month.`],
    [`Can I import bills from my distributors in ${l.name}?`, "Yes. Distributors' e-bills exported as CSV, Excel or pipe-separated text from Marg, BUSY, Logic, GoFrugal and similar software can be imported. If the columns aren't recognised, you map them once and Medoro remembers the mapping for that distributor."],
    [`Is support available in ${l.name}?`, `Setup, training and support are done remotely on WhatsApp and email, Monday to Saturday from 9 am to 9 pm IST, in Hindi or English. Pharmacies in ${l.name} get the same support as everywhere else, without waiting for a dealer visit.`],
    ["How much does Medoro cost?", "₹999 a month for one store on Starter, ₹2,499 on Professional and ₹4,499 for up to 5 branches on Multi-branch, GST included. The 7-day free trial has every feature and needs no card."],
  ];
}

export default async function LocationPage({ params }: Props) {
  const l = locationBySlug((await params).location);
  if (!l) notFound();
  const s = STATES[l.state];
  const path = locationPath(l.slug);
  const crumbs: Crumb[] = [["Pharmacy software in India", HUBS.locations], [`Pharmacy software in ${l.name}`, path]];
  const where = l.kind === "city" ? `${l.name}, ${s.name}` : l.name;
  const nearby = l.nearby.map((n) => locationBySlug(n)!).map((n) => [`Pharmacy software in ${n.name}`, locationPath(n.slug)] as [string, string]);
  const local: [typeof Check, string, string][] = [
    [ReceiptIndianRupee, `GST for ${s.name} pharmacies`, `${s.name} GSTINs start with ${s.gstCode}. Medoro sets the place of supply from your GSTIN, splits in-state sales into CGST and SGST, charges IGST to buyers in other states and records IGST on purchases from out-of-state distributors. Most medicines are taxed at 5% since 22 September 2025, worked out from the MRP on every line.`],
    [FileSpreadsheet, `Bills from ${l.kind === "city" ? l.name : s.name} distributors`, "Import distributors' e-bills as CSV, Excel or pipe-separated text, with batch, expiry, quantity, free goods, PTR, PTS, MRP, scheme and discounts read from the file. Column maps are saved per distributor, and the bill can't be posted until your total matches the printed one."],
    [Landmark, "Drug licence and registers", `Pharmacies in ${l.name} are licensed by ${s.regulator}. Your retail drug licence numbers (Forms 20 and 21) and GSTIN print on every invoice, prescription medicines ask for the prescriber, and the Schedule H1 register is built from your bills.`],
    [Languages, s.hindiBelt ? "Hindi for the whole team" : "Hindi and English", s.hindiBelt ? `Every screen is available in हिंदी as well as English, switchable per person, so counter staff in ${l.name} can bill in the language they're comfortable with. The assistant understands Hinglish too.` : "Every screen is available in English and हिंदी, switchable per person, so owners and counter staff can each work in the language they prefer."],
  ];
  return (
    <MarketingShell crumbs={crumbs} jsonLd={[softwareApplicationSchema({ description: description(l), path })]}>
      <Hero
        crumbs={crumbs}
        eyebrow={`Pharmacy software in ${where}`}
        h1={`Pharmacy billing & medical store software in ${l.name}`}
        intro={`${l.local} Medoro gives chemists in ${l.name} fast GST billing, batch-wise stock with expiry alerts, distributor bill import, accounts and WhatsApp invoices, on the shop PC, a tablet or your phone.`}
      />

      <Section id="local" title={`Why ${l.name} pharmacies choose Medoro`} soft>
        <ul className="m-0 p-0 list-none grid gap-3 grid-cols-1 min-[760px]:grid-cols-3">
          {l.context.map((c) => <li key={c} className="flex gap-2.5 rounded-xl bg-white border border-[var(--s-line)] p-5 text-[16px] leading-[1.5] text-[var(--s-ink)]"><Check size={18} aria-hidden className="flex-none mt-[2px] text-[var(--s-brand)]" />{c}</li>)}
        </ul>
      </Section>

      <Section id="setup" title={`Set up for ${s.name}`} lead={`What's specific to running a pharmacy in ${where}, and how Medoro handles it.`}>
        <div className="grid gap-5 grid-cols-1 min-[860px]:grid-cols-2">
          {local.map(([Icon, h, p]) => (
            <article key={h} data-reveal className="flex gap-4 rounded-xl border border-[var(--s-line)] p-6">
              <span className="flex-none size-11 rounded-xl bg-[var(--s-brand-tint)] flex items-center justify-center"><Icon size={21} aria-hidden className="text-[var(--s-brand)]" /></span>
              <div className="flex flex-col gap-2"><h3 className="m-0 text-[19px] font-semibold text-[var(--s-ink)]">{h}</h3><p className="m-0 text-[15.5px] leading-[1.6] text-[var(--s-ink-2)]">{p}</p></div>
            </article>
          ))}
        </div>
      </Section>

      <Section id="features" title="Everything your counter and godown need" soft>
        <CardGrid items={[
          { h: "Billing in three keys", p: "Brand, salt and barcode search, the earliest-expiring batch picked for you, and bills on thermal, A4 or WhatsApp.", points: ["FEFO batch picking", "Loose tablet sale", "Split payments and credit"] },
          { h: "Expiry you see in time", p: "30 to 180-day windows with the projected loss at cost and a return or transfer suggestion for each batch.", points: ["Expired stock blocked", "Expiry claims to distributors", "Recall quarantine"] },
          { h: "Accounts and GST returns", p: "Day book, P&L and ledgers kept as you bill, with GSTR-1 and GSTR-3B ready on the 1st and Tally export for your CA.", points: ["GSTR-1 JSON and GSTR-3B", "HSN summary", "Tally and Excel export"] },
        ]} />
        <LinkGrid links={FEATURE_LINKS} />
      </Section>

      <FaqSection faq={faq(l)} title={`Questions from pharmacies in ${l.name}`} />

      <Section id="nearby" title="Nearby and related">
        <LinkGrid links={[...nearby, ...TOOL_LINKS.slice(0, 2), COMPARE_LINKS[0]]} />
        <p className="m-0 text-[16px] text-[var(--s-ink-2)]">See <Link href={HUBS.locations} className="underline underline-offset-4">every city and state</Link> or <Link href="/#pricing" className="underline underline-offset-4">pricing</Link>.</p>
      </Section>

      <CtaBand title={`Start billing on Medoro in ${l.name} tomorrow.`} text="Import your stock today, set up your counters this evening and bill on Medoro from opening time. 7 days free, no card needed." />
    </MarketingShell>
  );
}

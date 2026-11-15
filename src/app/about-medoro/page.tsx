import Link from "next/link";
import { CardGrid, CtaBand, FaqSection, Hero, LinkGrid, MarketingShell, Section } from "@/components/seo/blocks";
import { BRAND, BRAND_FAQ, brandProfiles } from "@/data/brand";
import { FEATURE_LINKS, HUBS, SOLUTION_LINKS } from "@/data/site-links";
import { company } from "@/lib/company";
import { SITE_URL, aboutPageSchema, pageMetadata, type Crumb } from "@/lib/seo";
import { UDYAM } from "@/lib/udyam";
import { PRODUCTS } from "@/staff/constants";

/**
 * The official page about the Medoro brand: what it is, who makes it, the product suite, security and company
 * details. Search engines use a page like this to build the brand's knowledge panel, so every fact here matches the
 * site-wide Organization data (src/lib/seo.ts brandGraph) and /legal. English only, like the other search pages.
 */
const PATH = "/about-medoro";
const TITLE = "About Medoro (medoro.in): Medical & Pharmacy Billing SaaS";
const DESC = "Medoro (medoro.in) is a medical and pharmacy billing SaaS made in India: counter billing, batch stock, expiry, GST and accounts. Mission, product suite, security and company details.";

export const metadata = pageMetadata({
  title: `${TITLE} | Medoro`,
  description: DESC,
  path: PATH,
  keywords: ["Medoro", "medoro.in", "Medoro pharmacy software", "Medoro billing SaaS", "Medoro ERP", "about Medoro"],
});

const crumbs: Crumb[] = [["About Medoro", PATH]];

const SUITE: [name: string, path: string, blurb: string][] = [
  ["Medoro Medical Billing SaaS", "/medical-billing-saas", "Cloud billing for medical stores, clinic and hospital pharmacies, in a browser or the desktop app."],
  ["Medoro Pharmacy Billing Software", "/pharmacy-billing-software", "A keyboard-first chemist POS: three-key billing, FEFO batches and GST invoices."],
  ["Medoro Pharmacy Stock Software", "/medical-store-stock-management-software", "Batch-wise stock, near-expiry lists, reorder levels and purchase bill import."],
  ["Medoro GST Billing", "/features/gst-billing", "CGST, SGST and IGST worked out from MRP on every line, with GSTR-1 and GSTR-3B summaries."],
  ["Medoro Pharmacy Accounting", "/pharmacy-accounting-software", "Day book, P&L, ledgers and supplier dues, with Tally and Excel export."],
  ["Medoro Schedule H1 Register", "/features/schedule-h1-compliance", "The prescriber captured on the bill and the H1 register for any date range."],
];

const MISSION = [
  { h: "Fast at the counter", p: "A pharmacy’s evening rush is decided in seconds per bill. Medoro is built keyboard-first, so staff search, add and finish a sale without reaching for the mouse." },
  { h: "Honest about stock", p: "Medicines expire and margins are thin. Medoro tracks every batch and shows the loss coming from near-expiry stock while there is still time to act on it." },
  { h: "The pharmacy owns its data", p: "Records stay in a place the pharmacy controls, backups are encrypted with a key only the owner holds, and everything can be exported at any time." },
];

const SECURITY = [
  { h: "Encrypted in transit", p: "Medoro’s website and hosted app load only over HTTPS, enforced with HSTS." },
  { h: "Roles and two-step sign-in", p: "Cashiers bill, managers approve discounts and refunds, owners see everything. Owners and managers sign in with a second step." },
  { h: "Tamper-evident audit trail", p: "Every void, discount, refund and stock adjustment is logged with who did it and when." },
  { h: "Encrypted backups you hold", p: "Backups are encrypted before they leave your computer and go to your own Google Drive. Only your recovery key opens them." },
  { h: "Privacy and DPDP", p: "Customer consent for WhatsApp is recorded per customer, and Medoro publishes its privacy policy, DPDP rights and grievance officer." },
  { h: "Leave any time", p: "Full data export, CSV reports for your CA, and plans that never renew on their own." },
];

const cell = "py-3.5 border-b border-[var(--s-line)] text-[16px] align-top";

export default function AboutMedoro() {
  const c = company();
  const profiles = brandProfiles();
  const from = Math.min(...PRODUCTS.filter((p) => !("addon" in p) && !("once" in p)).map((p) => p.m));
  const facts: [string, React.ReactNode][] = [
    ["Brand", BRAND.name],
    ["Also known as", BRAND.alternateNames.join(", ")],
    ["Official website", <Link key="w" href="/" className="text-[var(--s-brand)] underline underline-offset-4">{SITE_URL}</Link>],
    ["What it is", "Medical and pharmacy billing SaaS: billing, stock, batch and expiry, GST and accounts"],
    ["Made for", "Medical stores, chemists, clinic and hospital pharmacies and pharmacy chains in India"],
    ["Company", `${c.name}, ${c.address}`],
    ["MSME registration", <span key="u">{UDYAM.number} ({UDYAM.type}, registered {UDYAM.registered}). <a href={UDYAM.verifyUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--s-brand)] underline underline-offset-4">Verify on the Udyam portal</a></span>],
    ["Runs on", "Chrome on any PC, tablet or phone; desktop app for Windows, macOS and Linux"],
    ["Languages", "English and हिंदी"],
    ["Pricing", <span key="p">From ₹{from.toLocaleString("en-IN")} a month, with a 7-day free trial. <Link href="/#pricing" className="text-[var(--s-brand)] underline underline-offset-4">Medoro pricing</Link></span>],
    ["Contact", <span key="c"><a href={`mailto:${BRAND.email}`} className="text-[var(--s-brand)] underline underline-offset-4">{BRAND.email}</a> · WhatsApp {BRAND.phoneDisplay} · {BRAND.supportHours}</span>],
    ...(profiles.length ? [["Official profiles", <span key="s" className="flex flex-wrap gap-x-4 gap-y-1">{profiles.map((p) => <a key={p.url} href={p.url} target="_blank" rel="noopener noreferrer me" className="text-[var(--s-brand)] underline underline-offset-4">{p.platform}</a>)}</span>] as [string, React.ReactNode]] : []),
  ];
  return (
    <MarketingShell crumbs={crumbs} jsonLd={[aboutPageSchema({ name: TITLE, description: DESC, path: PATH })]}>
      <Hero
        crumbs={crumbs}
        eyebrow="About Medoro · medoro.in"
        h1="Medoro: the medical and pharmacy billing SaaS for India’s medical stores."
        intro="Medoro (medoro.in) is software for the people behind the pharmacy counter. It handles billing, batch-wise stock, expiry, purchases, GST and accounts for medical stores, clinic and hospital pharmacies and small chains, in English and हिंदी, on a computer the pharmacy controls."
        note={`7 days free, no card needed. From ₹${from.toLocaleString("en-IN")} a month.`}
      />

      <Section id="facts" title="Medoro at a glance" lead="The official facts about the Medoro brand and product, kept in step with our legal and contact pages." soft>
        <table className="w-full max-w-[900px] border-collapse border-t-2 border-[var(--s-ink)]">
          <caption className="sr-only">Medoro brand and company details</caption>
          <tbody>
            {facts.map(([k, v]) => (
              <tr key={k}>
                <th scope="row" className={`${cell} w-[34%] min-[640px]:w-[26%] pr-5 text-left font-semibold text-[var(--s-ink)]`}>{k}</th>
                <td className={`${cell} text-[var(--s-ink-2)]`}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section id="mission" title="Our mission" lead="To give every Indian medical store, from a single chemist counter to a small chain, billing and stock software that is fast at the counter, honest about expiry and GST, and leaves the pharmacy in control of its own data.">
        <CardGrid items={MISSION} />
      </Section>

      <Section id="suite" title="The Medoro product suite" lead="One system for the counter, the godown and your CA. Each part has its own page." soft>
        <LinkGrid links={SUITE} />
        <p className="m-0 text-[16px] text-[var(--s-ink-2)]">
          See <Link href={HUBS.features} className="underline underline-offset-4">all Medoro features</Link>, including {FEATURE_LINKS.slice(1, 3).map(([n, p], i) => <span key={p}>{i ? " and " : ""}<Link href={p} className="underline underline-offset-4">{n.toLowerCase()}</Link></span>)}, or how Medoro fits a {SOLUTION_LINKS.slice(0, 3).map(([n, p], i) => <span key={p}>{i === 0 ? "" : i === 2 ? " or " : ", "}<Link href={p} className="underline underline-offset-4">{n.toLowerCase()}</Link></span>)}. Comparing software? Read <Link href={HUBS.compare} className="underline underline-offset-4">Medoro compared with Marg, Vyapar and others</Link>.
        </p>
      </Section>

      <Section id="security" title="Security and data ownership" lead="Medoro runs on infrastructure the pharmacy controls: a PC in the shop, your own server or your own cloud account. Invoices, stock, customers and prescriptions stay there.">
        <CardGrid items={SECURITY} />
        <p className="m-0 text-[16px] text-[var(--s-ink-2)]">Read the <Link href="/legal#privacy" className="underline underline-offset-4">Medoro privacy policy</Link>, <Link href="/legal#terms" className="underline underline-offset-4">terms of service</Link> and <Link href="/legal#grievance" className="underline underline-offset-4">grievance officer details</Link>.</p>
      </Section>

      <FaqSection faq={BRAND_FAQ} title="Questions about Medoro" />
      <CtaBand />
    </MarketingShell>
  );
}

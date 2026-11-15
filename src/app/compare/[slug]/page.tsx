import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Minus } from "lucide-react";
import { CtaBand, FaqSection, Hero, LinkGrid, MarketingShell, Section } from "@/components/seo/blocks";
import { CompareTable } from "@/components/seo/compare-table";
import { COMPARISONS, REVIEWED, comparisonBySlug } from "@/data/comparisons";
import { COMPARE_LINKS, FEATURE_LINKS, HUBS } from "@/data/site-links";
import { pageMetadata, softwareApplicationSchema, type Crumb } from "@/lib/seo";

export const dynamicParams = false;
export const generateStaticParams = () => COMPARISONS.map((c) => ({ slug: c.slug }));

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = comparisonBySlug((await params).slug);
  if (!c) return {};
  return pageMetadata({ title: `${c.title} | Medoro`, description: c.description, path: `/compare/${c.slug}`, keywords: c.keywords });
}

/** "Switch to Medoro in 24 hours": the same steps as the homepage, with the competitor-specific export tip first. */
const steps = (exportTip: string): [when: string, title: string, text: string][] => [
  ["Hour 0–2", "Export from your current software", exportTip],
  ["Hour 2–6", "Import and check", "Medoro checks every row: expiry, GST rate, MRP against cost. Problems are listed by row and nothing is imported until the file is clean."],
  ["Hour 6–10", "Set up counters and staff", "Connect the thermal printer and barcode scanner, add staff with PINs and roles, and bill a few test sales."],
  ["Hour 24", "Go live", "Bill on Medoro from opening time the next day. Keep the old software for reference as long as you like; we're on WhatsApp from 9 am to 9 pm."],
];

function ProsCons({ title, pros, cons, brand }: { title: string; pros: string[]; cons: string[]; brand?: boolean }) {
  return (
    <article className={`flex flex-col gap-5 rounded-xl border p-6 ${brand ? "border-[var(--s-brand)] bg-[var(--s-brand-tint)]/40" : "border-[var(--s-line)] bg-white"}`}>
      <h3 className="m-0 text-[21px] font-semibold text-[var(--s-ink)]">{title}</h3>
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold uppercase tracking-[.08em] text-[#146C43]">Strengths</span>
        <ul className="m-0 p-0 list-none flex flex-col gap-2">{pros.map((p) => <li key={p} className="flex gap-2 text-[15.5px] leading-[1.5] text-[var(--s-ink-2)]"><Check size={16} aria-hidden className="flex-none mt-[3px] text-[#146C43]" />{p}</li>)}</ul>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold uppercase tracking-[.08em] text-[#8A5A00]">Trade-offs</span>
        <ul className="m-0 p-0 list-none flex flex-col gap-2">{cons.map((p) => <li key={p} className="flex gap-2 text-[15.5px] leading-[1.5] text-[var(--s-ink-2)]"><Minus size={16} aria-hidden className="flex-none mt-[3px] text-[#8A5A00]" />{p}</li>)}</ul>
      </div>
    </article>
  );
}

export default async function ComparePage({ params }: Props) {
  const c = comparisonBySlug((await params).slug);
  if (!c) notFound();
  const path = `/compare/${c.slug}`;
  const crumbs: Crumb[] = [["Compare", HUBS.compare], [c.name, path]];
  const others = COMPARE_LINKS.filter(([, p]) => p !== path);
  return (
    <MarketingShell crumbs={crumbs} jsonLd={[softwareApplicationSchema({ description: `${c.competitor} alternative for Indian pharmacies. ${c.description}`, path })]}>
      <Hero crumbs={crumbs} eyebrow={`${c.competitor} alternative`} h1={c.h1} intro={c.intro} />

      <Section id="table" title={`Medoro vs ${c.competitor} at a glance`} lead={`Medoro's column is what the product does today. The ${c.competitor} column is based on public information as of ${REVIEWED}; editions, add-ons and dealers can change the answer, so check with them for your setup.`}>
        <CompareTable c={c} />
        <p className="m-0 text-[14px] text-[var(--s-muted)]">Spotted something out of date? Write to <a href="mailto:hello@medoro.in" className="underline underline-offset-4">hello@medoro.in</a> and we&rsquo;ll correct it. {c.competitor} is a trademark of its owner; Medoro is not affiliated with it.</p>
      </Section>

      <Section id="pros-cons" title="Honest pros and cons" lead={c.verdict} soft>
        <div className="grid gap-5 grid-cols-1 min-[900px]:grid-cols-2">
          <ProsCons title={c.competitor} pros={c.theirPros} cons={c.theirCons} />
          <ProsCons title="Medoro" pros={c.medoroPros} cons={c.medoroCons} brand />
        </div>
      </Section>

      <Section id="switch" title="Switch to Medoro in 24 hours" lead="Most pharmacies move in a day without closing the shop. Assisted migration is available if you'd rather send us the files.">
        <ol className="m-0 p-0 list-none grid gap-5 grid-cols-1 min-[760px]:grid-cols-2 min-[1100px]:grid-cols-4">
          {steps(c.exportTip).map(([when, title, text], i) => (
            <li key={title} data-reveal style={{ ["--d" as string]: i }} className="flex flex-col gap-2.5 border-t-2 border-[var(--s-brand)] pt-5">
              <span className="text-[13px] font-semibold uppercase tracking-[.08em] text-[var(--s-brand)]">Step {i + 1} · {when}</span>
              <h3 className="m-0 text-[19px] font-semibold text-[var(--s-ink)]">{title}</h3>
              <p className="m-0 text-[15.5px] leading-[1.55] text-[var(--s-ink-2)]">{text}</p>
            </li>
          ))}
        </ol>
      </Section>

      <FaqSection faq={c.faq} />

      <Section id="more" title="Explore Medoro">
        <LinkGrid links={[...FEATURE_LINKS.slice(0, 3), ...others]} />
        <p className="m-0 text-[16px] text-[var(--s-ink-2)]">See <Link href={HUBS.compare} className="underline underline-offset-4">all comparisons</Link> or <Link href="/#pricing" className="underline underline-offset-4">pricing</Link>.</p>
      </Section>

      <CtaBand title={`Try Medoro alongside ${c.competitor} for 7 days.`} text="Import your stock, bill a few customers on Medoro and keep your current software running until you're sure. No card needed." />
    </MarketingShell>
  );
}

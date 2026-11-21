import type { Metadata } from "next";
import {
  ArrowRight, BarChart3, Boxes, Check, ClipboardList, CreditCard, FileSpreadsheet, Gift, IndianRupee, MapPin, MessageCircle, PackageCheck, Plus,
  ReceiptIndianRupee, RotateCcw, ScanBarcode, ShieldCheck, Smartphone, Store, Truck, Users, Warehouse,
} from "lucide-react";
import { SiteFooter, SiteHeader, SiteMotion, WhatsAppFab, WA_DEMO } from "@/components/site/chrome";
import { DistHeroShot, Pricing } from "@/components/site/interactive";
import { DIST_PLANS } from "@/domain/distribution/plans";
import { JsonLd } from "@/components/seo/json-ld";
import { WEBSITE_ID, ORG_ID, absoluteUrl, faqSchema } from "@/lib/seo";
import { getLang } from "@/server/lang";
import { tFor } from "@/lib/tr";
import { Aurora, FloatingShapes } from "@/components/site/decor";

/**
 * Landing page for MEDORO Distribution, the wholesale ERP (/dist for the distributor's team, /portal for chemists).
 * Claims match docs/distribution/MODULES.md: keep them to what the product does today.
 */
const TITLE = "Medoro Distribution — Pharma Distribution & Wholesale ERP Software for Indian Distributors";
const DESC = "Medoro Distribution is pharma distribution software for Indian distributors, wholesalers, stockists, super stockists and C&F agents: orders with credit control, batch-wise stock across godowns, schemes, wholesale GST invoices, picking and dispatch, expiry claims, collections and a chemist ordering portal. 7-day free trial.";
const KEYWORDS = ["Medoro Distribution", "pharma distribution software", "pharma distributor software india", "medicine wholesale software", "pharma ERP", "stockist software", "C&F agent software", "chemist ordering portal"];

export async function generateMetadata(): Promise<Metadata> {
  const lang = await getLang();
  const t = tFor(lang);
  const title = t(TITLE), description = t(DESC);
  return {
    title: { absolute: title },
    description,
    keywords: KEYWORDS,
    applicationName: "Medoro Distribution",
    alternates: { canonical: "/distribution" },
    robots: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
    openGraph: { type: "website", url: "/distribution", siteName: "Medoro", title, description, locale: lang === "hi" ? "hi_IN" : "en_IN" },
    twitter: { card: "summary_large_image", title, description },
  };
}

const WHO = ["Pharma distributors", "Wholesalers", "Stockists", "Super stockists", "C&F agents"];

const PAINS: [string, string][] = [
  ["Outstanding that keeps growing", "Orders go out to chemists who are already over their limit or overdue, and nobody notices until month-end."],
  ["Short-expiry stock nobody claimed", "Near-expiry batches sit in the godown until the company’s claim window has closed."],
  ["Schemes worked out by hand", "“10+2” and special rates are calculated on a calculator, and free goods leak out unrecorded."],
  ["Orders on calls and WhatsApp", "Chemists phone in orders, salesmen write them on paper, and someone types them all again in the office."],
];

/** The modules, grouped as a distributor thinks of them. [icon, title, text] */
const MODULES: [typeof Check, string, string][] = [
  [ClipboardList, "Orders with credit control", "Every order checks the chemist’s credit limit, overdue bills and hold status before it is confirmed, and reserves stock batch by batch."],
  [ReceiptIndianRupee, "Wholesale GST invoicing", "CGST, SGST or IGST by place of supply, HSN, PTR and PTS, printable A4 invoices and credit notes for returns."],
  [Gift, "Schemes and free goods", "Quantity schemes like “10+2”, discounts and chemist-specific special rates applied automatically on the order."],
  [Boxes, "Batch-wise stock across godowns", "Batch, expiry, rack and quarantine for every item, in every godown, with stock transfers between them."],
  [PackageCheck, "Picking and dispatch", "A mobile picking list for the godown, packing and dispatch, and a delivery screen with proof of delivery."],
  [RotateCcw, "Expiry and breakage claims", "Near-expiry and expired stock raised as claims to the company, tracked to the credit note, with reconciliation."],
  [CreditCard, "Collections and ageing", "Cash, UPI, NEFT and cheque collections from the office, the field or at delivery, with chemist-wise ageing."],
  [FileSpreadsheet, "Purchases and GRN", "Purchase orders to companies, goods receipt with batches and landed cost, and the supplier ledger."],
  [IndianRupee, "Books and GST returns", "Day book, trial balance, chemist ledgers, bank reconciliation, GSTR-1 and GSTR-3B JSON, HSN summary."],
  [BarChart3, "MIS and business intelligence", "Fourteen MIS reports, reorder suggestions, expiry risk and credit risk, explained in plain numbers."],
  [Users, "Users and permissions", "Roles for office, godown, salesmen and delivery staff, a permission matrix and an audit trail."],
  [MapPin, "Territories and salesmen", "Territories, beat-wise chemists, and a field app for salesmen to take orders and collections."],
];

/** Order to cash, as the product runs it (docs/distribution/WORKFLOWS.md). */
const FLOW: [string, string][] = [
  ["Order", "From the chemist portal, a salesman’s phone or the office. Credit checked, stock reserved."],
  ["Invoice", "Schemes applied, GST worked out, the invoice numbered and printed."],
  ["Pick and pack", "The godown picks batch by batch on a phone, then packs."],
  ["Dispatch and deliver", "Goods leave with the delivery person, who records who received them."],
  ["Collect", "Payment taken at delivery or later, matched to bills, ageing updated."],
];

const PORTAL: string[] = [
  "Chemists register and connect with your licence check",
  "They see your catalogue with their own rates and schemes",
  "Orders arrive in your order queue, already credit-checked",
  "Invoices, outstanding and order status on their screen",
  "Free for your chemists; included from the Professional plan",
];

const FAQ: [string, string][] = [
  ["Who is Medoro Distribution for?", "Pharmaceutical distributors, wholesalers, stockists, super stockists and C&F agents in India who sell medicines to chemists, hospitals and other distributors, usually on credit."],
  ["Is it the same software as Medoro Pharmacy?", "No. It is a separate product built for wholesale, with its own screens, plans and workflows: orders, credit control, picking, dispatch, schemes, claims and collections. It shares Medoro’s accounting, GST, security and backup foundations."],
  ["Can my chemists order online?", "Yes. From the Professional plan your chemists get a free ordering portal. They see your catalogue with their own rates, place orders, and check invoices and dues. Orders land in your queue already credit-checked."],
  ["Does it handle schemes and free goods?", "Yes. Quantity schemes such as 10+2, percentage discounts and chemist-specific special rates are applied on the order and printed on the invoice. Free goods leave stock like any other quantity."],
  ["Can I manage more than one godown?", "Yes. Standard covers one godown, Professional up to 3 and Enterprise up to 20, with batch-wise stock in each and transfers between them."],
  ["How do I start?", "Sign up as a distributor, confirm your email or continue with Google, and enter your business details. The 7-day trial has every feature. Choose a plan only if you continue."],
];

const eyebrow = "text-[14px] font-semibold text-[var(--s-brand)]";
const h2 = "site-display m-0 text-[clamp(34px,4.4vw,56px)] text-[var(--s-ink)]";
const lead = "m-0 text-[clamp(17px,1.4vw,19px)] leading-[1.6] text-[var(--s-ink-2)]";
const wrap = "max-w-[1200px] mx-auto px-6 max-[640px]:px-4";

const pageLd = {
  "@type": "WebPage",
  "@id": `${absoluteUrl("/distribution")}#webpage`,
  url: absoluteUrl("/distribution"),
  name: TITLE,
  description: DESC,
  inLanguage: ["en-IN", "hi-IN"],
  isPartOf: { "@id": WEBSITE_ID },
  about: { "@id": ORG_ID },
};
const faqLd = faqSchema(FAQ);

export default async function DistributionHome() {
  const lang = await getLang();
  const t = tFor(lang);
  const from = Math.round(DIST_PLANS.dist_std.priceMonthly / 100);
  return (
    <div className="site-root bg-white overflow-x-clip">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:bg-white focus:px-4 focus:py-2 focus:rounded-lg focus:shadow">{t("Skip to content")}</a>
      <SiteHeader />
      <SiteMotion />
      <div aria-hidden className="site-progress" />
      <JsonLd data={[pageLd, faqLd]} />

      <main id="main">
        {/* Hero */}
        <section aria-labelledby="hero-title" className="site-dark bg-[var(--s-dark)] text-white relative overflow-hidden">
          <Aurora dark />
          <FloatingShapes />
          <div className={`relative ${wrap} pt-[clamp(56px,8vw,112px)] pb-[clamp(56px,8vw,104px)] grid grid-cols-12 gap-x-6 gap-y-12 items-center`}>
            <div className="col-span-12 min-[1000px]:col-span-6 flex flex-col gap-6">
              <h1 id="hero-title" className="m-0 flex flex-col gap-5">
                <span className="site-up inline-flex self-start items-center gap-2 text-[14px] font-semibold text-[#8FD3C6]"><Warehouse size={16} aria-hidden />{t("Medoro Distribution: pharma wholesale ERP")}</span>
                <span className="site-display site-up block text-[clamp(38px,4.6vw,60px)] leading-[1.05] [--d:1]">
                  <span className="block">{t("Run your pharma distribution")}</span>
                  <span className="block text-[#5EEAD4]">{t("from order to collection.")}</span>
                </span>
              </h1>
              <p className="site-up m-0 text-[clamp(17px,1.4vw,19px)] leading-[1.6] text-[#C3D3D0] max-w-[600px] [--d:2]">{t("Orders with credit control, batch-wise stock across godowns, schemes, wholesale GST invoices, picking, dispatch, expiry claims and collections, built for how Indian distributors work.")}</p>
              <div className="site-up flex gap-3 flex-wrap pt-1 [--d:3]">
                <a href="/distributor-signup" className="site-link-arrow inline-flex items-center gap-2 h-12 px-5 rounded-lg bg-white text-[var(--s-ink)] text-[16px] font-semibold hover:text-[var(--s-ink)]">{t("Start 7-day free trial")}<ArrowRight size={18} aria-hidden /></a>
                <a href={WA_DEMO} className="inline-flex items-center gap-2 h-12 px-5 rounded-lg border border-white/40 text-white text-[16px] font-semibold hover:border-white hover:text-white"><MessageCircle size={18} aria-hidden />{t("Book a demo on WhatsApp")}</a>
              </div>
              <p className="site-up m-0 text-[14px] text-[#9FB5B1] [--d:4]">{t("From {amount} a month. Every feature during the trial.", { amount: `₹${from.toLocaleString("en-IN")}` })}</p>
            </div>
            <div className="site-up [--d:3] col-span-12 min-[1000px]:col-span-6 min-[1000px]:col-start-7">
              <DistHeroShot />
            </div>
          </div>
        </section>

        {/* Who it's for */}
        <section aria-labelledby="who-title" className="border-b border-[var(--s-line)]">
          <div className={`${wrap} py-10 flex items-center gap-6 flex-wrap`}>
            <h2 id="who-title" className="m-0 text-[15px] font-semibold text-[var(--s-ink)]">{t("Built for")}</h2>
            <ul className="m-0 p-0 list-none flex flex-wrap gap-2.5">
              {WHO.map((w) => <li key={w} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--s-soft)] border border-[var(--s-line)] px-3.5 py-1.5 text-[15px] font-medium text-[var(--s-ink-2)]"><Check size={15} aria-hidden className="text-[var(--s-brand)]" />{t(w)}</li>)}
            </ul>
          </div>
        </section>

        {/* Pains */}
        <section aria-labelledby="pains-title" className={`${wrap} py-[clamp(72px,10vw,128px)] grid grid-cols-12 gap-x-6 gap-y-12`}>
          <div className="col-span-12 min-[1000px]:col-span-5 flex flex-col gap-5 min-[1000px]:sticky min-[1000px]:top-28 self-start">
            <span className={eyebrow}>{t("Why distributors switch")}</span>
            <h2 id="pains-title" className={h2}>{t("Where a distribution business quietly loses money.")}</h2>
            <p className={lead}>{t("Thin margins mean small leaks matter: credit that runs too long, stock that expires unclaimed, and hours spent retyping orders.")}</p>
          </div>
          <ol className="col-span-12 min-[1000px]:col-span-6 min-[1000px]:col-start-7 m-0 p-0 list-none flex flex-col">
            {PAINS.map(([title, d], i) => (
              <li key={title} data-reveal className="group grid grid-cols-[56px_minmax(0,1fr)] max-[640px]:grid-cols-1 gap-x-4 gap-y-2 py-8 px-3 -mx-3 border-t border-[var(--s-line)] last:border-b transition-colors duration-300 hover:bg-[var(--s-soft)]">
                <span className="site-num text-[15px] text-[var(--s-brand)] pt-1">{String(i + 1).padStart(2, "0")}</span>
                <div className="flex flex-col gap-2">
                  <h3 className="m-0 text-[22px] font-semibold tracking-[-.01em] text-[var(--s-ink)]">{t(title)}</h3>
                  <p className="m-0 text-[16.5px] text-[var(--s-ink-2)]">{t(d)}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Modules */}
        <section id="features" aria-labelledby="features-title" className="bg-[var(--s-soft)] border-y border-[var(--s-line)]">
          <div className={`${wrap} py-[clamp(72px,10vw,128px)] flex flex-col gap-12`}>
            <div data-reveal className="flex flex-col gap-5 max-w-[760px]">
              <span className={eyebrow}>{t("Features")}</span>
              <h2 id="features-title" className={h2}>{t("Everything a pharma distributor runs on, in one system.")}</h2>
            </div>
            <ul className="m-0 p-0 list-none grid gap-5 min-[640px]:grid-cols-2 min-[1000px]:grid-cols-3">
              {MODULES.map(([Icon, title, d], i) => (
                <li key={title} data-reveal style={{ ["--d" as string]: i % 3 }} className="site-lift rounded-xl bg-white border border-[var(--s-line)] p-6 flex flex-col gap-3">
                  <span className="size-11 rounded-lg bg-[var(--s-brand-tint)] flex items-center justify-center"><Icon size={22} aria-hidden className="site-breathe text-[var(--s-brand)]" /></span>
                  <h3 className="m-0 text-[19px] font-semibold text-[var(--s-ink)]">{t(title)}</h3>
                  <p className="m-0 text-[15.5px] text-[var(--s-ink-2)]">{t(d)}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Order to cash */}
        <section id="workflow" aria-labelledby="flow-title" className={`${wrap} py-[clamp(72px,10vw,128px)] flex flex-col gap-12`}>
          <div data-reveal className="flex flex-col gap-5 max-w-[760px]">
            <span className={eyebrow}>{t("Order to cash")}</span>
            <h2 id="flow-title" className={h2}>{t("One order, followed all the way to the money.")}</h2>
            <p className={lead}>{t("Every step checks the one before it, so stock, invoices and dues always agree.")}</p>
          </div>
          <ol className="m-0 p-0 list-none grid gap-x-6 gap-y-10 min-[720px]:grid-cols-3 min-[1100px]:grid-cols-5">
            {FLOW.map(([title, d], i) => (
              <li key={title} data-reveal style={{ ["--d" as string]: i }} className="flex flex-col gap-3 border-t-2 border-[var(--s-brand)] pt-5">
                <span className="site-num text-[13.5px] text-[var(--s-brand)]">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="m-0 text-[20px] font-semibold tracking-[-.01em] text-[var(--s-ink)]">{t(title)}</h3>
                <p className="m-0 text-[15.5px] text-[var(--s-ink-2)]">{t(d)}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Chemist portal and field */}
        <section id="portal" aria-labelledby="portal-title" className="site-dark bg-[var(--s-dark)] text-white relative overflow-hidden">
          <Aurora dark />
          <div className={`relative ${wrap} py-[clamp(72px,10vw,128px)] grid grid-cols-12 gap-x-6 gap-y-12 items-center`}>
            <div data-reveal className="col-span-12 min-[1000px]:col-span-6 flex flex-col gap-5">
              <span className="text-[14px] font-semibold text-[#8FD3C6]">{t("Chemist portal and field app")}</span>
              <h2 id="portal-title" className="site-display m-0 text-[clamp(34px,4.4vw,56px)]">{t("Let chemists order from you directly.")}</h2>
              <p className="m-0 text-[18px] leading-[1.6] text-[#C3D3D0]">{t("Fewer phone calls, fewer typing mistakes. Chemists order on their own portal, and your salesmen take orders and collections on their phones.")}</p>
              <ul className="m-0 p-0 list-none flex flex-col gap-3">
                {PORTAL.map((p) => <li key={p} className="flex gap-2.5 items-start text-[16px] text-[#D3E2DF]"><Check size={18} aria-hidden className="text-[#4ADE80] mt-[3px] flex-none" />{t(p)}</li>)}
              </ul>
            </div>
            <div data-reveal className="col-span-12 min-[1000px]:col-span-5 min-[1000px]:col-start-8 grid gap-4" aria-hidden>
              {([[Store, "Chemist portal", "Catalogue, rates, orders, invoices, dues"], [Smartphone, "Salesman app", "Beat-wise orders and collections"], [ScanBarcode, "Godown phone", "Picking lists, batch by batch"], [Truck, "Delivery phone", "Route, receiver, cash or UPI collected"]] as [typeof Check, string, string][]).map(([Icon, a, b]) => (
                <div key={a} className="site-lift flex items-center gap-4 rounded-xl border border-white/12 bg-white/[.04] px-5 py-4 hover:border-[#14B8A6]/60">
                  <Icon size={24} className="text-[#8FD3C6] flex-none" />
                  <span className="flex flex-col"><span className="text-[16px] font-semibold">{t(a)}</span><span className="text-[14.5px] text-[#B5C7C3]">{t(b)}</span></span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" aria-labelledby="pricing-title" className={`${wrap} py-[clamp(72px,10vw,128px)] flex flex-col gap-12`}>
          <div className="grid grid-cols-12 gap-x-6 gap-y-6 items-end">
            <div data-reveal className="col-span-12 min-[1000px]:col-span-7 flex flex-col gap-5">
              <span className={eyebrow}>{t("Pricing", { ctx: "site" })}</span>
              <h2 id="pricing-title" className={h2}>{t("Plans for one godown or twenty.")}</h2>
            </div>
            <p data-reveal className={`${lead} col-span-12 min-[1000px]:col-span-5`}>{t("No GST is charged on these prices. Pay by UPI, card or netbanking. Cancel any time and your data stays where it is.")}</p>
          </div>
          <Pricing only="distribution" />
        </section>

        {/* Trust strip */}
        <section aria-labelledby="dist-trust-title" className="border-y border-[var(--s-line)] bg-[var(--s-soft)]">
          <div className={`${wrap} py-12 flex flex-col gap-6`}>
            <h2 id="dist-trust-title" className="m-0 text-[15px] font-semibold text-[var(--s-ink)]">{t("The same Medoro foundations")}</h2>
            <ul className="m-0 p-0 list-none grid gap-x-8 gap-y-5 grid-cols-1 min-[640px]:grid-cols-2 min-[1000px]:grid-cols-4">
              {([[ShieldCheck, "Roles, two-step sign-in and an audit trail"], [ReceiptIndianRupee, "GST returns ready for your CA"], [Boxes, "Encrypted backups to your Drive"], [Users, "English and हिंदी for every team"]] as [typeof Check, string][]).map(([Icon, l]) => (
                <li key={l} className="flex items-center gap-2.5 text-[15.5px] text-[var(--s-ink-2)]"><Icon size={18} aria-hidden className="text-[var(--s-brand)] flex-none" />{t(l)}</li>
              ))}
            </ul>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" aria-labelledby="faq-title">
          <div className={`${wrap} py-[clamp(72px,10vw,128px)] grid grid-cols-12 gap-x-6 gap-y-10`}>
            <div className="col-span-12 min-[1000px]:col-span-4 flex flex-col gap-5 min-[1000px]:sticky min-[1000px]:top-28 self-start">
              <span className={eyebrow}>{t("FAQ")}</span>
              <h2 id="faq-title" className={h2}>{t("Questions distributors ask us.")}</h2>
              <a href={WA_DEMO} className="self-start inline-flex items-center gap-2 h-11 px-4 rounded-lg border border-[#C9D1CF] text-[15px] font-semibold text-[var(--s-ink)] hover:border-[var(--s-ink)] hover:text-[var(--s-ink)]"><MessageCircle size={16} aria-hidden />{t("Ask on WhatsApp")}</a>
            </div>
            <div className="site-faq col-span-12 min-[1000px]:col-span-7 min-[1000px]:col-start-6 flex flex-col">
              {FAQ.map(([q, a]) => (
                <details key={q} name="faq" className="border-t border-[var(--s-line)] last:border-b">
                  <summary className="flex justify-between items-center gap-6 py-5 text-[18px] font-semibold text-[var(--s-ink)] rounded-md">
                    {t(q)}<Plus size={20} aria-hidden className="site-plus flex-none text-[var(--s-brand)]" />
                  </summary>
                  <p className="m-0 pb-6 pr-10 text-[16.5px] text-[var(--s-ink-2)]">{t(a)}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section aria-labelledby="cta-title" className={`${wrap} pb-[clamp(72px,10vw,128px)]`}>
          <div data-reveal className="site-dark relative overflow-hidden rounded-2xl bg-[var(--s-dark)] text-white p-[clamp(28px,5vw,64px)] flex flex-col items-center text-center gap-6">
            <Aurora dark />
            <h2 id="cta-title" className="relative site-display m-0 text-[clamp(30px,3.8vw,48px)] max-w-[760px]">{t("Try Medoro Distribution free for 7 days.")}</h2>
            <p className="relative m-0 text-[18px] text-[#C3D3D0] max-w-[620px]">{t("Every feature, no card. Bring your products and chemists from Excel and take your first order today.")}</p>
            <div className="relative flex gap-3 flex-wrap justify-center">
              <a href="/distributor-signup" className="site-link-arrow inline-flex items-center gap-2 h-12 px-5 rounded-lg bg-white text-[var(--s-ink)] text-[16px] font-semibold hover:text-[var(--s-ink)]">{t("Start 7-day free trial")}<ArrowRight size={18} aria-hidden /></a>
              <a href="/pharmacy" className="inline-flex items-center gap-2 h-12 px-5 rounded-lg border border-white/40 text-white text-[16px] font-semibold hover:border-white hover:text-white">{t("Run a medical store? See Medoro Pharmacy")}</a>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
      <WhatsAppFab />
    </div>
  );
}

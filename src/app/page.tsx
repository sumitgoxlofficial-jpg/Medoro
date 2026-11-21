import type { Metadata } from "next";
import {
  ArrowRight, Check, CloudOff, Database, FileCheck, Flag, HeartPulse, IndianRupee, Languages, Layers, Lock, MessageCircle, Plus, ReceiptIndianRupee,
  ScanBarcode, ShieldCheck, Sparkles, Stethoscope, Store, Truck, UserCheck, Warehouse, X,
} from "lucide-react";
import { cookies } from "next/headers";
import { SiteFooter, SiteHeader, SiteMotion, WhatsAppFab, WA_DEMO } from "@/components/site/chrome";
import { SiteLangCarryOver } from "@/components/site/header";
import { Marquee } from "@/components/site/interactive";
import { PRODUCTS } from "@/staff/constants";
import { DIST_PLANS } from "@/domain/distribution/plans";
import { BRAND_FAQ } from "@/data/brand";
import { JsonLd } from "@/components/seo/json-ld";
import { WEBSITE_ID, ORG_ID, absoluteUrl, faqSchema } from "@/lib/seo";
import { getLang } from "@/server/lang";
import { tFor } from "@/lib/tr";
import { Aurora } from "@/components/site/decor";
import { HeroVideo } from "@/components/site/hero-video";

/**
 * The main Medoro page: what Medoro is, why it is built only for Indian pharma, what makes it different, and the
 * two products. Each product has its own landing page: /pharmacy (retail) and /distribution (wholesale).
 */
const TITLE = "Medoro — Pharma Software Made in India for Indian Pharmacies & Distributors";
const DESC = "Medoro (medoro.in) is Indian pharma software built only for Indian pharma: Medoro Pharmacy for medical stores and chains, and Medoro Distribution for pharma distributors, stockists and C&F agents. GST, batches, expiry, Schedule H1 and हिंदी built in.";
const KEYWORDS = ["Medoro", "Medoro software", "Indian pharma software", "pharmacy software india", "pharma distribution software", "medical store software", "pharma ERP india", "Medoro Pharmacy", "Medoro Distribution"];

export async function generateMetadata(): Promise<Metadata> {
  const lang = await getLang();
  const t = tFor(lang);
  const title = t(TITLE), description = t(DESC);
  return {
    title: { absolute: title },
    description,
    keywords: KEYWORDS,
    applicationName: "Medoro",
    alternates: { canonical: "/" },
    robots: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
    openGraph: { type: "website", url: "/", siteName: "Medoro", title, description, locale: lang === "hi" ? "hi_IN" : "en_IN" },
    twitter: { card: "summary_large_image", title, description },
  };
}

// "From" prices are read from the same tables the licence server and the app use.
const PRODUCTS_LIST = [
  { id: "pharmacy", Icon: ScanBarcode, name: "Medoro Pharmacy", for: "Medical stores, pharmacy chains, clinic and hospital pharmacies", from: PRODUCTS.find((p) => p.id === "starter")!.m, href: "/pharmacy", trial: "/trial",
    line: "The counter, the stock room and the books of a medical store in one place.",
    points: ["Three-key GST billing with FEFO batch picking", "Expiry, low-stock and reorder alerts", "Purchases, supplier bills and claims", "Accounts, GST returns and Tally export", "WhatsApp invoices and billing when the internet drops"] },
  { id: "distribution", Icon: Warehouse, name: "Medoro Distribution", for: "Pharma distributors, wholesalers, stockists, super stockists and C&F agents", from: Math.round(DIST_PLANS.dist_std.priceMonthly / 100), href: "/distribution", trial: "/distributor-signup",
    line: "Order to cash for a pharma wholesaler, from the chemist’s order to the collection.",
    points: ["Orders with credit control and batch-wise stock reservation", "Wholesale GST invoices, schemes and free goods", "Mobile picking, dispatch and delivery", "Expiry claims to companies, collections and ageing", "A chemist ordering portal with your own rates"] },
] as const;

/** What "built for Indian pharma" means in the product. Each line is something both products do today. */
const INDIA: [typeof Check, string, string][] = [
  [ReceiptIndianRupee, "GST the Indian way", "MRP-inclusive pricing, CGST + SGST or IGST by place of supply, HSN codes, GSTR-1 and GSTR-3B."],
  [Stethoscope, "Drug schedules", "Schedule H, H1, X and NDPS medicines ask for the prescriber and fill the register."],
  [Layers, "Batch and expiry first", "Every strip has a batch and an expiry. The earliest expiry goes out first; expired stock is blocked."],
  [IndianRupee, "PTR, PTS and schemes", "Trade rates, free goods like “10+2”, trade and cash discounts, worked into landed cost."],
  [UserCheck, "Drug licences and DPDP", "Licence numbers and validity on parties; customer consent recorded under India’s DPDP Act."],
  [Languages, "English and हिंदी", "Every screen in both languages, switchable per person. The assistant understands Hinglish."],
];

/** What makes Medoro different from general billing software. [icon, title, text] */
const DIFFERENT: [typeof Check, string, string][] = [
  [HeartPulse, "Only pharma, nothing else", "Medoro is not a general billing app with a medicine template. Batches, salts, schedules, expiry returns and distributor schemes are the core of the product, not add-ons."],
  [Database, "Your data stays with you", "Invoices, stock, customers and prescriptions live on infrastructure you control. Medoro’s servers hold only your account and licence. Export everything, any time."],
  [CloudOff, "Keeps working when the internet doesn’t", "Counters on the shop network keep billing during an outage, and installed counters can bill offline and sync later."],
  [Truck, "One family for the whole supply chain", "The same Medoro for the medical store and for the distributor who supplies it, with a free ordering portal for chemists."],
  [Lock, "Security that is switched on", "Two-step sign-in for owners, roles and permissions, a tamper-evident audit trail and encrypted backups only your key opens."],
  [IndianRupee, "Honest pricing in rupees", "Plain monthly prices, a 7-day free trial with no card, no automatic renewals. If you stop paying, your data turns read-only; it is never held back."],
];

const COMPARE: [string, string, string][] = [
  ["Built for", "Any shop that sells anything", "Indian pharmacies and pharma distributors only"],
  ["Batches and expiry", "A column you fill in, if at all", "Batch-wise stock, FEFO picking and expiry blocked at billing"],
  ["Regulation", "Left to you", "Schedule H1 register, drug licences, GST returns ready"],
  ["Distributor bills", "Typed in line by line", "Imported from CSV, Excel or a scanned PDF"],
  ["Internet outage", "Billing stops", "Billing carries on over the shop network"],
  ["Language", "English only", "English and हिंदी on every screen"],
  ["Your data", "In the vendor’s cloud and format", "On your infrastructure, full export any time"],
];

const WORKS_WITH = ["GST and e-invoice", "Tally", "WhatsApp Business API", "UPI", "Google Drive", "Excel and CSV", "80 mm thermal printers", "Barcode scanners", "Windows", "macOS", "Linux", "Android"];

const FLOW: [typeof Check, string, string][] = [
  [Warehouse, "Distributor", "Stocks from the company, offers schemes and rates, delivers to chemists on credit."],
  [Store, "Chemist", "Orders on the distributor’s portal, receives with batch and expiry, sells at the counter."],
  [HeartPulse, "Patient", "Gets the right medicine, in date, with a proper GST bill on paper or WhatsApp."],
];

const eyebrow = "text-[14px] font-semibold text-[var(--s-brand)]";
const h2 = "site-display m-0 text-[clamp(34px,4.4vw,56px)] text-[var(--s-ink)]";
const lead = "m-0 text-[clamp(17px,1.4vw,19px)] leading-[1.6] text-[var(--s-ink-2)]";
const wrap = "max-w-[1200px] mx-auto px-6 max-[640px]:px-4";

const pageLd = {
  "@type": "WebPage",
  "@id": `${absoluteUrl("/")}/#webpage`,
  url: absoluteUrl("/"),
  name: TITLE,
  description: DESC,
  inLanguage: ["en-IN", "hi-IN"],
  isPartOf: { "@id": WEBSITE_ID },
  about: { "@id": ORG_ID },
};

const FAQ: [string, string][] = [
  ...BRAND_FAQ,
  ["What is the difference between Medoro Pharmacy and Medoro Distribution?", "Medoro Pharmacy is for retail: medical stores, chains and hospital pharmacies that sell to patients at a counter. Medoro Distribution is for wholesale: distributors, stockists and C&F agents that sell to chemists on credit, with orders, picking, dispatch, schemes and collections. They are separate products with separate plans."],
  ["Is Medoro made in India?", "Yes. Medoro is designed and built in India, only for the Indian pharma trade: GST, drug schedules, batch and expiry rules, PTR and PTS, distributor schemes, UPI and Hindi are part of the product, not settings you add later."],
];
const faqLd = faqSchema(FAQ);

export default async function Home() {
  const lang = await getLang();
  const t = tFor(lang);
  // Visitors who chose हिंदी on the old homepage toggle (kept in the browser) get the site-wide cookie once.
  const carryOver = !(await cookies()).has("medoro_lang");
  return (
    <div className="site-root bg-white overflow-x-clip">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:bg-white focus:px-4 focus:py-2 focus:rounded-lg focus:shadow">{t("Skip to content")}</a>
      <SiteHeader />
      <SiteMotion />
      <div aria-hidden className="site-progress" />
      {carryOver ? <SiteLangCarryOver /> : null}
      <JsonLd data={[pageLd, faqLd]} />

      <main id="main">
        {/* Hero: who Medoro is, and the two doors. */}
        <section aria-labelledby="hero-title" className="relative overflow-hidden min-[1000px]:min-h-[calc(100svh-65px)] min-[1000px]:flex min-[1000px]:items-center">
          <HeroVideo />
          <div className={`relative w-full ${wrap} pt-[clamp(40px,5vw,64px)] pb-[clamp(64px,8vw,104px)] flex flex-col items-center text-center gap-6`}>
            <span className="site-up inline-flex items-center gap-2 rounded-full bg-white/90 border border-[var(--s-line)] px-3.5 py-1.5 text-[14px] font-semibold text-[var(--s-brand)]"><Flag size={15} aria-hidden />{t("Made in India, for Indian pharma")}</span>
            <h1 id="hero-title" className="m-0 flex flex-col gap-4 items-center">
              <span className="site-up text-[15px] font-medium text-[var(--s-ink-2)] [--d:1]">{t("Medoro: pharma software for Indian pharmacies and distributors")}</span>
              <span className="site-display site-up block text-[clamp(40px,6vw,76px)] leading-[1.04] max-w-[980px] [--d:1]">
                <span className="block">{t("Software that speaks")}</span>
                <span className="block site-shine">{t("the language of Indian pharma.")}</span>
              </span>
            </h1>
            <p className="site-up m-0 text-[clamp(17px,1.5vw,20px)] leading-[1.6] text-[var(--s-ink-2)] max-w-[760px] [--d:2]">{t("Batches, expiry, GST, Schedule H1, PTR and schemes are not add-ons for us. They are the product. Medoro runs the medical store counter and the distributor’s godown, on infrastructure you control.")}</p>
            <div className="site-up flex gap-3 flex-wrap justify-center pt-1 [--d:3]">
              <a href="/pharmacy" className="site-link-arrow inline-flex items-center gap-2 h-12 px-5 rounded-lg bg-[var(--s-brand)] text-white text-[16px] font-semibold transition-colors hover:bg-[var(--s-brand-ink)] hover:text-white"><ScanBarcode size={18} aria-hidden />{t("Medoro Pharmacy")}<ArrowRight size={18} aria-hidden /></a>
              <a href="/distribution" className="site-link-arrow inline-flex items-center gap-2 h-12 px-5 rounded-lg bg-[var(--s-dark)] text-white text-[16px] font-semibold transition-colors hover:text-white hover:opacity-90"><Warehouse size={18} aria-hidden />{t("Medoro Distribution")}<ArrowRight size={18} aria-hidden /></a>
            </div>
            <p className="site-up m-0 text-[14px] text-[var(--s-muted)] [--d:4]">{t("7-day free trial on both. No card needed.")}</p>
          </div>
        </section>

        {/* What is Medoro */}
        <section id="about" aria-labelledby="about-title" className="border-y border-[var(--s-line)] bg-[var(--s-soft)]">
          <div className={`${wrap} py-[clamp(64px,9vw,112px)] grid grid-cols-12 gap-x-6 gap-y-10 items-start`}>
            <div data-reveal className="col-span-12 min-[1000px]:col-span-5 flex flex-col gap-5">
              <span className={eyebrow}>{t("What is Medoro")}</span>
              <h2 id="about-title" className={h2}>{t("One Indian company. One job: pharma.")}</h2>
            </div>
            <div data-reveal className="col-span-12 min-[1000px]:col-span-6 min-[1000px]:col-start-7 flex flex-col gap-5">
              <p className={lead}>{t("Medoro is a family of business software for the Indian pharmaceutical trade. Medoro Pharmacy runs the medical store: billing, batch stock, purchases, GST and accounts. Medoro Distribution runs the wholesaler: orders, godowns, dispatch, schemes, claims and collections.")}</p>
              <p className={lead}>{t("Both are designed and built in India, around Indian law and the way Indian chemists and distributors actually work, in English and हिंदी.")}</p>
              <a href="/about-medoro" className="site-link-arrow self-start inline-flex items-center gap-1.5 text-[16px] font-semibold text-[var(--s-brand)] underline underline-offset-4 decoration-[var(--s-brand)]/30 hover:decoration-[var(--s-brand)]">{t("More about Medoro")}<ArrowRight size={16} aria-hidden /></a>
            </div>
          </div>
        </section>

        {/* The two products */}
        <section id="products" aria-labelledby="products-title" className={`${wrap} py-[clamp(64px,9vw,112px)] flex flex-col gap-10`}>
          <div className="grid grid-cols-12 gap-x-6 gap-y-5 items-end">
            <div data-reveal className="col-span-12 min-[1000px]:col-span-7 flex flex-col gap-5">
              <span className={eyebrow}>{t("Two products, one Medoro")}</span>
              <h2 id="products-title" className={h2}>{t("From the medical store counter to the distributor’s godown.")}</h2>
            </div>
            <p data-reveal className={`${lead} col-span-12 min-[1000px]:col-span-5`}>{t("Pick the one that fits your business. Each has its own page with features, plans and a free trial.")}</p>
          </div>
          <div className="grid gap-5 min-[900px]:grid-cols-2">
            {PRODUCTS_LIST.map((f, i) => {
              const dark = i === 1;
              return (
                <article key={f.id} data-reveal style={{ ["--d" as string]: i }} className={`site-lift relative overflow-hidden rounded-2xl p-[clamp(22px,3vw,36px)] flex flex-col gap-5 ${dark ? "site-dark bg-[var(--s-dark)] text-white" : "bg-white border border-[var(--s-line)]"}`}>
                  {dark ? <div aria-hidden className="absolute inset-0"><Aurora dark /></div> : null}
                  <div className="relative flex items-center gap-3">
                    <span className={`size-12 rounded-xl flex items-center justify-center ${dark ? "bg-white/10 text-[#8FD3C6]" : "bg-[var(--s-brand-tint)] text-[var(--s-brand)]"}`}><f.Icon size={24} aria-hidden className="site-breathe" /></span>
                    <div className="flex flex-col">
                      <h3 className="m-0 text-[24px] font-semibold tracking-[-.01em]">{t(f.name)}</h3>
                      <span className={`text-[15px] ${dark ? "text-[#B5C7C3]" : "text-[var(--s-muted)]"}`}>{t(f.for)}</span>
                    </div>
                  </div>
                  <p className={`relative m-0 text-[17px] ${dark ? "text-[#D3E2DF]" : "text-[var(--s-ink-2)]"}`}>{t(f.line)}</p>
                  <div className="relative flex items-baseline gap-1.5"><span className="text-[15px] font-medium">{t("From")}</span><span className={`site-display text-[40px] leading-none ${dark ? "text-white" : "text-[var(--s-brand)]"}`}>₹{f.from.toLocaleString("en-IN")}</span><span className={`text-[15px] ${dark ? "text-[#B5C7C3]" : "text-[var(--s-muted)]"}`}>{t("/ month")}</span></div>
                  <ul className="relative m-0 p-0 list-none flex flex-col gap-2.5">
                    {f.points.map((x) => <li key={x} className={`flex gap-2.5 items-start text-[15.5px] ${dark ? "text-[#D3E2DF]" : "text-[var(--s-ink-2)]"}`}><Check size={17} aria-hidden className={`${dark ? "text-[#4ADE80]" : "text-[var(--s-brand)]"} mt-[3px] flex-none`} />{t(x)}</li>)}
                  </ul>
                  <div className="relative mt-auto flex flex-wrap gap-3 pt-2">
                    <a href={f.href} className={`site-link-arrow inline-flex items-center gap-2 h-12 px-5 rounded-lg text-[15.5px] font-semibold transition-colors ${dark ? "bg-white text-[var(--s-ink)] hover:text-[var(--s-ink)]" : "bg-[var(--s-brand)] text-white hover:bg-[var(--s-brand-ink)] hover:text-white"}`}>{t("Explore {name}", { name: f.name })}<ArrowRight size={18} aria-hidden /></a>
                    <a href={f.trial} className={`inline-flex items-center h-12 px-4 rounded-lg text-[15.5px] font-semibold border transition-colors ${dark ? "border-white/30 text-white hover:border-white hover:text-white" : "border-[#C9D1CF] text-[var(--s-ink)] hover:border-[var(--s-brand)] hover:text-[var(--s-brand)]"}`}>{t("Start free trial")}</a>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* Built for Indian pharma */}
        <section id="india" aria-labelledby="india-title" className="site-dark bg-[var(--s-dark)] text-white relative overflow-hidden">
          <Aurora dark />
          <div className={`relative ${wrap} py-[clamp(72px,10vw,128px)] flex flex-col gap-12`}>
            <div className="grid grid-cols-12 gap-x-6 gap-y-6 items-end">
              <div data-reveal className="col-span-12 min-[1000px]:col-span-7 flex flex-col gap-5">
                <span className="text-[14px] font-semibold text-[#8FD3C6]">{t("Dedicated to Indian pharma")}</span>
                <h2 id="india-title" className="site-display m-0 text-[clamp(34px,4.4vw,56px)]">{t("Indian rules are built in, not bolted on.")}</h2>
              </div>
              <p data-reveal className="col-span-12 min-[1000px]:col-span-5 m-0 text-[18px] leading-[1.6] text-[#C3D3D0]">{t("Foreign and general-purpose software treats a medicine like any other item. Indian pharma has its own taxes, schedules, rates and paperwork, and Medoro starts from them.")}</p>
            </div>
            <ul className="m-0 p-0 list-none grid gap-5 min-[640px]:grid-cols-2 min-[1000px]:grid-cols-3">
              {INDIA.map(([Icon, title, d], i) => (
                <li key={title} data-reveal style={{ ["--d" as string]: i % 3 }} className="site-lift rounded-xl border border-white/12 bg-white/[.03] p-6 flex flex-col gap-3 hover:border-[#14B8A6]/60">
                  <span className="size-11 rounded-lg bg-white/10 flex items-center justify-center"><Icon size={22} aria-hidden className="site-breathe text-[#8FD3C6]" /></span>
                  <h3 className="m-0 text-[19px] font-semibold">{t(title)}</h3>
                  <p className="m-0 text-[15.5px] text-[#B5C7C3]">{t(d)}</p>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-6 max-[720px]:flex-col max-[720px]:items-stretch max-[720px]:gap-3">
              <span className="text-[14px] text-[#9FB5B1] whitespace-nowrap">{t("Works with")}</span>
              <div className="flex-1 min-w-0"><Marquee items={WORKS_WITH.map((w) => t(w))} /></div>
            </div>
          </div>
        </section>

        {/* What makes Medoro different */}
        <section id="different" aria-labelledby="different-title" className={`${wrap} py-[clamp(72px,10vw,128px)] flex flex-col gap-12`}>
          <div data-reveal className="flex flex-col gap-5 max-w-[760px]">
            <span className={eyebrow}>{t("What makes Medoro different")}</span>
            <h2 id="different-title" className={h2}>{t("Six things you won’t find together anywhere else.")}</h2>
          </div>
          <ol className="m-0 p-0 list-none grid gap-x-10 gap-y-12 min-[720px]:grid-cols-2 min-[1100px]:grid-cols-3">
            {DIFFERENT.map(([Icon, title, d], i) => (
              <li key={title} data-reveal style={{ ["--d" as string]: i % 3 }} className="flex flex-col gap-3 border-t-2 border-[var(--s-brand)] pt-6">
                <span className="flex items-center justify-between">
                  <span className="size-10 rounded-lg bg-[var(--s-brand-tint)] flex items-center justify-center"><Icon size={20} aria-hidden className="site-breathe text-[var(--s-brand)]" /></span>
                  <span className="site-num text-[14px] text-[var(--s-brand)]">{String(i + 1).padStart(2, "0")}</span>
                </span>
                <h3 className="m-0 text-[21px] font-semibold tracking-[-.01em] text-[var(--s-ink)]">{t(title)}</h3>
                <p className="m-0 text-[16px] leading-[1.6] text-[var(--s-ink-2)]">{t(d)}</p>
              </li>
            ))}
          </ol>

          <div data-reveal className="flex flex-col gap-6 pt-6">
            <h3 className="m-0 text-[24px] font-semibold text-[var(--s-ink)]">{t("General billing software compared with Medoro")}</h3>
            <div className="max-[719px]:hidden">
              <table className="w-full border-collapse text-[16px]">
                <caption className="sr-only">{t("General billing software compared with Medoro")}</caption>
                <thead>
                  <tr className="text-left">
                    <th scope="col" className="w-[22%] py-4 pr-6 font-medium text-[14px] text-[var(--s-muted)] border-b-2 border-[var(--s-ink)]"><span className="sr-only">{t("Area")}</span></th>
                    <th scope="col" className="w-[34%] py-4 pr-6 font-medium text-[14px] text-[var(--s-muted)] border-b-2 border-[var(--s-ink)]">{t("General billing software")}</th>
                    <th scope="col" className="py-4 font-semibold text-[15px] text-[var(--s-brand)] border-b-2 border-[var(--s-brand)]">Medoro</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARE.map(([a, other, m]) => (
                    <tr key={a} className="align-top transition-colors duration-300 hover:bg-[var(--s-soft)]">
                      <th scope="row" className="py-4 pr-6 text-left font-semibold text-[var(--s-ink)] border-b border-[var(--s-line)]">{t(a)}</th>
                      <td className="py-4 pr-6 text-[var(--s-muted)] border-b border-[var(--s-line)]"><span className="flex gap-2.5 items-start"><X size={17} aria-hidden className="text-[#B4534B] mt-[4px] flex-none" />{t(other)}</span></td>
                      <td className="py-4 text-[var(--s-ink)] border-b border-[var(--s-line)]"><span className="flex gap-2.5 items-start"><Check size={17} aria-hidden className="text-[var(--s-brand)] mt-[4px] flex-none" />{t(m)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="min-[720px]:hidden m-0 p-0 list-none flex flex-col border-t-2 border-[var(--s-ink)]">
              {COMPARE.map(([a, other, m]) => (
                <li key={a} className="py-5 border-b border-[var(--s-line)] flex flex-col gap-2">
                  <span className="text-[17px] font-semibold text-[var(--s-ink)]">{t(a)}</span>
                  <span className="text-[15px] text-[var(--s-muted)]"><span className="font-medium">{`${t("General software:")} `}</span>{t(other)}</span>
                  <span className="flex gap-2.5 items-start text-[16px] text-[var(--s-ink)]"><Check size={17} aria-hidden className="text-[var(--s-brand)] mt-[4px] flex-none" /><span><span className="sr-only">Medoro: </span>{t(m)}</span></span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* The supply chain Medoro serves */}
        <section aria-labelledby="chain-title" className="bg-[var(--s-soft)] border-y border-[var(--s-line)]">
          <div className={`${wrap} py-[clamp(64px,9vw,112px)] flex flex-col gap-12`}>
            <div data-reveal className="flex flex-col gap-5 max-w-[760px]">
              <span className={eyebrow}>{t("The whole chain")}</span>
              <h2 id="chain-title" className={h2}>{t("Every medicine passes through two businesses before it reaches a patient.")}</h2>
              <p className={lead}>{t("Medoro is built for both of them.")}</p>
            </div>
            <ol className="m-0 p-0 list-none grid gap-4 min-[900px]:grid-cols-[1fr_auto_1fr_auto_1fr] items-stretch">
              {FLOW.map(([Icon, title, d], i) => (
                <li key={title} className="contents">
                  <div data-reveal style={{ ["--d" as string]: i }} className="site-lift rounded-xl bg-white border border-[var(--s-line)] p-6 flex flex-col gap-3">
                    <span className="flex items-center gap-3"><span className="size-11 rounded-lg bg-[var(--s-brand-tint)] flex items-center justify-center"><Icon size={22} aria-hidden className="text-[var(--s-brand)]" /></span><span className="text-[19px] font-semibold text-[var(--s-ink)]">{t(title)}</span></span>
                    <p className="m-0 text-[15.5px] text-[var(--s-ink-2)]">{t(d)}</p>
                    <span className="mt-auto text-[14px] font-semibold text-[var(--s-brand)]">{i === 0 ? t("Medoro Distribution") : i === 1 ? t("Medoro Pharmacy and the chemist portal") : t("A GST bill from Medoro Pharmacy")}</span>
                  </div>
                  {i < FLOW.length - 1 ? <span aria-hidden className="flex items-center justify-center text-[var(--s-brand)] max-[899px]:rotate-90"><ArrowRight size={26} /></span> : null}
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Trust */}
        <section aria-labelledby="trust-title" className={`${wrap} py-[clamp(72px,10vw,128px)] grid grid-cols-12 gap-x-6 gap-y-10 items-center`}>
          <div data-reveal className="col-span-12 min-[1000px]:col-span-6 flex flex-col gap-5">
            <span className={eyebrow}>{t("Security and data ownership")}</span>
            <h2 id="trust-title" className={h2}>{t("Your business data is yours. Full stop.")}</h2>
            <p className={lead}>{t("Medoro runs on infrastructure you control: a PC in your shop, your own server or your cloud account. Medoro’s servers see your account and plan, never your invoices, stock or patients.")}</p>
            <a href="/pharmacy#security" className="site-link-arrow self-start inline-flex items-center gap-1.5 text-[16px] font-semibold text-[var(--s-brand)] underline underline-offset-4 decoration-[var(--s-brand)]/30 hover:decoration-[var(--s-brand)]">{t("How Medoro keeps your data safe")}<ArrowRight size={16} aria-hidden /></a>
          </div>
          <ul className="col-span-12 min-[1000px]:col-span-5 min-[1000px]:col-start-8 m-0 p-0 list-none grid gap-3 min-[560px]:grid-cols-2">
            {([[ShieldCheck, "Two-step sign-in"], [Lock, "Encrypted backups"], [FileCheck, "Audit trail"], [UserCheck, "DPDP consent records"], [Sparkles, "AI that never gives medical advice"], [MessageCircle, "Real people on WhatsApp"]] as [typeof Check, string][]).map(([Icon, l], i) => (
              <li key={l} data-reveal style={{ ["--d" as string]: i % 2 }} className="site-lift flex items-center gap-3 rounded-xl border border-[var(--s-line)] bg-white px-4 py-4 text-[15.5px] font-medium text-[var(--s-ink)]"><Icon size={20} aria-hidden className="text-[var(--s-brand)] flex-none" />{t(l)}</li>
            ))}
          </ul>
        </section>

        {/* FAQ */}
        <section id="faq" aria-labelledby="faq-title" className="border-t border-[var(--s-line)]">
          <div className={`${wrap} py-[clamp(72px,10vw,128px)] grid grid-cols-12 gap-x-6 gap-y-10`}>
            <div className="col-span-12 min-[1000px]:col-span-4 flex flex-col gap-5 min-[1000px]:sticky min-[1000px]:top-28 self-start">
              <span className={eyebrow}>{t("FAQ")}</span>
              <h2 id="faq-title" className={h2}>{t("About Medoro")}</h2>
              <p className="m-0 text-[16.5px] text-[var(--s-ink-2)]">{t("Questions about a product? Each product page has its own FAQ, or message us on WhatsApp.")}</p>
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

        {/* Choose */}
        <section aria-labelledby="choose-title" className={`${wrap} pb-[clamp(72px,10vw,128px)]`}>
          <div data-reveal className="site-dark relative overflow-hidden rounded-2xl bg-[var(--s-dark)] text-white p-[clamp(28px,5vw,64px)] flex flex-col items-center text-center gap-6">
            <Aurora dark />
            <h2 id="choose-title" className="relative site-display m-0 text-[clamp(30px,3.8vw,48px)] max-w-[760px]">{t("Which Medoro is right for you?")}</h2>
            <p className="relative m-0 text-[18px] text-[#C3D3D0] max-w-[620px]">{t("Sell to patients at a counter? Choose Medoro Pharmacy. Sell to chemists on credit? Choose Medoro Distribution.")}</p>
            <div className="relative flex gap-3 flex-wrap justify-center">
              <a href="/pharmacy" className="site-link-arrow inline-flex items-center gap-2 h-12 px-5 rounded-lg bg-white text-[var(--s-ink)] text-[16px] font-semibold hover:text-[var(--s-ink)]"><ScanBarcode size={18} aria-hidden />{t("I run a medical store")}<ArrowRight size={18} aria-hidden /></a>
              <a href="/distribution" className="site-link-arrow inline-flex items-center gap-2 h-12 px-5 rounded-lg border border-white/40 text-white text-[16px] font-semibold hover:border-white hover:text-white"><Warehouse size={18} aria-hidden />{t("I run a distribution business")}<ArrowRight size={18} aria-hidden /></a>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
      <WhatsAppFab />
    </div>
  );
}

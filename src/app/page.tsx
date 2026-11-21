import type { Metadata } from "next";
import {
  ArrowRight, Boxes, BriefcaseBusiness, Building2, Check, CloudOff, Database, FileCheck, Flag, Handshake, HeartPulse, IndianRupee, Languages, Layers, Lock, Mail,
  MessageCircle, Plus, ReceiptIndianRupee, ScanBarcode, ShieldCheck, Sparkles, Stethoscope, Store, Truck, UserCheck, Warehouse,
} from "lucide-react";
import { cookies } from "next/headers";
import { SiteFooter, SiteHeader, SiteMotion, WhatsAppFab, WA_DEMO } from "@/components/site/chrome";
import { SiteLangCarryOver } from "@/components/site/header";
import { Marquee } from "@/components/site/interactive";
import { BRAND } from "@/data/brand";
import { JsonLd } from "@/components/seo/json-ld";
import { WEBSITE_ID, ORG_ID, absoluteUrl, faqSchema } from "@/lib/seo";
import { getLang } from "@/server/lang";
import { tFor } from "@/lib/tr";
import { Aurora, FloatingShapes, HelpArt, SupplyChainArt } from "@/components/site/decor";
import { HeroVideo } from "@/components/site/hero-video";

/**
 * The main Medoro page, about the company: who Medoro is, its two products (each with its own landing page, /pharmacy
 * and /distribution, where features and prices live), why businesses choose it, who it serves, and how to reach it.
 */
const TITLE = "Medoro — Business Software for India’s Pharma Trade";
const DESC = "Medoro is an Indian software company building business software only for the pharma trade: Medoro Pharmacy for medical stores and chains, and Medoro Distribution for distributors, stockists and C&F agents. Made in India, GST-ready, in English and हिंदी.";
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

/** The two products, told at company level: who each is for and what it runs. Details and prices live on their own pages. */
const PRODUCTS_LIST = [
  { id: "pharmacy", Icon: ScanBarcode, name: "Medoro Pharmacy", for: "For medical stores, pharmacy chains and hospital pharmacies", href: "/pharmacy",
    line: "Billing, batch stock, purchases, GST and accounts for the pharmacy counter.",
    points: ["Counter billing with batch and expiry control", "Purchases, stock and supplier accounts", "GST returns, registers and reports"] },
  { id: "distribution", Icon: Warehouse, name: "Medoro Distribution", for: "For distributors, stockists, super stockists and C&F agents", href: "/distribution",
    line: "Order to cash for pharma wholesale, from the chemist’s order to the collection.",
    points: ["Orders, credit control and schemes", "Godowns, picking, dispatch and delivery", "Expiry claims, collections and a chemist portal"] },
] as const;

/** The promises the company makes, shown right under the hero. */
const TRUST: [typeof Check, string][] = [
  [Flag, "Made in India"], [ReceiptIndianRupee, "GST-ready"], [Database, "Your data stays with you"], [Languages, "English and हिंदी"], [MessageCircle, "Real people on WhatsApp"],
];

/** Medoro in three facts, each true of the product today. */
const FACTS: [string, string][] = [
  ["2", "products, one for each side of the pharma trade"],
  ["1", "focus: Indian pharma, and nothing else"],
  ["0", "invoices, stock or patient records kept on our servers"],
];

/** What "built for Indian pharma" means in the product. Each line is something both products do today. */
const INDIA: [typeof Check, string, string][] = [
  [ReceiptIndianRupee, "GST the Indian way", "MRP-inclusive pricing, CGST + SGST or IGST by place of supply, HSN codes, GSTR-1 and GSTR-3B."],
  [Stethoscope, "Drug schedules", "Schedule H, H1, X and NDPS medicines ask for the prescriber and fill the register."],
  [Layers, "Batch and expiry first", "Every strip has a batch and an expiry. The earliest expiry goes out first; expired stock is blocked."],
  [IndianRupee, "PTR, PTS and schemes", "Trade rates, free goods like “10+2”, trade and cash discounts, worked into landed cost."],
  [UserCheck, "Drug licences and DPDP", "Licence numbers and validity on parties; customer consent recorded under India’s DPDP Act."],
  [Languages, "English and हिंदी", "Every screen in both languages, switchable per person. The assistant understands Hinglish."],
];

/** Why businesses choose Medoro. [icon, title, text] */
const WHY: [typeof Check, string, string][] = [
  [HeartPulse, "Only pharma, nothing else", "Medoro is not a general billing app with a medicine template. Batches, salts, schedules, expiry returns and distributor schemes are the core of the product, not add-ons."],
  [Database, "Your data stays with you", "Invoices, stock, customers and prescriptions live on infrastructure you control. Medoro’s servers hold only your account and licence. Export everything, any time."],
  [CloudOff, "Keeps working when the internet doesn’t", "Counters on the shop network keep billing during an outage, and installed counters can bill offline and sync later."],
  [Truck, "One family for the whole supply chain", "The same Medoro for the medical store and for the distributor who supplies it, with a free ordering portal for chemists."],
  [Lock, "Security that is switched on", "Two-step sign-in for owners, roles and permissions, a tamper-evident audit trail and encrypted backups only your key opens."],
  [Handshake, "A partner, not just a vendor", "Help moving from your current software, training for your team, and people who understand pharma on WhatsApp, Monday to Saturday."],
];

/** Who Medoro serves, each linked to the product (and solution page) that fits. */
const SERVE: [typeof Check, string, string, string][] = [
  [Store, "Retail chemists", "Medoro Pharmacy", "/solutions/retail-pharmacy"],
  [Building2, "Pharmacy chains", "Medoro Pharmacy", "/solutions/pharmacy-chains"],
  [Stethoscope, "Hospital and clinic pharmacies", "Medoro Pharmacy", "/solutions/hospital-pharmacy"],
  [Warehouse, "Distributors and wholesalers", "Medoro Distribution", "/distribution"],
  [Boxes, "Stockists and super stockists", "Medoro Distribution", "/distribution"],
  [Truck, "C&F agents", "Medoro Distribution", "/distribution"],
];

const WORKS_WITH = ["GST and e-invoice", "Tally", "WhatsApp Business API", "UPI", "Google Drive", "Excel and CSV", "80 mm thermal printers", "Barcode scanners", "Windows", "macOS", "Linux", "Android"];

/** The company: links for people who want to know Medoro, work with it or join it. */
const COMPANY: [typeof Check, string, string, string][] = [
  [Building2, "About Medoro", "Who we are, what we build and how we work.", "/about-medoro"],
  [Handshake, "Partners", "Refer pharmacies and distributors, and earn with Medoro.", "/partners"],
  [BriefcaseBusiness, "Careers", "Help build software for India’s pharma trade.", "/careers"],
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
  ["What is Medoro?", "Medoro is an Indian software company that builds business software only for the pharma trade: Medoro Pharmacy for medical stores, chains and hospital pharmacies, and Medoro Distribution for distributors, stockists and C&F agents."],
  ["What is the difference between Medoro Pharmacy and Medoro Distribution?", "Medoro Pharmacy is for retail: medical stores, chains and hospital pharmacies that sell to patients at a counter. Medoro Distribution is for wholesale: distributors, stockists and C&F agents that sell to chemists on credit, with orders, picking, dispatch, schemes and collections. They are separate products with separate plans."],
  ["Is Medoro made in India?", "Yes. Medoro is designed and built in India, only for the Indian pharma trade: GST, drug schedules, batch and expiry rules, PTR and PTS, distributor schemes, UPI and Hindi are part of the product, not settings you add later."],
  ["Where is my business data kept?", "On infrastructure you control: a PC in your shop, your own server or your own cloud account. Medoro’s servers keep your account, plan and licence, never your invoices, stock or patient records. You can export everything, any time."],
  ["How do I get started?", "Pick the product that fits your business and start its 7-day free trial, or book a demo on WhatsApp and we’ll walk you through it with your own workflow."],
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
        {/* Hero: the company, in one line, over the street-of-pharmacies video. */}
        <section aria-labelledby="hero-title" className="site-dark relative overflow-hidden bg-[#061412] text-white min-[1000px]:min-h-[calc(100svh-65px)] min-[1000px]:flex min-[1000px]:items-center">
          <HeroVideo />
          <div className={`relative w-full ${wrap} pt-[clamp(48px,7vw,88px)] pb-[clamp(72px,9vw,120px)] flex flex-col items-center text-center gap-6`}>
            <span className="site-up inline-flex items-center gap-2 rounded-full bg-white/12 backdrop-blur border border-white/25 px-3.5 py-1.5 text-[14px] font-semibold text-[#8FF0DD]"><Flag size={15} aria-hidden />{t("Made in India, for Indian pharma")}</span>
            <h1 id="hero-title" className="m-0 flex flex-col gap-4 items-center">
              <span className="site-up text-[15px] font-medium text-[#D3E2DF] [--d:1]">{t("Medoro: pharma software for Indian pharmacies and distributors")}</span>
              <span className="site-display site-up block text-[clamp(40px,6vw,76px)] leading-[1.04] max-w-[1000px] [--d:1] [text-shadow:0_2px_24px_rgba(0,0,0,.35)]">
                <span className="block">{t("Business software for")}</span>
                <span className="block text-[#5EEAD4]">{t("India’s pharma trade.")}</span>
              </span>
            </h1>
            <p className="site-up m-0 text-[clamp(17px,1.5vw,20px)] leading-[1.6] text-[#E2ECEA] max-w-[760px] [--d:2] [text-shadow:0_1px_12px_rgba(0,0,0,.5)]">{t("Medoro builds software for the businesses that keep medicines moving across India: the medical store on the corner and the distributor who supplies it.")}</p>
            <div className="site-up flex gap-3 flex-wrap justify-center pt-1 [--d:3]">
              <a href="#products" className="site-link-arrow inline-flex items-center gap-2 h-12 px-5 rounded-lg bg-[var(--s-brand)] text-white text-[16px] font-semibold transition-colors hover:bg-[var(--s-brand-ink)] hover:text-white">{t("Explore our products")}<ArrowRight size={18} aria-hidden /></a>
              <a href={WA_DEMO} className="inline-flex items-center gap-2 h-12 px-5 rounded-lg bg-white text-[var(--s-ink)] text-[16px] font-semibold transition-colors hover:text-[var(--s-ink)] hover:opacity-90"><MessageCircle size={18} aria-hidden />{t("Book a demo")}</a>
            </div>
          </div>
        </section>

        {/* The company's promises. */}
        <section aria-label={t("Why businesses trust Medoro")} className="border-b border-[var(--s-line)] bg-white">
          <ul className={`${wrap} m-0 list-none py-7 grid gap-x-6 gap-y-4 grid-cols-2 min-[720px]:grid-cols-3 min-[1100px]:grid-cols-5`}>
            {TRUST.map(([Icon, l], i) => (
              <li key={l} data-reveal style={{ ["--d" as string]: i }} className="flex items-center gap-2.5 text-[15.5px] font-semibold text-[var(--s-ink)]"><span className="size-9 rounded-lg bg-[var(--s-brand-tint)] flex items-center justify-center flex-none"><Icon size={18} aria-hidden className="text-[var(--s-brand)]" /></span>{t(l)}</li>
            ))}
          </ul>
        </section>

        {/* About the company */}
        <section id="about" aria-labelledby="about-title" className="relative overflow-hidden">
          <Aurora />
          <div className={`relative ${wrap} py-[clamp(72px,10vw,128px)] grid grid-cols-12 gap-x-6 gap-y-10 items-start`}>
          <div data-reveal className="col-span-12 min-[1000px]:col-span-5 flex flex-col gap-5">
            <span className={eyebrow}>{t("About Medoro")}</span>
            <h2 id="about-title" className={h2}>{t("One Indian company. One job: pharma.")}</h2>
            <SupplyChainArt className="w-full max-w-[460px] h-auto mt-3 drop-shadow-[0_18px_30px_rgba(11,94,91,.10)]" />
          </div>
          <div data-reveal className="col-span-12 min-[1000px]:col-span-6 min-[1000px]:col-start-7 flex flex-col gap-5">
            <p className={lead}>{t("India’s pharma trade runs on thousands of medical stores and the distributors who supply them. Most of them still work with software that was built for any shop, or with paper. Medoro exists to change that.")}</p>
            <p className={lead}>{t("We build business software only for this trade, designed in India around Indian law and the way chemists and distributors actually work, in English and हिंदी. Your business data stays with you, and our team is a WhatsApp message away.")}</p>
            <a href="/about-medoro" className="site-link-arrow self-start inline-flex items-center gap-1.5 text-[16px] font-semibold text-[var(--s-brand)] underline underline-offset-4 decoration-[var(--s-brand)]/30 hover:decoration-[var(--s-brand)]">{t("More about Medoro")}<ArrowRight size={16} aria-hidden /></a>
          </div>
          <dl className="col-span-12 m-0 grid grid-cols-1 min-[720px]:grid-cols-3 border-y border-[var(--s-line)]">
            {FACTS.map(([n, d], i) => (
              <div key={d} data-reveal style={{ ["--d" as string]: i }} className={`flex flex-col gap-2 py-8 min-[720px]:px-6 ${i > 0 ? "min-[720px]:border-l max-[719px]:border-t border-[var(--s-line)]" : "min-[720px]:pl-0"}`}>
                <dt className="site-display text-[clamp(44px,5vw,64px)] leading-none text-[var(--s-brand)]">{n}</dt>
                <dd className="m-0 text-[16px] text-[var(--s-ink-2)]">{t(d)}</dd>
              </div>
            ))}
          </dl>
          </div>
        </section>

        {/* Products */}
        <section id="products" aria-labelledby="products-title" className="bg-[var(--s-soft)] border-y border-[var(--s-line)]">
          <div className={`${wrap} py-[clamp(72px,10vw,128px)] flex flex-col gap-10`}>
            <div className="grid grid-cols-12 gap-x-6 gap-y-5 items-end">
              <div data-reveal className="col-span-12 min-[1000px]:col-span-7 flex flex-col gap-5">
                <span className={eyebrow}>{t("Our products")}</span>
                <h2 id="products-title" className={h2}>{t("Two products. One for each side of the trade.")}</h2>
              </div>
              <p data-reveal className={`${lead} col-span-12 min-[1000px]:col-span-5`}>{t("Each product has its own page with features, plans and a free trial.")}</p>
            </div>
            <div className="grid gap-5 min-[900px]:grid-cols-2">
              {PRODUCTS_LIST.map((f, i) => {
                const dark = i === 1;
                return (
                  <article key={f.id} data-reveal style={{ ["--d" as string]: i }} className={`site-lift relative overflow-hidden rounded-2xl p-[clamp(24px,3.4vw,40px)] flex flex-col gap-5 ${dark ? "site-dark bg-[var(--s-dark)] text-white" : "bg-white border border-[var(--s-line)]"}`}>
                    {dark ? <div aria-hidden className="absolute inset-0"><Aurora dark /></div> : null}
                    <span className={`relative size-14 rounded-xl flex items-center justify-center ${dark ? "bg-white/10 text-[#8FD3C6]" : "bg-[var(--s-brand-tint)] text-[var(--s-brand)]"}`}><f.Icon size={28} aria-hidden /></span>
                    <div className="relative flex flex-col gap-1.5">
                      <h3 className="m-0 text-[28px] font-semibold tracking-[-.01em]">{t(f.name)}</h3>
                      <span className={`text-[15.5px] ${dark ? "text-[#B5C7C3]" : "text-[var(--s-muted)]"}`}>{t(f.for)}</span>
                    </div>
                    <p className={`relative m-0 text-[18px] ${dark ? "text-[#E2ECEA]" : "text-[var(--s-ink)]"}`}>{t(f.line)}</p>
                    <ul className="relative m-0 p-0 list-none flex flex-col gap-2.5">
                      {f.points.map((x) => <li key={x} className={`flex gap-2.5 items-start text-[16px] ${dark ? "text-[#D3E2DF]" : "text-[var(--s-ink-2)]"}`}><Check size={17} aria-hidden className={`${dark ? "text-[#4ADE80]" : "text-[var(--s-brand)]"} mt-[4px] flex-none`} />{t(x)}</li>)}
                    </ul>
                    <a href={f.href} className={`relative mt-auto self-start site-link-arrow inline-flex items-center gap-2 h-12 px-5 rounded-lg text-[15.5px] font-semibold transition-colors ${dark ? "bg-white text-[var(--s-ink)] hover:text-[var(--s-ink)]" : "bg-[var(--s-brand)] text-white hover:bg-[var(--s-brand-ink)] hover:text-white"}`}>{t("Explore {name}", { name: f.name })}<ArrowRight size={18} aria-hidden /></a>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* Why Medoro */}
        <section id="why" aria-labelledby="why-title" className="relative overflow-hidden">
          <Aurora />
          <div aria-hidden className="absolute inset-0 opacity-50"><FloatingShapes /></div>
          <div className={`relative ${wrap} py-[clamp(72px,10vw,128px)] flex flex-col gap-12`}>
          <div data-reveal className="flex flex-col gap-5 max-w-[760px]">
            <span className={eyebrow}>{t("Why Medoro")}</span>
            <h2 id="why-title" className={h2}>{t("Why businesses choose Medoro.")}</h2>
          </div>
          <ol className="m-0 p-0 list-none grid gap-x-10 gap-y-12 min-[720px]:grid-cols-2 min-[1100px]:grid-cols-3">
            {WHY.map(([Icon, title, d], i) => (
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

        {/* Who we serve */}
        <section id="serve" aria-labelledby="serve-title" className="relative overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute inset-0 site-dots opacity-70" />
          <div aria-hidden className="pointer-events-none absolute -right-24 top-10 size-[340px] rounded-full bg-[#F5C451]/15 blur-[70px]" />
          <div aria-hidden className="pointer-events-none absolute -left-24 bottom-0 size-[320px] rounded-full bg-[#14B8A6]/12 blur-[70px]" />
          <div className={`relative ${wrap} py-[clamp(72px,10vw,128px)] flex flex-col gap-10`}>
          <div data-reveal className="flex flex-col gap-5 max-w-[760px]">
            <span className={eyebrow}>{t("Who we serve")}</span>
            <h2 id="serve-title" className={h2}>{t("Built for every business in the medicine supply chain.")}</h2>
          </div>
          <ul className="m-0 p-0 list-none grid gap-4 min-[640px]:grid-cols-2 min-[1000px]:grid-cols-3">
            {SERVE.map(([Icon, who, product, href], i) => (
              <li key={who} data-reveal style={{ ["--d" as string]: i % 3 }}>
                <a href={href} className="site-lift group h-full flex items-center gap-4 rounded-xl border border-[var(--s-line)] bg-white p-5 text-[var(--s-ink)] hover:border-[var(--s-brand)] hover:text-[var(--s-ink)]">
                  <span className="size-12 rounded-xl bg-[var(--s-brand-tint)] flex items-center justify-center flex-none"><Icon size={22} aria-hidden className="text-[var(--s-brand)]" /></span>
                  <span className="flex flex-col gap-0.5 min-w-0"><span className="text-[17px] font-semibold">{t(who)}</span><span className="text-[14.5px] text-[var(--s-muted)]">{t(product)}</span></span>
                  <ArrowRight size={18} aria-hidden className="ml-auto flex-none text-[var(--s-brand)] transition-transform group-hover:translate-x-1" />
                </a>
              </li>
            ))}
          </ul>
          </div>
        </section>

        {/* Security and data ownership */}
        <section aria-labelledby="trust-title" className="bg-[var(--s-soft)] border-y border-[var(--s-line)]">
          <div className={`${wrap} py-[clamp(72px,10vw,128px)] grid grid-cols-12 gap-x-6 gap-y-10 items-center`}>
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
          </div>
        </section>

        {/* Company */}
        <section id="company" aria-labelledby="company-title" className="relative overflow-hidden">
          <Aurora />
          <div className={`relative ${wrap} py-[clamp(72px,10vw,128px)] flex flex-col gap-10`}>
          <div data-reveal className="flex flex-col gap-5 max-w-[760px]">
            <span className={eyebrow}>{t("Company")}</span>
            <h2 id="company-title" className={h2}>{t("Get to know Medoro.")}</h2>
          </div>
          <ul className="m-0 p-0 list-none grid gap-5 min-[900px]:grid-cols-3">
            {COMPANY.map(([Icon, title, d, href], i) => (
              <li key={href} data-reveal style={{ ["--d" as string]: i }}>
                <a href={href} className="site-lift group h-full flex flex-col gap-3 rounded-2xl border border-[var(--s-line)] bg-white p-7 text-[var(--s-ink)] hover:border-[var(--s-brand)] hover:text-[var(--s-ink)]">
                  <Icon size={26} aria-hidden className="text-[var(--s-brand)]" />
                  <span className="text-[20px] font-semibold">{t(title)}</span>
                  <span className="text-[15.5px] text-[var(--s-ink-2)]">{t(d)}</span>
                  <span className="mt-auto pt-2 inline-flex items-center gap-1.5 text-[15px] font-semibold text-[var(--s-brand)]">{t("Learn more")}<ArrowRight size={16} aria-hidden className="transition-transform group-hover:translate-x-1" /></span>
                </a>
              </li>
            ))}
          </ul>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" aria-labelledby="faq-title" className="border-t border-[var(--s-line)]">
          <div className={`${wrap} py-[clamp(72px,10vw,128px)] grid grid-cols-12 gap-x-6 gap-y-10`}>
            <div className="col-span-12 min-[1000px]:col-span-4 flex flex-col gap-5 min-[1000px]:sticky min-[1000px]:top-28 self-start">
              <span className={eyebrow}>{t("FAQ")}</span>
              <h2 id="faq-title" className={h2}>{t("About Medoro")}</h2>
              <p className="m-0 text-[16.5px] text-[var(--s-ink-2)]">{t("Questions about a product? Each product page has its own FAQ, or message us on WhatsApp.")}</p>
              <HelpArt className="w-full max-w-[340px] h-auto mt-2 max-[999px]:hidden" />
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

        {/* Contact */}
        <section id="contact" aria-labelledby="contact-title" className={`${wrap} pb-[clamp(72px,10vw,128px)]`}>
          <div data-reveal className="site-dark relative overflow-hidden rounded-2xl bg-[var(--s-dark)] text-white p-[clamp(28px,5vw,64px)] grid grid-cols-12 gap-x-6 gap-y-8 items-center">
            <Aurora dark />
            <div className="relative col-span-12 min-[1000px]:col-span-7 flex flex-col gap-4">
              <h2 id="contact-title" className="site-display m-0 text-[clamp(30px,3.8vw,48px)]">{t("Let’s talk about your business.")}</h2>
              <p className="m-0 text-[18px] text-[#C3D3D0] max-w-[560px]">{t("Tell us how you work today. We’ll show you Medoro with your own workflow, and help you move across when you’re ready.")}</p>
            </div>
            <div className="relative col-span-12 min-[1000px]:col-span-5 flex flex-col gap-3">
              <a href={WA_DEMO} className="site-link-arrow inline-flex items-center justify-center gap-2 h-12 px-5 rounded-lg bg-white text-[var(--s-ink)] text-[16px] font-semibold hover:text-[var(--s-ink)]"><MessageCircle size={18} aria-hidden />{t("Book a demo on WhatsApp")}</a>
              <a href={`mailto:${BRAND.email}`} className="inline-flex items-center justify-center gap-2 h-12 px-5 rounded-lg border border-white/40 text-white text-[16px] font-semibold hover:border-white hover:text-white"><Mail size={18} aria-hidden />{BRAND.email}</a>
              <span className="text-center text-[14px] text-[#9FB5B1]">{t(BRAND.supportHours)}</span>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
      <WhatsAppFab />
    </div>
  );
}

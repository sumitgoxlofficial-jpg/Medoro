import type { Metadata } from "next";
import {
  ArrowRight, Check, CloudOff, Download, FileCheck, HardDriveUpload, KeyRound, Languages, Layers, Lock, MessageCircle, Monitor, Plus,
  ReceiptIndianRupee, ScrollText, Server, ShieldCheck, Stethoscope, UserCheck, Users, Database,
} from "lucide-react";
import { SiteFooter, SiteHeader, SiteMotion, WhatsAppFab, WA_DEMO } from "@/components/site/chrome";
import { FeatureTabs, Hero, Marquee, Pricing } from "@/components/site/interactive";
import { PRODUCTS } from "@/staff/constants";

const SITE = process.env.APP_URL ?? "https://medoro.in";
const TITLE = "Medoro · Pharmacy billing, batch stock and GST for Indian medical stores";
const DESC = "Billing with FEFO batches, expiry control, purchases, GST and accounts, WhatsApp invoices and offline billing for Indian medical stores and small chains. Runs on infrastructure you control. 7-day free trial.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESC,
  alternates: { canonical: "/" },
  openGraph: { type: "website", url: "/", siteName: "Medoro", title: TITLE, description: DESC, locale: "en_IN" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESC },
};

const STANDARDS: [typeof Check, string, string][] = [
  [ReceiptIndianRupee, "GST", "MRP-inclusive, CGST, SGST and IGST"],
  [Stethoscope, "Schedule H & H1", "Prescriber captured on the bill"],
  [Layers, "FEFO", "Earliest expiry sells first"],
  [UserCheck, "DPDP", "Customer consent on record"],
  [CloudOff, "Offline", "Billing on the shop network"],
  [Languages, "हिंदी", "Full Hindi interface"],
];
const WORKS_WITH = ["WhatsApp Business API", "Google Drive", "UPI", "Tally", "Excel and CSV", "80 mm thermal printers", "Barcode scanners", "Windows", "macOS", "Linux", "Chrome on any device"];

const LEAKS: [string, string, string][] = [
  ["Stock that expires on the shelf", "Batches expiring in the next 90 days are listed with the loss they will cause, early enough to return them to the distributor or move them to a branch that sells them.", "/#product"],
  ["A queue at the counter", "Keyboard-first billing with brand, salt and barcode search. The batch is picked for you and prescription details are asked only when the medicine needs them.", "/#product"],
  ["Month-end GST and the CA’s calls", "Every bill already carries its taxable value and tax split. Summaries are ready on the 1st, and your CA gets exports in the format they use.", "/#product"],
  ["Not knowing the numbers when you’re away", "Sales, cash, margin and dues for every branch on your phone, with the expiry and low-stock lists that need your attention.", "/#product"],
];

const KEYS: [string, string, string][] = [["F2", "Search", "dolo"], ["Enter", "Add to bill", "Dolo 650 · batch DL24091 · exp 05/2027"], ["F9", "Complete sale", "INV/25-26/0418 · ₹67.20 · UPI"]];

const COMPARE: [string, string, string][] = [
  ["Where you can use it", "Usually one PC in the shop", "Every counter, a tablet and your phone"],
  ["Backups", "A pen drive, if someone remembers", "Encrypted daily to your own Google Drive, with test restores"],
  ["Expiry", "A report to print and go through", "90-day warning with projected loss and a return or transfer suggestion"],
  ["Customer invoices", "Printed only", "Printed, or a PDF on WhatsApp with delivery status"],
  ["GST month-end", "Exported and reworked in Excel", "Summaries ready on the 1st, exports for Tally"],
  ["Owner away from the shop", "Call the shop and ask", "Live sales, cash and dues on your phone"],
  ["Language", "English", "English and हिंदी; the assistant understands Hinglish"],
  ["Your data", "On that PC, in the vendor’s format", "On infrastructure you control, full export any time"],
];

const STEPS: [string, string, string][] = [
  ["Day 1, morning", "Export from your current software", "Most pharmacy software can export stock, batches, suppliers and customers to Excel. Send us the file on WhatsApp or keep it for the next step."],
  ["Day 1, afternoon", "Import and check", "Medoro checks every row: expiry, GST rate, MRP against cost. Problems are listed by row and nothing is imported until the file is clean."],
  ["Day 1, evening", "Set up the counters", "Connect the thermal printer and barcode scanner, add your staff with PINs and roles, and do a few test bills."],
  ["Day 2", "Go live", "Bill on Medoro from opening time. Keep the old software for reference as long as you like. We are on WhatsApp from 9 am to 9 pm."],
];

const ENV: [typeof Check, string][] = [[Monitor, "Counters, tablets and phones"], [Server, "Medoro app"], [Database, "Your database"]];
const OUTSIDE: [typeof Check, string, string][] = [[HardDriveUpload, "Your Google Drive", "Encrypted backups Google can’t read"], [MessageCircle, "WhatsApp", "The customer’s number and invoice PDF, when you send one"], [KeyRound, "Medoro", "Your account, plan and licence check-ins"]];
const SEC: [typeof Check, string, string][] = [
  [Users, "Roles and permissions", "Cashiers bill. Managers approve discounts and refunds. Owners see everything."],
  [ShieldCheck, "Two-step sign-in", "Required for owners and managers. Lost devices can be signed out remotely."],
  [ScrollText, "Tamper-evident audit trail", "Every void, discount, refund and stock adjustment is logged with who and when."],
  [Lock, "Encrypted backups", "Encrypted before they leave your computer. Only your recovery key opens them."],
  [FileCheck, "Consent records", "WhatsApp opt-in and opt-out recorded per customer, with the date and method."],
  [Download, "Leave any time", "Full JSON export, CSV reports for your CA, and backups only your key opens."],
];

const FAQ: { title: string; items: [string, string][] }[] = [
  { title: "Product", items: [
    ["Does Medoro handle GST billing?", "Yes. Prices are MRP-inclusive and Medoro works out the taxable value with the CGST and SGST split, or IGST for out-of-state parties, on every line. Invoices are numbered per branch and financial year. Month-end GST summaries and exports are ready for your CA. Have your CA confirm the setup for your business."],
    ["Can it stop expired medicines from being sold?", "Yes. Billing picks the earliest-expiring sellable batch automatically. Expired, quarantined and recalled batches are blocked on the server, even if someone tries to add them by hand."],
    ["Does it work without internet?", "Yes, when Medoro runs on a PC in your shop: every counter on the shop network keeps billing while the internet is down, and WhatsApp messages and backups go out when it is back. Installed counters can also bill offline and sync when they reconnect."],
    ["Do I need to install anything?", "Install the desktop app for Windows, macOS or Linux on the shop PC, or open Medoro in Chrome on any PC, tablet or phone."],
    ["Can my staff use it in Hindi?", "Yes. Each person can switch the interface between English and हिंदी. The assistant understands English, Hindi and Hinglish."]] },
  { title: "Data and privacy", items: [
    ["Where is my data stored?", "In a database you control: a PC in your shop, your own server or your own cloud account. Medoro’s servers hold only your account, plan, licence and the support tickets you send. You can export everything, any time."],
    ["What leaves my server?", "Only what you turn on. Medoro’s licence server gets your pharmacy name and owner contact once, then the app version and branch and counter counts at each check-in. WhatsApp gets the customer number and the invoice PDF. Google Drive gets encrypted backup files it cannot read. Outside AI is off unless you switch it on, and the settings show exactly what would be sent."],
    ["Does the AI give medical advice?", "No. It answers business questions about sales, stock, expiry and dues. It refuses dosage or treatment questions and refers them to the pharmacist."]] },
  { title: "Switching and pricing", items: [
    ["Can I move my data from my current software?", "Yes. Export medicines, batches, suppliers and customers to Excel or CSV from your current software and import them into Medoro. Every row is checked and nothing is imported until the file is clean. Assisted migration is available as a one-time service."],
    ["How long is the free trial?", "7 days, no card needed. After that there are 7 days of grace, then Medoro turns read-only until you pay: your data stays where it is, and viewing, exports and backups keep working. Pay online by UPI, card or netbanking from the Subscription page. Plans never renew on their own."],
    ["How do I cancel?", "In the app, open Subscription and choose Cancel subscription, any time. The plan stays active until the end of the paid period, then the software goes read-only. Your data stays on your server and can always be exported."]] },
];

const eyebrow = "text-[14px] font-semibold text-[var(--s-brand)]";
const h2 = "site-display m-0 text-[clamp(34px,4.4vw,56px)] text-[var(--s-ink)]";
const lead = "m-0 text-[clamp(17px,1.4vw,19px)] leading-[1.6] text-[var(--s-ink-2)]";
const wrap = "max-w-[1200px] mx-auto px-6 max-[640px]:px-4";

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Medoro",
  applicationCategory: "BusinessApplication",
  applicationSubCategory: "Pharmacy management software",
  operatingSystem: "Windows, macOS, Linux, Web browser",
  description: DESC,
  url: SITE,
  inLanguage: ["en-IN", "hi-IN"],
  offers: {
    "@type": "AggregateOffer", priceCurrency: "INR", offerCount: 3,
    lowPrice: Math.min(...PRODUCTS.filter((p) => ["starter", "pro", "multi"].includes(p.id)).map((p) => p.m)),
    highPrice: Math.max(...PRODUCTS.filter((p) => ["starter", "pro", "multi"].includes(p.id)).map((p) => p.m)),
  },
  publisher: { "@type": "Organization", name: "Medoro", url: SITE, email: "hello@medoro.in", areaServed: "IN" },
};

export default function Home() {
  return (
    <div className="site-root bg-white overflow-x-clip">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:bg-white focus:px-4 focus:py-2 focus:rounded-lg focus:shadow">Skip to content</a>
      <SiteHeader />
      <SiteMotion />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />

      <main id="main">
        <Hero />

        <section aria-labelledby="standards-title" className="border-b border-[var(--s-line)]">
          <div className={`${wrap} py-14 flex flex-col gap-10`}>
            <h2 id="standards-title" className="m-0 text-[15px] font-semibold text-[var(--s-ink)]">Built for how Indian pharmacies work</h2>
            <ul className="m-0 p-0 list-none grid gap-x-8 gap-y-6 border-y border-[var(--s-line)] py-7 grid-cols-2 min-[720px]:grid-cols-3 min-[1100px]:grid-cols-6">
              {STANDARDS.map(([Icon, t, d], i) => (
                <li key={t} data-reveal style={{ ["--d" as string]: i }} className="flex flex-col gap-1.5">
                  <span className="flex items-center gap-2 text-[17px] font-semibold text-[var(--s-ink)]"><Icon size={18} aria-hidden className="text-[var(--s-brand)]" />{t}</span>
                  <span className="text-[15px] text-[var(--s-muted)]">{d}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-6 max-[720px]:flex-col max-[720px]:items-stretch max-[720px]:gap-3">
              <span className="text-[14px] text-[var(--s-muted)] whitespace-nowrap">Works with</span>
              <div className="flex-1 min-w-0"><Marquee items={WORKS_WITH} /></div>
            </div>
          </div>
        </section>

        <section aria-labelledby="leaks-title" className={`${wrap} py-[clamp(72px,10vw,128px)] grid grid-cols-12 gap-x-6 gap-y-12`}>
          <div className="col-span-12 min-[1000px]:col-span-5 flex flex-col gap-5 min-[1000px]:sticky min-[1000px]:top-28 self-start">
            <span className={eyebrow}>Why owners switch</span>
            <h2 id="leaks-title" className={h2}>Where a medical store quietly loses money.</h2>
            <p className={lead}>Most of it is not theft or bad luck. It is stock nobody noticed, a slow counter on a busy evening, and hours lost to GST every month.</p>
          </div>
          <ol className="col-span-12 min-[1000px]:col-span-6 min-[1000px]:col-start-7 m-0 p-0 list-none flex flex-col">
            {LEAKS.map(([t, d], i) => (
              <li key={t} data-reveal className="grid grid-cols-[56px_minmax(0,1fr)] max-[640px]:grid-cols-1 gap-x-4 gap-y-2 py-8 border-t border-[var(--s-line)] last:border-b">
                <span className="site-num text-[15px] text-[var(--s-brand)] pt-1">{String(i + 1).padStart(2, "0")}</span>
                <div className="flex flex-col gap-2">
                  <h3 className="m-0 text-[22px] font-semibold tracking-[-.01em] text-[var(--s-ink)]">{t}</h3>
                  <p className="m-0 text-[16.5px] text-[var(--s-ink-2)]">{d}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="keys-title" className="site-dark bg-[var(--s-dark)] text-white">
          <div className={`${wrap} py-[clamp(64px,8vw,104px)] grid grid-cols-12 gap-x-6 gap-y-10 items-center`}>
            <div className="col-span-12 min-[1000px]:col-span-5 flex flex-col gap-5">
              <span className="text-[14px] font-semibold text-[#8FD3C6]">At the counter</span>
              <h2 id="keys-title" className="site-display m-0 text-[clamp(34px,4.4vw,56px)]">A bill in three keys.</h2>
              <p className="m-0 text-[18px] leading-[1.6] text-[#C3D3D0]">Your staff never reach for the mouse. Search, add, finish. Medoro picks the batch that expires first and skips anything expired or quarantined.</p>
            </div>
            <div data-play className="site-keys col-span-12 min-[1000px]:col-span-6 min-[1000px]:col-start-7">
              <ol className="m-0 p-0 list-none flex flex-col gap-3">
                {KEYS.map(([k, label, out], i) => (
                  <li key={k} data-step style={{ ["--step" as string]: i }} className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-5 bg-white/[.04] border border-white/10 rounded-xl px-5 py-4 max-[480px]:grid-cols-1 max-[480px]:gap-2">
                    <kbd data-step style={{ ["--step" as string]: i }} className="site-num justify-self-start inline-flex items-center justify-center min-w-[64px] h-11 px-3 rounded-lg bg-white text-[var(--s-ink)] text-[16px] font-medium border border-[#C9D1CF] shadow-[0_2px_0_#C9D1CF]">{k}</kbd>
                    <span className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-[14px] text-[#9FB5B1]">{label}</span>
                      <span className="site-num text-[16px] text-white break-words">{out}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section id="product" aria-labelledby="product-title" className={`${wrap} pt-[clamp(72px,10vw,128px)] pb-[clamp(56px,8vw,96px)] flex flex-col gap-12`}>
          <div data-reveal className="flex flex-col gap-5 max-w-[760px]">
            <span className={eyebrow}>The product</span>
            <h2 id="product-title" className={h2}>One system for the counter, the godown and your CA.</h2>
            <p className={lead}>Real screens from a Pune pharmacy’s day, not mock-ups. Pick an area to see how it works.</p>
          </div>
          <FeatureTabs />
        </section>

        <section aria-labelledby="facts-title" className="border-y border-[var(--s-line)] bg-[var(--s-soft)]">
          <h2 id="facts-title" className="sr-only">Medoro in numbers</h2>
          <div className={wrap}>
            <dl className="m-0 -mx-6 max-[640px]:-mx-4 grid grid-cols-2 min-[900px]:grid-cols-4">
              {([["7", "", "-day free trial", "No card. Your data stays if you leave."], ["999", "₹", " / month", "Starter plan for one store, GST included"], ["0", "", " records", "of your pharmacy kept on Medoro’s servers"], ["2", "", " languages", "English and हिंदी, Hinglish for the assistant"]] as const).map(([n, pre, suf, d], i) => (
                <div key={d} className={`flex flex-col gap-2 py-10 px-6 max-[640px]:px-4 max-[640px]:py-8 border-[var(--s-line)] ${i > 0 ? "min-[900px]:border-l" : ""} ${i % 2 ? "max-[899px]:border-l" : ""} ${i > 1 ? "max-[899px]:border-t" : ""}`}>
                  <dt className="flex items-baseline text-[var(--s-ink)]"><span className="site-display text-[clamp(40px,4.4vw,56px)] leading-none" data-count={n} data-prefix={pre}>{pre}{Number(n).toLocaleString("en-IN")}</span><span className={`text-[17px] font-medium ${suf.startsWith("-") ? "" : "ml-1.5"}`}>{suf}</span></dt>
                  <dd className="m-0 text-[15px] text-[var(--s-muted)]">{d}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section aria-labelledby="compare-title" className={`${wrap} py-[clamp(72px,10vw,128px)] flex flex-col gap-10`}>
          <div data-reveal className="flex flex-col gap-5 max-w-[760px]">
            <span className={eyebrow}>Compared</span>
            <h2 id="compare-title" className={h2}>What changes from the usual desktop billing software.</h2>
            <p className={lead}>Desktop software has served pharmacies well for years. This is what a store gets on top when billing, stock and accounts are connected.</p>
          </div>
          <div data-reveal className="max-[719px]:hidden">
            <table className="w-full border-collapse text-[16px]">
              <caption className="sr-only">Typical desktop pharmacy software compared with Medoro</caption>
              <thead>
                <tr className="text-left">
                  <th scope="col" className="w-[24%] py-4 pr-6 font-medium text-[14px] text-[var(--s-muted)] border-b-2 border-[var(--s-ink)]"><span className="sr-only">Area</span></th>
                  <th scope="col" className="w-[33%] py-4 pr-6 font-medium text-[14px] text-[var(--s-muted)] border-b-2 border-[var(--s-ink)]">Typical desktop software</th>
                  <th scope="col" className="py-4 font-semibold text-[15px] text-[var(--s-brand)] border-b-2 border-[var(--s-brand)]">Medoro</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map(([a, t, m]) => (
                  <tr key={a} className="align-top">
                    <th scope="row" className="py-4 pr-6 text-left font-semibold text-[var(--s-ink)] border-b border-[var(--s-line)]">{a}</th>
                    <td className="py-4 pr-6 text-[var(--s-muted)] border-b border-[var(--s-line)]">{t}</td>
                    <td className="py-4 text-[var(--s-ink)] border-b border-[var(--s-line)]"><span className="flex gap-2.5 items-start"><Check size={17} aria-hidden className="text-[var(--s-brand)] mt-[4px] flex-none" />{m}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="min-[720px]:hidden m-0 p-0 list-none flex flex-col border-t-2 border-[var(--s-ink)]">
            {COMPARE.map(([a, t, m]) => (
              <li key={a} className="py-5 border-b border-[var(--s-line)] flex flex-col gap-2">
                <span className="text-[17px] font-semibold text-[var(--s-ink)]">{a}</span>
                <span className="text-[15px] text-[var(--s-muted)]"><span className="font-medium">Typical: </span>{t}</span>
                <span className="flex gap-2.5 items-start text-[16px] text-[var(--s-ink)]"><Check size={17} aria-hidden className="text-[var(--s-brand)] mt-[4px] flex-none" /><span><span className="sr-only">Medoro: </span>{m}</span></span>
              </li>
            ))}
          </ul>
        </section>

        <section id="switching" aria-labelledby="switching-title" className="bg-[var(--s-soft)] border-y border-[var(--s-line)]">
          <div className={`${wrap} py-[clamp(72px,10vw,128px)] flex flex-col gap-14`}>
            <div className="grid grid-cols-12 gap-x-6 gap-y-6 items-end">
              <div data-reveal className="col-span-12 min-[1000px]:col-span-7 flex flex-col gap-5">
                <span className={eyebrow}>Switching</span>
                <h2 id="switching-title" className={h2}>Switch in an afternoon. Bill on Medoro the next morning.</h2>
              </div>
              <p data-reveal className={`${lead} col-span-12 min-[1000px]:col-span-5`}>No re-typing your catalogue. Bring your stock across from Excel, or let us do it with assisted migration.</p>
            </div>
            <ol className="m-0 p-0 list-none grid gap-x-6 gap-y-10 min-[720px]:grid-cols-2 min-[1100px]:grid-cols-4">
              {STEPS.map(([when, t, d], i) => (
                <li key={t} data-reveal style={{ ["--d" as string]: i }} className="flex flex-col gap-3 border-t-2 border-[var(--s-brand)] pt-5">
                  <span className="site-num text-[13.5px] text-[var(--s-brand)]">{String(i + 1).padStart(2, "0")} · {when}</span>
                  <h3 className="m-0 text-[21px] font-semibold tracking-[-.01em] text-[var(--s-ink)]">{t}</h3>
                  <p className="m-0 text-[16px] text-[var(--s-ink-2)]">{d}</p>
                </li>
              ))}
            </ol>
            <div data-reveal className="flex gap-4 flex-wrap items-center">
              <a href="/trial" className="site-link-arrow inline-flex items-center gap-2 h-12 px-5 rounded-lg bg-[var(--s-brand)] text-white text-[16px] font-semibold transition-colors hover:bg-[var(--s-brand-ink)] hover:text-white">Start the free trial<ArrowRight size={17} aria-hidden /></a>
              <span className="text-[15px] text-[var(--s-muted)]">Assisted setup and training: ₹{PRODUCTS.find((p) => p.id === "setup")!.m.toLocaleString("en-IN")} once. Stock migration from ₹2,999.</span>
            </div>
          </div>
        </section>

        <section id="security" aria-labelledby="security-title" className="site-dark bg-[var(--s-dark)] text-white">
          <div className={`${wrap} py-[clamp(72px,10vw,128px)] flex flex-col gap-16`}>
            <div className="grid grid-cols-12 gap-x-6 gap-y-12 items-center">
              <div data-reveal className="col-span-12 min-[1000px]:col-span-5 flex flex-col gap-5">
                <span className="text-[14px] font-semibold text-[#8FD3C6]">Security and data ownership</span>
                <h2 id="security-title" className="site-display m-0 text-[clamp(34px,4.4vw,56px)]">Your data, your Drive.</h2>
                <p className="m-0 text-[18px] leading-[1.6] text-[#C3D3D0]">Medoro runs on infrastructure you control: a PC in your shop, your own server or your own cloud account. Invoices, stock, customers and prescriptions stay there. Medoro sees your account and licence, nothing more.</p>
                <a href="#faq" className="site-link-arrow self-start text-[16px] font-semibold text-white underline underline-offset-4 decoration-white/40 hover:decoration-white hover:text-white flex gap-1.5 items-center">What exactly leaves my server?<ArrowRight size={16} aria-hidden /></a>
              </div>
              <div data-reveal className="col-span-12 min-[1000px]:col-span-6 min-[1000px]:col-start-7 flex flex-col gap-4" role="img" aria-label="Diagram: counters, the Medoro app and your database run in your environment. Only encrypted backups go to your Google Drive, invoice PDFs to WhatsApp when you send them, and account and licence details to Medoro.">
                <div className="rounded-xl border border-[#2C5A55] bg-white/[.03] p-5 flex flex-col gap-4">
                  <span className="text-[13px] font-semibold uppercase tracking-[.08em] text-[#8FD3C6] flex gap-2 items-center"><Lock size={14} aria-hidden />Your environment</span>
                  <div className="grid grid-cols-3 gap-3">
                    {ENV.map(([Icon, l]) => <div key={l} className="rounded-lg bg-white/[.06] border border-white/10 px-3 py-4 flex flex-col items-center gap-2 text-center text-[14px]"><Icon size={22} aria-hidden className="text-[#8FD3C6]" />{l}</div>)}
                  </div>
                </div>
                <div aria-hidden className="grid grid-cols-3 gap-3 justify-items-center max-[559px]:hidden">{[0, 1, 2].map((i) => <span key={i} className="w-px h-7 bg-[linear-gradient(#2C5A55,transparent)]" />)}</div>
                <div className="grid gap-3 min-[560px]:grid-cols-3">
                  {OUTSIDE.map(([Icon, l, d]) => <div key={l} className="rounded-lg border border-white/10 p-4 flex flex-col gap-1.5"><span className="text-[15px] font-semibold flex gap-2 items-center"><Icon size={16} aria-hidden className="text-[#9FB5B1]" />{l}</span><span className="text-[14px] text-[#9FB5B1]">{d}</span></div>)}
                </div>
              </div>
            </div>
            <ul className="m-0 p-0 list-none grid gap-x-10 min-[640px]:grid-cols-2 min-[1000px]:grid-cols-3">
              {SEC.map(([Icon, t, d], i) => (
                <li key={t} data-reveal style={{ ["--d" as string]: i % 3 }} className="border-t border-white/15 py-7 flex flex-col gap-2">
                  <span className="flex gap-2.5 items-center text-[17px] font-semibold"><Icon size={18} aria-hidden className="text-[#8FD3C6]" />{t}</span>
                  <span className="text-[15.5px] text-[#B5C7C3]">{d}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="pricing" aria-labelledby="pricing-title" className={`${wrap} py-[clamp(72px,10vw,128px)] flex flex-col gap-12`}>
          <div className="grid grid-cols-12 gap-x-6 gap-y-6 items-end">
            <div data-reveal className="col-span-12 min-[1000px]:col-span-7 flex flex-col gap-5">
              <span className={eyebrow}>Pricing</span>
              <h2 id="pricing-title" className={h2}>Plain prices in rupees. 7 days free.</h2>
            </div>
            <p data-reveal className={`${lead} col-span-12 min-[1000px]:col-span-5`}>Prices include 18% GST. Pay by UPI, card or netbanking. Cancel any time and your data stays where it is.</p>
          </div>
          <Pricing />
          <p className="m-0 text-[13.5px] text-[var(--s-muted)] max-w-[820px]">Launch prices in Indian rupees, including 18% GST. Yearly plans are billed upfront. WhatsApp messages are subject to Meta’s conversation charges. Hosting your own server or cloud is billed separately by your provider.</p>
        </section>

        <section id="faq" aria-labelledby="faq-title" className="border-t border-[var(--s-line)]">
          <div className={`${wrap} py-[clamp(72px,10vw,128px)] grid grid-cols-12 gap-x-6 gap-y-10`}>
            <div className="col-span-12 min-[1000px]:col-span-4 flex flex-col gap-5 min-[1000px]:sticky min-[1000px]:top-28 self-start">
              <span className={eyebrow}>FAQ</span>
              <h2 id="faq-title" className={h2}>Questions owners ask us.</h2>
              <p className="m-0 text-[16.5px] text-[var(--s-ink-2)]">Something else? Message us on WhatsApp and someone who knows pharmacy billing will reply.</p>
              <a href={WA_DEMO} className="self-start inline-flex items-center gap-2 h-11 px-4 rounded-lg border border-[#C9D1CF] text-[15px] font-semibold text-[var(--s-ink)] hover:border-[var(--s-ink)] hover:text-[var(--s-ink)]"><MessageCircle size={16} aria-hidden className="text-[#146C43]" />Ask on WhatsApp</a>
            </div>
            <div className="site-faq col-span-12 min-[1000px]:col-span-7 min-[1000px]:col-start-6 flex flex-col gap-10">
              {FAQ.map((g) => (
                <div key={g.title} className="flex flex-col">
                  <h3 className="m-0 pb-3 text-[13px] font-semibold uppercase tracking-[.08em] text-[var(--s-muted)]">{g.title}</h3>
                  {g.items.map(([q, a]) => (
                    <details key={q} name="faq" className="border-t border-[var(--s-line)] last:border-b">
                      <summary className="flex justify-between items-center gap-6 py-5 text-[18px] font-semibold text-[var(--s-ink)] rounded-md">
                        {q}<Plus size={20} aria-hidden className="site-plus flex-none text-[var(--s-brand)]" />
                      </summary>
                      <p className="m-0 pb-6 pr-10 text-[16.5px] text-[var(--s-ink-2)]">{a}</p>
                    </details>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="cta-title" className={`${wrap} pb-[clamp(72px,10vw,128px)]`}>
          <div data-reveal className="rounded-2xl bg-[var(--s-brand)] text-white px-[clamp(24px,6vw,72px)] py-[clamp(48px,7vw,88px)] grid grid-cols-12 gap-x-6 gap-y-8 items-end">
            <div className="col-span-12 min-[1000px]:col-span-8 flex flex-col gap-4">
              <h2 id="cta-title" className="site-display m-0 text-[clamp(34px,4.4vw,56px)]">Set up your counter this afternoon.</h2>
              <p className="m-0 text-[18px] text-[#D3EAE6] max-w-[600px]">Start the 7-day trial, import your stock from Excel, and bill on Medoro tomorrow. We help on WhatsApp all the way.</p>
            </div>
            <div className="col-span-12 min-[1000px]:col-span-4 flex flex-col gap-3 min-[1000px]:justify-self-end min-[1000px]:w-[280px]">
              <a href="/trial" className="site-link-arrow w-full inline-flex items-center justify-center gap-2 h-12 px-6 rounded-lg bg-white text-[var(--s-brand-ink)] text-[16px] font-semibold transition-colors hover:bg-[#E7F2F0] hover:text-[var(--s-brand-ink)]">Start 7-day free trial<ArrowRight size={17} aria-hidden /></a>
              <a href={WA_DEMO} className="w-full inline-flex items-center justify-center gap-2 h-12 px-6 rounded-lg border border-white/40 text-white text-[16px] font-semibold transition-colors hover:bg-white/10 hover:text-white"><MessageCircle size={17} aria-hidden />Get a demo on WhatsApp</a>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
      <WhatsAppFab />
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight, Check, ScanBarcode, Search, Hourglass, MessageCircle, FileScan, Landmark, CalendarRange, GitBranch, Sparkles,
  Layers, BadgeIndianRupee, CloudUpload, Lock, Monitor, Server, Database, HardDriveUpload, KeyRound, Users, ShieldCheck, ScrollText, FileCheck, Download,
} from "lucide-react";
import { SiteFooter, SiteHeader, Reveal, WhatsAppFab, WA } from "@/components/site/chrome";
import { Faq, Pricing } from "@/components/site/interactive";

export const metadata: Metadata = {
  title: "Medoro · Pharmacy billing, stock & accounts",
  description: "GST billing with FEFO batches, expiry prevention, purchases, accounts and WhatsApp invoices for Indian pharmacies. Your records stay on your own server. 14-day free trial.",
};

const MARQUEE = [[ScanBarcode, "Barcode billing"], [Layers, "FEFO batch picking"], [BadgeIndianRupee, "MRP-inclusive GST"], [MessageCircle, "WhatsApp PDF invoices"], [Hourglass, "Expiry loss prevention"], [FileScan, "Supplier bill scanner"], [Landmark, "Day book & P&L"], [Sparkles, "Hinglish AI manager"], [GitBranch, "Multi-branch transfers"], [CloudUpload, "Encrypted Drive backups"]] as const;
const TRUST = ["14-day free trial", "No card needed", "Pay by UPI or bank transfer", "GST-ready", "CSV reports for your CA", "DPDP-ready consent"];
const FACTS = [["FEFO", "Earliest-expiring batch picked on every bill"], ["GST", "MRP-inclusive, CGST and SGST split, CSV for your CA"], ["हिंदी", "Ask the AI in English, Hindi or Hinglish"], ["0", "Pharmacy records kept on Medoro’s servers"]];
const POS = ["Brand, salt or barcode search", "Cash, UPI, card and split", "Held carts and credit sales", "A4 and thermal receipts", "Returns and credit notes", "Shift cash reconciliation"];
const TILES = [
  [Hourglass, "Expiry loss prevention", "See which batches won’t sell in time. Return them to the supplier or move them to another branch before they expire.", "#FDF2E1", "#94570A"],
  [MessageCircle, "WhatsApp invoices", "The PDF bill reaches the customer’s phone through the official WhatsApp Business API, with delivery status shown.", "#E7F6EE", "#18794E"],
  [FileScan, "Scan supplier bills", "Photograph a supplier invoice. Lines are matched and totals checked, and nothing reaches stock until you approve it.", "#EAF0FC", "#2459C9"],
  [Landmark, "Accounts your CA will like", "Day book, receivables, payables, P&L and a GST summary. Corrections post as reversals, never as edits.", "#E1F1EF", "#0B5E5B"],
  [CalendarRange, "Seasonal stock planner", "Shows which medicines sell more in which month, so you can order before the rush.", "#F1EEFB", "#5B45B0"],
  [GitBranch, "Multi-branch control", "Branch stock, approved transfers, central buying and consolidated reports.", "#F2F4F5", "#3D454D"],
] as const;
const STEPS = [["01", "Scan or search", "Find the medicine by brand, salt or barcode. Rx items ask for the prescriber’s details."], ["02", "Right batch, automatically", "FEFO picks the batch that expires first. Expired and quarantined stock is blocked."], ["03", "Take payment", "Cash, UPI, card or split. Stock, accounts and the invoice number update in one step."], ["04", "Send on WhatsApp", "Confirm the number and the PDF invoice is on its way, with delivery status."]];
const AI_POINTS = ["Runs on your own server by default. Nothing goes to outside AI unless you turn it on", "Every answer shows which data it used", "Refuses clinical questions and refers them to the pharmacist", "Switch it off any time without affecting billing"];
const AI_ROWS = [["Montair LC", "+45%", "+18"], ["Okacet", "+38%", "+42"], ["Ascoril LS Syrup", "+32%", "+9"], ["Volini Gel", "+21%", "+6"]];
const ENV = [[Monitor, "Counters & tablets"], [Server, "Medoro app"], [Database, "Your database"]] as const;
const EXT = [[HardDriveUpload, "Google Drive", "Encrypted backups only"], [MessageCircle, "WhatsApp API", "Invoice PDF and number"], [KeyRound, "Medoro", "Account and licence only"]] as const;
const SEC = [
  [Users, "Roles and permissions", "Cashiers bill. Managers approve discounts and refunds. Owners see everything."],
  [ShieldCheck, "Two-step sign-in", "MFA is required for owners and managers, and lost devices can be signed out remotely."],
  [ScrollText, "Tamper-evident audit trail", "Every void, discount, refund and stock adjustment is logged with who and when."],
  [Lock, "Encrypted backups", "Backups are encrypted before they leave your PC. Only your recovery key opens them."],
  [FileCheck, "Consent records", "WhatsApp opt-in and opt-out are recorded per customer, with the date and method."],
  [Download, "Export and leave any time", "Your full data as a JSON export, CSV reports for your CA, and encrypted backups only your key opens. No lock-in."],
] as const;
const FAQ: { title: string; items: [string, string][] }[] = [
  { title: "Product", items: [
    ["Does Medoro handle GST billing?", "Yes. Prices are MRP-inclusive and Medoro works out the taxable value with the CGST and SGST split for every line. Invoices are numbered per branch and financial year, and a GST summary downloads as a CSV (opens in Excel) for your CA. Have your CA confirm the setup for your business."],
    ["Can it stop expired medicines from being sold?", "Yes. Billing picks the earliest-expiring sellable batch automatically. Expired, quarantined and recalled batches are blocked on the server, even if someone tries to add them by hand."],
    ["Do I need to install anything?", "No. Medoro runs in Chrome or any modern browser on PCs, tablets and phones. If the database is on a PC in your shop, counters on the shop network keep billing even when the internet is down."]] },
  { title: "Data and privacy", items: [
    ["Where is my data stored?", "On a database you control: a PC in your shop, your own server or your own cloud account. Medoro’s servers hold only your account, plan, licence and the support tickets you send. You can export everything, any time."],
    ["What leaves my server?", "Only what you turn on. Medoro’s licence server gets your pharmacy name and owner contact once, then the app version and branch and counter counts at each check-in. WhatsApp gets the customer number and the invoice PDF. Google Drive gets encrypted backup files it cannot read. Outside AI is off unless you switch it on, and the settings show exactly what would be sent."],
    ["Is the AI giving medical advice?", "No. The AI answers business questions about sales, stock, expiry and dues. It refuses dosage or treatment questions and refers them to the pharmacist."]] },
  { title: "Pricing and trial", items: [
    ["How long is the free trial?", "14 days, no card needed. After that there are 7 days of grace, then Medoro turns read-only until you pay: your data stays where it is, and viewing, exports and backups keep working. Pay by UPI or bank transfer and tap “I’ve paid” on the Subscription page."],
    ["Can I move my data from my current software?", "Yes. Import medicines, batches, suppliers and customers from Excel or CSV. Assisted migration is a one-time service, listed under add-ons."],
    ["How do I cancel?", "In the app, open Subscription (under System) and choose Cancel subscription, any time. The plan stays active until the end of the paid period, then the software goes read-only. Your data stays on your server and can always be exported."]] },
];

const eyebrow = "text-[13px] font-semibold text-teal tracking-[.06em]";
const h2 = "m-0 text-[clamp(28px,3.6vw,40px)] leading-[1.12] tracking-[-.03em] font-bold text-balance";

export default function Home() {
  return (
    <div className="site-root bg-white text-ink-strong leading-normal text-[16px] overflow-x-hidden">
      <SiteHeader />
      <Reveal />

      <section id="top" className="relative overflow-hidden bg-[linear-gradient(180deg,#F3F9F8_0%,#fff_70%)]">
        <div aria-hidden className="absolute -right-[180px] -top-[120px] w-[760px] h-[620px] pointer-events-none bg-[radial-gradient(ellipse_at_center,rgba(10,154,128,.12),transparent_65%)]" />
        <div className="relative max-w-[1320px] mx-auto px-[clamp(16px,3vw,40px)] pt-[clamp(24px,5vh,56px)] pb-[clamp(24px,4vh,40px)] grid gap-[clamp(28px,4vw,56px)] items-center grid-cols-1 min-[1000px]:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] min-[1000px]:min-h-[calc(100vh-160px)]">
          <div className="flex flex-col gap-[clamp(16px,3vh,26px)] items-start min-w-0">
            <span className="site-rise inline-flex items-center gap-2.5 min-h-10 px-[18px] py-2 border border-teal-line bg-white rounded-[20px] text-[clamp(13px,1.4vw,15px)] leading-[1.35] text-teal font-medium"><span className="size-2 rounded-full bg-[#0A9A80] flex-none" />Live now in India · For medical stores and pharmacy chains</span>
            <h1 className="site-rise [animation-delay:90ms] m-0 font-cond text-[clamp(40px,min(5.4vw,9vh),84px)] leading-[.95] tracking-[-.01em] font-bold uppercase"><span className="block text-ink-strong">Your pharmacy’s billing.</span><span className="block text-teal">Your stock &amp; accounts.</span></h1>
            <div className="site-rise [animation-delay:180ms] flex flex-col gap-1.5 text-[clamp(16px,min(1.7vw,2.8vh),23px)] leading-[1.4] text-ink-2">
              <span>Pharmacy billing &amp; stock from <strong className="text-ink-strong font-bold">₹999 a month</strong>.</span>
              <span>AI Pharmacy Manager from <strong className="text-ink-strong font-bold">₹499 a month</strong>.</span>
              <span className="text-teal font-semibold mt-1.5">One Medoro for your whole store. 14-day free trial.</span>
            </div>
            <div className="site-rise [animation-delay:270ms] flex gap-3 flex-wrap mt-1.5">
              <Link href="/start" className="flex items-center gap-2.5 bg-teal text-white h-[clamp(48px,6vh,58px)] px-[clamp(18px,2.2vw,30px)] rounded-full text-[clamp(15px,1.4vw,17px)] font-semibold whitespace-nowrap shadow-[0_12px_28px_-10px_rgba(11,94,91,.6)] hover:bg-teal-hover hover:text-white">Start free trial<ArrowRight size={18} /></Link>
              <a href="#pricing" className="flex items-center gap-2 bg-white text-ink-strong h-[clamp(48px,6vh,58px)] px-[clamp(18px,2.2vw,30px)] rounded-full text-[clamp(15px,1.4vw,17px)] font-semibold whitespace-nowrap border border-input hover:border-teal hover:text-teal">See pricing</a>
            </div>
            <a href={WA} className="site-rise [animation-delay:360ms] flex items-center gap-2 text-[17px] font-semibold text-teal pl-1.5 hover:text-teal-hover">Talk to us on WhatsApp<ArrowRight size={17} /></a>
          </div>
          <div className="site-rise [animation-delay:250ms] flex flex-col items-center gap-[22px] min-w-0">
            <div className="w-full max-w-[700px] flex flex-col items-center">
              <div className="w-[88%] bg-[#1F2328] rounded-t-2xl px-2.5 pt-2.5 shadow-[0_40px_80px_-30px_rgba(11,58,120,.35)]">
                <div className="bg-white rounded-t-md overflow-hidden leading-[0]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/laptop-dashboard.png" alt="Medoro dashboard: sales, margin, purchases, receivables, payables and insights" className="w-full h-auto block" />
                </div>
              </div>
              <div className="w-full h-3.5 bg-[linear-gradient(180deg,#D5D9DD,#B7BCC2)] rounded-b-[14px] relative shadow-[0_18px_30px_-14px_rgba(16,24,40,.35)]"><span className="absolute left-1/2 top-0 -translate-x-1/2 w-[16%] h-1.5 bg-[#A3AAB1] rounded-b-md" /></div>
            </div>
            <span className="flex items-center gap-2 text-[17px] flex-wrap justify-center"><strong className="font-bold">Medoro Pharmacy</strong><span className="text-faint">billing, stock &amp; accounts</span></span>
          </div>
        </div>
        <div className="max-w-[1320px] mx-auto px-6 pb-14">
          <div className="border-t border-[#E6E8EB] pt-7 flex gap-3 flex-wrap justify-center">
            {TRUST.map((t) => <span key={t} className="flex gap-2 items-center min-h-10 px-4 py-1.5 border border-[#E6E8EB] bg-white rounded-full text-[14px] font-medium text-[#1F2328] whitespace-nowrap"><Check size={16} className="text-teal" />{t}</span>)}
          </div>
        </div>
        <div className="border-y border-[#EEF0F2] bg-white overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
          <div className="site-marquee flex w-max">
            {[...MARQUEE, ...MARQUEE].map(([Icon, t], i) => <span key={i} aria-hidden={i >= MARQUEE.length} className="flex items-center gap-2.5 px-7 py-[18px] text-[15px] font-semibold text-ink-2 whitespace-nowrap"><Icon size={17} className="text-teal" />{t}<span className="size-[5px] rounded-full bg-input ml-7" /></span>)}
          </div>
        </div>
      </section>

      <section className="max-w-[1200px] mx-auto px-6 pt-14 max-[640px]:px-4">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,230px),1fr))] border border-[#E6E8EB] rounded-2xl overflow-hidden gap-px bg-[#E6E8EB]">
          {FACTS.map(([v, d]) => <div key={v} className="bg-white p-6 flex flex-col gap-1.5"><span className="text-[30px] font-bold tracking-[-.03em] text-teal leading-[1.1]">{v}</span><span className="text-[14px] text-[#4B535B] text-pretty">{d}</span></div>)}
        </div>
      </section>

      <section id="product" className="max-w-[1200px] mx-auto px-6 pt-[104px] pb-10 flex flex-col gap-11 max-[640px]:px-4 max-[640px]:pt-16">
        <div data-reveal className="flex flex-col gap-3 max-w-[700px]">
          <span className={eyebrow}>PRODUCT</span>
          <h2 className="m-0 text-[clamp(30px,4vw,44px)] leading-[1.1] tracking-[-.03em] font-bold text-balance">Every counter, every batch, every rupee.</h2>
          <p className="m-0 text-[17px] text-[#4B535B] text-pretty">Built around how Indian pharmacies work: MRP-inclusive GST, Schedule H and H1 registers, FEFO batches and supplier credit.</p>
        </div>
        <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))]">
          <div data-reveal className="col-span-full grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] bg-white border border-[#E6E8EB] rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(16,24,40,.04)]">
            <div className="p-8 flex flex-col gap-3 max-[640px]:p-6">
              <span className="flex gap-2 items-center text-[13px] font-semibold text-teal"><ScanBarcode size={16} />Billing counter</span>
              <h3 className="m-0 font-bold text-[26px] tracking-[-.02em] leading-[1.2]">Bill in seconds, straight from the keyboard</h3>
              <p className="m-0 text-[15px] text-[#4B535B]">Scan or type a name, brand or salt. The earliest-expiring batch is picked, and expired or quarantined stock is blocked before it reaches the bill.</p>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-x-4 gap-y-2 mt-1.5">
                {POS.map((p) => <span key={p} className="flex gap-2 items-start text-[14px] text-[#1F2328]"><Check size={15} className="text-[#18794E] mt-[3px] flex-none" />{p}</span>)}
              </div>
            </div>
            <div aria-hidden className="bg-[#F7F8F9] border-l border-[#EEF0F2] p-7 flex flex-col gap-2 justify-center max-[640px]:p-4">
              <div className="flex gap-2 items-center bg-white border-[1.5px] border-teal rounded-lg px-[11px] py-[9px] text-[13px] text-faint"><Search size={14} />augmentin<span className="ml-auto font-mono text-[10.5px] border border-[#E6E8EB] rounded px-1">F2</span></div>
              {[["Augmentin 625 Duo", "Rx H1", "#C0362C", "#F0B8B2", "AG1176 expired, skipped · using AG1290", "#94570A", 1, "₹223.80"], ["Dolo 650", "OTC", "#6B737B", "#E6E8EB", "FEFO DL24091 · exp Nov 2026", "#6B737B", 2, "₹67.20"]].map(([n, tag, tf, tb, sub, sf, q, a]) => (
                <div key={n as string} className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 items-center bg-white border border-[#EEF0F2] rounded-lg px-3 py-2.5 text-[12.5px]">
                  <div className="flex flex-col min-w-0"><span className="flex gap-1.5 items-center"><strong className="font-semibold">{n}</strong><span className="text-[10px] font-semibold border rounded-[3px] px-[3px]" style={{ color: tf as string, borderColor: tb as string }}>{tag}</span></span><span className="text-[11px] truncate" style={{ color: sf as string }}>{sub}</span></div>
                  <span className="text-faint">× {q}</span><strong className="tnum">{a}</strong>
                </div>
              ))}
              <div className="flex justify-between items-center bg-white border border-[#EEF0F2] rounded-lg px-3 py-2.5 text-[12.5px]"><span className="text-faint">CGST ₹13.86 · SGST ₹13.86 · UPI</span><strong className="text-[15px]">₹291.00</strong></div>
              <div className="flex justify-center items-center gap-1.5 bg-teal text-white rounded-lg h-[38px] text-[13px] font-semibold">Complete sale<span className="font-mono text-[10.5px] border border-white/40 rounded px-1">F9</span></div>
            </div>
          </div>
          {TILES.map(([Icon, t, d, bg, fg], i) => (
            <div key={t} data-reveal={i % 3} className="bg-white border border-[#E6E8EB] rounded-2xl p-[26px] flex flex-col gap-2 shadow-[0_1px_2px_rgba(16,24,40,.04)] hover:border-input">
              <span className="size-[38px] rounded-[9px] flex items-center justify-center mb-1.5" style={{ background: bg, color: fg }}><Icon size={18} /></span>
              <h3 className="m-0 font-bold text-[18px] tracking-[-.01em]">{t}</h3>
              <p className="m-0 text-[14.5px] text-[#4B535B] text-pretty">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-[1200px] mx-auto px-6 pt-16 pb-10 flex flex-col gap-9 max-[640px]:px-4">
        <div data-reveal className="flex flex-col gap-3 max-w-[700px]">
          <span className={eyebrow}>HOW A BILL WORKS</span>
          <h2 className={h2}>From scan to WhatsApp in four steps.</h2>
        </div>
        <ol className="list-none m-0 p-0 grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))]">
          {STEPS.map(([n, t, d], i) => (
            <li key={n} data-reveal={i} className="border-t-2 border-teal pt-[18px] flex flex-col gap-2">
              <span className="font-mono text-[13px] text-teal font-medium">{n}</span>
              <h3 className="m-0 font-bold text-[18px] tracking-[-.01em]">{t}</h3>
              <p className="m-0 text-[14.5px] text-[#4B535B] text-pretty">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="ai" className="max-w-[1200px] mx-auto px-6 py-[72px] max-[640px]:px-4">
        <div data-reveal className="bg-[#0E1A1F] rounded-3xl p-[clamp(28px,5vw,56px)] grid gap-12 items-center text-white relative overflow-hidden grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))]">
          <div aria-hidden className="absolute -right-[120px] -top-[120px] size-[420px] rounded-full bg-[radial-gradient(circle,rgba(10,154,128,.35),transparent_70%)]" />
          <div className="relative flex flex-col gap-4">
            <span className="text-[13px] font-semibold text-[#5FD3BC] tracking-[.06em]">AI PHARMACY MANAGER · ADD-ON</span>
            <h2 className={h2}>Ask in Hinglish. Get answers from your own data.</h2>
            <p className="m-0 text-[16px] text-[#B8C7CC] text-pretty">It reads sales, stock, expiry and supplier balances within your permissions, and tells you which items sell more in which month so you can stock up early. It can draft a purchase order. Nothing is ordered, paid or changed until you confirm.</p>
            <div className="flex flex-col gap-2.5 mt-1.5">
              {AI_POINTS.map((p) => <div key={p} className="flex gap-2.5 items-start text-[14.5px] text-[#DCE6E9]"><Check size={16} className="text-[#5FD3BC] mt-0.5 flex-none" />{p}</div>)}
            </div>
            <Link href="/start" className="self-start mt-2 flex items-center gap-2 bg-white text-[#0E1A1F] h-11 px-[18px] rounded-[9px] text-[14.5px] font-semibold hover:bg-teal-tint hover:text-[#0E1A1F]"><Sparkles size={15} />Try it free for 14 days</Link>
          </div>
          <div aria-label="Sample conversation" className="relative bg-[#162429] border border-[#24363C] rounded-2xl p-[18px] flex flex-col gap-3 shadow-[0_30px_60px_-20px_rgba(0,0,0,.5)]">
            <div className="flex items-center gap-2 pb-3 border-b border-[#24363C]"><span className="size-[26px] rounded-[7px] bg-teal flex items-center justify-center"><Sparkles size={14} /></span><strong className="text-[14px]">Medoro AI</strong><span className="ml-auto text-[11.5px] text-[#7F9399] flex gap-[5px] items-center"><span className="size-1.5 rounded-full bg-[#22A06B]" />On your server</span></div>
            <div className="self-end bg-teal px-[13px] py-[9px] rounded-[12px_12px_3px_12px] text-[14px]">Agle mahine kya zyada bikega?</div>
            <div className="self-start bg-[#1D2E34] border border-[#24363C] px-3.5 py-3 rounded-[12px_12px_12px_3px] text-[13.5px] flex flex-col gap-[9px] max-w-[94%]">
              <span className="self-start font-mono text-[11px] text-[#8FB3FF] bg-[rgba(36,89,201,.18)] px-[7px] py-0.5 rounded">get_seasonal_forecast</span>
              <span className="text-[#DCE6E9]">November mein ye items zyada bikte hain. 4 items ka stock pehle se mangwa lein.</span>
              <div className="flex flex-col border border-[#24363C] rounded-lg overflow-hidden">
                {AI_ROWS.map(([a, b, c]) => <div key={a} className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2.5 px-2.5 py-[7px] border-b border-[#24363C] last:border-b-0 text-[12.5px]"><span>{a}</span><span className="text-[#5FD3BC] font-semibold">{b}</span><span className="text-[#B8C7CC] tnum">{c}</span></div>)}
              </div>
              <span className="self-start border border-[#2F5F59] text-[#5FD3BC] rounded-[7px] px-2.5 py-[5px] text-[12.5px] font-semibold">Create draft PO</span>
            </div>
            <span className="text-[11.5px] text-[#7F9399]">Sample conversation. AI answers are business guidance, not clinical advice, and can be wrong.</span>
          </div>
        </div>
      </section>

      <section id="data" className="bg-[#F7F8F9] border-y border-[#EEF0F2]">
        <div className="max-w-[1200px] mx-auto px-6 py-24 flex flex-col gap-14 max-[640px]:px-4 max-[640px]:py-16">
          <div className="grid gap-14 items-center grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))]">
            <div data-reveal className="flex flex-col gap-3.5">
              <span className={eyebrow}>DATA OWNERSHIP</span>
              <h2 className={h2}>Your pharmacy’s records stay on your server.</h2>
              <p className="m-0 text-[16px] text-[#4B535B] text-pretty">Medoro runs on a database you control: a PC in your shop, your own server or your own cloud account. We see only your account and licence. Export everything, any time.</p>
              <a href="#faq" className="self-start text-[14.5px] font-semibold flex gap-1.5 items-center">What exactly leaves my server?<ArrowRight size={15} /></a>
            </div>
            <div data-reveal={1} className="bg-white border border-[#E6E8EB] rounded-[20px] p-[22px] flex flex-col gap-3.5">
              <div className="border-[1.5px] border-dashed border-teal-border rounded-[14px] p-4 bg-[#F7FBFA] flex flex-col gap-3">
                <span className="text-[12px] font-semibold text-teal flex gap-1.5 items-center"><Lock size={13} />YOUR ENVIRONMENT</span>
                <div className="grid grid-cols-3 gap-2">
                  {ENV.map(([Icon, l]) => <div key={l} className="border border-[#E6E8EB] bg-white rounded-[10px] px-2 py-3 flex flex-col items-center gap-1.5 text-center text-[12.5px] font-medium"><Icon size={20} className="text-teal" />{l}</div>)}
                </div>
              </div>
              <div className="grid gap-2 grid-cols-[repeat(auto-fit,minmax(140px,1fr))]">
                {EXT.map(([Icon, l, d]) => <div key={l} className="border border-[#E6E8EB] rounded-[10px] p-3 bg-white flex flex-col gap-1"><span className="text-[12.5px] font-semibold flex gap-1.5 items-center"><Icon size={14} className="text-faint" />{l}</span><span className="text-[11.5px] text-faint">{d}</span></div>)}
              </div>
            </div>
          </div>
          <div id="security" className="flex flex-col gap-6">
            <h3 data-reveal className="m-0 font-bold text-[22px] tracking-[-.02em]">Security, built in on every plan</h3>
            <div className="grid gap-px bg-[#E6E8EB] border border-[#E6E8EB] rounded-2xl overflow-hidden grid-cols-1 min-[640px]:grid-cols-2 min-[960px]:grid-cols-3">
              {SEC.map(([Icon, t, d]) => <div key={t} className="bg-white p-[22px] flex flex-col gap-1.5"><span className="flex gap-2 items-center text-[15px] font-semibold"><Icon size={17} className="text-teal" />{t}</span><span className="text-[14px] text-[#4B535B] text-pretty">{d}</span></div>)}
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" className="max-w-[1200px] mx-auto px-6 pt-[104px] pb-10 flex flex-col gap-9 max-[640px]:px-4 max-[640px]:pt-16">
        <div data-reveal className="flex flex-col gap-3 items-center text-center">
          <span className={eyebrow}>PRICING</span>
          <h2 className="m-0 text-[clamp(30px,4vw,44px)] leading-[1.1] tracking-[-.03em] font-bold text-balance">Simple plans. Start free for 14 days.</h2>
          <p className="m-0 text-[16px] text-[#4B535B] max-w-[620px] text-pretty">Prices in rupees, including GST. Pay by UPI or bank transfer. Cancel any time and your data stays on your server.</p>
        </div>
        <Pricing />
        <p className="m-0 text-[12.5px] text-fainter text-center max-w-[820px] self-center text-pretty">Proposed launch prices in Indian rupees, including 18% GST. Yearly plans are billed upfront. WhatsApp messaging is subject to Meta’s conversation charges. Hosting costs for your own server or cloud are separate.</p>
      </section>

      <section id="faq" className="max-w-[1200px] mx-auto px-6 pt-20 pb-24 grid gap-12 items-start grid-cols-[repeat(auto-fit,minmax(min(100%,360px),1fr))] max-[640px]:px-4">
        <div className="flex flex-col gap-3">
          <span className={eyebrow}>FAQ</span>
          <h2 className="m-0 text-[clamp(30px,4vw,44px)] leading-[1.1] tracking-[-.03em] font-bold">Questions, answered.</h2>
          <p className="m-0 text-[15.5px] text-[#4B535B]">Still unsure? Message us on WhatsApp and a pharmacy specialist will reply.</p>
          <a href={WA} className="self-start flex items-center gap-2 border border-[#E6E8EB] h-[42px] px-4 rounded-[9px] text-[14.5px] font-semibold text-ink-strong hover:border-input hover:text-ink-strong"><MessageCircle size={16} className="text-[#18794E]" />WhatsApp us</a>
        </div>
        <Faq groups={FAQ} />
      </section>

      <section className="max-w-[1200px] mx-auto px-6 pb-24 max-[640px]:px-4">
        <div data-reveal className="bg-[linear-gradient(135deg,#0B3A78,#0B5E5B)] rounded-3xl p-[clamp(32px,6vw,64px)] flex flex-col items-center text-center gap-4 text-white">
          <h2 className="m-0 text-[clamp(28px,4vw,44px)] leading-[1.1] tracking-[-.03em] font-bold text-balance max-w-[720px]">Run a calmer pharmacy, starting today.</h2>
          <p className="m-0 text-[16.5px] text-[#CFE0F5] max-w-[560px]">Set up your counter in an afternoon. Import your stock from Excel and we’ll help you on WhatsApp.</p>
          <div className="flex gap-2.5 flex-wrap justify-center mt-1.5">
            <Link href="/start" className="flex items-center gap-2 bg-white text-[#0B3A78] h-12 px-[22px] rounded-[10px] text-[15.5px] font-semibold hover:bg-teal-tint hover:text-[#0B3A78]">Start 14-day free trial</Link>
            <a href={WA} className="flex items-center gap-2 border border-white/35 text-white h-12 px-5 rounded-[10px] text-[15.5px] font-medium hover:bg-white/10 hover:text-white">Talk to us on WhatsApp</a>
          </div>
        </div>
      </section>

      <SiteFooter />
      <WhatsAppFab />
    </div>
  );
}

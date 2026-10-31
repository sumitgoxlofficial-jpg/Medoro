"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowRight, BadgeIndianRupee, Bot, Check, ChevronDown, CloudOff, HardDriveUpload, MessageCircle, Minus, Pause, Play, ScanBarcode, Truck, Warehouse,
} from "lucide-react";
import { PRODUCTS } from "@/staff/constants";
import { WA_DEMO } from "./brand";

// ───────────── Hero (English / हिंदी) ─────────────

const HERO = {
  en: {
    eyebrow: "Pharmacy software for Indian medical stores",
    h1: ["Bill faster.", "Waste less stock.", "Close GST on time."],
    sub: "Medoro handles billing, batch stock, purchases, GST and accounts for medical stores and small chains. It runs on a computer you control and keeps billing when the internet drops.",
    cta: "Start 7-day free trial", demo: "Get a demo on WhatsApp",
    note: "No card needed. Pay by UPI, card or netbanking only if you continue.",
    alt: "Medoro dashboard for Sanjeevani Pharmacy: today’s sales, margin, receivables, a 14-day sales chart, low stock and batches expiring within 90 days",
  },
  hi: {
    eyebrow: "भारतीय मेडिकल स्टोर के लिए फ़ार्मेसी सॉफ़्टवेयर",
    h1: ["तेज़ बिलिंग", "कम एक्सपायरी नुकसान", "GST समय पर"],
    sub: "Medoro मेडिकल स्टोर और छोटी फ़ार्मेसी चेन के लिए बिलिंग, बैच स्टॉक, खरीद, GST और हिसाब-किताब संभालता है। यह आपके अपने कंप्यूटर पर चलता है, और इंटरनेट बंद होने पर भी बिलिंग चलती रहती है।",
    cta: "7 दिन का मुफ़्त ट्रायल", demo: "WhatsApp पर डेमो लें",
    note: "कार्ड की ज़रूरत नहीं। आगे जारी रखें तभी UPI, कार्ड या नेटबैंकिंग से भुगतान करें।",
    alt: "हिंदी में Medoro डैशबोर्ड: आज की बिक्री, मार्जिन, बकाया, 14 दिन की बिक्री और 90 दिन में एक्सपायर होने वाले बैच",
  },
};

export function Hero() {
  const [lang, setLang] = useState<"en" | "hi">("en");
  useEffect(() => { if (localStorage.getItem("medoro-site-lang") === "hi") setLang("hi"); }, []);
  const pick = (l: "en" | "hi") => { setLang(l); localStorage.setItem("medoro-site-lang", l); };
  const c = HERO[lang];
  const seg = (on: boolean) => `h-9 max-[640px]:h-11 px-3.5 rounded-md text-[14px] font-medium cursor-pointer transition-colors ${on ? "bg-white text-[var(--s-ink)] shadow-[0_1px_2px_rgba(14,22,20,.12)]" : "text-[var(--s-muted)] hover:text-[var(--s-ink)]"}`;
  return (
    <section aria-labelledby="hero-title" className="relative">
      <div lang={lang === "hi" ? "hi" : "en"} className="max-w-[1200px] mx-auto px-6 pt-[clamp(40px,7vw,88px)] grid grid-cols-12 gap-x-6 gap-y-8 items-end max-[640px]:px-4">
        <div className="col-span-12 min-[1000px]:col-span-7 flex flex-col gap-6">
          <div className="site-up flex items-center gap-4 flex-wrap">
            <span className="text-[14px] font-medium text-[var(--s-brand)]">{c.eyebrow}</span>
            <div role="group" aria-label="Language" className="inline-flex gap-0.5 p-[3px] rounded-lg bg-[var(--s-soft)] border border-[var(--s-line)]">
              <button type="button" lang="en" aria-pressed={lang === "en"} onClick={() => pick("en")} className={seg(lang === "en")}>English</button>
              <button type="button" lang="hi" aria-pressed={lang === "hi"} onClick={() => pick("hi")} className={seg(lang === "hi")}>हिंदी</button>
            </div>
          </div>
          <h1 id="hero-title" className="site-display site-up m-0 text-[clamp(44px,6.6vw,84px)] [--d:1]">
            {c.h1.map((l, i) => <span key={l} className={`block ${i === 1 ? "text-[var(--s-brand)]" : ""}`}>{l}</span>)}
          </h1>
        </div>
        <div className="col-span-12 min-[1000px]:col-span-5 flex flex-col gap-6 min-[1000px]:pb-2">
          <p className="site-up m-0 text-[clamp(17px,1.5vw,19px)] leading-[1.6] text-[var(--s-ink-2)] max-w-[520px] [--d:2]">{c.sub}</p>
          <div className="site-up flex gap-3 flex-wrap [--d:3]">
            <Link href="/start" className="site-link-arrow inline-flex items-center gap-2 h-12 px-5 rounded-lg bg-[var(--s-brand)] text-white text-[16px] font-semibold transition-colors hover:bg-[var(--s-brand-ink)] hover:text-white">{c.cta}<ArrowRight size={17} aria-hidden /></Link>
            <a href={WA_DEMO} className="inline-flex items-center gap-2 h-12 px-5 rounded-lg border border-[#C9D1CF] bg-white text-[var(--s-ink)] text-[16px] font-semibold transition-colors hover:border-[var(--s-ink)] hover:text-[var(--s-ink)]"><MessageCircle size={17} aria-hidden className="text-[#146C43]" />{c.demo}</a>
          </div>
          <p className="site-up m-0 text-[14px] text-[var(--s-muted)] [--d:4]">{c.note}</p>
        </div>
      </div>

      <div className="relative mt-[clamp(40px,6vw,72px)]">
        <div aria-hidden className="absolute inset-x-0 bottom-0 top-[38%] bg-[var(--s-soft)] border-t border-[var(--s-line)]" />
        <div className="relative max-w-[1200px] mx-auto px-6 pb-[clamp(48px,7vw,96px)] max-[640px]:px-4">
          <div className="site-up [--d:3] relative">
            <div className="site-tilt">
              <BrowserFrame label="Dashboard · Sanjeevani Pharmacy, FC Road">
                <Image key={lang} src={lang === "hi" ? "/site/dashboard-hi.webp" : "/site/dashboard.webp"} alt={c.alt} width={2000} height={1250} priority={lang === "en"} sizes="(min-width: 1248px) 1152px, calc(100vw - 32px)" className="block w-full h-auto" />
              </BrowserFrame>
            </div>
            <div className="site-drift absolute -right-2 min-[1248px]:-right-10 -bottom-10 w-[clamp(150px,19vw,236px)] max-[560px]:hidden">
              <div className="site-phone"><div><Image src="/site/mobile-dashboard.webp" alt="The owner’s view of the same dashboard on a phone" width={600} height={1298} sizes="236px" className="block w-full h-auto" /></div></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function BrowserFrame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="site-browser">
      <div className="flex items-center gap-3 h-9 px-3.5 border-b border-[var(--s-line)] bg-[#FAFBFB]">
        <span aria-hidden className="flex gap-1.5">{[0, 1, 2].map((i) => <span key={i} className="size-2.5 rounded-full bg-[#D5DBDA]" />)}</span>
        <span className="text-[12.5px] text-[var(--s-muted)] truncate">{label}</span>
      </div>
      {children}
    </div>
  );
}

// ───────────── Feature tabs ─────────────

const FEATURES = [
  {
    id: "billing", icon: ScanBarcode, tab: "Billing", label: "Billing & POS",
    title: "Bill a Dolo strip in 3 keystrokes. FEFO picks the batch.",
    body: "F2 to search by brand, salt or barcode, Enter to add, F9 to finish. The earliest-expiring batch is picked for you, and expired or quarantined stock is blocked on the server, even if someone selects it by hand.",
    points: ["Schedule H and H1 items ask for the prescriber before the bill closes", "Cash, UPI, card, split and customer credit with limits", "80 mm thermal and A4 invoices, held carts, returns and credit notes"],
    img: ["/site/pos.webp", "Billing screen with Dolo 650, Pan-D and Azithral 500 in the cart, batch picked by expiry, prescriber field for the Schedule H1 item and UPI payment"],
  },
  {
    id: "inventory", icon: Warehouse, tab: "Expiry", label: "Inventory & expiry",
    title: "See what expires in 90 days while you can still return it.",
    body: "Every batch is tracked with its expiry, rack and cost. The expiry screen projects how much of each batch will not sell in time, values the loss at cost, and suggests what to do: return it to a supplier who accepts near-expiry stock, move it to another branch, or push it to regular customers.",
    points: ["Windows for 30, 60, 90 and 180 days, with projected loss", "Low-stock list from reorder levels and 28-day sales", "Recalls quarantine the matching batches across branches"],
    img: ["/site/expiry.webp", "Expiry prevention, 90-day window: Benadryl Cough, Becosules, Liv 52 and Ascoril LS batches with days left, projected loss at cost and a recommendation for each"],
  },
  {
    id: "purchases", icon: Truck, tab: "Purchases", label: "Purchases & GRN",
    title: "Purchases that check the distributor’s maths.",
    body: "Raise a purchase order, receive it against the distributor’s bill and post the GRN. Import the supplier’s e-bill file or scan the printed invoice. Nothing reaches stock until the lines are complete and your total matches the one printed on the bill.",
    points: ["Supplier e-bill import and invoice scanning, reviewed before posting", "Batch, expiry, free quantity and rate on every line", "Supplier dues with due dates and payment vouchers"],
    img: ["/site/purchases.webp", "Receiving a distributor’s invoice against a purchase order: Thyronorm 50 batch and expiry entered, the calculated total matching the printed total, ready to post the GRN"],
  },
  {
    id: "gst", icon: BadgeIndianRupee, tab: "GST", label: "GST & Tally",
    title: "GSTR-1 and GSTR-3B figures ready on the 1st.",
    body: "Prices are MRP-inclusive and every line carries its taxable value with the CGST and SGST split, or IGST for out-of-state parties. Month-end summaries are ready for filing, and your CA gets the data in the format they already use.",
    points: ["GSTR-1 and GSTR-3B summaries, e-invoice for B2B bills where your turnover requires it", "Day book, P&L, trial balance and ledgers; corrections post as reversals", "Exports for Tally and CSV that opens in Excel"],
    img: ["/site/accounts.webp", "Accounting: profit and loss, cash and bank, GST summary by slab with output and input tax, and the day book"],
  },
  {
    id: "whatsapp", icon: MessageCircle, tab: "WhatsApp", label: "WhatsApp & refills",
    title: "The invoice reaches the customer’s phone. The refill reminder too.",
    body: "Send the PDF invoice on WhatsApp through the official Business API and see when it is delivered and read. Customers on regular medicines get a reminder when their next refill is due, only if they have opted in.",
    points: ["Delivery status with retries, and the PDF stays on your server", "Refill reminders from each customer’s purchase interval", "Loyalty points, feedback requests and recorded opt-outs"],
    img: ["/site/messaging.webp", "Customer messaging: refill reminders switched on, upcoming reminders for regular customers, and recorded opt-outs"],
  },
  {
    id: "offline", icon: CloudOff, tab: "Offline", label: "Offline & branches",
    title: "Internet down? The counter keeps billing.",
    body: "Run Medoro on a PC in your shop and every counter on the shop network keeps working when the internet drops. Bills made offline sync when the connection is back, with conflicts shown for you to resolve.",
    points: ["Desktop app for Windows, macOS and Linux, or open it in Chrome", "Up to 5 branches with approved stock transfers", "Branch and consolidated reports, and the owner’s view on your phone"],
    img: ["/site/sync.webp", "Sync and offline: offline billing switched on for Counter 1, with the offline bills queue"],
  },
  {
    id: "backups", icon: HardDriveUpload, tab: "Backups", label: "Backups & your data",
    title: "Your data, your Drive.",
    body: "Backups are encrypted on your own computer and uploaded to your own Google Drive every day. Only your recovery key opens them. Restores go to a test copy first, so you can check before anything is replaced.",
    points: ["Daily automatic backup, verified with integrity hashes", "Google Drive access limited to the files Medoro creates", "Full export any time: your records are never locked in"],
    img: ["/site/backup.webp", "Backup and restore: Google Drive connection, AES-256 encryption with the recovery-kit fingerprint, and a verified backup in the history"],
  },
  {
    id: "ai", icon: Bot, tab: "AI", label: "AI assistant",
    title: "Ask “Aaj ki total sale kitni hai?” and get the answer from your own data.",
    body: "The assistant answers questions about sales, stock, expiry and dues in English, Hindi or Hinglish. It shows which data it used, can draft a purchase order for you to review, and never orders, pays or changes anything on its own.",
    points: ["Runs on your server by default; outside AI only if you switch it on", "Refuses dosage and treatment questions and refers them to the pharmacist", "Ctrl + J from any screen"],
    img: ["/site/ai.webp", "Medoro AI drawer answering “Aaj ki total sale kitni hai?” with today’s sales split by cash, UPI, card and credit, then a stock lookup for Dolo 650"],
  },
] as const;

export function FeatureTabs() {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const go = (i: number) => { const n = (i + FEATURES.length) % FEATURES.length; setActive(n); refs.current[n]?.focus(); };
  const onKey = (e: KeyboardEvent) => {
    const k = e.key;
    if (k === "ArrowDown" || k === "ArrowRight") { e.preventDefault(); go(active + 1); }
    else if (k === "ArrowUp" || k === "ArrowLeft") { e.preventDefault(); go(active - 1); }
    else if (k === "Home") { e.preventDefault(); go(0); }
    else if (k === "End") { e.preventDefault(); go(FEATURES.length - 1); }
  };
  return (
    <div className="grid grid-cols-12 gap-x-6 gap-y-6">
      <div role="tablist" aria-label="Medoro features" onKeyDown={onKey}
        className="col-span-12 min-[1000px]:col-span-4 flex min-[1000px]:flex-col gap-1 overflow-x-auto min-[1000px]:overflow-visible -mx-4 px-4 min-[1000px]:mx-0 min-[1000px]:px-0 pb-1 [scrollbar-width:none] min-[1000px]:sticky min-[1000px]:top-24 self-start">
        {FEATURES.map((f, i) => {
          const on = i === active;
          return (
            <button key={f.id} ref={(el) => { refs.current[i] = el; }} id={`tab-${f.id}`} role="tab" type="button" aria-selected={on} aria-controls={`panel-${f.id}`} tabIndex={on ? 0 : -1} onClick={() => setActive(i)}
              className={`group relative flex-none flex items-center gap-3 text-left cursor-pointer rounded-lg transition-colors h-11 px-3.5 min-[1000px]:h-auto min-[1000px]:py-3.5 min-[1000px]:px-4 border min-[1000px]:border-0 ${on ? "bg-[var(--s-brand-tint)] border-[var(--s-brand)] text-[var(--s-ink)]" : "border-[var(--s-line)] text-[var(--s-ink-2)] hover:bg-[var(--s-soft)] hover:text-[var(--s-ink)]"}`}>
              <span aria-hidden className={`hidden min-[1000px]:block absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full transition-colors ${on ? "bg-[var(--s-brand)]" : "bg-transparent"}`} />
              <f.icon size={18} aria-hidden className={on ? "text-[var(--s-brand)]" : "text-[var(--s-muted)]"} />
              <span className="text-[15px] font-semibold whitespace-nowrap"><span className="min-[1000px]:hidden">{f.tab}</span><span className="hidden min-[1000px]:inline">{f.label}</span></span>
              <span aria-hidden className="hidden min-[1000px]:block ml-auto site-num text-[12px] text-[var(--s-muted)]">{String(i + 1).padStart(2, "0")}</span>
            </button>
          );
        })}
      </div>
      <div className="col-span-12 min-[1000px]:col-span-8 min-w-0">
        {FEATURES.map((f, i) => (
          <div key={f.id} id={`panel-${f.id}`} role="tabpanel" aria-labelledby={`tab-${f.id}`} hidden={i !== active} tabIndex={0} className={`${i === active ? "site-swap" : ""} flex flex-col gap-6`}>
            <div className="flex flex-col gap-3 max-w-[680px]">
              <h3 className="site-display m-0 text-[clamp(26px,3vw,36px)] text-[var(--s-ink)]">{f.title}</h3>
              <p className="m-0 text-[17px] text-[var(--s-ink-2)]">{f.body}</p>
            </div>
            <ul className="m-0 p-0 list-none grid gap-x-6 gap-y-2.5 min-[720px]:grid-cols-3">
              {f.points.map((p) => <li key={p} className="flex gap-2.5 items-start text-[15px] text-[var(--s-ink-2)] border-t border-[var(--s-line)] pt-3"><Check size={16} aria-hidden className="text-[var(--s-brand)] mt-[3px] flex-none" />{p}</li>)}
            </ul>
            <BrowserFrame label={`${f.label} · Medoro`}>
              <Image src={f.img[0]} alt={f.img[1]} width={1600} height={1144} sizes="(min-width: 1248px) 768px, (min-width: 1000px) 62vw, calc(100vw - 32px)" className="block w-full h-auto aspect-[1600/1144] bg-[var(--s-soft)]" />
            </BrowserFrame>
          </div>
        ))}
      </div>
    </div>
  );
}

// ───────────── Works-with marquee ─────────────

export function Marquee({ items }: { items: string[] }) {
  const [paused, setPaused] = useState(false);
  return (
    <div className="site-marquee-wrap relative flex items-center gap-3" data-paused={paused}>
      <div className="relative flex-1 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_6%,#000_94%,transparent)]">
        <ul className="site-marquee m-0 p-0 list-none flex w-max">
          {[...items, ...items].map((t, i) => (
            <li key={i} aria-hidden={i >= items.length} className="flex items-center gap-8 pr-8 text-[16px] font-medium text-[var(--s-ink-2)] whitespace-nowrap">{t}<span aria-hidden className="size-1 rounded-full bg-[#AEB8B6]" /></li>
          ))}
        </ul>
      </div>
      <button type="button" onClick={() => setPaused((p) => !p)} aria-label={paused ? "Play the list" : "Pause the list"} className="flex-none size-11 rounded-full border border-[var(--s-line)] bg-white text-[var(--s-ink-2)] flex items-center justify-center cursor-pointer hover:border-[var(--s-ink)] motion-reduce:hidden">
        {paused ? <Play size={15} aria-hidden /> : <Pause size={15} aria-hidden />}
      </button>
    </div>
  );
}

// ───────────── Pricing ─────────────

const inr = (n: number) => "₹" + n.toLocaleString("en-IN");
const price = (id: string) => PRODUCTS.find((p) => p.id === id)!.m;
const PLANS = [
  { id: "starter", name: "Starter", rec: false, for: "A single medical store", cap: "1 branch · 2 counters · 3 users", feats: ["GST billing with FEFO batches", "Medicine catalogue and barcode billing", "Expiry and low-stock alerts", "Purchases, suppliers and dues", "WhatsApp PDF invoices", "Daily encrypted Google Drive backup"] },
  { id: "pro", name: "Professional", rec: true, for: "Busy stores with staff", cap: "1 branch · 5 counters · 10 users", feats: ["Everything in Starter", "Accounts: day book, P&L, GST summaries", "Customer credit and statements", "Supplier invoice scanner, reviewed first", "Roles, permissions and audit trail", "Billing on the shop network when the internet drops"] },
  { id: "multi", name: "Multi-branch", rec: false, for: "Pharmacy chains", cap: "Up to 5 branches · 15 counters · 25 users", feats: ["Everything in Professional", "Branch stock and approved transfers", "Central purchasing", "Consolidated and branch reports", "Anomaly review for owners", "Priority support, 9 am to 9 pm"] },
];
const EXTRAS: [string, string][] = [["Assisted setup and training", `${inr(price("setup"))} once`], ["Stock and data migration", "from ₹2,999"], ["Extra branch (Multi-branch)", "₹799 / month"], ["Thermal printer and scanner setup", "Included"]];
const CMP: [string, ...(boolean | string)[]][] = [
  ["Branches", "1", "1", "Up to 5"], ["Counters / devices", "2", "5", "15"], ["Users", "3", "10", "25"],
  ["GST billing, FEFO, expiry alerts", true, true, true], ["WhatsApp PDF invoices", true, true, true], ["Encrypted Drive backups", true, true, true],
  ["Accounts, P&L, GST summaries", false, true, true], ["Customer credit", false, true, true], ["Invoice scanner", false, true, true],
  ["Shop-network billing without internet", false, true, true], ["Branch transfers, consolidated reports", false, false, true], ["Priority support", false, false, true],
];

export function Pricing() {
  const [yearly, setYearly] = useState(false);
  const [compare, setCompare] = useState(false);
  const seg = (on: boolean) => `h-10 max-[640px]:h-11 px-4 rounded-md text-[15px] font-medium cursor-pointer flex gap-2 items-center transition-colors ${on ? "bg-white text-[var(--s-ink)] shadow-[0_1px_2px_rgba(14,22,20,.12)]" : "text-[var(--s-muted)] hover:text-[var(--s-ink)]"}`;
  const ai = price("ai");
  return (
    <div className="flex flex-col gap-8">
      <div role="group" aria-label="Billing period" className="self-start inline-flex gap-0.5 p-[3px] rounded-lg bg-[var(--s-soft)] border border-[var(--s-line)]">
        <button type="button" onClick={() => setYearly(false)} aria-pressed={!yearly} className={seg(!yearly)}>Monthly</button>
        <button type="button" onClick={() => setYearly(true)} aria-pressed={yearly} className={seg(yearly)}>Yearly<span className="text-[12.5px] font-semibold text-[var(--s-brand)]">2 months free</span></button>
      </div>
      <div className="grid gap-px bg-[var(--s-line)] border border-[var(--s-line)] rounded-xl overflow-hidden min-[900px]:grid-cols-3">
        {PLANS.map((p) => {
          const m = price(p.id);
          return (
            <div key={p.id} className="relative bg-white p-7 flex flex-col gap-5 max-[640px]:p-5">
              {p.rec ? <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-[var(--s-brand)]" /> : null}
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2.5 flex-wrap"><h3 className="m-0 text-[20px] font-semibold">{p.name}</h3>{p.rec ? <span className="text-[12.5px] font-semibold text-[var(--s-brand)] bg-[var(--s-brand-tint)] px-2 py-0.5 rounded">Most stores pick this</span> : null}</div>
                <span className="text-[15px] text-[var(--s-muted)]">{p.for}</span>
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-baseline gap-1.5"><span className="site-display text-[48px] leading-none text-[var(--s-ink)]">{inr(yearly ? Math.round((m * 10) / 12) : m)}</span><span className="text-[15px] text-[var(--s-muted)]">/ month</span></div>
                <span className="text-[14px] text-[var(--s-muted)]">{yearly ? `${inr(m * 10)} billed yearly` : "Billed monthly after the free trial"}</span>
              </div>
              <Link href="/start" className={`flex items-center justify-center h-12 rounded-lg text-[15.5px] font-semibold transition-colors ${p.rec ? "bg-[var(--s-brand)] text-white hover:bg-[var(--s-brand-ink)] hover:text-white" : "border border-[#C9D1CF] text-[var(--s-ink)] hover:border-[var(--s-ink)] hover:text-[var(--s-ink)]"}`}>Start free trial</Link>
              <span className="text-[14px] font-medium text-[var(--s-ink)]">{p.cap}</span>
              <ul className="m-0 p-0 list-none flex flex-col gap-2.5 border-t border-[var(--s-line)] pt-5">
                {p.feats.map((f) => <li key={f} className="flex gap-2.5 items-start text-[15px] text-[var(--s-ink-2)]"><Check size={16} aria-hidden className="text-[var(--s-brand)] mt-[3px] flex-none" />{f}</li>)}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="grid gap-4 min-[900px]:grid-cols-2">
        <div className="site-dark bg-[var(--s-dark)] text-white rounded-xl p-7 flex flex-col gap-2.5 max-[640px]:p-5">
          <span className="text-[13px] font-semibold uppercase tracking-[.08em] text-[#8FD3C6]">Add-on for any plan</span>
          <div className="flex items-baseline justify-between gap-3 flex-wrap"><h3 className="m-0 text-[20px] font-semibold">AI assistant</h3><span className="text-[17px] font-semibold">{yearly ? `${inr(Math.round((ai * 10) / 12))} / month, billed yearly` : `${inr(ai)} / month`}</span></div>
          <p className="m-0 text-[15px] text-[#C3D3D0]">Ask in English, Hindi or Hinglish. Seasonal demand planner, invoice scanner and reorder suggestions. Runs on your server by default.</p>
          <Link href="/start" className="site-link-arrow mt-auto pt-3 self-start inline-flex items-center gap-1.5 text-[15px] font-semibold text-white underline underline-offset-4 decoration-white/40 hover:decoration-white hover:text-white">Try it during the free trial<ArrowRight size={15} aria-hidden /></Link>
        </div>
        <div className="bg-white border border-[var(--s-line)] rounded-xl p-7 flex flex-col gap-1 max-[640px]:p-5">
          <h3 className="m-0 mb-2 text-[17px] font-semibold">One-time and extras</h3>
          {EXTRAS.map(([l, v]) => <div key={l} className="flex justify-between gap-3 text-[15px] border-b border-[var(--s-line-2)] py-2 last:border-b-0"><span className="text-[var(--s-ink-2)]">{l}</span><strong className="font-semibold whitespace-nowrap">{v}</strong></div>)}
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <button type="button" onClick={() => setCompare((x) => !x)} aria-expanded={compare} aria-controls="plan-compare" className="self-start h-11 px-4 rounded-lg border border-[#C9D1CF] bg-white text-[15px] font-semibold cursor-pointer flex gap-2 items-center text-[var(--s-ink)] hover:border-[var(--s-ink)]">
          {compare ? "Hide plan comparison" : "Compare all features"}<ChevronDown size={16} aria-hidden className={`transition-transform duration-300 ${compare ? "rotate-180" : ""}`} />
        </button>
        <div id="plan-compare" hidden={!compare} className="overflow-x-auto border border-[var(--s-line)] rounded-xl">
          <table className="w-full min-w-[640px] border-collapse text-[15px]">
            <caption className="sr-only">Features by plan</caption>
            <thead><tr className="bg-[var(--s-soft)]">{["Feature", "Starter", "Professional", "Multi-branch"].map((h, i) => <th key={h} scope="col" className={`text-left px-4 py-3 font-semibold border-b border-[var(--s-line)] ${i === 2 ? "text-[var(--s-brand)]" : ""}`}>{h}</th>)}</tr></thead>
            <tbody>{CMP.map(([f, ...v]) => (
              <tr key={f}><th scope="row" className="text-left font-normal px-4 py-3 border-b border-[var(--s-line-2)] text-[var(--s-ink-2)]">{f}</th>
                {v.map((c, i) => <td key={i} className="px-4 py-3 border-b border-[var(--s-line-2)]">{c === true ? <><Check size={17} aria-hidden className="text-[var(--s-brand)]" /><span className="sr-only">Included</span></> : c === false ? <><Minus size={17} aria-hidden className="text-[#8A9693]" /><span className="sr-only">Not included</span></> : c}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

"use client";
import Image from "next/image";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowRight, BadgeIndianRupee, Bot, Check, ChevronDown, CloudOff, CreditCard, Gift, HardDriveUpload, MessageCircle, Minus, Pause, Play, RefreshCcw, ScanBarcode, ShieldCheck, Sparkles, Truck, Warehouse,
} from "lucide-react";
import { PRODUCTS } from "@/staff/constants";
import { useLang, useT } from "@/lib/i18n-client";
import { WA_DEMO } from "./brand";
import { Aurora, FloatingShapes } from "./decor";

// ───────────── Hero ─────────────

// Hindi for these lines (and the Hindi dashboard screenshot) follows the site-wide `medoro_lang` cookie.
const H1 = ["Bill faster.", "Waste less stock.", "Close GST on time."];
// Little "live" notifications that pop in around the dashboard shot.
const HERO_CHIPS: [string, string, string][] = [
  ["✓", "₹486 paid by UPI", "-left-6 top-[14%] min-[1248px]:-left-10"],
  ["⏳", "3 batches expire this month", "-left-4 bottom-[18%] min-[1248px]:-left-12"],
  ["📄", "GST summary ready", "right-[12%] -top-5"],
];
const HERO_CHIP_BG = ["#DCF2E7", "#FDF2E1", "#E7F2F0"];

export function Hero() {
  const t = useT();
  const lang = useLang();
  return (
    // Desktop: copy and product shot side by side, sized to fill one screen under the 65px header.
    // Below 1000px the two stack, as before.
    <section aria-labelledby="hero-title" className="relative overflow-hidden min-[1000px]:min-h-[calc(100svh-65px)] min-[1000px]:flex min-[1000px]:items-center">
      <Aurora />
      <FloatingShapes />
      <div aria-hidden className="absolute inset-x-0 bottom-0 top-[62%] bg-[var(--s-soft)]/70 border-t border-[var(--s-line)] min-[1000px]:hidden" />
      <div className="relative w-full max-w-[1200px] mx-auto px-6 pt-[clamp(28px,4vw,40px)] pb-[clamp(48px,6vw,56px)] min-[1000px]:py-8 grid grid-cols-1 min-[1000px]:grid-cols-[minmax(0,1fr)_minmax(0,1.12fr)] gap-x-12 gap-y-10 items-center max-[640px]:px-4">
        <div className="flex flex-col gap-5">
          <span className="site-up text-[14px] font-medium text-[var(--s-brand)]">{t("Pharmacy software for Indian medical stores")}</span>
          <h1 id="hero-title" className="site-display site-up m-0 text-[clamp(40px,5.2vw,64px)] min-[1000px]:text-[clamp(40px,min(4.4vw,7.2vh),62px)] [--d:1]">
            {H1.map((l, i) => <span key={l} className={`block ${i === 1 ? "site-shine" : ""}`}>{t(l)}</span>)}
          </h1>
          <p className="site-up m-0 text-[clamp(16px,1.3vw,18px)] leading-[1.6] text-[var(--s-ink-2)] max-w-[520px] [--d:2]">{t("Medoro handles billing, batch stock, purchases, GST and accounts for medical stores and small chains. It runs on a computer you control and keeps billing when the internet drops.")}</p>
          <div className="site-up flex gap-3 flex-wrap pt-1 [--d:3]">
            <a href="/trial" className="site-link-arrow inline-flex items-center gap-2 h-12 px-5 rounded-lg bg-[var(--s-brand)] text-white text-[16px] font-semibold transition-colors hover:bg-[var(--s-brand-ink)] hover:text-white">{t("Start 7-day free trial")}<ArrowRight size={17} aria-hidden /></a>
            <a href={WA_DEMO} className="inline-flex items-center gap-2 h-12 px-5 rounded-lg border border-[#C9D1CF] bg-white text-[var(--s-ink)] text-[16px] font-semibold transition-colors hover:border-[var(--s-ink)] hover:text-[var(--s-ink)]"><MessageCircle size={17} aria-hidden className="text-[#146C43]" />{t("Get a demo on WhatsApp")}</a>
          </div>
          <p className="site-up m-0 text-[14px] text-[var(--s-muted)] [--d:4]">{t("No card needed. Pay by UPI, card or netbanking only if you continue.")}</p>
        </div>

        <div className="site-up [--d:3] relative">
          <BrowserFrame label={t("Dashboard · Sanjeevani Pharmacy, FC Road")}>
            <Image src={lang === "hi" ? "/site/dashboard-hi.webp" : "/site/dashboard.webp"} alt={t("Medoro dashboard for Sanjeevani Pharmacy: today’s sales, margin, receivables, a 14-day sales chart, low stock and batches expiring within 90 days")} width={2000} height={1250} priority sizes="(min-width: 1248px) 630px, (min-width: 1000px) 52vw, calc(100vw - 32px)" className="block w-full h-auto" />
          </BrowserFrame>
          <ul aria-hidden className="m-0 p-0 list-none max-[560px]:hidden">
            {HERO_CHIPS.map(([icon, text, pos], i) => (
              <li key={text} style={{ ["--d" as string]: i }} className={`site-chip absolute ${pos} flex items-center gap-2 rounded-xl bg-white/95 backdrop-blur border border-[var(--s-line)] shadow-[0_12px_28px_-12px_rgba(14,22,20,.35)] px-3 py-2 text-[13px] font-semibold text-[var(--s-ink)] whitespace-nowrap`}>
                <span className="size-7 rounded-lg flex items-center justify-center text-[15px]" style={{ background: HERO_CHIP_BG[i] }}>{icon}</span>{t(text)}
              </li>
            ))}
          </ul>
          <div className="site-bob absolute -right-2 min-[1248px]:-right-8 -bottom-8 w-[clamp(96px,10vw,136px)] max-[560px]:hidden">
            <div className="site-phone"><div><Image src="/site/mobile-dashboard.webp" alt={t("The owner’s view of the same dashboard on a phone")} width={600} height={1409} sizes="136px" className="block w-full h-auto" /></div></div>
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

// ───────────── Live product tour ─────────────

/**
 * The working prototype from design/, built into public/tour/ by scripts/build-tour.mjs. It runs sandboxed in its own
 * opaque origin (see TOUR in src/server/security-headers.ts), so it can't see the visitor's session or our cookies.
 * The iframe loads only when the section nears the viewport.
 */
export function ProductTour() {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <div className="site-browser">
        <div className="flex items-center gap-3 h-9 px-3.5 border-b border-[var(--s-line)] bg-[#FAFBFB]">
          <span aria-hidden className="flex gap-1.5">{[0, 1, 2].map((i) => <span key={i} className="size-2.5 rounded-full bg-[#D5DBDA]" />)}</span>
          <span className="text-[12.5px] text-[var(--s-muted)] truncate">{t("Live demo · sample data, nothing is saved")}</span>
          <a href="/tour/index.html" target="_blank" rel="noopener" className="ml-auto inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--s-brand)] whitespace-nowrap">
            {t("Open full screen")}<ArrowRight size={13} aria-hidden />
          </a>
        </div>
        <iframe
          src="/tour/index.html"
          title={t("Medoro live demo: a working copy of the app with sample data")}
          loading="lazy"
          sandbox="allow-scripts allow-downloads"
          referrerPolicy="no-referrer"
          className="block w-full h-[clamp(560px,82vh,820px)] border-0 bg-[#F5F6F7]"
        />
      </div>
      <p className="m-0 text-[14px] text-[var(--s-muted)] min-[1000px]:hidden">{t("The demo is made for a computer screen. On a phone, open it full screen and turn the phone sideways.")}</p>
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
  const t = useT();
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
      <div role="tablist" aria-label={t("Medoro features")} onKeyDown={onKey}
        className="col-span-12 min-[1000px]:col-span-4 flex min-[1000px]:flex-col gap-1 overflow-x-auto min-[1000px]:overflow-visible -mx-4 px-4 min-[1000px]:mx-0 min-[1000px]:px-0 pb-1 [scrollbar-width:none] min-[1000px]:sticky min-[1000px]:top-24 self-start">
        {FEATURES.map((f, i) => {
          const on = i === active;
          return (
            <button key={f.id} ref={(el) => { refs.current[i] = el; }} id={`tab-${f.id}`} role="tab" type="button" aria-selected={on} aria-controls={`panel-${f.id}`} tabIndex={on ? 0 : -1} onClick={() => setActive(i)}
              className={`group relative flex-none flex items-center gap-3 text-left cursor-pointer rounded-lg transition-colors h-11 px-3.5 min-[1000px]:h-auto min-[1000px]:py-3.5 min-[1000px]:px-4 border min-[1000px]:border-0 ${on ? "bg-[var(--s-brand-tint)] border-[var(--s-brand)] text-[var(--s-ink)]" : "border-[var(--s-line)] text-[var(--s-ink-2)] hover:bg-[var(--s-soft)] hover:text-[var(--s-ink)]"}`}>
              <span aria-hidden className={`hidden min-[1000px]:block absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full transition-colors ${on ? "bg-[var(--s-brand)]" : "bg-transparent"}`} />
              <f.icon size={18} aria-hidden className={on ? "text-[var(--s-brand)]" : "text-[var(--s-muted)]"} />
              <span className="text-[15px] font-semibold whitespace-nowrap"><span className="min-[1000px]:hidden">{t(f.tab)}</span><span className="hidden min-[1000px]:inline">{t(f.label)}</span></span>
              <span aria-hidden className="hidden min-[1000px]:block ml-auto site-num text-[12px] text-[var(--s-muted)]">{String(i + 1).padStart(2, "0")}</span>
            </button>
          );
        })}
      </div>
      <div className="col-span-12 min-[1000px]:col-span-8 min-w-0">
        {FEATURES.map((f, i) => (
          <div key={f.id} id={`panel-${f.id}`} role="tabpanel" aria-labelledby={`tab-${f.id}`} hidden={i !== active} tabIndex={0} className={`${i === active ? "site-swap" : ""} flex flex-col gap-6`}>
            <div className="flex flex-col gap-3 max-w-[680px]">
              <h3 className="site-display m-0 text-[clamp(26px,3vw,36px)] text-[var(--s-ink)]">{t(f.title)}</h3>
              <p className="m-0 text-[17px] text-[var(--s-ink-2)]">{t(f.body)}</p>
            </div>
            <ul className="m-0 p-0 list-none grid gap-x-6 gap-y-2.5 min-[720px]:grid-cols-3">
              {f.points.map((p) => <li key={p} className="flex gap-2.5 items-start text-[15px] text-[var(--s-ink-2)] border-t border-[var(--s-line)] pt-3"><Check size={16} aria-hidden className="text-[var(--s-brand)] mt-[3px] flex-none" />{t(p)}</li>)}
            </ul>
            <BrowserFrame label={`${t(f.label)} · Medoro`}>
              <Image src={f.img[0]} alt={t(f.img[1])} width={1600} height={1144} sizes="(min-width: 1248px) 768px, (min-width: 1000px) 62vw, calc(100vw - 32px)" className="block w-full h-auto aspect-[1600/1144] bg-[var(--s-soft)]" />
            </BrowserFrame>
          </div>
        ))}
      </div>
    </div>
  );
}

// ───────────── Works-with marquee ─────────────

export function Marquee({ items }: { items: string[] }) {
  const t = useT();
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
      <button type="button" onClick={() => setPaused((p) => !p)} aria-label={paused ? t("Play the list") : t("Pause the list")} className="flex-none size-11 rounded-full border border-[var(--s-line)] bg-white text-[var(--s-ink-2)] flex items-center justify-center cursor-pointer hover:border-[var(--s-ink)] motion-reduce:hidden">
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
// Values are [line, amount]: the line is translated with the amount filled in.
const EXTRAS: [string, [string, string?]][] = [["Assisted setup and training", ["{amount} once", inr(price("setup"))]], ["Stock and data migration", ["from {amount}", "₹2,999"]], ["Extra branch (Multi-branch)", ["{amount} / month", "₹799"]], ["Thermal printer and scanner setup", ["Included"]]];
const CMP: [string, ...(boolean | string)[]][] = [
  ["Branches", "1", "1", "Up to 5"], ["Counters / devices", "2", "5", "15"], ["Users", "3", "10", "25"],
  ["GST billing, FEFO, expiry alerts", true, true, true], ["WhatsApp PDF invoices", true, true, true], ["Encrypted Drive backups", true, true, true],
  ["Accounts, P&L, GST summaries", false, true, true], ["Customer credit", false, true, true], ["Invoice scanner", false, true, true],
  ["Shop-network billing without internet", false, true, true], ["Branch transfers, consolidated reports", false, false, true], ["Priority support", false, false, true],
];

// Reassurances shown above the plans: each is a promise the site already makes (trial, renewal, cancellation, payment, help).
const PROMISES: [typeof Gift, string][] = [[Gift, "7 days free, no card"], [RefreshCcw, "Plans never renew on their own"], [ShieldCheck, "Cancel any time, your data stays"], [CreditCard, "Pay by UPI, card or netbanking"], [MessageCircle, "Setup help on WhatsApp"]];

// Plan finder: the smallest plan whose limits (branches, counters, users) fit the answers.
const FIND: { key: "b" | "c" | "u"; q: string; opts: [string, number][] }[] = [
  { key: "b", q: "Branches", opts: [["1", 1], ["2–5", 5], ["6 or more", 6]] },
  { key: "c", q: "Billing counters", opts: [["1–2", 2], ["3–5", 5], ["6–15", 15]] },
  { key: "u", q: "People using it", opts: [["1–3", 3], ["4–10", 10], ["11–25", 25]] },
];
const LIMITS: [string, number, number, number][] = [["starter", 1, 2, 3], ["pro", 1, 5, 10], ["multi", 5, 15, 25]];
const fitPlan = (a: { b: number; c: number; u: number }) => (LIMITS.find(([, b, c, u]) => a.b <= b && a.c <= c && a.u <= u) ?? LIMITS[2])[0];
const AFTER: [string, string, string][] = [
  ["Today", "Start the free trial", "Sign up and open your store. No card needed."],
  ["Day 1", "Bring your stock in", "Import stock from Excel. Every row is checked before anything is saved, and we help on WhatsApp."],
  ["Day 7", "Decide", "Pay by UPI, card or netbanking only if you continue. Plans never renew on their own."],
];

export function Pricing() {
  const t = useT();
  const [yearly, setYearly] = useState(false);
  const [compare, setCompare] = useState(false);
  const [ans, setAns] = useState<{ b: number; c: number; u: number } | null>(null);
  const fit = ans ? fitPlan(ans) : null;
  const pick = (k: "b" | "c" | "u", v: number) => setAns((a) => ({ ...(a ?? { b: 1, c: 2, u: 3 }), [k]: v }));
  // Phones: a slim "start free trial" bar while the pricing block is on screen.
  const box = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.05 });
    io.observe(el); return () => io.disconnect();
  }, []);
  const seg = (on: boolean) => `h-10 max-[640px]:h-11 px-4 rounded-md text-[15px] font-medium cursor-pointer flex gap-2 items-center transition-colors ${on ? "bg-white text-[var(--s-ink)] shadow-[0_1px_2px_rgba(14,22,20,.12)]" : "text-[var(--s-muted)] hover:text-[var(--s-ink)]"}`;
  const ai = price("ai");
  return (
    <div ref={box} className="flex flex-col gap-8">
      <ul className="m-0 p-0 list-none flex flex-wrap gap-2.5">
        {PROMISES.map(([Icon, l], i) => (
          <li key={l} data-reveal style={{ ["--d" as string]: i }} className="site-lift inline-flex items-center gap-2 rounded-full bg-white border border-[var(--s-line)] pl-1.5 pr-3.5 py-1.5 text-[14.5px] font-medium text-[var(--s-ink)] shadow-[0_1px_2px_rgba(14,22,20,.05)]">
            <span className="size-7 rounded-full bg-[var(--s-brand-tint)] flex items-center justify-center"><Icon size={15} aria-hidden className="site-breathe text-[var(--s-brand)]" style={{ ["--d" as string]: i }} /></span>{t(l)}
          </li>
        ))}
      </ul>
      <div data-reveal className="rounded-2xl border border-[var(--s-line)] bg-[var(--s-soft)] p-[clamp(16px,2.4vw,24px)] flex flex-col gap-4">
        <div className="flex items-center gap-2.5"><span className="size-8 rounded-lg bg-white border border-[var(--s-line)] flex items-center justify-center"><Sparkles size={16} aria-hidden className="site-sparkle text-[var(--s-brand)]" /></span><h3 className="m-0 text-[17px] font-semibold">{t("Find your plan in 3 taps")}</h3></div>
        <div className="grid gap-4 min-[900px]:grid-cols-3">
          {FIND.map((f) => (
            <div key={f.key} role="group" aria-label={t(f.q)} className="flex flex-col gap-2">
              <span className="text-[13.5px] font-semibold text-[var(--s-ink-2)]">{t(f.q)}</span>
              <div className="flex gap-1.5 flex-wrap">
                {f.opts.map(([l, v]) => {
                  const on = ans?.[f.key] === v;
                  return <button key={l} type="button" aria-pressed={on} onClick={() => pick(f.key, v)} className={`h-10 px-3.5 rounded-lg border text-[14.5px] font-medium cursor-pointer transition-[background-color,border-color,color,transform] duration-200 active:scale-95 ${on ? "bg-[var(--s-brand)] border-[var(--s-brand)] text-white" : "bg-white border-[var(--s-line)] text-[var(--s-ink)] hover:border-[var(--s-brand)]"}`}>{t(l)}</button>;
                })}
              </div>
            </div>
          ))}
        </div>
        <div aria-live="polite" className="min-h-[24px]">
          {fit ? (
            <p key={fit + JSON.stringify(ans)} className="site-swap m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15.5px]">
              <Check size={17} aria-hidden className="text-[#146C43]" /><strong>{t("{plan} fits your store.", { plan: PLANS.find((p) => p.id === fit)!.name })}</strong>
              {ans && ans.b > 5 ? <span className="text-[var(--s-muted)]">{t("Add extra branches at {amount} / month each.", { amount: "₹799" })}</span> : <span className="text-[var(--s-muted)]">{t("It’s highlighted below.")}</span>}
            </p>
          ) : <p className="m-0 text-[14.5px] text-[var(--s-muted)]">{t("Pick your answers and we’ll highlight the plan that fits.")}</p>}
        </div>
      </div>
      <div role="group" aria-label={t("Billing period")} className="self-start inline-flex gap-0.5 p-[3px] rounded-lg bg-[var(--s-soft)] border border-[var(--s-line)]">
        <button type="button" onClick={() => setYearly(false)} aria-pressed={!yearly} className={seg(!yearly)}>{t("Monthly")}</button>
        <button type="button" onClick={() => setYearly(true)} aria-pressed={yearly} className={seg(yearly)}>{t("Yearly")}<span className={`text-[12.5px] font-semibold rounded-full px-2 py-0.5 ${yearly ? "bg-[var(--s-brand)] text-white" : "bg-[var(--s-brand-tint)] text-[var(--s-brand)] site-breathe"}`}>{t("2 months free")}</span></button>
      </div>
      <div className="grid gap-5 items-stretch min-[900px]:grid-cols-3 min-[900px]:pt-4">
        {PLANS.map((p, i) => {
          const m = price(p.id);
          const monthly = yearly ? Math.round((m * 10) / 12) : m;
          return (
            <div key={p.id} data-reveal style={{ ["--d" as string]: i }} className={`site-lift relative rounded-2xl p-7 flex flex-col gap-5 max-[640px]:p-5 transition-[box-shadow,outline-color] duration-300 ${fit === p.id ? "outline outline-[3px] outline-offset-4 outline-[#14B8A6]" : "outline-0"} ${p.rec ? "site-plan-rec bg-white min-[900px]:-mt-4 min-[900px]:mb-[-16px] shadow-[0_30px_60px_-30px_rgba(11,94,91,.55)]" : "bg-white border border-[var(--s-line)]"}`}>
              {p.rec ? <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full bg-[var(--s-brand)] text-white text-[12.5px] font-semibold px-3 py-1 shadow-[0_8px_18px_-8px_rgba(11,94,91,.8)] whitespace-nowrap"><Sparkles size={13} aria-hidden className="site-sparkle" />{t("Most stores pick this")}</span> : null}
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2.5 flex-wrap"><h3 className="m-0 text-[20px] font-semibold">{p.name}</h3>{fit === p.id ? <span className="site-swap inline-flex items-center gap-1 text-[12.5px] font-semibold rounded-full bg-[#DCF2E7] text-[#146C43] px-2.5 py-0.5"><Check size={13} aria-hidden />{t("Fits your store")}</span> : null}</div>
                <span className="text-[15px] text-[var(--s-muted)]">{t(p.for)}</span>
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-baseline gap-1.5"><span key={`${p.id}-${yearly}`} className={`site-swap site-display text-[48px] leading-none ${p.rec ? "text-[var(--s-brand)]" : "text-[var(--s-ink)]"}`}>{inr(monthly)}</span><span className="text-[15px] text-[var(--s-muted)]">{t("/ month")}</span></div>
                <span className="text-[14px] text-[var(--s-muted)]">{yearly ? t("{amount} billed yearly", { amount: inr(m * 10) }) : t("Billed monthly after the free trial")}</span>
                <span className="flex flex-wrap gap-1.5 pt-1">
                  <span className="text-[12.5px] font-semibold rounded-full bg-[var(--s-soft)] border border-[var(--s-line)] px-2.5 py-0.5 text-[var(--s-ink-2)]">{t("About {amount} a day", { amount: inr(Math.round(monthly / 30)) })}</span>
                  {yearly ? <span key={`save-${p.id}`} className="site-swap text-[12.5px] font-semibold rounded-full bg-[#DCF2E7] text-[#146C43] px-2.5 py-0.5">{t("Save {amount} a year", { amount: inr(m * 2) })}</span> : null}
                </span>
              </div>
              <a href="/trial" className={`site-link-arrow flex items-center justify-center gap-2 h-12 rounded-lg text-[15.5px] font-semibold transition-colors ${p.rec ? "site-cta relative overflow-hidden bg-[var(--s-brand)] text-white hover:bg-[var(--s-brand-ink)] hover:text-white" : "border border-[#C9D1CF] text-[var(--s-ink)] hover:border-[var(--s-brand)] hover:text-[var(--s-brand)]"}`}>{t("Start free trial")}<ArrowRight size={16} aria-hidden /></a>
              <span className="text-[14px] font-medium text-[var(--s-ink)]">{t(p.cap)}</span>
              <ul className="m-0 p-0 list-none flex flex-col gap-2.5 border-t border-[var(--s-line)] pt-5">
                {p.feats.map((f, j) => <li key={f} data-reveal style={{ ["--d" as string]: j }} className="flex gap-2.5 items-start text-[15px] text-[var(--s-ink-2)]"><span className="size-[18px] mt-[2px] rounded-full bg-[var(--s-brand-tint)] flex items-center justify-center flex-none"><Check size={12} strokeWidth={3} aria-hidden className="text-[var(--s-brand)]" /></span>{t(f)}</li>)}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="grid gap-4 min-[900px]:grid-cols-2">
        <div data-reveal className="site-dark site-lift relative overflow-hidden bg-[var(--s-dark)] text-white rounded-xl p-7 flex flex-col gap-2.5 max-[640px]:p-5">
          <div aria-hidden className="pointer-events-none absolute inset-0"><div className="site-blob site-blob-b bg-[#14B8A6]/25" /></div>
          <span className="relative flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[.08em] text-[#8FD3C6]"><Bot size={16} aria-hidden className="site-breathe" />{t("Add-on for any plan")}</span>
          <div className="flex items-baseline justify-between gap-3 flex-wrap"><h3 className="m-0 text-[20px] font-semibold">{t("AI assistant")}</h3><span className="text-[17px] font-semibold">{yearly ? t("{amount} / month, billed yearly", { amount: inr(Math.round((ai * 10) / 12)) }) : t("{amount} / month", { amount: inr(ai) })}</span></div>
          <p className="m-0 text-[15px] text-[#C3D3D0]">{t("Ask in English, Hindi or Hinglish. Seasonal demand planner, invoice scanner and reorder suggestions. Runs on your server by default.")}</p>
          <a href="/trial" className="site-link-arrow mt-auto pt-3 self-start inline-flex items-center gap-1.5 text-[15px] font-semibold text-white underline underline-offset-4 decoration-white/40 hover:decoration-white hover:text-white">{t("Try it during the free trial")}<ArrowRight size={15} aria-hidden /></a>
        </div>
        <div data-reveal className="site-lift bg-white border border-[var(--s-line)] rounded-xl p-7 flex flex-col gap-1 max-[640px]:p-5">
          <h3 className="m-0 mb-2 text-[17px] font-semibold">{t("One-time and extras")}</h3>
          {EXTRAS.map(([l, v]) => <div key={l} className="flex justify-between gap-3 text-[15px] border-b border-[var(--s-line-2)] py-2 last:border-b-0"><span className="text-[var(--s-ink-2)]">{t(l)}</span><strong className="font-semibold whitespace-nowrap">{t(v[0], { amount: v[1] })}</strong></div>)}
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <button type="button" onClick={() => setCompare((x) => !x)} aria-expanded={compare} aria-controls="plan-compare" className="self-start h-11 px-4 rounded-lg border border-[#C9D1CF] bg-white text-[15px] font-semibold cursor-pointer flex gap-2 items-center text-[var(--s-ink)] hover:border-[var(--s-ink)]">
          {compare ? t("Hide plan comparison") : t("Compare all features")}<ChevronDown size={16} aria-hidden className={`transition-transform duration-300 ${compare ? "rotate-180" : ""}`} />
        </button>
        <div id="plan-compare" hidden={!compare} className="overflow-x-auto border border-[var(--s-line)] rounded-xl">
          <table className="w-full min-w-[640px] border-collapse text-[15px]">
            <caption className="sr-only">{t("Features by plan")}</caption>
            <thead><tr className="bg-[var(--s-soft)]">{["Feature", "Starter", "Professional", "Multi-branch"].map((h, i) => <th key={h} scope="col" className={`text-left px-4 py-3 font-semibold border-b border-[var(--s-line)] ${i === 2 ? "text-[var(--s-brand)]" : ""}`}>{i === 0 ? t(h) : h}</th>)}</tr></thead>
            <tbody>{CMP.map(([f, ...v]) => (
              <tr key={f}><th scope="row" className="text-left font-normal px-4 py-3 border-b border-[var(--s-line-2)] text-[var(--s-ink-2)]">{t(f)}</th>
                {v.map((c, i) => <td key={i} className="px-4 py-3 border-b border-[var(--s-line-2)]">{c === true ? <><Check size={17} aria-hidden className="text-[var(--s-brand)]" /><span className="sr-only">{t("Included")}</span></> : c === false ? <><Minus size={17} aria-hidden className="text-[#8A9693]" /><span className="sr-only">{t("Not included")}</span></> : t(c)}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <h3 data-reveal className="m-0 text-[20px] font-semibold">{t("What happens after you click “Start free trial”")}</h3>
        <ol className="site-steps relative m-0 p-0 list-none grid gap-4 min-[900px]:grid-cols-3">
          {AFTER.map(([when, title, d], i) => (
            <li key={title} data-reveal style={{ ["--d" as string]: i }} className="site-lift relative z-[1] bg-white border border-[var(--s-line)] rounded-xl p-5 flex flex-col gap-2 hover:border-[#8FD3C6]">
              <span className="flex items-center gap-2.5"><span className="size-9 rounded-full bg-[var(--s-brand)] text-white flex items-center justify-center text-[15px] font-bold">{i + 1}</span><span className="text-[13px] font-semibold uppercase tracking-[.08em] text-[var(--s-brand)]">{t(when)}</span></span>
              <strong className="text-[17px]">{t(title)}</strong>
              <span className="text-[15px] text-[var(--s-ink-2)] leading-[1.55]">{t(d)}</span>
            </li>
          ))}
        </ol>
      </div>
      <div aria-hidden={!inView} className={`min-[641px]:hidden fixed inset-x-0 bottom-0 z-[25] border-t border-[var(--s-line)] bg-white/95 backdrop-blur px-4 pr-20 py-2.5 flex items-center gap-3 transition-transform duration-300 ${inView ? "translate-y-0" : "translate-y-full"}`}>
        <span className="flex flex-col leading-tight min-w-0"><strong className="text-[15px]">{t("From {amount} / month", { amount: inr(yearly ? Math.round((price("starter") * 10) / 12) : price("starter")) })}</strong><span className="text-[12.5px] text-[var(--s-muted)] truncate">{t("7 days free, no card")}</span></span>
        <a href="/trial" tabIndex={inView ? 0 : -1} className="site-cta relative overflow-hidden ml-auto flex-none inline-flex items-center h-11 px-4 rounded-lg bg-[var(--s-brand)] text-white text-[15px] font-semibold hover:text-white">{t("Start free trial")}</a>
      </div>
      <div data-reveal className="site-pan relative overflow-hidden rounded-2xl text-white p-[clamp(22px,4vw,40px)] flex flex-col gap-5 min-[900px]:flex-row min-[900px]:items-center min-[900px]:justify-between">
        <div className="relative flex flex-col gap-2 max-w-[640px]">
          <h3 className="m-0 text-[clamp(22px,2.6vw,30px)] font-semibold">{t("Not sure which plan fits?")}</h3>
          <p className="m-0 text-[16px] text-[#D3EAE6]">{t("Start the 7-day trial now and choose a plan only if you continue. Or tell us about your store on WhatsApp and we’ll suggest one.")}</p>
        </div>
        <div className="relative flex gap-3 flex-wrap">
          <a href="/trial" className="site-link-arrow inline-flex items-center gap-2 h-12 px-6 rounded-lg bg-white text-[var(--s-brand-ink)] text-[16px] font-semibold hover:bg-[#E7F2F0] hover:text-[var(--s-brand-ink)]">{t("Start 7-day free trial")}<ArrowRight size={17} aria-hidden /></a>
          <a href={WA_DEMO} className="inline-flex items-center gap-2 h-12 px-5 rounded-lg border border-white/40 text-white text-[16px] font-semibold hover:bg-white/10 hover:text-white"><MessageCircle size={17} aria-hidden />{t("Ask on WhatsApp")}</a>
        </div>
      </div>
    </div>
  );
}

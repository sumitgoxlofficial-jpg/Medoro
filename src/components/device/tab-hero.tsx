"use client";
import {
  ScanBarcode, ReceiptText, Boxes, ShieldAlert, Truck, Handshake, Bike, Users, Stethoscope, BookOpen, Landmark, FileCheck2,
  BarChart3, Lightbulb, Sparkles, History, MonitorCog, type LucideIcon,
} from "lucide-react";
import { useT } from "@/lib/i18n-client";
import type { Tab } from "./tabs";
import { TABS } from "./tabs";

/** Icon and one-line purpose for each counter tab (the Dashboard has its own welcome banner). */
const HERO: Partial<Record<Tab, [LucideIcon, string]>> = {
  bill: [ScanBarcode, "F2 search · F4 hold · F9 complete"],
  bills: [ReceiptText, "Find bills, take returns and print the day-end."],
  stock: [Boxes, "Batches, expiry dates and shelf counts on this counter."],
  recalls: [ShieldAlert, "Recalled batches: block, quarantine or return them."],
  purchases: [Truck, "Receive supplier bills into stock."],
  supplier: [Handshake, "Import distributor e-bills and other supplier tools."],
  orders: [Bike, "Home delivery orders, from order to doorstep."],
  customers: [Users, "Customers, credit and reminders."],
  doctors: [Stethoscope, "Prescribing doctors and their referrals."],
  accounts: [BookOpen, "Cash book and what you owe suppliers."],
  money: [Landmark, "UPI and bank credits, matched to bills."],
  cheques: [FileCheck2, "Cheques received and given, until they clear."],
  reports: [BarChart3, "Sales, stock and GST reports for your CA."],
  insights: [Lightbulb, "Stock forecasts and what to reorder."],
  ask: [Sparkles, "Ask about sales, stock and customers in plain words."],
  activity: [History, "Who did what on this counter, and when."],
  settings: [MonitorCog, "PIN and settings for this device."],
};

/**
 * Teal header strip at the top of each counter tab: the tab's icon in a bobbing tile, its name and purpose, a large
 * faint copy of the icon drifting on the right and two twinkles. Billing gets the slim version to keep its space.
 */
export function TabHero({ tab }: { tab: Tab }) {
  const t = useT();
  const h = HERO[tab];
  if (!h) return null;
  const [Icon, sub] = h;
  const name = TABS.find(([k]) => k === tab)?.[1] ?? "";
  const slim = tab === "bill";
  return (
    <div key={tab} className={`app-up app-welcome relative overflow-hidden rounded-xl text-white flex items-center gap-3 ${slim ? "px-4 py-2.5" : "px-[clamp(16px,2.4vw,22px)] py-3.5"}`}>
      <div aria-hidden className="pointer-events-none absolute inset-0"><div className="app-glow" /></div>
      <Icon aria-hidden size={slim ? 70 : 96} strokeWidth={1.2} className="app-drift pointer-events-none absolute right-6 -bottom-6 text-white/10 [--dur:13s]" />
      <svg aria-hidden viewBox="0 0 10 10" className="app-twinkle absolute right-[28%] top-2 size-2.5"><path d="M5 0l1.2 3.8L10 5 6.2 6.2 5 10 3.8 6.2 0 5l3.8-1.2z" fill="#F5C451" /></svg>
      <svg aria-hidden viewBox="0 0 10 10" className="app-twinkle absolute right-[40%] bottom-2 size-2 [animation-delay:-1.4s]"><path d="M5 0l1.2 3.8L10 5 6.2 6.2 5 10 3.8 6.2 0 5l3.8-1.2z" fill="#5EEAD4" /></svg>
      <span className={`app-bob relative flex-none rounded-xl bg-white/15 border border-white/20 flex items-center justify-center ${slim ? "size-9" : "size-11"}`}><Icon size={slim ? 18 : 22} aria-hidden /></span>
      <span className="relative flex flex-col leading-tight min-w-0">
        <strong className={slim ? "text-[15px]" : "text-[17px]"}>{t(name)}</strong>
        <span className="text-[13px] text-white/80 truncate">{t(sub)}</span>
      </span>
    </div>
  );
}

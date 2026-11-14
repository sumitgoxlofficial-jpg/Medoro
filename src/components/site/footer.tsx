"use client";
import Link from "next/link";
import { Boxes, Building2, ChevronRight, Heart, LogIn, Mail, MessageCircle, Scale, type LucideIcon } from "lucide-react";
import { useT } from "@/lib/i18n-client";
import { UDYAM } from "@/lib/udyam";
import { WA_DEMO, Wordmark } from "./brand";
import { Aurora } from "./decor";

const FOOT: { t: string; icon: LucideIcon; links: [string, string][] }[] = [
  { t: "Product", icon: Boxes, links: [["Billing & POS", "/#product"], ["Inventory & expiry", "/#product"], ["GST & accounts", "/#product"], ["WhatsApp & refills", "/#product"], ["Offline & branches", "/#product"], ["Pricing", "/#pricing"]] },
  { t: "Company", icon: Building2, links: [["About Medoro", "/legal#about"], ["Become a reference partner", "/partners"], ["Switching to Medoro", "/#switching"], ["Security & data", "/#security"], ["FAQ", "/#faq"], ["Help & setup", "/legal#help"], ["Backup & recovery", "/legal#backup"], ["Contact", "/legal#contact"]] },
  { t: "Sign in", icon: LogIn, links: [["Log in", "/signin"], ["Pharmacy staff login", "/signin?view=employee"], ["Medoro employee login", "/staff/login"], ["Start 7-day free trial", "/trial"]] },
  { t: "Legal", icon: Scale, links: [["Privacy policy", "/legal#privacy"], ["Terms of service", "/legal#terms"], ["Cancellation & refunds", "/legal#refund"], ["Cookie policy", "/legal#cookies"], ["DPDP rights", "/legal#dpdp"], ["Grievance officer", "/legal#grievance"]] },
];

export function SiteFooter() {
  const t = useT();
  return (
    <footer className="relative overflow-hidden bg-[var(--s-soft)]">
      {/* Animated waves along the top edge */}
      <svg aria-hidden viewBox="0 0 1440 60" preserveAspectRatio="none" className="block w-full h-[40px] min-[720px]:h-[60px] bg-white">
        <path className="site-wave" d="M0 30 Q 90 0 180 30 T 360 30 T 540 30 T 720 30 T 900 30 T 1080 30 T 1260 30 T 1440 30 T 1620 30 T 1800 30 V60 H0Z" fill="#E7F2F0" />
        <path className="site-wave site-wave-2" d="M0 38 Q 90 14 180 38 T 360 38 T 540 38 T 720 38 T 900 38 T 1080 38 T 1260 38 T 1440 38 T 1620 38 T 1800 38 V60 H0Z" fill="var(--s-soft)" />
      </svg>
      <Aurora />
      <div className="relative max-w-[1200px] mx-auto px-6 pt-16 pb-8 flex flex-col gap-12 max-[640px]:px-4 max-[640px]:pb-24">
        <div className="grid gap-x-8 gap-y-10 grid-cols-2 min-[720px]:grid-cols-4 min-[1040px]:grid-cols-12">
          <div className="flex flex-col gap-4 col-span-full min-[1040px]:col-span-4">
            <Link href="/" aria-label={t("Medoro home")} className="site-logo self-start"><Wordmark size={20} /></Link>
            <p className="m-0 text-[15px] text-[var(--s-muted)] max-w-[320px]">{t("Billing, stock, GST and accounts for Indian medical stores and small pharmacy chains.")}</p>
            <div className="flex flex-col gap-1.5 text-[15px]">
              <a href={WA_DEMO} className="group text-[var(--s-ink)] flex gap-2.5 items-center hover:text-[var(--s-brand)]">
                <span className="relative size-8 rounded-lg bg-[#DCF2E7] flex items-center justify-center"><MessageCircle size={16} aria-hidden className="site-nav-ico text-[#146C43]" /><span aria-hidden className="site-ping absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-[#22A06B]" /></span>WhatsApp +91 62077 74673
              </a>
              <a href="mailto:hello@medoro.in" className="group text-[var(--s-ink)] flex gap-2.5 items-center hover:text-[var(--s-brand)]">
                <span className="size-8 rounded-lg bg-[var(--s-brand-tint)] flex items-center justify-center"><Mail size={16} aria-hidden className="site-nav-ico text-[var(--s-brand)]" /></span>hello@medoro.in
              </a>
              <span className="text-[var(--s-muted)] text-[14px] pl-[42px]">{t("Monday to Saturday, 9 am to 9 pm IST")}</span>
            </div>
          </div>
          {FOOT.map((c) => (
            <nav key={c.t} aria-label={t(c.t)} className="flex flex-col gap-2.5 min-[1040px]:col-span-2">
              <span className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[.08em] text-[var(--s-muted)] mb-1">
                <span className="size-7 rounded-lg bg-white border border-[var(--s-line)] flex items-center justify-center"><c.icon size={15} aria-hidden className="site-breathe text-[var(--s-brand)]" style={{ ["--d" as string]: FOOT.indexOf(c) }} /></span>{t(c.t)}
              </span>
              {c.links.map(([l, h]) => (
                <a key={l} href={h} className="site-foot-link group flex items-start gap-1 text-[15px] text-[var(--s-ink-2)] hover:text-[var(--s-brand)] py-1">
                  <ChevronRight size={14} aria-hidden className="flex-none mt-[4px] -ml-[18px] opacity-0 text-[var(--s-brand)] transition-all duration-300 group-hover:ml-0 group-hover:opacity-100" />
                  <span className="transition-transform duration-300">{t(l, { ctx: "site" })}</span>
                </a>
              ))}
            </nav>
          ))}
        </div>
        {/* Heartbeat line in place of the divider */}
        <svg aria-hidden viewBox="0 0 1200 40" preserveAspectRatio="none" className="block w-full h-10 -mb-6">
          <path d="M0 20H1200" stroke="var(--s-line)" strokeWidth="1" />
          <path className="site-ecg" pathLength={1} d="M0 20H520l14-14 16 30 14-30 12 22 10-8H1200" stroke="#14B8A6" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="pt-6 flex justify-between gap-x-6 gap-y-3 flex-wrap text-[13.5px] text-[var(--s-muted)]">
          <span><Heart size={14} aria-hidden className="site-beat inline -mt-0.5 mr-1.5 fill-[#F28B82] text-[#F28B82]" />{t("© 2026 Medoro. Made in Bokaro for Indian pharmacies.")} <a href={UDYAM.verifyUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-[var(--s-ink)]">{t("Udyam-registered MSME")} · {UDYAM.number}</a></span>
          <span className="max-w-[640px]">{t("Medoro is business software. It does not give clinical advice; compliance responsibilities stay with the licensed pharmacist.")}</span>
        </div>
      </div>
    </footer>
  );
}

export function WhatsAppFab() {
  const t = useT();
  return (
    <a href={WA_DEMO} aria-label={t("Message Medoro on WhatsApp")} className="site-fab fixed right-4 bottom-4 z-30 flex items-center justify-center gap-2 h-12 min-w-12 px-0 min-[640px]:px-4 rounded-full bg-[#146C43] text-white text-[15px] font-semibold shadow-[0_10px_30px_-10px_rgba(14,22,20,.5)] transition-colors hover:bg-[#0F5534] hover:text-white">
      <MessageCircle size={19} aria-hidden /><span className="hidden min-[640px]:inline">WhatsApp</span>
    </a>
  );
}

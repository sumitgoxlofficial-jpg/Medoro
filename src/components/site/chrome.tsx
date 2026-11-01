import Link from "next/link";
import { MessageCircle, Mail } from "lucide-react";
import { WA, WA_DEMO, Wordmark } from "./brand";

export { WA, WA_DEMO, Wordmark };
export { SiteHeader, SiteMotion } from "./header";

const FOOT: { t: string; links: [string, string][] }[] = [
  { t: "Product", links: [["Billing & POS", "/#product"], ["Inventory & expiry", "/#product"], ["GST & accounts", "/#product"], ["WhatsApp & refills", "/#product"], ["Offline & branches", "/#product"], ["Pricing", "/#pricing"]] },
  { t: "Company", links: [["About Medoro", "/legal#about"], ["Switching to Medoro", "/#switching"], ["Security & data", "/#security"], ["FAQ", "/#faq"], ["Help & setup", "/legal#help"], ["Backup & recovery", "/legal#backup"], ["Contact", "/legal#contact"]] },
  { t: "Sign in", links: [["Owner sign in", "/signin"], ["Pharmacy staff login", "/signin?view=employee"], ["Start free trial", "/start"]] },
  { t: "Legal", links: [["Privacy policy", "/legal#privacy"], ["Terms of service", "/legal#terms"], ["Cancellation & refunds", "/legal#refund"], ["Cookie policy", "/legal#cookies"], ["DPDP rights", "/legal#dpdp"], ["Grievance officer", "/legal#grievance"]] },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--s-line)] bg-white">
      <div className="max-w-[1200px] mx-auto px-6 pt-16 pb-8 flex flex-col gap-12 max-[640px]:px-4 max-[640px]:pb-24">
        <div className="grid gap-x-8 gap-y-10 grid-cols-2 min-[720px]:grid-cols-4 min-[1040px]:grid-cols-12">
          <div className="flex flex-col gap-4 col-span-full min-[1040px]:col-span-4">
            <Link href="/" aria-label="Medoro home" className="self-start"><Wordmark size={20} /></Link>
            <p className="m-0 text-[15px] text-[var(--s-muted)] max-w-[320px]">Billing, stock, GST and accounts for Indian medical stores and small pharmacy chains.</p>
            <div className="flex flex-col gap-1.5 text-[15px]">
              <a href={WA_DEMO} className="text-[var(--s-ink)] flex gap-2 items-center hover:text-[var(--s-brand)]"><MessageCircle size={15} aria-hidden className="text-[var(--s-brand)]" />WhatsApp +91 62077 74673</a>
              <a href="mailto:hello@medoro.in" className="text-[var(--s-ink)] flex gap-2 items-center hover:text-[var(--s-brand)]"><Mail size={15} aria-hidden className="text-[var(--s-brand)]" />hello@medoro.in</a>
              <span className="text-[var(--s-muted)] text-[14px]">Monday to Saturday, 9 am to 9 pm IST</span>
            </div>
          </div>
          {FOOT.map((c) => (
            <nav key={c.t} aria-label={c.t} className="flex flex-col gap-2.5 min-[1040px]:col-span-2">
              <span className="text-[13px] font-semibold uppercase tracking-[.08em] text-[var(--s-muted)] mb-1">{c.t}</span>
              {c.links.map(([l, h]) => <a key={l} href={h} className="text-[15px] text-[var(--s-ink-2)] hover:text-[var(--s-ink)] hover:underline underline-offset-4 py-1">{l}</a>)}
            </nav>
          ))}
        </div>
        <div className="border-t border-[var(--s-line)] pt-6 flex justify-between gap-x-6 gap-y-3 flex-wrap text-[13.5px] text-[var(--s-muted)]">
          <span>© 2026 Medoro. Made in Pune for Indian pharmacies.</span>
          <span className="max-w-[640px]">Medoro is business software. It does not give clinical advice; compliance responsibilities stay with the licensed pharmacist.</span>
        </div>
      </div>
    </footer>
  );
}

export function WhatsAppFab() {
  return (
    <a href={WA_DEMO} aria-label="Message Medoro on WhatsApp" className="fixed right-4 bottom-4 z-30 flex items-center justify-center gap-2 h-12 min-w-12 px-0 min-[640px]:px-4 rounded-full bg-[#146C43] text-white text-[15px] font-semibold shadow-[0_10px_30px_-10px_rgba(14,22,20,.5)] transition-colors hover:bg-[#0F5534] hover:text-white">
      <MessageCircle size={19} aria-hidden /><span className="hidden min-[640px]:inline">WhatsApp</span>
    </a>
  );
}

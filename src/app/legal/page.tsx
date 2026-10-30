import type { Metadata } from "next";
import {
  ArrowRight, BadgeHelp, Building2, Check, Cookie, FileText, HardDriveUpload, LifeBuoy, Mail, MessageCircle, Phone,
  ReceiptIndianRupee, Shield, TriangleAlert, UserCheck,
} from "lucide-react";
import { SiteFooter, WA } from "@/components/site/chrome";
import { PageHeader } from "@/components/site/page-header";
import { Toc } from "./toc";

export const metadata: Metadata = { title: "Company, help and legal · Medoro", description: "About Medoro, contact, help, backup and recovery, privacy policy, terms, refunds, cookies, DPDP rights and grievance officer." };

type Sec = { id: string; icon: typeof Shield; kicker: string; title: string; intro: string; points: string[]; cta?: [string, string, typeof Shield] };

const SECTIONS: Sec[] = [
  { id: "about", icon: Building2, kicker: "Company", title: "About Medoro", intro: "Medoro builds pharmacy software for Indian medical stores and pharmacy chains: billing, batch inventory, expiry control, purchases, accounts and an AI manager, all running on a database the pharmacy controls.", points: ["Based in Pune, Maharashtra (placeholder: Medoro Technologies Pvt. Ltd.)", "Built for MRP-inclusive GST, FEFO batches and Schedule H and H1 registers", "We never hold your pharmacy’s operational records"] },
  { id: "contact", icon: Phone, kicker: "Company", title: "Contact us", intro: "Sales, setup help and support, Monday to Saturday, 9 am to 9 pm IST.", points: ["WhatsApp: +91 62077 74673", "Email: hello@medoro.in · support@medoro.in", "Address: Kothrud, Pune 411038, Maharashtra (placeholder)"], cta: ["WhatsApp us", WA, MessageCircle] },
  { id: "help", icon: LifeBuoy, kicker: "Resources", title: "Help & setup", intro: "Most pharmacies are billing within an afternoon.", points: ["1. Start the free trial and create the owner account with two-step sign-in", "2. Choose where your database lives: a shop PC, your server or your cloud", "3. Import medicines and opening stock from Excel or CSV", "4. Connect a thermal printer and barcode scanner, then add staff and roles", "5. Connect WhatsApp Business and Google Drive backups when you are ready"], cta: ["Start free trial", "/start", ArrowRight] },
  { id: "backup", icon: HardDriveUpload, kicker: "Resources", title: "Backup & recovery", intro: "Backups are encrypted on your own server before they upload to your own Google Drive. They open only with your backup key: the printed recovery kit, and a sealed copy your server keeps so it can back up and restore on its own. Medoro never receives the key.", points: ["Daily automatic backup, plus manual backups any time", "Every backup is checked with integrity hashes", "Restores go to a test copy first, and you confirm before it goes live", "On a new server, the recovery kit restores a backup file or one from your Google Drive", "Keep your printed recovery kit in two safe places. If your server is lost, backups cannot be opened without it"] },
  { id: "privacy", icon: Shield, kicker: "Legal", title: "Privacy policy", intro: "Your pharmacy’s records, including invoices, stock, customers and prescriptions, stay in the database you control. Medoro processes only the account data needed to run your subscription.", points: ["We hold: the account owner’s name, email and phone, plan, licence check-ins, branch and device counts, app version, and the support tickets and payment references you send from the app", "We do not hold: invoices, stock, customer or patient details, or backup contents", "WhatsApp receives the customer number and invoice PDF only when you send one", "Outside AI is off by default. If you turn it on, settings show exactly what is sent", "We never sell data or use pharmacy records to train AI models"] },
  { id: "terms", icon: FileText, kicker: "Legal", title: "Terms of service", intro: "These terms cover your use of the Medoro software and services.", points: ["Medoro is business software. It does not give clinical advice or replace the licensed pharmacist", "You are responsible for drug-law, GST and record-keeping compliance in your store", "Subscriptions renew monthly or yearly until cancelled", "If payment fails, there is a 7-day grace period, then the software goes read-only. Exports always work", "Do not resell, sublicense or reverse-engineer the software"] },
  { id: "refund", icon: ReceiptIndianRupee, kicker: "Legal", title: "Refund policy", intro: "Try Medoro free for 14 days before you pay anything.", points: ["Monthly plans: cancel any time. The plan stays active until the paid period ends, with no partial refunds", "Yearly plans: a full refund if requested within 7 days of payment, and pro-rated after that for service failures only", "One-time setup and migration fees are refundable only if the work has not started", "Refunds go back to the original payment method within 7–10 working days"] },
  { id: "cookies", icon: Cookie, kicker: "Legal", title: "Cookie policy", intro: "medoro.in uses essential cookies only, to keep you signed in and remember your language.", points: ["No advertising or cross-site tracking cookies", "Optional analytics run only with your consent, and you can change this at any time", "The Medoro app on your own server sets only session cookies"] },
  { id: "dpdp", icon: UserCheck, kicker: "Legal", title: "Your DPDP rights", intro: "Under India’s Digital Personal Data Protection Act, 2023, you can exercise these rights over the personal data Medoro holds about you.", points: ["Access: ask what personal data we hold and why", "Correction and erasure: fix or delete your account data", "Withdraw consent for optional processing at any time", "Nominate someone to exercise these rights for you", "Pharmacy customers should contact their pharmacy, which controls its own records"], cta: ["Email a request", "mailto:privacy@medoro.in", Mail] },
  { id: "grievance", icon: BadgeHelp, kicker: "Legal", title: "Grievance officer", intro: "For privacy complaints or concerns about how data is handled, contact our grievance officer. We acknowledge within 48 hours and resolve within 30 days.", points: ["Name: [Grievance officer name]", "Email: grievance@medoro.in", "Address: Medoro Technologies Pvt. Ltd., Kothrud, Pune 411038 (placeholder)", "If you are not satisfied, you can approach the Data Protection Board of India"], cta: ["Email the grievance officer", "mailto:grievance@medoro.in", Mail] },
];

export default function Legal() {
  return (
    <div className="site-root bg-white min-h-dvh">
      <PageHeader />

      <div className="max-w-[1200px] mx-auto px-6 pt-[clamp(40px,6vw,72px)] pb-24 grid gap-14 items-start grid-cols-1 min-[900px]:grid-cols-[240px_minmax(0,1fr)] max-[640px]:px-4">
        <Toc items={SECTIONS.map((s) => ({ id: s.id, title: s.title }))} />
        <main id="main" className="flex flex-col gap-14 min-w-0 max-w-[760px]">
          <div className="flex flex-col gap-2.5">
            <h1 className="site-display m-0 text-[clamp(40px,5vw,64px)]">Company, help and legal</h1>
            <p className="m-0 text-[16px] text-[var(--s-muted)]">Last updated 27 October 2026.</p>
            <div role="note" className="flex gap-2.5 items-start bg-[#FDF2E1] border border-[#F3D9A8] rounded-[10px] px-3.5 py-3 text-[14px] text-[#6B4A0E]">
              <TriangleAlert size={16} className="mt-[3px] flex-none" /><span>Draft text. Have a qualified lawyer review it before launch. Company name, address and officer details are placeholders.</span>
            </div>
          </div>
          {SECTIONS.map((s) => (
            <section key={s.id} id={s.id} className="flex flex-col gap-4 border-t border-[var(--s-line)] pt-10 scroll-mt-24">
              <span className="flex gap-2 items-center text-[14px] font-semibold text-[var(--s-brand)]"><s.icon size={16} aria-hidden />{s.kicker}</span>
              <h2 className="site-display m-0 text-[clamp(28px,3vw,36px)]">{s.title}</h2>
              <p className="m-0 text-[17px] leading-[1.6] text-[var(--s-ink-2)] text-pretty">{s.intro}</p>
              <ul className="m-0 p-0 list-none flex flex-col gap-2.5">
                {s.points.map((p) => <li key={p} className="flex gap-2.5 items-start text-[16px] text-[var(--s-ink-2)]"><Check size={16} aria-hidden className="text-[var(--s-brand)] mt-1 flex-none" /><span>{p}</span></li>)}
              </ul>
              {s.cta ? (() => { const [label, href, Icon] = s.cta; return (
                <a href={href} className="self-start flex gap-2 items-center h-11 px-4 border border-[#C9D1CF] rounded-lg text-[15px] font-semibold text-[var(--s-ink)] hover:border-[var(--s-ink)] hover:text-[var(--s-ink)]"><Icon size={16} aria-hidden />{label}</a>
              ); })() : null}
            </section>
          ))}
        </main>
      </div>

      <SiteFooter />
    </div>
  );
}

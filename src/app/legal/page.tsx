import type { Metadata } from "next";
import {
  ArrowRight, BadgeHelp, Building2, Cookie, FileText, HardDriveUpload, LifeBuoy, Mail, MessageCircle, Phone,
  ReceiptIndianRupee, Shield, UserCheck,
} from "lucide-react";
import { SiteFooter, WA } from "@/components/site/chrome";
import { PageHeader } from "@/components/site/page-header";
import { Toc } from "./toc";

export const metadata: Metadata = { title: "Company, help and legal · Medoro", description: "About Medoro, contact, help, backup and recovery, privacy policy, terms of service, cancellation and refund policy, cookies, DPDP rights and grievance officer." };

type Sec = { id: string; icon: typeof Shield; kicker: string; title: string; intro: string; points: string[]; cta?: [string, string, typeof Shield] };

export const dynamic = "force-dynamic";

/** Company and grievance-officer details come from the environment, so each deployment shows its own. */
function company() {
  const e = process.env;
  return {
    name: e.MEDORO_COMPANY_NAME?.trim() || "Medoro Technologies",
    address: e.MEDORO_COMPANY_ADDRESS?.trim() || "Bokaro, Jharkhand, India",
    officer: e.MEDORO_GRIEVANCE_NAME?.trim() || "The Grievance Officer",
    email: e.MEDORO_GRIEVANCE_EMAIL?.trim() || "grievance@medoro.in",
    phone: e.MEDORO_GRIEVANCE_PHONE?.trim() || "",
    configured: !!(e.MEDORO_COMPANY_NAME && e.MEDORO_COMPANY_ADDRESS && e.MEDORO_GRIEVANCE_NAME),
  };
}

const sections = (c: ReturnType<typeof company>): Sec[] => [
  { id: "about", icon: Building2, kicker: "Company", title: "About Medoro", intro: "Medoro builds pharmacy software for Indian medical stores and pharmacy chains: billing, batch inventory, expiry control, purchases, accounts and an AI assistant, all running on a database the pharmacy controls.", points: [`${c.name}, ${c.address}`, "Built for MRP-inclusive GST, FEFO batches and Schedule H and H1 registers", "We never hold your pharmacy’s operational records"] },
  { id: "contact", icon: Phone, kicker: "Company", title: "Contact us", intro: "Sales, setup help and support, Monday to Saturday, 9 am to 9 pm IST.", points: ["WhatsApp: +91 62077 74673", "Email: hello@medoro.in · support@medoro.in", `Address: ${c.address}`], cta: ["WhatsApp us", WA, MessageCircle] },
  { id: "help", icon: LifeBuoy, kicker: "Resources", title: "Help & setup", intro: "Most pharmacies are billing within an afternoon.", points: ["1. Start the free trial and create the owner account with two-step sign-in", "2. Choose where your database lives: a shop PC, your server or your cloud", "3. Import medicines and opening stock from Excel or CSV", "4. Connect a thermal printer and barcode scanner, then add staff and roles", "5. Connect WhatsApp Business and Google Drive backups when you are ready"], cta: ["Start free trial", "/start", ArrowRight] },
  { id: "backup", icon: HardDriveUpload, kicker: "Resources", title: "Backup & recovery", intro: "Backups are encrypted on your own server before they upload to your own Google Drive. They open only with your backup key: the printed recovery kit, and a sealed copy your server keeps so it can back up and restore on its own. Medoro never receives the key.", points: ["Daily automatic backup, plus manual backups any time", "Every backup is checked with integrity hashes", "Restores go to a test copy first, and you confirm before it goes live", "On a new server, the recovery kit restores a backup file or one from your Google Drive", "Keep your printed recovery kit in two safe places. If your server is lost, backups cannot be opened without it"] },
  { id: "privacy", icon: Shield, kicker: "Legal", title: "Privacy policy", intro: "Your pharmacy’s records, including invoices, stock, customers and prescriptions, stay in the database you control. Medoro processes only the account data needed to run your subscription.", points: ["We hold: the account owner’s name, email and phone, plan, licence check-ins, branch and device counts, app version, and the support tickets and payment references you send from the app", "We do not hold: invoices, stock, customer or patient details, or backup contents", "WhatsApp receives the customer number and invoice PDF only when you send one", "Outside AI is off by default. If you turn it on, settings show exactly what is sent", "We never sell data or use pharmacy records to train AI models"] },
  { id: "terms", icon: FileText, kicker: "Legal", title: "Terms of service", intro: `These terms are an agreement between ${c.name} (“Medoro”, “we”) and the pharmacy business that creates an account (“you”). By creating an account or paying, you accept them and the Cancellation & refund policy below.`, points: [
    "Who can use Medoro: a business with a valid drug licence, through an owner aged 18 or over who can bind the business. Medoro is business software for your pharmacy, not a consumer service",
    "Medoro does not give clinical advice or replace the registered pharmacist. You are responsible for drug-law, Schedule H/H1/X, GST and record-keeping compliance in your store, and for what your staff do in the app",
    "Plans are prepaid for a month or a year at the price shown before you pay (GST included). Nothing renews or is charged automatically: you choose when to pay again",
    "Price changes are announced at least 30 days ahead and apply only from your next payment, never to a period you have already paid for",
    "When a paid period ends there are 7 days of grace, then the app becomes read-only until you pay. Viewing, exports and backups keep working",
    "Your pharmacy’s records belong to you. You can export them at any time, including after you cancel",
    "You must not resell, sublicense, copy, reverse-engineer or overload the software, share sign-ins, or use it for anything unlawful. We may suspend an account that does, after notice where the law allows",
    "We aim for the service to be available around the clock and give notice of planned maintenance, but we can’t promise it will never be interrupted. Our total liability for any claim is limited to the fees you paid in the 12 months before it, and we are not liable for indirect losses such as lost profit",
    "Indian law applies. Disputes go first to our grievance officer; if unresolved, to the courts at our registered office, without affecting any right you have under the Consumer Protection Act, 2019",
    "We may update these terms. Material changes are notified in the app or by email at least 30 days before they apply",
  ] },
  { id: "refund", icon: ReceiptIndianRupee, kicker: "Legal", title: "Cancellation & refund policy", intro: "Try Medoro free first, then pay only for the period you choose. This policy is shown before you pay, as the Consumer Protection (E-Commerce) Rules, 2020 require, and you accept it when you pay.", points: [
    "Free trial: 7 days with every feature, no card or payment needed. The trial is how you decide whether Medoro suits your pharmacy. If you don’t pay, nothing is charged and nothing is owed",
    "No auto-renewal: plans are prepaid for one month or one year. We never save your card or set up automatic debits, so you are never charged without pressing Pay yourself, and there is no subscription to cancel",
    "No cancellation or refund after paying: because you can try Medoro free first, payments are final. A paid month or year can’t be cancelled, refunded or exchanged, in full or in part, including unused days. Your plan simply ends on its end date unless you pay again, and stays fully usable until then",
    "Renewal opens in the last 7 days of a paid period, so a plan can’t be paid twice by accident. A renewal paid early starts when the current period ends; no days are lost",
    "Paid twice by mistake: if a second payment goes through within minutes of the first, it doesn’t add time and is refunded automatically. For any other duplicate payment, write to billing@medoro.in within 30 days and we refund it",
    "Failed or interrupted payments: if money left your account but the payment failed, Razorpay and your bank reverse it automatically, usually within 5–7 working days. If not, send us the payment reference and we will follow it up",
    "Service failure: if Medoro is unavailable for more than 72 hours in a row because of a fault on our side, we extend your plan by that time, or refund it pro-rata if you prefer",
    "If we close your account for a breach of the terms, no refund is due. If we stop offering the service, you get a pro-rata refund of any unused paid period",
    "Refunds, where they apply, are for the amount you actually paid (after any coupon or discount, never the list price), to the original payment method through Razorpay within 5–7 working days, with a GST credit note",
    "Coupons and promotional prices can’t be exchanged for cash. Please write to us before raising a chargeback; we resolve billing problems faster directly",
    "When your plan ends, Medoro becomes read-only after 7 days of grace; your records stay available to view and export. To have them deleted, see Your DPDP rights; tax records are kept as GST law requires",
    `Questions or complaints: billing@medoro.in, or the grievance officer below (${c.email}). We acknowledge within 48 hours and resolve within 30 days`,
  ] },
  { id: "cookies", icon: Cookie, kicker: "Legal", title: "Cookie policy", intro: "medoro.in uses essential cookies only, to keep you signed in and remember your language.", points: ["No advertising or cross-site tracking cookies", "Optional analytics run only with your consent, and you can change this at any time", "The Medoro app on your own server sets only session cookies"] },
  { id: "dpdp", icon: UserCheck, kicker: "Legal", title: "Your DPDP rights", intro: "Under India’s Digital Personal Data Protection Act, 2023, you can exercise these rights over the personal data Medoro holds about you.", points: ["Access: ask what personal data we hold and why", "Correction and erasure: fix your account data, or delete the whole pharmacy account from Privacy & data (owner only). It is deleted 7 days later, and you can cancel until then. Download your data first; Medoro keeps only its record of your subscription payments, as tax law requires", "Withdraw consent for optional processing at any time", "Nominate someone to exercise these rights for you", "Pharmacy customers should contact their pharmacy, which controls its own records"], cta: ["Email a request", "mailto:privacy@medoro.in", Mail] },
  { id: "grievance", icon: BadgeHelp, kicker: "Legal", title: "Grievance officer", intro: "For privacy complaints or concerns about how data is handled, contact our grievance officer. We acknowledge within 48 hours and resolve within 30 days.", points: [`Name: ${c.officer}`, `Email: ${c.email}`, ...(c.phone ? [`Phone: ${c.phone}`] : []), `Address: ${c.name}, ${c.address}`, "Customers of a pharmacy that uses Medoro: your pharmacy’s grievance contact is printed on your invoice", "If you are not satisfied, you can approach the Data Protection Board of India"], cta: ["Email the grievance officer", `mailto:${c.email}`, Mail] },
];

export default function Legal() {
  const c = company();
  const SECTIONS = sections(c);
  return (
    <div className="site-root bg-white min-h-dvh">
      <PageHeader />

      <div className="max-w-[1200px] mx-auto px-6 pt-[clamp(40px,6vw,72px)] pb-24 grid gap-14 items-start grid-cols-1 min-[900px]:grid-cols-[240px_minmax(0,1fr)] max-[640px]:px-4">
        <Toc items={SECTIONS.map((s) => ({ id: s.id, title: s.title }))} />
        <main id="main" className="flex flex-col gap-14 min-w-0 max-w-[760px]">
          <div className="flex flex-col gap-2.5">
            <h1 className="site-display m-0 text-[clamp(40px,5vw,64px)]">Company, help and legal</h1>
            <p className="m-0 text-[16px] text-[var(--s-muted)]">Last updated 27 October 2026.</p>
          </div>
          {SECTIONS.map((s) => (
            <section key={s.id} id={s.id} className="flex flex-col gap-4 border-t border-[var(--s-line)] pt-10 scroll-mt-24">
              <span className="flex gap-2 items-center text-[14px] font-semibold text-[var(--s-brand)]"><s.icon size={16} aria-hidden />{s.kicker}</span>
              <h2 className="site-display m-0 text-[clamp(28px,3vw,36px)]">{s.title}</h2>
              <p className="m-0 text-[17px] leading-[1.6] text-[var(--s-ink-2)] text-pretty">{s.intro}</p>
              <ul className="m-0 p-0 list-none flex flex-col gap-2.5">
                {s.points.map((p) => (
                  <li key={p} className="flex gap-2.5 items-start text-[16px] text-[var(--s-ink-2)]">{/^\d+\.\s/.test(p) ? null : <span aria-hidden className="size-1.5 rounded-full bg-[var(--s-muted)] mt-2.5 flex-none" />}<span>{p}</span></li>
                ))}
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

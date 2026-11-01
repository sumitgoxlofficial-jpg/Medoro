import Link from "next/link";
import type { Metadata } from "next";
import { BadgeIndianRupee, BarChart3, CheckCircle2, Handshake, Link2, MessageCircle, ShieldCheck, Store, Wallet } from "lucide-react";
import { SiteFooter, SiteHeader, WA, WhatsAppFab } from "@/components/site/chrome";
import { getRates } from "@/staff/sales";
import { PRODUCTS, TDS_PCT, amountPaise } from "@/staff/constants";

export const metadata: Metadata = {
  title: "Reference partner programme · Medoro",
  description: "Medical representatives, distributors and pharmacy consultants: recommend Medoro to pharmacies you visit and earn commission on every plan they buy.",
};
export const dynamic = "force-dynamic";

const inr = (paise: number) => "₹" + Math.round(paise / 100).toLocaleString("en-IN");
const PLANS = PRODUCTS.filter((p) => !("once" in p));
const WA_PARTNER = `${WA}?text=${encodeURIComponent("Hi Medoro, I'm interested in the reference partner programme.")}`;

export default async function Partners() {
  const rates = await getRates();
  const pro = rates.pro;
  const proYear = amountPaise("pro", "y");
  const example = { pharmacies: 10, first: Math.round((proYear * pro.first) / 100) * 10, renew: Math.round((proYear * pro.renew) / 100) * 10 };
  const steps = [
    { icon: Handshake, t: "Join free", d: "Sign up with your Google account in one minute. Your referral code and dashboard are ready straight away." },
    { icon: Link2, t: "Share your code", d: "You get a personal referral code and link. Share it with pharmacies you visit, on WhatsApp or in person." },
    { icon: Store, t: "Pharmacy starts a free trial", d: "They sign up with your code or link and use Medoro free for 7 days. No card needed." },
    { icon: BadgeIndianRupee, t: "You earn when they pay", d: "Commission on their first payment and on every renewal after that, for as long as they stay with Medoro." },
  ];
  const faq: [string, string][] = [
    ["Who can become a reference partner?", "Medical representatives (MRs), pharma distributors, wholesalers, pharmacy consultants and anyone who works with medical stores. You don’t need to be a Medoro employee, and it doesn’t affect your current job."],
    ["Does it cost anything to join?", "No. Joining is free and there’s no target. You earn only when a pharmacy you referred pays for Medoro."],
    ["How does Medoro know a pharmacy came from me?", "The pharmacy signs up with your referral code, or through your link, which fills the code in automatically. It’s linked to you from that moment and shows in your dashboard."],
    ["When do I get paid?", `Earnings are recorded automatically when a referred pharmacy pays online. Medoro pays them to your bank account through Razorpay, after ${TDS_PCT}% TDS as required by law. Add your bank account and PAN in your dashboard.`],
    ["Do I earn on renewals too?", "Yes. You earn the first-payment rate when a pharmacy first pays, and the renewal rate every time they renew, monthly or yearly."],
    ["What if a pharmacy gets a refund?", "If a payment is refunded, the commission on it is cancelled. Medoro refunds only in rare cases, such as a payment made twice by mistake."],
    ["Can the rates change?", "Medoro can update rates for future payments. Earnings already recorded are never reduced. The current rates are always shown on this page."],
  ];

  return (
    <div className="site-root bg-white min-h-dvh">
      <SiteHeader />
      <main>
        <section className="max-w-[1200px] mx-auto px-6 pt-[clamp(40px,7vw,96px)] pb-14 grid grid-cols-12 gap-x-6 gap-y-10 items-center max-[640px]:px-4">
          <div className="col-span-12 min-[960px]:col-span-7 flex flex-col gap-6">
            <span className="text-[14px] font-semibold text-[var(--s-brand)]">Reference partner programme · Free to join</span>
            <h1 className="site-display m-0 text-[clamp(38px,5vw,62px)]">Recommend Medoro to pharmacies. Earn on every plan they buy.</h1>
            <p className="m-0 text-[18px] leading-[1.6] text-[var(--s-ink-2)] max-w-[600px]">For medical representatives, distributors and pharmacy consultants. You already visit medical stores every day. Tell them about Medoro, the billing, stock and GST app made for Indian pharmacies, and earn extra income from every pharmacy that joins.</p>
            <div className="flex gap-3 flex-wrap">
              <Link href="/staff/login?join=partner" className="inline-flex items-center h-12 px-6 rounded-lg bg-[var(--s-brand)] text-white text-[16px] font-semibold no-underline hover:bg-[var(--s-brand-ink)] hover:text-white">Become a reference partner</Link>
              <Link href="/staff/login" className="inline-flex items-center h-12 px-6 rounded-lg border border-[#C9D1CF] text-[16px] font-semibold text-[var(--s-ink)] no-underline hover:border-[var(--s-ink)] hover:text-[var(--s-ink)]">Partner login</Link>
            </div>
          </div>
          <div className="col-span-12 min-[960px]:col-span-5 bg-[var(--s-soft)] border border-[var(--s-line)] rounded-2xl p-6 flex flex-col gap-3">
            <span className="text-[14px] font-semibold text-[var(--s-ink-2)]">Example</span>
            <span className="text-[15px] text-[var(--s-ink-2)]">{example.pharmacies} pharmacies on the Professional plan, paying yearly:</span>
            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-baseline border-b border-[var(--s-line)] pb-2"><span className="text-[15px]">First year</span><strong className="text-[26px] text-[var(--s-brand)]">{inr(example.first)}</strong></div>
              <div className="flex justify-between items-baseline"><span className="text-[15px]">Every year after, while they renew</span><strong className="text-[22px]">{inr(example.renew)}</strong></div>
            </div>
            <span className="text-[12.5px] text-[var(--s-muted)]">At today’s rates ({pro.first}% first payment, {pro.renew}% renewals), before {TDS_PCT}% TDS.</span>
          </div>
        </section>

        <section className="bg-[var(--s-soft)] border-y border-[var(--s-line)]">
          <div className="max-w-[1200px] mx-auto px-6 py-16 flex flex-col gap-8 max-[640px]:px-4">
            <h2 className="site-display m-0 text-[clamp(28px,3.4vw,40px)]">How it works</h2>
            <ol className="m-0 p-0 list-none grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))]">
              {steps.map((s, i) => (
                <li key={s.t} className="bg-white border border-[var(--s-line)] rounded-xl p-5 flex flex-col gap-2.5">
                  <span className="flex items-center gap-2.5"><span className="size-9 rounded-lg bg-[var(--s-brand-tint)] text-[var(--s-brand)] flex items-center justify-center"><s.icon size={18} aria-hidden /></span><span className="site-num text-[13px] text-[var(--s-brand)]">{String(i + 1).padStart(2, "0")}</span></span>
                  <strong className="text-[17px]">{s.t}</strong>
                  <span className="text-[15px] text-[var(--s-ink-2)] leading-[1.55]">{s.d}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="max-w-[1200px] mx-auto px-6 py-16 flex flex-col gap-6 max-[640px]:px-4">
          <h2 className="site-display m-0 text-[clamp(28px,3.4vw,40px)]">What you earn</h2>
          <p className="m-0 text-[16px] text-[var(--s-ink-2)] max-w-[720px]">A percentage of what the pharmacy pays (before GST). You earn the first-payment rate on their first purchase of a plan, and the renewal rate every time they renew.</p>
          <div className="overflow-auto border border-[var(--s-line)] rounded-xl">
            <table className="w-full border-collapse min-w-[640px] text-[15px]">
              <thead><tr className="bg-[var(--s-soft)] text-left text-[13px] text-[var(--s-muted)]"><th className="px-4 py-3 font-semibold">Plan</th><th className="px-4 py-3 font-semibold">First payment</th><th className="px-4 py-3 font-semibold">Renewals</th><th className="px-4 py-3 font-semibold">You earn on a yearly plan</th></tr></thead>
              <tbody>{PLANS.map((p) => {
                const r = rates[p.id];
                const y = amountPaise(p.id, "y");
                return (
                  <tr key={p.id} className="border-t border-[var(--s-line)]">
                    <td className="px-4 py-3 font-semibold">{p.name}</td>
                    <td className="px-4 py-3">{r.first}%</td>
                    <td className="px-4 py-3">{r.renew}%</td>
                    <td className="px-4 py-3">{inr((y * r.first) / 100)} first year, then {inr((y * r.renew) / 100)} a year</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          <span className="text-[13px] text-[var(--s-muted)]">Monthly plans earn the same percentages on each monthly payment. Rates shown are current; earnings already recorded never go down.</span>
        </section>

        <section className="bg-[var(--s-soft)] border-y border-[var(--s-line)]">
          <div className="max-w-[1200px] mx-auto px-6 py-16 grid gap-6 grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] max-[640px]:px-4">
            {[
              { icon: BarChart3, t: "Your own partner dashboard", d: "See the pharmacies you referred, who is paying, what you earned this month and in total, and where you rank among top partners today, this week and this month." },
              { icon: Wallet, t: "Monthly payouts to your bank", d: `Add your bank account and PAN once. Earnings are paid monthly by bank transfer, after ${TDS_PCT}% TDS.` },
              { icon: ShieldCheck, t: "Pharmacies trust it", d: "Medoro keeps each pharmacy’s data private, works offline, prints GST bills and backs up to their own Google Drive. Easy to recommend." },
            ].map((x) => (
              <div key={x.t} className="bg-white border border-[var(--s-line)] rounded-xl p-5 flex flex-col gap-2.5">
                <span className="size-9 rounded-lg bg-[var(--s-brand-tint)] text-[var(--s-brand)] flex items-center justify-center"><x.icon size={18} aria-hidden /></span>
                <strong className="text-[17px]">{x.t}</strong>
                <span className="text-[15px] text-[var(--s-ink-2)] leading-[1.55]">{x.d}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="max-w-[1200px] mx-auto px-6 py-16 grid grid-cols-12 gap-x-6 gap-y-8 max-[640px]:px-4">
          <div className="col-span-12 min-[960px]:col-span-5 flex flex-col gap-4">
            <h2 className="site-display m-0 text-[clamp(28px,3.4vw,40px)]">Simple, fair rules</h2>
            <ul className="m-0 p-0 list-none flex flex-col gap-3 text-[15px] text-[var(--s-ink-2)]">
              {[
                "The pharmacy must sign up with your code or link. A code can’t be added later.",
                "You earn on payments the pharmacy makes online through Medoro.",
                "Commission on a refunded payment is cancelled.",
                "Recommend honestly. No spam, fake sign-ups or promises Medoro doesn’t make.",
                "Medoro can close a partner profile that breaks these rules.",
              ].map((r) => <li key={r} className="flex gap-2.5"><CheckCircle2 size={18} aria-hidden className="text-[var(--s-brand)] flex-none mt-0.5" />{r}</li>)}
            </ul>
          </div>
          <div className="col-span-12 min-[960px]:col-span-7 flex flex-col gap-3">
            <h2 className="site-display m-0 text-[clamp(28px,3.4vw,40px)]">Questions</h2>
            {faq.map(([q, a]) => (
              <details key={q} className="border border-[var(--s-line)] rounded-xl px-4 py-3 group">
                <summary className="cursor-pointer text-[16px] font-semibold list-none flex justify-between gap-3">{q}<span aria-hidden className="text-[var(--s-muted)] group-open:rotate-45 transition-transform">+</span></summary>
                <p className="m-0 mt-2 text-[15px] leading-[1.6] text-[var(--s-ink-2)]">{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="max-w-[1200px] mx-auto px-6 pb-20 max-[640px]:px-4">
          <div className="bg-[var(--s-brand)] text-white rounded-2xl p-[clamp(24px,4vw,48px)] flex flex-col gap-4 min-[960px]:flex-row min-[960px]:items-center min-[960px]:justify-between">
            <div className="flex flex-col gap-2">
              <h2 className="m-0 text-[clamp(24px,3vw,34px)] font-semibold text-white">Start earning with Medoro</h2>
              <span className="text-[16px] text-white/85">Free to join with Google. Your referral code is ready in a minute.</span>
            </div>
            <div className="flex gap-3 flex-wrap">
              <Link href="/staff/login?join=partner" className="inline-flex items-center h-12 px-6 rounded-lg bg-white text-[var(--s-brand)] text-[16px] font-semibold no-underline hover:text-[var(--s-brand)]">Become a reference partner</Link>
              <a href={WA_PARTNER} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 h-12 px-5 rounded-lg border border-white/50 text-white text-[16px] font-semibold no-underline hover:border-white hover:text-white"><MessageCircle size={17} aria-hidden />Ask on WhatsApp</a>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
      <WhatsAppFab />
    </div>
  );
}

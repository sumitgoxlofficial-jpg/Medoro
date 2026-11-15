import type { Metadata } from "next";
import { BadgeCheck, Coffee, GraduationCap, HeartHandshake, Rocket, Sparkles } from "lucide-react";
import { SiteFooter, SiteHeader, SiteMotion } from "@/components/site/chrome";
import { Aurora, FloatingShapes } from "@/components/site/decor";
import { ApplicantBar, CareersBoard } from "@/components/site/careers";
import { readApplicant, linkedinLogin } from "@/server/applicant";
import { googleLoginConfigured } from "@/server/google-oidc";
import { publicJobs, lastApplication } from "@/staff/hrms/careers";
import { careersJsonLd } from "./seo";

export const metadata: Metadata = {
  title: "Careers at Medoro · Jobs in pharmacy software, sales and support",
  description: "Open jobs at Medoro, the pharmacy billing and accounting software made in Bokaro. Apply in two minutes with LinkedIn, Google or email.",
  alternates: { canonical: "/careers" },
  openGraph: { title: "Careers at Medoro", description: "Build software that thousands of Indian pharmacies run on. See open roles and apply with LinkedIn.", url: "/careers", type: "website" },
};
export const dynamic = "force-dynamic";

const SIGNIN_MSG: Record<string, string> = {
  off: "That sign-in isn’t set up yet. You can still apply with your email.",
  cancelled: "Sign-in was cancelled. You can try again or apply with your email.",
  error: "We couldn’t sign you in. Please try again or apply with your email.",
  state: "That sign-in link expired. Please try again.",
  unverified: "Your LinkedIn email isn’t verified yet. Verify it on LinkedIn or apply with your email.",
};

export default async function Careers({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const [jobs, who] = await Promise.all([publicJobs().catch(() => []), readApplicant()]);
  const applicant = who ? { name: who.name, email: who.email, via: who.via, prefill: await lastApplication(who.email) } : null;
  const signins = { linkedin: !!linkedinLogin(), google: googleLoginConfigured() };
  const src = (q.src ?? q.utm_source ?? "").slice(0, 40);
  const perks = [
    { icon: Rocket, t: "Real impact", d: "What you build ships to pharmacies across India within days." },
    { icon: GraduationCap, t: "Learn fast", d: "Small team, real ownership, and mentors who review your work." },
    { icon: HeartHandshake, t: "People first", d: "Fair pay on time, paid leave, and a team that has your back." },
    { icon: Coffee, t: "Flexible", d: "On-site in Bokaro, hybrid or remote, depending on the role." },
  ];
  return (
    <div className="site-root bg-white min-h-dvh">
      <SiteHeader />
      <SiteMotion />
      <div aria-hidden className="site-progress" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(careersJsonLd(jobs)).replace(/</g, "\\u003c") }} />
      <main>
        <section className="relative overflow-hidden">
          <Aurora />
          <FloatingShapes />
          <div className="relative max-w-[1200px] mx-auto px-6 pt-[clamp(36px,6vw,80px)] pb-10 flex flex-col gap-5 max-[640px]:px-4">
            <span className="site-up inline-flex items-center gap-2 text-[14px] font-semibold text-[var(--s-brand)]"><Sparkles size={16} aria-hidden /> Careers at Medoro · {jobs.length} open {jobs.length === 1 ? "role" : "roles"}</span>
            <h1 className="site-display site-up [--d:1] m-0 text-[clamp(36px,5vw,60px)] max-w-[860px]">Build the software India’s pharmacies run on.</h1>
            <p className="site-up [--d:2] m-0 text-[18px] leading-[1.6] text-[var(--s-ink-2)] max-w-[680px]">Join a small team in Bokaro that ships every week. Find a role below and apply in two minutes with LinkedIn, Google or your email. We reply to every applicant.</p>
            <div className="site-up [--d:3]"><ApplicantBar applicant={applicant} signins={signins} next="/careers" /></div>
            {q.signin && SIGNIN_MSG[q.signin] ? <p role="status" className="m-0 rounded-lg bg-[#FFF7E6] border border-[#F5D48A] text-[#7A4B00] px-3 py-2 text-[14px] max-w-[680px]">{SIGNIN_MSG[q.signin]}</p> : null}
          </div>
        </section>

        <section id="openings" className="bg-[var(--s-soft)] border-y border-[var(--s-line)]">
          <div className="max-w-[1200px] mx-auto px-6 py-10 max-[640px]:px-4">
            <CareersBoard jobs={jobs} applicant={applicant} src={src} signins={signins} autoApply={q.apply ?? null} />
          </div>
        </section>

        <section className="max-w-[1200px] mx-auto px-6 py-16 flex flex-col gap-8 max-[640px]:px-4">
          <h2 className="site-display m-0 text-[clamp(28px,3.4vw,40px)]">Why work at Medoro</h2>
          <div className="grid gap-4 grid-cols-1 min-[640px]:grid-cols-2 min-[1000px]:grid-cols-4">
            {perks.map((p) => (
              <div key={p.t} className="site-lift rounded-2xl border border-[var(--s-line)] bg-white p-5 flex flex-col gap-2">
                <p.icon size={26} aria-hidden className="text-[var(--s-brand)]" />
                <strong className="text-[17px]">{p.t}</strong>
                <span className="text-[15px] text-[var(--s-ink-2)]">{p.d}</span>
              </div>
            ))}
          </div>
          <div className="rounded-2xl bg-[var(--s-brand-tint)] p-6 flex gap-3 items-start text-[15px] text-[var(--s-ink-2)]">
            <BadgeCheck size={22} aria-hidden className="text-[var(--s-brand)] flex-none mt-0.5" />
            <span><strong className="text-[var(--s-ink)]">How hiring works.</strong> Apply → a short call with HR → one or two interviews with the team → offer. Every applicant gets an email confirmation straight away. Medoro never charges a fee and never asks for money at any stage.</span>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

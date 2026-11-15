import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, BriefcaseBusiness } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { ApplicantBar } from "@/components/site/careers";
import { readApplicant, linkedinLogin } from "@/server/applicant";
import { googleLoginConfigured } from "@/server/google-oidc";
import { mailEnabled } from "@/server/mail";
import { myApplications } from "@/staff/hrms/careers";

export const metadata: Metadata = { title: "My applications · Careers at Medoro", robots: { index: false } };
export const dynamic = "force-dynamic";

const TONE: Record<string, string> = { applied: "bg-[var(--s-brand-tint)] text-[var(--s-brand)]", interview: "bg-[#EEF2FF] text-[#4338CA]", offer: "bg-[#FFF7E6] text-[#7A4B00]", hired: "bg-[#E8F5EC] text-[#146C43]", rejected: "bg-[var(--s-soft)] text-[var(--s-muted)]" };

export default async function MyApplications() {
  const who = await readApplicant();
  const signins = { linkedin: !!linkedinLogin(), google: googleLoginConfigured(), email: mailEnabled() };
  const rows = who ? await myApplications(who.email) : [];
  return (
    <div className="site-root bg-white min-h-dvh">
      <SiteHeader />
      <main className="bg-[var(--s-soft)] border-t border-[var(--s-line)] min-h-[60dvh]">
        <div className="max-w-[860px] mx-auto px-6 py-10 flex flex-col gap-5 max-[640px]:px-4">
          <Link href="/careers" className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[var(--s-brand)] no-underline"><ArrowLeft size={15} aria-hidden /> All jobs</Link>
          <h1 className="site-display m-0 text-[clamp(28px,3.4vw,40px)]">My applications</h1>
          {!who ? (
            <div className="rounded-2xl bg-white border border-[var(--s-line)] p-6 flex flex-col gap-4">
              <p className="m-0 text-[15px] text-[var(--s-ink-2)]">Sign in with the email you applied with (LinkedIn, Google or an email code) to see where your applications stand.</p>
              <ApplicantBar applicant={null} signins={signins} next="/careers/applications" />
              {!signins.linkedin && !signins.google && !signins.email ? <p className="m-0 text-[14px] text-[var(--s-muted)]">Online tracking isn’t switched on yet. Your confirmation email has your application reference: reply to it with any question.</p> : null}
            </div>
          ) : (
            <>
              <div className="rounded-2xl bg-white border border-[var(--s-line)] p-5"><ApplicantBar applicant={{ name: who.name, email: who.email, via: who.via }} signins={signins} next="/careers/applications" /></div>
              {rows.length ? (
                <ul className="m-0 p-0 list-none flex flex-col gap-3">
                  {rows.map((r) => (
                    <li key={r.id} className="rounded-2xl bg-white border border-[var(--s-line)] p-5 flex flex-wrap gap-3 items-center">
                      <BriefcaseBusiness size={22} aria-hidden className="text-[var(--s-brand)]" />
                      <div className="flex-1 min-w-[200px] flex flex-col">
                        {r.slug ? <Link href={`/careers/${r.slug}`} className="text-[16px] font-semibold text-[var(--s-ink)] no-underline hover:underline">{r.title}</Link> : <strong className="text-[16px]">{r.title}</strong>}
                        <span className="text-[13.5px] text-[var(--s-muted)]">{[r.dept, r.location].filter(Boolean).join(" · ")} · Applied {new Date(r.at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })} · Ref {r.ref}</span>
                      </div>
                      <span className={`inline-flex items-center h-8 px-3 rounded-full text-[13.5px] font-semibold ${TONE[r.stage] ?? TONE.applied}`}>{r.status}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="m-0 rounded-2xl bg-white border border-[var(--s-line)] p-6 text-[15px] text-[var(--s-ink-2)]">No applications with {who.email} yet. <Link href="/careers">See open jobs</Link>.</p>}
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

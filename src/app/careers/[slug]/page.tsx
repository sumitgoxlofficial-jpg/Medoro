import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { ApplicantBar, JobDetail } from "@/components/site/careers";
import { readApplicant, linkedinLogin } from "@/server/applicant";
import { googleLoginConfigured } from "@/server/google-oidc";
import { publicJob, publicJobs, lastApplication } from "@/staff/hrms/careers";
import { jobPostingLd } from "../seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const j = await publicJob((await params).slug);
  if (!j) return { title: "Job not found · Medoro careers" };
  const desc = `${j.type} · ${j.mode} · ${j.location}. ${j.description.replace(/\s+/g, " ").slice(0, 150)}`;
  return {
    title: `${j.title} · ${j.location} · Careers at Medoro`,
    description: desc,
    alternates: { canonical: `/careers/${j.slug}` },
    openGraph: { title: `${j.title} at Medoro`, description: desc, url: `/careers/${j.slug}`, type: "website" },
    robots: j.open ? undefined : { index: false },
  };
}

export default async function JobPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ slug }, q] = await Promise.all([params, searchParams]);
  const [job, who] = await Promise.all([publicJob(slug), readApplicant()]);
  if (!job) notFound();
  const more = job.open ? (await publicJobs().catch(() => [])).filter((j) => j.slug !== job.slug).slice(0, 4) : (await publicJobs().catch(() => [])).slice(0, 4);
  const applicant = who ? { name: who.name, email: who.email, via: who.via, prefill: await lastApplication(who.email) } : null;
  const signins = { linkedin: !!linkedinLogin(), google: googleLoginConfigured() };
  const src = (q.src ?? q.utm_source ?? "").slice(0, 40);
  const here = `/careers/${job.slug}${src ? `?src=${encodeURIComponent(src)}` : ""}`;
  return (
    <div className="site-root bg-white min-h-dvh">
      <SiteHeader />
      {job.open ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jobPostingLd(job)).replace(/</g, "\\u003c") }} /> : null}
      <main className="bg-[var(--s-soft)] border-t border-[var(--s-line)]">
        <div className="max-w-[1200px] mx-auto px-6 py-8 grid gap-6 grid-cols-1 min-[1000px]:grid-cols-[minmax(0,1fr)_320px] items-start max-[640px]:px-4">
          <div className="flex flex-col gap-4 min-w-0">
            <Link href={`/careers${src ? `?src=${encodeURIComponent(src)}` : ""}`} className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[var(--s-brand)] no-underline"><ArrowLeft size={15} aria-hidden /> All jobs</Link>
            {q.signin ? <p role="status" className="m-0 rounded-lg bg-[#FFF7E6] border border-[#F5D48A] text-[#7A4B00] px-3 py-2 text-[14px]">We couldn’t sign you in that way. You can still apply with your email.</p> : null}
            <div className="rounded-2xl bg-white border border-[var(--s-line)] p-7 max-[640px]:p-4">
              <JobDetail job={job} applicant={applicant} src={src} signins={signins} autoApply={q.apply === job.slug} full />
            </div>
          </div>
          <aside className="flex flex-col gap-4 min-[1000px]:sticky min-[1000px]:top-24">
            <div className="rounded-2xl bg-white border border-[var(--s-line)] p-5"><ApplicantBar applicant={applicant} signins={signins} next={here} />{!applicant && !signins.linkedin && !signins.google ? <span className="text-[14px] text-[var(--s-ink-2)]">Apply with your email: no account needed.</span> : null}</div>
            {more.length ? (
              <div className="rounded-2xl bg-white border border-[var(--s-line)] p-5 flex flex-col gap-3">
                <strong className="text-[16px]">More jobs at Medoro</strong>
                {more.map((j) => (
                  <Link key={j.slug} href={`/careers/${j.slug}`} className="flex flex-col no-underline border-t border-[var(--s-line-2)] pt-3 first-of-type:border-0 first-of-type:pt-0 group">
                    <span className="text-[15px] font-semibold text-[var(--s-ink)] group-hover:underline">{j.title}</span>
                    <span className="text-[13.5px] text-[var(--s-muted)]">{j.location} · {j.mode} · {j.type}</span>
                  </Link>
                ))}
              </div>
            ) : null}
          </aside>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

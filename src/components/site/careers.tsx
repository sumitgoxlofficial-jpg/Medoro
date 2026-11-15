"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Mail, Banknote, BriefcaseBusiness, Building2, Check, CheckCircle2, Clock, Copy, FileText, LogOut, MapPin, Search, Send, Share2, Sparkles, Users, X } from "lucide-react";
import type { Prefill, PublicJob } from "@/staff/hrms/careers";
import { applyForJob, sendCareersCode, signOutApplicant, verifyCareersCode } from "@/app/careers/actions";

export type ApplicantView = { name: string; email: string; via: "linkedin" | "google" | "email"; prefill?: Prefill | null } | null;
const VIA: Record<string, string> = { linkedin: "LinkedIn", google: "Google", email: "an email code" };
const anySignin = (s: Props["signins"]) => s.linkedin || s.google || s.email;
type Props = { applicant: ApplicantView; src: string; signins: { linkedin: boolean; google: boolean; email: boolean } };

const LI_BLUE = "#0A66C2";
const daysAgo = (iso: string) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? "Today" : d === 1 ? "1 day ago" : d < 30 ? `${d} days ago` : d < 60 ? "1 month ago" : `${Math.floor(d / 30)} months ago`;
};
const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

/** Plain text from HR: blank lines split paragraphs, lines starting with - or • become bullets. */
export function Rich({ text }: { text: string }) {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return <>{blocks.map((b, i) => {
    const lines = b.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.every((l) => /^[-•*]\s+/.test(l))) return <ul key={i} className="m-0 mb-3 pl-5 list-disc flex flex-col gap-1.5 marker:text-[var(--s-brand)]">{lines.map((l, k) => <li key={k}>{l.replace(/^[-•*]\s+/, "")}</li>)}</ul>;
    return <p key={i} className="m-0 mb-3 whitespace-pre-line">{b}</p>;
  })}</>;
}

function CompanyTile({ size = 48 }: { title?: string; size?: number }) {
  return <span aria-hidden className="flex-none grid place-items-center rounded-lg bg-white border border-[var(--s-line)] shadow-[0_1px_2px_rgba(14,22,20,.06)]" style={{ width: size, height: size, padding: size * 0.14 }}><Image src="/medoro-mark.png" alt="" width={655} height={530} className="w-full h-auto" /></span>;
}

function Chip({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "brand" | "green" }) {
  const c = tone === "brand" ? "bg-[var(--s-brand-tint)] text-[var(--s-brand)] border-transparent" : tone === "green" ? "bg-[#E8F5EC] text-[#146C43] border-transparent" : "bg-white text-[var(--s-ink-2)] border-[var(--s-line)]";
  return <span className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-full border text-[13px] font-medium whitespace-nowrap ${c}`}>{children}</span>;
}

// ── Signed-in strip
export function ApplicantBar({ applicant, signins, next }: { applicant: ApplicantView; signins: Props["signins"]; next: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [byEmail, setByEmail] = useState(false);
  if (!applicant) {
    if (!anySignin(signins)) return null;
    if (byEmail) return <div className="max-w-[440px]"><EmailCodeSignIn onDone={() => { setByEmail(false); router.refresh(); }} onCancel={() => setByEmail(false)} /></div>;
    return (
      <div className="flex flex-wrap items-center gap-2 text-[14px] text-[var(--s-ink-2)]">
        <span>Sign in to apply faster and track your applications:</span>
        {signins.linkedin ? <a href={`/api/careers/linkedin/start?next=${encodeURIComponent(next)}`} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-white text-[14px] font-semibold no-underline hover:text-white hover:opacity-90" style={{ background: LI_BLUE }}><LinkedInMark /> LinkedIn</a> : null}
        {signins.google ? <a href={`/api/auth/google/start?intent=careers&next=${encodeURIComponent(next)}`} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-[#C9D1CF] bg-white text-[var(--s-ink)] text-[14px] font-semibold no-underline hover:border-[var(--s-ink)] hover:text-[var(--s-ink)]"><GoogleMark /> Google</a> : null}
        {signins.email ? <button type="button" onClick={() => setByEmail(true)} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-[#C9D1CF] bg-white text-[var(--s-ink)] text-[14px] font-semibold cursor-pointer hover:border-[var(--s-ink)]"><Mail size={16} aria-hidden /> Email code</button> : null}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 text-[14px]">
      <span className="grid place-items-center size-9 rounded-full bg-[var(--s-brand)] text-white font-bold text-[13px]">{initials(applicant.name || applicant.email)}</span>
      <span className="flex flex-col leading-tight"><strong>{applicant.name || applicant.email}</strong><span className="text-[12.5px] text-[var(--s-muted)]">Signed in with {VIA[applicant.via]} · {applicant.email}</span></span>
      <Link href="/careers/applications" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-[var(--s-line)] bg-white text-[var(--s-ink)] font-semibold no-underline hover:border-[var(--s-brand)]"><BriefcaseBusiness size={15} aria-hidden /> My applications</Link>
      <button type="button" disabled={pending} onClick={() => start(async () => { await signOutApplicant(); router.refresh(); })} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-transparent border-0 text-[var(--s-muted)] cursor-pointer hover:text-[var(--s-ink)]"><LogOut size={15} aria-hidden /> Sign out</button>
    </div>
  );
}

// ── The board: search, filters, list and the selected job side by side (stacked on phones)
export function CareersBoard({ jobs, applicant, src, signins, autoApply }: Props & { jobs: PublicJob[]; autoApply: string | null }) {
  const router = useRouter();
  const [q, setQ] = useState(""), [where, setWhere] = useState("");
  const [dept, setDept] = useState(""), [type, setType] = useState(""), [mode, setMode] = useState("");
  const [sel, setSel] = useState<string | null>(jobs[0]?.slug ?? null);
  const detailRef = useRef<HTMLDivElement>(null);
  const opts = (k: "dept" | "type" | "mode") => [...new Set(jobs.map((j) => j[k]).filter(Boolean))].sort();
  const shown = useMemo(() => jobs.filter((j) => {
    const hay = `${j.title} ${j.dept} ${j.skills.join(" ")} ${j.description}`.toLowerCase();
    return (!q || q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) && (!where || j.location.toLowerCase().includes(where.toLowerCase()) || (where.toLowerCase() === "remote" && j.mode === "Remote"))
      && (!dept || j.dept === dept) && (!type || j.type === type) && (!mode || j.mode === mode);
  }), [jobs, q, where, dept, type, mode]);
  const job = shown.find((j) => j.slug === sel) ?? shown[0] ?? null;
  const pick = (slug: string) => {
    if (window.matchMedia("(max-width: 959px)").matches) { router.push(`/careers/${slug}${src ? `?src=${encodeURIComponent(src)}` : ""}`); return; }
    setSel(slug);
    detailRef.current?.scrollTo({ top: 0 });
  };
  const sel_ = "h-10 px-3 rounded-full border border-[var(--s-line)] bg-white text-[14px] text-[var(--s-ink)] cursor-pointer";

  return (
    <div className="flex flex-col gap-5">
      <form role="search" onSubmit={(e) => e.preventDefault()} className="flex flex-wrap gap-2 p-2 rounded-2xl bg-white border border-[var(--s-line)] shadow-[0_20px_40px_-30px_rgba(11,94,91,.5)]">
        <label className="flex-1 min-w-[220px] flex items-center gap-2 px-3 h-12 rounded-xl bg-[var(--s-soft)]"><Search size={18} aria-hidden className="text-[var(--s-muted)]" /><span className="sr-only">Search jobs</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, skill or team" className="flex-1 bg-transparent border-0 outline-none text-[15px]" /></label>
        <label className="flex-1 min-w-[180px] flex items-center gap-2 px-3 h-12 rounded-xl bg-[var(--s-soft)]"><MapPin size={18} aria-hidden className="text-[var(--s-muted)]" /><span className="sr-only">Location</span><input value={where} onChange={(e) => setWhere(e.target.value)} placeholder="City or “remote”" className="flex-1 bg-transparent border-0 outline-none text-[15px]" /></label>
      </form>
      <div className="flex flex-wrap gap-2 items-center">
        <select aria-label="Team" className={sel_} value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All teams</option>{opts("dept").map((x) => <option key={x}>{x}</option>)}</select>
        <select aria-label="Job type" className={sel_} value={type} onChange={(e) => setType(e.target.value)}><option value="">Any job type</option>{opts("type").map((x) => <option key={x}>{x}</option>)}</select>
        <select aria-label="Workplace" className={sel_} value={mode} onChange={(e) => setMode(e.target.value)}><option value="">On-site, hybrid or remote</option>{opts("mode").map((x) => <option key={x}>{x}</option>)}</select>
        {q || where || dept || type || mode ? <button type="button" onClick={() => { setQ(""); setWhere(""); setDept(""); setType(""); setMode(""); }} className="h-10 px-3 rounded-full border-0 bg-transparent text-[14px] font-semibold text-[var(--s-brand)] cursor-pointer">Clear filters</button> : null}
        <span className="ml-auto text-[14px] text-[var(--s-muted)]">{shown.length} {shown.length === 1 ? "opening" : "openings"}</span>
      </div>

      {jobs.length === 0 ? <NoJobs /> : shown.length === 0 ? <p className="m-0 py-12 text-center text-[var(--s-muted)]">No openings match. Try clearing a filter.</p> : (
        <div className="grid grid-cols-1 min-[960px]:grid-cols-[minmax(0,400px)_minmax(0,1fr)] rounded-2xl border border-[var(--s-line)] bg-white overflow-hidden">
          <ul className="m-0 p-0 list-none min-[960px]:max-h-[calc(100dvh-140px)] min-[960px]:overflow-y-auto min-[960px]:border-r border-[var(--s-line)]">
            {shown.map((j) => {
              const on = job?.slug === j.slug;
              return (
                <li key={j.slug} className="border-b border-[var(--s-line-2)] last:border-0">
                  <button type="button" onClick={() => pick(j.slug)} aria-current={on ? "true" : undefined}
                    className={`w-full text-left flex gap-3 p-4 bg-transparent border-0 cursor-pointer border-l-[3px] transition-colors ${on ? "bg-[var(--s-brand-tint)] border-l-[var(--s-brand)]" : "border-l-transparent hover:bg-[var(--s-soft)]"}`}>
                    <CompanyTile title={j.dept || j.title} />
                    <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                      <strong className={`text-[16px] leading-snug ${on ? "text-[var(--s-brand)]" : "text-[var(--s-ink)]"} underline-offset-2 hover:underline`}>{j.title}</strong>
                      <span className="text-[14px] text-[var(--s-ink-2)]">Medoro · {j.dept}</span>
                      <span className="text-[13.5px] text-[var(--s-muted)]">{j.location} ({j.mode}) · {j.type}</span>
                      <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px]">
                        <span className="text-[#146C43] font-semibold inline-flex items-center gap-1"><Sparkles size={13} aria-hidden /> Easy Apply</span>
                        <span className="text-[var(--s-muted)]" suppressHydrationWarning>{daysAgo(j.postedAt)}</span>
                        {j.applicants ? <span className="text-[var(--s-muted)]">{j.applicants} applicant{j.applicants === 1 ? "" : "s"}</span> : <span className="text-[var(--s-brand)] font-semibold">Be an early applicant</span>}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div ref={detailRef} className="hidden min-[960px]:block min-[960px]:max-h-[calc(100dvh-140px)] overflow-y-auto">
            {job ? <JobDetail key={job.slug} job={job} applicant={applicant} src={src} signins={signins} autoApply={autoApply === job.slug} /> : null}
          </div>
        </div>
      )}
    </div>
  );
}

function NoJobs() {
  return (
    <div className="rounded-2xl border border-dashed border-[#C9D1CF] bg-white p-10 text-center flex flex-col items-center gap-3">
      <BriefcaseBusiness size={36} aria-hidden className="text-[var(--s-brand)]" />
      <h2 className="m-0 text-[22px]">No openings right now</h2>
      <p className="m-0 max-w-[480px] text-[var(--s-ink-2)]">We post every new role here first. You can still write to us at <a href="mailto:careers@medoro.in">careers@medoro.in</a> with your résumé and the kind of work you enjoy.</p>
    </div>
  );
}

// ── One job: header, actions and the full description
export function JobDetail({ job, applicant, src, signins, autoApply = false, full = false }: Props & { job: PublicJob & { open?: boolean }; autoApply?: boolean; full?: boolean }) {
  const [applying, setApplying] = useState(autoApply);
  const [done, setDone] = useState<{ ref: string; emailed: boolean } | null>(null);
  const open = job.open !== false;
  return (
    <article className={full ? "" : "p-6 max-[640px]:p-4"}>
      <div className="flex gap-4 items-start">
        <CompanyTile title={job.dept || job.title} size={full ? 64 : 56} />
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <span className="text-[14px] text-[var(--s-ink-2)] inline-flex items-center gap-1.5"><Building2 size={14} aria-hidden /> Medoro · {job.dept}</span>
          {full ? <h1 className="m-0 text-[clamp(26px,3.4vw,36px)] leading-tight">{job.title}</h1> : <h2 className="m-0 text-[24px] leading-tight"><Link href={`/careers/${job.slug}${src ? `?src=${encodeURIComponent(src)}` : ""}`} className="text-[var(--s-ink)] no-underline hover:underline">{job.title}</Link></h2>}
          <span className="text-[14px] text-[var(--s-muted)]" suppressHydrationWarning>{job.location} · {daysAgo(job.postedAt)} · {job.applicants ? `${job.applicants} applicant${job.applicants === 1 ? "" : "s"}` : "Be an early applicant"}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mt-4">
        <Chip tone="brand"><BriefcaseBusiness size={13} aria-hidden /> {job.type}</Chip>
        <Chip tone="brand"><MapPin size={13} aria-hidden /> {job.mode}</Chip>
        {job.experience ? <Chip><Clock size={13} aria-hidden /> {job.experience} experience</Chip> : null}
        {job.salary ? <Chip tone="green"><Banknote size={13} aria-hidden /> {job.salary}</Chip> : null}
        {job.openings > 1 ? <Chip><Users size={13} aria-hidden /> {job.openings} openings</Chip> : null}
      </div>
      <div className="flex flex-wrap gap-2 mt-5 items-center">
        {done ? <span className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-[#E8F5EC] text-[#146C43] font-semibold"><CheckCircle2 size={18} aria-hidden /> Applied · {done.ref}</span>
          : open ? <button type="button" onClick={() => setApplying(true)} className="site-cta relative overflow-hidden inline-flex items-center gap-2 h-11 px-6 rounded-full bg-[var(--s-brand)] text-white text-[16px] font-semibold border-0 cursor-pointer hover:bg-[var(--s-brand-ink)]"><Sparkles size={17} aria-hidden /> Easy Apply</button>
          : <span className="inline-flex items-center h-11 px-5 rounded-full bg-[var(--s-soft)] text-[var(--s-muted)] font-semibold">No longer accepting applications</span>}
        <ShareMenu job={job} />
      </div>

      <div className="mt-7 flex flex-col gap-6 text-[15.5px] leading-[1.65] text-[var(--s-ink-2)]">
        {job.description ? <section><h3 className="m-0 mb-2 text-[19px] text-[var(--s-ink)]">About the job</h3><Rich text={job.description} /></section> : null}
        {job.requirements ? <section><h3 className="m-0 mb-2 text-[19px] text-[var(--s-ink)]">What we’re looking for</h3><Rich text={job.requirements} /></section> : null}
        {job.skills.length ? <section><h3 className="m-0 mb-2 text-[19px] text-[var(--s-ink)]">Skills</h3><div className="flex flex-wrap gap-2">{job.skills.map((s) => <Chip key={s}><Check size={13} aria-hidden /> {s}</Chip>)}</div></section> : null}
        {job.benefits ? <section><h3 className="m-0 mb-2 text-[19px] text-[var(--s-ink)]">What you get</h3><Rich text={job.benefits} /></section> : null}
        <section className="rounded-xl bg-[var(--s-soft)] border border-[var(--s-line)] p-4 text-[14px]">
          <strong className="text-[var(--s-ink)]">About Medoro.</strong> Medoro builds billing, stock, GST and accounting software for Indian pharmacies, made in Bokaro. We are a small team that ships every week and listens to pharmacists. Medoro never asks for money at any stage of hiring.
        </section>
      </div>
      {applying && open ? <ApplyModal job={job} applicant={applicant} src={src} signins={signins} onClose={() => setApplying(false)} onDone={(r) => { setDone(r); }} /> : null}
    </article>
  );
}

function ShareMenu({ job }: { job: PublicJob }) {
  const [open, setOpen] = useState(false), [copied, setCopied] = useState(false);
  const url = () => `${window.location.origin}/careers/${job.slug}`;
  const go = (href: string) => window.open(href, "_blank", "noopener,noreferrer");
  return (
    <div className="relative">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="inline-flex items-center gap-2 h-11 px-5 rounded-full border border-[var(--s-brand)] bg-white text-[var(--s-brand)] text-[15px] font-semibold cursor-pointer hover:bg-[var(--s-brand-tint)]"><Share2 size={16} aria-hidden /> Share</button>
      {open ? (
        <div className="absolute z-20 left-0 top-12 w-56 rounded-xl border border-[var(--s-line)] bg-white shadow-[0_20px_40px_-20px_rgba(14,22,20,.35)] p-1.5 flex flex-col">
          <button type="button" className="text-left flex items-center gap-2 px-3 py-2 rounded-lg bg-transparent border-0 cursor-pointer hover:bg-[var(--s-soft)] text-[14px]" onClick={() => go(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url() + "?src=linkedin")}`)}><LinkedInMark color={LI_BLUE} /> Share on LinkedIn</button>
          <button type="button" className="text-left flex items-center gap-2 px-3 py-2 rounded-lg bg-transparent border-0 cursor-pointer hover:bg-[var(--s-soft)] text-[14px]" onClick={() => go(`https://wa.me/?text=${encodeURIComponent(`${job.title} at Medoro: ${url()}?src=whatsapp`)}`)}><Send size={15} aria-hidden className="text-[#146C43]" /> Send on WhatsApp</button>
          <button type="button" className="text-left flex items-center gap-2 px-3 py-2 rounded-lg bg-transparent border-0 cursor-pointer hover:bg-[var(--s-soft)] text-[14px]" onClick={() => { void navigator.clipboard?.writeText(url()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>{copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />} {copied ? "Link copied" : "Copy link"}</button>
        </div>
      ) : null}
    </div>
  );
}

// ── Easy Apply
function ApplyModal({ job, applicant, src, signins, onClose, onDone }: Props & { job: PublicJob; onClose: () => void; onDone: (r: { ref: string; emailed: boolean }) => void }) {
  const [step, setStep] = useState<"choose" | "code" | "form" | "sent">(applicant || !anySignin(signins) ? "form" : "choose");
  const router = useRouter();
  const [err, setErr] = useState(""), [pending, start] = useTransition(), [sent, setSent] = useState<{ ref: string; emailed: boolean; email: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  // Details filled in for the applicant: their last Medoro application (signed in), else what this browser remembers.
  const [saved, setSaved] = useState<Partial<Record<"name" | "email" | "phone" | "location" | "experience" | "linkedin", string>> | null>(null);
  useEffect(() => { try { const v = localStorage.getItem(SAVED_KEY); if (v) setSaved(JSON.parse(v)); } catch {} }, []);
  const prev = applicant?.prefill ?? null;
  const pre = { ...saved, ...Object.fromEntries(Object.entries(prev ?? {}).filter(([, v]) => v)) } as Partial<Record<"name" | "email" | "phone" | "location" | "experience" | "linkedin", string>>;
  const [reuse, setReuse] = useState(!!prev?.resumeName);
  const next = `/careers/${job.slug}?apply=${job.slug}${src ? `&src=${encodeURIComponent(src)}` : ""}`;
  const box = useRef<HTMLDivElement>(null), closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", k); document.body.style.overflow = "hidden";
    box.current?.querySelector<HTMLElement>("input,button,a")?.focus();
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, []);
  const inp = "w-full h-11 px-3 rounded-lg border border-[#C9D1CF] bg-white text-[15px] outline-none focus:border-[var(--s-brand)] focus:shadow-[0_0_0_3px_var(--s-brand-tint)] disabled:bg-[var(--s-soft)] disabled:text-[var(--s-muted)]";
  const lbl = "flex flex-col gap-1.5 text-[14px] font-semibold text-[var(--s-ink)]";

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErr("");
    const fd = new FormData(e.currentTarget);
    if (applicant) fd.set("email", applicant.email);
    start(async () => {
      const r = await applyForJob(fd);
      if (!r.ok) { setErr(r.error); return; }
      try { localStorage.setItem(SAVED_KEY, JSON.stringify({ name: fd.get("name"), email: fd.get("email"), phone: fd.get("phone"), location: fd.get("location"), experience: fd.get("experience"), linkedin: fd.get("linkedin") })); } catch {}
      setSent({ ...r.data, email: String(fd.get("email")) });
      setStep("sent");
      onDone(r.data);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end min-[640px]:items-center justify-center bg-[rgba(14,22,20,.55)] p-0 min-[640px]:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !pending) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="apply-title" className="site-up w-full max-w-[600px] max-h-[92dvh] overflow-y-auto bg-white rounded-t-2xl min-[640px]:rounded-2xl shadow-2xl">
        <div className="sticky top-0 z-10 bg-white flex items-center gap-3 px-5 py-4 border-b border-[var(--s-line)]">
          <div className="flex-1 min-w-0"><h2 id="apply-title" className="m-0 text-[19px]">Apply to Medoro</h2><span className="text-[13.5px] text-[var(--s-muted)] truncate block">{job.title} · {job.location}</span></div>
          <button type="button" aria-label="Close" onClick={onClose} className="grid place-items-center size-9 rounded-full border-0 bg-transparent cursor-pointer hover:bg-[var(--s-soft)]"><X size={20} aria-hidden /></button>
        </div>

        {step === "choose" ? (
          <div className="p-5 flex flex-col gap-3">
            <p className="m-0 text-[15px] text-[var(--s-ink-2)]">Sign in to fill in your verified name and email, then track your application here.</p>
            {signins.linkedin ? <a href={`/api/careers/linkedin/start?next=${encodeURIComponent(next)}`} className="flex items-center justify-center gap-2 h-12 rounded-full text-white text-[16px] font-semibold no-underline hover:text-white hover:opacity-90" style={{ background: LI_BLUE }}><LinkedInMark /> Apply with LinkedIn</a> : null}
            {signins.google ? <a href={`/api/auth/google/start?intent=careers&next=${encodeURIComponent(next)}`} className="flex items-center justify-center gap-2 h-12 rounded-full border border-[#C9D1CF] text-[var(--s-ink)] text-[16px] font-semibold no-underline hover:border-[var(--s-ink)] hover:text-[var(--s-ink)]"><GoogleMark /> Apply with Google</a> : null}
            {signins.email ? <button type="button" onClick={() => setStep("code")} className="flex items-center justify-center gap-2 h-12 rounded-full border border-[#C9D1CF] bg-white text-[var(--s-ink)] text-[16px] font-semibold cursor-pointer hover:border-[var(--s-ink)]"><Mail size={18} aria-hidden /> Sign in with an email code</button> : null}
            {signins.email ? <span className="text-[13px] text-[var(--s-muted)] text-center -mt-1">Use the email code if you’re on Naukri or don’t use LinkedIn or Google.</span> : null}
            <div className="flex items-center gap-3 text-[13px] text-[var(--s-muted)] my-1"><span className="flex-1 h-px bg-[var(--s-line)]" />or<span className="flex-1 h-px bg-[var(--s-line)]" /></div>
            <button type="button" onClick={() => setStep("form")} className="h-12 rounded-full border border-[var(--s-brand)] bg-white text-[var(--s-brand)] text-[16px] font-semibold cursor-pointer hover:bg-[var(--s-brand-tint)]">Apply without signing in</button>
          </div>
        ) : step === "code" ? (
          <div className="p-5"><EmailCodeSignIn onDone={() => { router.refresh(); setStep("form"); }} onCancel={() => setStep("choose")} /></div>
        ) : step === "sent" && sent ? (
          <div className="p-8 flex flex-col items-center text-center gap-3">
            <span className="grid place-items-center size-16 rounded-full bg-[#E8F5EC] text-[#146C43]"><CheckCircle2 size={34} aria-hidden /></span>
            <h3 className="m-0 text-[22px]">Your application was sent</h3>
            <p className="m-0 text-[15px] text-[var(--s-ink-2)] max-w-[440px]">Thank you for your interest in the {job.title} role. {sent.emailed ? <>We’ve emailed a confirmation to <strong>{sent.email}</strong>.</> : null} Our team reviews every application and will reach out if your profile is a match.</p>
            <span className="text-[14px] text-[var(--s-muted)]">Application reference <strong className="text-[var(--s-ink)]">{sent.ref}</strong></span>
            <div className="flex gap-2 mt-2 flex-wrap justify-center">
              {applicant ? <Link href="/careers/applications" className="inline-flex items-center h-11 px-5 rounded-full bg-[var(--s-brand)] text-white font-semibold no-underline hover:text-white">My applications</Link> : null}
              <Link href="/careers" onClick={onClose} className="inline-flex items-center h-11 px-5 rounded-full border border-[#C9D1CF] text-[var(--s-ink)] font-semibold no-underline">See more jobs</Link>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="p-5 flex flex-col gap-4" noValidate={false}>
            {applicant ? <div className="flex items-center gap-2 rounded-lg bg-[var(--s-brand-tint)] px-3 py-2 text-[13.5px] text-[var(--s-brand)]"><CheckCircle2 size={16} aria-hidden /> Email verified{applicant.via === "email" ? "" : ` with ${VIA[applicant.via]}`}: {applicant.email}</div> : null}
            <input type="hidden" name="jobId" value={job.id} />
            <input type="hidden" name="src" value={src} />
            <div aria-hidden className="absolute -left-[9999px] w-px h-px overflow-hidden"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
            {prev || saved ? <p className="m-0 -mb-1 text-[13px] text-[var(--s-muted)] inline-flex items-center gap-1.5"><Sparkles size={14} aria-hidden className="text-[var(--s-brand)]" /> We filled in your details from {prev ? "your last application" : "this device"}. Check them before sending.</p> : null}
            <div key={saved ? "saved" : "blank"} className="grid grid-cols-1 min-[560px]:grid-cols-2 gap-4">
              <label className={lbl}>Full name *<input name="name" required minLength={3} maxLength={80} autoComplete="name" defaultValue={applicant?.name || pre.name || ""} className={inp} /></label>
              <label className={lbl}>Email *<input name="email" type="email" required autoComplete="email" defaultValue={applicant?.email ?? pre.email ?? ""} disabled={!!applicant} className={inp} /></label>
              <label className={lbl}>Mobile number *<input name="phone" type="tel" required inputMode="tel" autoComplete="tel" placeholder="+91 98xxxxxxxx" pattern="\+?[\d\s\-]{10,16}" defaultValue={pre.phone ?? ""} className={inp} /></label>
              <label className={lbl}>Current city<input name="location" maxLength={60} autoComplete="address-level2" defaultValue={pre.location ?? ""} className={inp} /></label>
              <label className={lbl}>Experience<select name="experience" className={inp} defaultValue={pre.experience ?? ""}><option value="">Choose…</option>{["Fresher", "Less than 1 year", "1–2 years", "2–4 years", "4–7 years", "7+ years"].map((x) => <option key={x}>{x}</option>)}</select></label>
              <label className={lbl}>LinkedIn profile<input name="linkedin" type="url" placeholder="https://linkedin.com/in/you" maxLength={200} defaultValue={pre.linkedin ?? ""} className={inp} /></label>
            </div>
            <div className={lbl}>Résumé (PDF) *
              {prev?.resumeName && reuse && !file ? (
                <div className="flex items-center gap-3 rounded-xl border-2 border-[var(--s-brand)] bg-[var(--s-brand-tint)] px-4 py-4 font-normal">
                  <input type="hidden" name="reuseResume" value="1" />
                  <FileText size={24} aria-hidden className="text-[var(--s-brand)] flex-none" />
                  <span className="flex-1 min-w-0 text-[14px]"><strong className="block truncate">{prev.resumeName}</strong><span className="text-[var(--s-muted)]">From your last application</span></span>
                  <button type="button" onClick={() => setReuse(false)} className="h-9 px-3 rounded-full border border-[var(--s-brand)] bg-white text-[var(--s-brand)] text-[13.5px] font-semibold cursor-pointer">Upload new</button>
                </div>
              ) : (
                <label className={`flex items-center gap-3 rounded-xl border-2 border-dashed px-4 py-4 cursor-pointer font-normal ${file ? "border-[var(--s-brand)] bg-[var(--s-brand-tint)]" : "border-[#C9D1CF] hover:border-[var(--s-brand)]"}`}>
                  <FileText size={24} aria-hidden className="text-[var(--s-brand)] flex-none" />
                  <span className="flex-1 min-w-0 text-[14px]">{file ? <><strong className="block truncate">{file.name}</strong><span className="text-[var(--s-muted)]">{(file.size / 1024 / 1024).toFixed(1)} MB · tap to change</span></> : <><strong>Upload your résumé</strong><span className="block text-[var(--s-muted)]">PDF, up to 4 MB</span></>}</span>
                  <input name="resume" type="file" accept="application/pdf,.pdf" required className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </label>
              )}
              {!prev?.resumeName && applicant?.via === "linkedin" && !file ? <span className="font-normal text-[13px] text-[var(--s-muted)] leading-snug">No résumé handy? Use your LinkedIn profile: open <a href="https://www.linkedin.com/in/me/" target="_blank" rel="noopener noreferrer">your profile</a> → <strong>Resources</strong> (or <strong>More</strong>) → <strong>Save to PDF</strong>, then upload that file here.</span> : null}
            </div>
            <label className={lbl}>Why this role? <span className="font-normal text-[var(--s-muted)] text-[13px] -mt-1">Optional. A few lines about you and what you’d like to work on.</span><textarea name="cover" rows={4} maxLength={3000} className={`${inp} h-auto py-2 resize-y`} /></label>
            <label className="flex items-start gap-2.5 text-[13.5px] text-[var(--s-ink-2)]"><input type="checkbox" name="consent" required className="mt-1 size-4 accent-[var(--s-brand)]" /><span>I agree that Medoro may store and use these details to assess my application and contact me about it, as described in the <a href="/legal#privacy" target="_blank">privacy policy</a>.</span></label>
            {err ? <p role="alert" className="m-0 rounded-lg bg-[#FDECEA] text-[#B3261E] px-3 py-2 text-[14px]">{err}</p> : null}
            <div className="flex gap-2 justify-end items-center pt-1">
              {!applicant && anySignin(signins) ? <button type="button" onClick={() => setStep("choose")} className="mr-auto inline-flex items-center gap-1 h-11 px-2 border-0 bg-transparent text-[var(--s-muted)] cursor-pointer text-[14px]"><ArrowLeft size={15} aria-hidden /> Back</button> : null}
              <button type="submit" disabled={pending} className="inline-flex items-center gap-2 h-11 px-6 rounded-full bg-[var(--s-brand)] text-white text-[16px] font-semibold border-0 cursor-pointer hover:bg-[var(--s-brand-ink)] disabled:opacity-60 disabled:cursor-wait">{pending ? "Sending…" : <><Send size={16} aria-hidden /> Submit application</>}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const SAVED_KEY = "medoro-careers-details";

/** Email → 6-digit code → signed in. For Naukri users and anyone without LinkedIn or Google. */
export function EmailCodeSignIn({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const [email, setEmail] = useState(""), [code, setCode] = useState(""), [sentTo, setSentTo] = useState<string | null>(null);
  const [err, setErr] = useState(""), [pending, start] = useTransition();
  const inp = "w-full h-11 px-3 rounded-lg border border-[#C9D1CF] bg-white text-[15px] outline-none focus:border-[var(--s-brand)] focus:shadow-[0_0_0_3px_var(--s-brand-tint)]";
  const send = () => start(async () => { setErr(""); const r = await sendCareersCode(email); if (r.ok) { setSentTo(r.data.email); setCode(""); } else setErr(r.error); });
  const verify = () => start(async () => { setErr(""); const r = await verifyCareersCode(code); if (r.ok) onDone(); else setErr(r.error); });
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (sentTo) verify(); else send(); }}>
      {!sentTo ? <>
        <label className="flex flex-col gap-1.5 text-[14px] font-semibold">Your email<input type="email" required autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className={inp} /></label>
        <span className="text-[13px] text-[var(--s-muted)] -mt-1">We’ll email you a 6-digit code. No password needed.</span>
      </> : <>
        <span className="text-[14px] text-[var(--s-ink-2)]">We sent a 6-digit code to <strong>{sentTo}</strong>. It’s valid for 10 minutes (check spam if you don’t see it).</span>
        <label className="flex flex-col gap-1.5 text-[14px] font-semibold">Code<input inputMode="numeric" autoComplete="one-time-code" autoFocus required maxLength={6} pattern="\d{6}" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" className={`${inp} tracking-[.4em] text-[18px] font-semibold`} /></label>
      </>}
      {err ? <p role="alert" className="m-0 rounded-lg bg-[#FDECEA] text-[#B3261E] px-3 py-2 text-[14px]">{err}</p> : null}
      <div className="flex items-center gap-2 flex-wrap">
        {onCancel ? <button type="button" onClick={onCancel} className="inline-flex items-center gap-1 h-11 px-2 border-0 bg-transparent text-[var(--s-muted)] cursor-pointer text-[14px]"><ArrowLeft size={15} aria-hidden /> Back</button> : null}
        {sentTo ? <button type="button" disabled={pending} onClick={() => { setSentTo(null); setErr(""); }} className="h-11 px-2 border-0 bg-transparent text-[var(--s-brand)] font-semibold cursor-pointer text-[14px]">Change email</button> : null}
        <button type="submit" disabled={pending} className="ml-auto inline-flex items-center gap-2 h-11 px-6 rounded-full bg-[var(--s-brand)] text-white text-[15px] font-semibold border-0 cursor-pointer hover:bg-[var(--s-brand-ink)] disabled:opacity-60">{pending ? "Please wait…" : sentTo ? "Verify and continue" : "Send code"}</button>
      </div>
    </form>
  );
}

export function LinkedInMark({ color = "#fff" }: { color?: string }) {
  return <svg aria-hidden viewBox="0 0 24 24" width="18" height="18" fill={color}><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.95v5.66H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" /></svg>;
}
export function GoogleMark() {
  return <svg aria-hidden viewBox="0 0 48 48" width="18" height="18"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>;
}


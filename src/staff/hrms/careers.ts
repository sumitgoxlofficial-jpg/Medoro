import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { log } from "@/server/log";
import { mailEnabled, sendMail } from "@/server/mail";
import { MAX_BYTES, MAX_LABEL, getObject, putObject, sniff } from "@/server/storage";
import { hit } from "@/server/ratelimit";
import { clearPendingCode, readPendingCode, setApplicant, setPendingCode, type Applicant } from "@/server/applicant";
import { hashCode, newCode, sameHash } from "@/server/otp";
import { audit, holders, loadSettings, need, notify, type Me } from "./auth";
import { JOB_MODES, JOB_SOURCES, JOB_TYPES, type JobSource } from "./constants";
import { applicantCodeMail, applicationMail } from "./mails";

// The public careers page (/careers): HR and the super admin post openings in Recruitment, job seekers read them
// and apply (signed in with LinkedIn or Google, or by typing their details). Every application lands in the ATS
// pipeline as an "applied" candidate and the applicant gets a thank-you email.

const SITE = () => (process.env.APP_URL ?? "").replace(/\/+$/, "");
export const jobUrl = (slug: string) => `${SITE()}/careers/${slug}`;

export const slugify = (title: string) => title.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").slice(0, 60).replace(/-+$/, "") || "job";
async function freeSlug(title: string, id?: string) {
  const base = slugify(title);
  for (let n = 1; n < 200; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const taken = await db.hrJob.findUnique({ where: { slug }, select: { id: true } });
    if (!taken || taken.id === id) return slug;
  }
  return `${base}-${randomUUID().slice(0, 6)}`;
}

/** Where an application came from: ?src= or ?utm_source= on the job link, else how they signed in. */
export function sourceOf(raw: string | null | undefined, via?: string | null): JobSource {
  const s = (raw ?? "").toLowerCase().trim();
  const hitSrc = JOB_SOURCES.find((x) => x.id !== "hr" && x.id !== "referral" && (s === x.id || s.startsWith(x.id)));
  if (hitSrc) return hitSrc.id;
  if (s === "li" || s.includes("linkedin") || s === "lnkd.in") return "linkedin";
  if (s) return "other";
  return via === "linkedin" ? "linkedin" : "website";
}

// ── HR: posting and editing openings
const multiline = (max: number) => z.string().trim().max(max).default("");
export const jobSchema = z.object({
  title: z.string().trim().min(3, "Enter the job title.").max(100),
  dept: z.string().trim().min(1, "Choose a department.").max(60),
  location: z.string().trim().min(2, "Enter the location.").max(60),
  type: z.enum(JOB_TYPES),
  mode: z.enum(JOB_MODES).default("On-site"),
  experience: z.string().trim().max(40).default(""),
  salary: z.string().trim().max(60).default(""),
  openings: z.coerce.number().int().min(1, "At least one opening.").max(500).default(1),
  skills: z.string().trim().max(400).default(""),
  description: multiline(6000),
  requirements: multiline(4000),
  benefits: multiline(2000),
});
export type JobInput = z.input<typeof jobSchema>;

export async function postJob(me: Me, raw: JobInput) {
  need(me, "recruitment");
  const i = jobSchema.parse(raw);
  if (i.description.length < 40) throw new UserError("Write a job description (at least a few lines) so applicants know what the role is.");
  await db.hrJob.create({ data: { ...i, skills: tidySkills(i.skills), slug: await freeSlug(i.title), postedBy: me.id } });
  await audit(me, "Job posted", i.title);
}
export async function updateJob(me: Me, id: string, raw: JobInput) {
  need(me, "recruitment");
  const i = jobSchema.parse(raw);
  const old = await db.hrJob.findUnique({ where: { id } });
  if (!old) throw new UserError("Job not found.");
  // The public link stays the same once shared, unless the job never had one.
  await db.hrJob.update({ where: { id }, data: { ...i, skills: tidySkills(i.skills), slug: old.slug ?? (await freeSlug(i.title, id)) } });
  await audit(me, "Job updated", i.title);
}
const tidySkills = (s: string) => [...new Set(s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean))].slice(0, 20).join(", ");

/** Older jobs posted before the careers page get a public link the first time Recruitment opens. */
export async function backfillSlugs() {
  const rows = await db.hrJob.findMany({ where: { slug: null }, select: { id: true, title: true } });
  for (const r of rows) await db.hrJob.update({ where: { id: r.id }, data: { slug: await freeSlug(r.title, r.id) } }).catch(() => {});
}

// ── Public
const publicOut = (j: { id: string; slug: string | null; title: string; dept: string; location: string; type: string; mode: string; experience: string; salary: string; openings: number; skills: string; description: string; requirements: string; benefits: string; createdAt: Date; updatedAt: Date }, applicants: number) => ({
  id: j.id, slug: j.slug ?? j.id, title: j.title, dept: j.dept, location: j.location, type: j.type, mode: j.mode, experience: j.experience, salary: j.salary, openings: j.openings,
  skills: j.skills ? j.skills.split(",").map((s) => s.trim()).filter(Boolean) : [], description: j.description, requirements: j.requirements, benefits: j.benefits,
  postedAt: j.createdAt.toISOString(), updatedAt: j.updatedAt.toISOString(), applicants,
});
export type PublicJob = ReturnType<typeof publicOut>;

export async function publicJobs(): Promise<PublicJob[]> {
  const rows = await db.hrJob.findMany({ where: { status: "active" }, include: { _count: { select: { candidates: true } } }, orderBy: { createdAt: "desc" } });
  return rows.map((j) => publicOut(j, j._count.candidates));
}
export async function publicJob(slug: string): Promise<(PublicJob & { open: boolean }) | null> {
  const j = await db.hrJob.findFirst({ where: { OR: [{ slug }, { id: slug }] }, include: { _count: { select: { candidates: true } } } }).catch(() => null);
  return j ? { ...publicOut(j, j._count.candidates), open: j.status === "active" } : null;
}
export async function companyName() {
  return (await loadSettings()).company.name || "Medoro";
}

// ── Applying
const PHONE = /^\+?[\d\s-]{10,16}$/;
const applySchema = z.object({
  jobId: z.string().uuid("Choose the role you are applying for."),
  name: z.string().trim().min(3, "Enter your full name.").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(120),
  phone: z.string().trim().regex(PHONE, "Enter a valid mobile number."),
  location: z.string().trim().max(60).default(""),
  experience: z.string().trim().max(40).default(""),
  linkedin: z.string().trim().max(200).default("").refine((v) => !v || /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\//i.test(v), "Enter your LinkedIn profile link (linkedin.com/in/…)."),
  cover: z.string().trim().max(3000).default(""),
  src: z.string().trim().max(40).default(""),
  consent: z.literal("on", { message: "Please agree to let Medoro use your details for this application." }),
});

export const applicationRef = (id: string) => `MED-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;

/** A job seeker applies. The applicant cookie, when present, fixes the email to the one LinkedIn or Google verified. */
export async function apply(form: FormData, who: Applicant | null, ip: string | null) {
  if (String(form.get("website") ?? "")) return { ref: "MED-OK" }; // honeypot: bots fill every field
  const raw = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string"));
  const i = applySchema.parse({ ...raw, email: who?.email ?? raw.email });
  const limit = await hit({ name: "jobApply", limit: 8, windowSec: 3600, what: "applications" }, ip ?? i.email);
  if (!limit.ok) throw new UserError("Too many applications from this network. Please try again in an hour.");

  const job = await db.hrJob.findUnique({ where: { id: i.jobId } });
  if (!job || job.status !== "active") throw new UserError("This role is no longer open. Have a look at our other openings.");
  if (await db.hrCandidate.findFirst({ where: { jobId: job.id, email: i.email }, select: { id: true } })) throw new UserError("You have already applied for this role with this email. We will be in touch.");

  const file = form.get("resume");
  let resumeKey: string, resumeName: string;
  const type = "application/pdf" as const;
  if (file instanceof File && file.size) {
    if (file.size > MAX_BYTES) throw new UserError(`Your résumé is too large (limit ${MAX_LABEL}).`);
    const bytes = Buffer.from(await file.arrayBuffer());
    if (sniff(bytes) !== type) throw new UserError("Upload your résumé as a PDF file.");
    resumeKey = `_hrms/careers/${randomUUID()}.pdf`;
    resumeName = file.name.replace(/[^\w.\- ]/g, "").slice(0, 80) || "resume.pdf";
    await putObject(resumeKey, bytes, type);
  } else {
    // A signed-in applicant can reuse the résumé from their last application (only their own: matched by verified email).
    const prev = who && form.get("reuseResume") === "1" ? await lastApplicationRow(who.email) : null;
    if (!prev?.resumeKey) throw new UserError("Attach your résumé (PDF).");
    resumeKey = prev.resumeKey;
    resumeName = prev.resumeName ?? "resume.pdf";
  }

  const source = sourceOf(i.src, who?.via);
  const c = await db.hrCandidate.create({
    data: {
      jobId: job.id, name: i.name, email: i.email, phone: i.phone, role: job.title, location: i.location, experience: i.experience, linkedin: i.linkedin, cover: i.cover,
      source, verifiedBy: who?.via ?? null, resumeKey, resumeName, resumeType: type,
    },
  });
  const ref = applicationRef(c.id);
  const org = await companyName();
  await notify(await holders("recruitment"), `New application: ${i.name} for ${job.title} (${JOB_SOURCES.find((s) => s.id === source)?.label ?? source}).`, "recruit").catch(() => {});
  await audit({ id: null, name: i.name }, "Job application received", `${job.title} · ${source}`).catch(() => {});
  let emailed = false;
  if (mailEnabled()) {
    const statusUrl = SITE() ? `${SITE()}/careers/applications` : "";
    emailed = await sendMail({ to: i.email, ...applicationMail({ name: i.name, org, title: job.title, dept: job.dept, location: job.location, ref, statusUrl }) })
      .then(() => true, (e) => { log.error("careers thank-you mail failed", { err: e }); return false; });
  }
  return { ref, emailed };
}

const lastApplicationRow = (email: string) =>
  db.hrCandidate.findFirst({ where: { email: email.toLowerCase(), source: { notIn: ["hr", "referral"] } }, orderBy: { createdAt: "desc" }, select: { phone: true, location: true, experience: true, linkedin: true, resumeKey: true, resumeName: true } });

/** Details from a signed-in applicant's last application, to fill the next form for them. */
export async function lastApplication(email: string) {
  const r = await lastApplicationRow(email).catch(() => null);
  return r ? { phone: r.phone, location: r.location, experience: r.experience, linkedin: r.linkedin, resumeName: r.resumeKey ? r.resumeName ?? "resume.pdf" : null } : null;
}
export type Prefill = NonNullable<Awaited<ReturnType<typeof lastApplication>>>;

/** What an applicant sees under "My applications": their own rows only, by verified email. */
const STAGE_PUBLIC: Record<string, string> = { applied: "Application received", interview: "Interviewing", offer: "Offer stage", hired: "Hired", rejected: "Not moving forward" };
export async function myApplications(email: string) {
  const rows = await db.hrCandidate.findMany({ where: { email: email.toLowerCase(), source: { notIn: ["hr", "referral"] } }, include: { job: { select: { slug: true, title: true, dept: true, location: true, status: true } } }, orderBy: { createdAt: "desc" }, take: 50 });
  return rows.map((c) => ({ id: c.id, ref: applicationRef(c.id), title: c.job?.title ?? c.role, dept: c.job?.dept ?? "", location: c.job?.location ?? "", slug: c.job?.slug ?? null, status: STAGE_PUBLIC[c.stage] ?? "Application received", stage: c.stage, at: c.createdAt.toISOString() }));
}

// ── HR: the résumé file
export async function resumeFile(me: Me, candidateId: string) {
  need(me, "recruitment");
  const c = await db.hrCandidate.findUnique({ where: { id: candidateId }, select: { resumeKey: true, resumeName: true, resumeType: true } });
  if (!c?.resumeKey) return null;
  const bytes = await getObject(c.resumeKey);
  return bytes ? { bytes, name: c.resumeName ?? "resume.pdf", type: c.resumeType ?? "application/pdf" } : null;
}

// ── Sign in with an email code (careers page)
const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.").max(120);
const CODE_SCOPE = "careers-signin";

/** Emails a 6-digit code. Limited per email and per network so the page can't be used to spam inboxes. */
export async function sendApplicantCode(rawEmail: string, ip: string | null) {
  const email = emailSchema.parse(rawEmail);
  if (!mailEnabled()) throw new UserError("Email sign-in isn’t available right now. You can still apply without signing in.");
  const perEmail = await hit({ name: "careersCode", limit: 4, windowSec: 900, what: "sign-in codes" }, email);
  const perIp = ip ? await hit({ name: "careersCodeIp", limit: 15, windowSec: 3600, what: "sign-in codes" }, ip) : { ok: true };
  if (!perEmail.ok || !perIp.ok) throw new UserError("Too many codes requested. Please wait a few minutes and try again.");
  const code = newCode();
  await sendMail({ to: email, ...applicantCodeMail({ code, org: await companyName() }) });
  await setPendingCode({ email, hash: hashCode(CODE_SCOPE + ":" + email, code) });
  return { email };
}

/** Checks the code and signs the applicant in for 7 days. Wrong guesses are counted on the server, per email. */
export async function verifyApplicantCode(rawCode: string) {
  const code = String(rawCode ?? "").replace(/\D/g, "");
  const p = await readPendingCode();
  if (!p) throw new UserError("That code has expired. Ask for a new one.");
  const tries = await hit({ name: "careersCodeTry", limit: 6, windowSec: 900, what: "code attempts" }, p.email);
  if (!tries.ok) { await clearPendingCode(); throw new UserError("Too many wrong codes. Ask for a new code in a few minutes."); }
  if (code.length !== 6 || !sameHash(hashCode(CODE_SCOPE + ":" + p.email, code), p.hash)) throw new UserError("That code isn’t right. Check the email and try again.");
  await clearPendingCode();
  await setApplicant({ email: p.email, name: "", via: "email" });
  return { email: p.email };
}

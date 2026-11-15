import type { PublicJob } from "@/staff/hrms/careers";

const SITE = () => (process.env.APP_URL ?? "https://medoro.in").replace(/\/+$/, "");
const TYPE: Record<string, string> = { "Full-time": "FULL_TIME", "Part-time": "PART_TIME", Contract: "CONTRACTOR", Internship: "INTERN" };
const ORG = () => ({ "@type": "Organization", name: "Medoro", sameAs: SITE(), logo: `${SITE()}/medoro-logo.png` });

/** schema.org JobPosting, so Google for Jobs (and job sites that read it) list the opening with an Apply link here. */
export function jobPostingLd(j: PublicJob) {
  const valid = new Date(new Date(j.postedAt).getTime() + 60 * 86_400_000);
  const text = [j.description, j.requirements && `What we’re looking for\n${j.requirements}`, j.benefits && `What you get\n${j.benefits}`].filter(Boolean).join("\n\n");
  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: j.title,
    description: text.split(/\n\s*\n/).map((p) => `<p>${p.replace(/[<>&]/g, "").replace(/\n/g, "<br>")}</p>`).join(""),
    datePosted: j.postedAt.slice(0, 10),
    validThrough: valid.toISOString(),
    employmentType: TYPE[j.type] ?? "OTHER",
    hiringOrganization: ORG(),
    identifier: { "@type": "PropertyValue", name: "Medoro", value: j.id },
    directApply: true,
    url: `${SITE()}/careers/${j.slug}`,
    ...(j.mode === "Remote"
      ? { jobLocationType: "TELECOMMUTE", applicantLocationRequirements: { "@type": "Country", name: "India" } }
      : { jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: j.location, addressCountry: "IN" } } }),
    ...(j.skills.length ? { skills: j.skills.join(", ") } : {}),
  };
}

export function careersJsonLd(jobs: PublicJob[]) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Open jobs at Medoro",
    itemListElement: jobs.map((j, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE()}/careers/${j.slug}`, name: j.title })),
  };
}

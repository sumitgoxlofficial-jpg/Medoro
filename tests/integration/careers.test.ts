import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {} }), headers: async () => new Headers() }));

import { db } from "@/server/db";
import { apply, lastApplication, myApplications } from "@/staff/hrms/careers";
import { resetDb } from "./helpers";

const pdf = (name: string) => new File([Buffer.from("%PDF-1.4 cv")], name, { type: "application/pdf" });
const form = (v: Record<string, string | File>) => { const f = new FormData(); for (const [k, x] of Object.entries(v)) f.set(k, x); return f; };
const base = { name: "Riya Kumari", email: "riya@example.com", phone: "+91 9876543210", location: "Ranchi", experience: "1–2 years", linkedin: "https://www.linkedin.com/in/riya", consent: "on" };
let jobA: string, jobB: string, jobC: string;

beforeAll(async () => {
  await resetDb();
  const mk = (title: string) => db.hrJob.create({ data: { title, slug: title.toLowerCase().replace(/\s+/g, "-"), dept: "Sales", location: "Bokaro", type: "Full-time", description: "x".repeat(50) } });
  [jobA, jobB, jobC] = (await Promise.all([mk("Sales Executive"), mk("Marketing Manager"), mk("Support Lead")])).map((j) => j.id);
});

describe("careers applications", () => {
  it("applies with a résumé, then a signed-in applicant reuses it and gets their details filled", async () => {
    const r = await apply(form({ ...base, jobId: jobA, resume: pdf("Riya-CV.pdf") }), null, "10.0.0.1");
    expect(r.ref).toMatch(/^MED-[0-9A-F]{8}$/);

    const pre = await lastApplication("RIYA@example.com");
    expect(pre).toEqual({ phone: base.phone, location: "Ranchi", experience: "1–2 years", linkedin: base.linkedin, resumeName: "Riya-CV.pdf" });

    const who = { email: "riya@example.com", name: "Riya Kumari", via: "linkedin" as const, exp: Date.now() + 60_000 };
    await apply(form({ ...base, jobId: jobB, reuseResume: "1" }), who, "10.0.0.1");
    const rows = await db.hrCandidate.findMany({ where: { email: "riya@example.com" }, orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[1].resumeKey).toBe(rows[0].resumeKey);
    expect(rows[1]).toMatchObject({ source: "linkedin", verifiedBy: "linkedin", resumeName: "Riya-CV.pdf" });
    expect((await myApplications("riya@example.com")).map((a) => a.title).sort()).toEqual(["Marketing Manager", "Sales Executive"]);
  });

  it("never lends someone else's résumé, and still needs one", async () => {
    await expect(apply(form({ ...base, email: "x@example.com", jobId: jobC, reuseResume: "1" }), null, "10.0.0.2")).rejects.toThrow("Attach your résumé");
    const stranger = { email: "nobody@example.com", name: "No Body", via: "google" as const, exp: Date.now() + 60_000 };
    await expect(apply(form({ ...base, jobId: jobC, reuseResume: "1" }), stranger, "10.0.0.2")).rejects.toThrow("Attach your résumé");
    expect(await lastApplication("nobody@example.com")).toBeNull();
  });

  it("refuses a second application for the same role", async () => {
    await expect(apply(form({ ...base, jobId: jobA, resume: pdf("again.pdf") }), null, "10.0.0.3")).rejects.toThrow("already applied");
  });
});

import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));
// The emailed code is fixed so the test can type it.
vi.mock("@/server/otp", async (orig) => ({ ...(await orig<typeof import("@/server/otp")>()), newCode: () => "246810" }));

import { PDFDocument } from "pdf-lib";
import { db } from "@/server/db";
import { loadPerms, type Me } from "@/staff/hrms/auth";
import { hireFromOffer, retryHire, sendForSignature, sendSignCode, signedOfferPdf, signingStatus, signingView, signOffer, verifySignCode } from "@/staff/hrms/offer-sign";
import { saveOffer } from "@/staff/hrms/work";
import { resetDb } from "./helpers";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const ctx = { ip: "10.1.2.3", userAgent: "vitest browser" };
const sign = { name: "Cara Das", phone: "9876501234", place: "Bokaro Steel City", lat: 23.6693, lng: 86.1511, accuracy: 18, type: "typed", png: "data:image/png;base64," + PNG, consent: true };
let hr: Me, job: { id: string };
const tokenOf = (url: string) => url.split("/offer/sign/")[1];

async function candidate(name: string, email: string, phone: string, offer: object = {}) {
  const c = await db.hrCandidate.create({ data: { jobId: job.id, name, email, phone, role: "Engineer", stage: "interview" } });
  await saveOffer(hr, c.id, { position: "Software Engineer", empType: "Full-time", pay: "₹ 8,00,000 per year", joinDate: "2027-01-11", mode: "On-site", terms: "", dept: "Engineering", ctc: "800000", role: "employee", location: "Bokaro", ...offer });
  return c;
}

beforeAll(async () => {
  await resetDb();
  process.env.MAIL_PROVIDER = "console";
  process.env.APP_URL = "https://medoro.test";
  const u = await db.staffUser.create({ data: { empNo: "MS-401", name: "Hari Hr", email: "hari@medoro.in", kind: "team", phone: "9850000401", role: "employee", status: "active", hr: { create: { role: "hr", profileDone: true, docsAcceptedAt: new Date() } } } });
  hr = { id: u.id, empNo: u.empNo, name: u.name, first: "Hari", email: u.email, staffRole: u.role, role: "hr", perms: await loadPerms(), sessionId: "t", phone: u.phone, personalEmail: "", dept: "", designation: "", photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true, kycSubmitted: true, kycSkipped: false, kycVerified: true };
  job = await db.hrJob.create({ data: { title: "Software Engineer", dept: "Engineering", location: "Bokaro", type: "Full-time", status: "active" } });
});

describe("offer e-signature", () => {
  it("needs the CTC and department before it can be sent for signature", async () => {
    const c = await candidate("Dev Roy", "dev@example.com", "9876500001", { ctc: "", dept: "" });
    await expect(sendForSignature(hr, c.id)).rejects.toThrow("department and annual CTC");
  });

  it("sends, verifies the email, signs with name, place and live location, and creates the employee", async () => {
    const c = await candidate("Cara Das", "cara@example.com", "9876501234");
    const sent = await sendForSignature(hr, c.id);
    expect(sent).toMatchObject({ emailed: true, to: "cara@example.com" });
    expect(sent.url).toMatch(/^https:\/\/medoro\.test\/offer\/sign\/[A-Za-z0-9_-]{40,}$/);
    const token = tokenOf(sent.url);
    expect(await db.hrOfferSign.count({ where: { tokenHash: token } })).toBe(0); // only a hash of the link is kept

    const v = await signingView(token, "10.1.2.3");
    expect(v).toMatchObject({ state: "open", name: "Cara Das", verified: false, email: expect.stringMatching(/^c\*+a@example\.com$/) });
    expect(v.letter.title).toBe("Offer of Employment");
    expect((await signingStatus(hr, c.id))?.status).toBe("viewed");

    // Signing needs the email code first.
    await expect(signOffer(token, sign, ctx)).rejects.toThrow("Verify your email");
    await sendSignCode(token, "10.1.2.3");
    await expect(verifySignCode(token, "111111", null)).rejects.toThrow("isn’t right");
    await verifySignCode(token, "246810", null);
    await expect(signOffer(token, { ...sign, consent: false }, ctx)).rejects.toThrow();
    await expect(signOffer(token, { ...sign, png: "not-an-image" }, ctx)).rejects.toThrow("Sign in the box");

    const r = await signOffer(token, sign, ctx);
    expect(r.empNo).toMatch(/^MS-\d{3}$/);
    const emp = await db.staffUser.findUniqueOrThrow({ where: { empNo: r.empNo! }, include: { hr: true } });
    expect(emp).toMatchObject({ name: "Cara Das", phone: "9876501234", status: "active" });
    expect(emp.hr).toMatchObject({ designation: "Software Engineer", dept: "Engineering", ctc: 800000, personalEmail: "cara@example.com", location: "Bokaro", mustChangePassword: true });
    expect((await db.hrCandidate.findUniqueOrThrow({ where: { id: c.id } })).stage).toBe("hired");

    const st = await signingStatus(hr, c.id);
    expect(st).toMatchObject({ status: "signed", signer: "Cara Das", place: "Bokaro Steel City", empNo: r.empNo, hireError: "" });
    const row = await db.hrOfferSign.findUniqueOrThrow({ where: { candidateId: c.id } });
    expect(row).toMatchObject({ ip: "10.1.2.3", lat: 23.6693, lng: 86.1511, sigType: "typed" });
    expect((row.trail as { event: string }[]).map((e) => e.event)).toEqual(["Sent for signature", "Opened", "Code sent", "Email verified", "Signed", "Employee created"]);

    // The signed PDF: the full offer plus the certificate of electronic signature.
    const { pdf } = await signedOfferPdf(hr, c.id);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThanOrEqual(21);

    // It can't be signed twice, the offer can't be edited after signing, and the hire isn't repeated.
    await expect(signOffer(token, sign, ctx)).rejects.toThrow("already signed");
    await expect(saveOffer(hr, c.id, { position: "Lead", empType: "Full-time", pay: "1", joinDate: "2027-01-11", mode: "On-site" })).rejects.toThrow("can’t be changed");
    expect((await hireFromOffer(row.id)).empNo).toBe(r.empNo);
    expect(await db.staffUser.count({ where: { name: "Cara Das" } })).toBe(1);
    expect((await signingView(token, null)).state).toBe("signed");
  });

  it("keeps the signature when the employee can't be created, and HR retries after fixing it", async () => {
    const c = await candidate("Esha Nair", "esha@example.com", "9876509999");
    const token = tokenOf((await sendForSignature(hr, c.id)).url);
    await signingView(token, null); await sendSignCode(token, null); await verifySignCode(token, "246810", null);
    // The mobile given at signing already belongs to an employee (Cara, above).
    const r = await signOffer(token, { ...sign, name: "Esha Nair", phone: "9876501234" }, ctx);
    expect(r.empNo).toBeNull();
    const st = await signingStatus(hr, c.id);
    expect(st).toMatchObject({ status: "signed", empNo: null, hireError: expect.stringContaining("mobile number already exists") });
    expect(await db.hrNotification.count({ where: { staffId: hr.id, text: { contains: "couldn’t be created" } } })).toBe(1);

    await db.hrOfferSign.update({ where: { candidateId: c.id }, data: { signerPhone: "9876509999" } });
    const again = await retryHire({ ...hr, role: "admin" }, c.id);
    expect(again.empNo).toMatch(/^MS-\d{3}$/);
  });

  it("refuses bad, cancelled and expired links", async () => {
    await expect(signingView("short", null)).rejects.toThrow("isn’t valid");
    await expect(signingView("x".repeat(43), null)).rejects.toThrow("isn’t valid any more");
    const c = await candidate("Farah Khan", "farah@example.com", "9876508888");
    const old = tokenOf((await sendForSignature(hr, c.id)).url);
    const fresh = tokenOf((await sendForSignature(hr, c.id)).url); // sending again replaces the link
    await expect(signingView(old, null)).rejects.toThrow("isn’t valid any more");
    await db.hrOfferSign.update({ where: { candidateId: c.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await signingView(fresh, null)).state).toBe("expired");
    await expect(sendSignCode(fresh, null)).rejects.toThrow("lapsed");
  });
});

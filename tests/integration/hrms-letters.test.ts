import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => (v ? jar.set(k, v) : jar.delete(k)), delete: (k: string) => jar.delete(k) }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.8", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { loadPerms, type Me } from "@/staff/hrms/auth";
import { buildLetter, JOINING_LETTERS, LETTER_TYPES, letterText, salarySplit } from "@/staff/hrms/letters";
import { computeSlip } from "@/staff/hrms/pay";
import { candidateLetter, emailLetter, emailOffer, letterFor, letterPdf, sendLetters, sentLetters, unreadLetters } from "@/staff/hrms/letters-server";
import { PDFDocument } from "pdf-lib";
import { resetDb } from "./helpers";

let admin: Me, hr: Me, ann: Me, bob: Me;
const mkMe = async (id: string): Promise<Me> => { const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } }); return { id, empNo: u.empNo, name: u.name, first: u.name.split(" ")[0], email: u.email, staffRole: u.role, role: u.hr!.role, perms: await loadPerms(), sessionId: "t", phone: u.phone, personalEmail: "", dept: "", designation: "", photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true, kycSubmitted: true, kycVerified: true }; };
const mk = (n: number, name: string, role: "super_admin" | "employee" | "sales", hrRole: "admin" | "hr" | "employee" | "sales", extra: object = {}) =>
  db.staffUser.create({ data: { empNo: `MS-30${n}`, name, email: `${name.split(" ")[0].toLowerCase()}@medoro.in`, kind: "team", phone: `98500000${n}0`, role, status: "active", hr: { create: { role: hrRole, profileDone: true, docsAcceptedAt: new Date(), ...extra } } } });

beforeAll(async () => {
  await resetDb();
  process.env.SESSION_SECRET ||= "test-only-secret-0123456789abcdef0123";
  admin = await mkMe((await mk(1, "Asha Admin", "super_admin", "admin")).id);
  hr = await mkMe((await mk(2, "Hari Hr", "employee", "hr")).id);
  ann = await mkMe((await mk(3, "Ann Sharma", "sales", "sales", { designation: "Sales Executive", dept: "Sales", ctc: 600000, location: "Bokaro", joinDate: new Date("2026-12-01"), incentivePct: 3 })).id);
  bob = await mkMe((await mk(4, "Bob Rao", "employee", "employee", { designation: "Engineer", dept: "Engineering", ctc: 900000 })).id);
});
beforeEach(() => jar.clear());

describe("letters", () => {
  it("writes the three joining letters from the employee record", async () => {
    const offer = await letterFor(ann, ann.id, "offer");
    expect(offer).toMatchObject({ title: "Offer of Employment", to: "Ann Sharma", toLine: "Sales Executive, Sales", ref: expect.stringMatching(/^MDR\/HR\/OFR\/\d{4}\/303$/) });
    const text = letterText(offer);
    expect(text).toContain("Sales Executive in the Sales team");
    expect(text).toContain("1 December 2026");
    expect(text).toContain("₹6,00,000");
    expect(text).toContain("3% of the annual subscription value"); // the sales incentive appears for sales staff
    expect(letterText(await letterFor(ann, ann.id, "appointment"))).toContain("MS-303");
    expect((await letterFor(ann, ann.id, "nda")).title).toBe("Non-Disclosure Agreement");
    expect(letterText(await letterFor(bob, bob.id, "offer"))).not.toContain("incentive");
    expect(JOINING_LETTERS).toEqual(["offer", "appointment", "nda"]);
  });

  it("lets employees open only their own joining letters, and HR anyone's", async () => {
    await expect(letterFor(bob, ann.id, "offer")).rejects.toThrow("Your role can’t do that");
    await expect(letterFor(bob, bob.id, "experience", "2027-01-31")).rejects.toThrow("Your role can’t do that");
    expect((await letterFor(hr, ann.id, "offer")).to).toBe("Ann Sharma");
    expect((await letterFor(admin, bob.id, "appointment")).to).toBe("Bob Rao");
    await expect(letterFor(hr, ann.id, "salary-slip")).rejects.toThrow("Choose a letter");
    await expect(letterFor(hr, "nobody", "offer")).rejects.toThrow("Employee not found");
  });

  it("writes experience and relieving letters with the last working day", async () => {
    const exp = await letterFor(hr, ann.id, "experience", "2027-06-30");
    expect(letterText(exp)).toContain("from 1 December 2026 to 30 June 2027");
    expect(letterText(await letterFor(hr, ann.id, "relieving", "2027-06-30"))).toContain("close of business on 30 June 2027");
    await expect(letterFor(hr, ann.id, "relieving", "30/06/2027")).rejects.toThrow("last working day");
  });

  it("makes a real PDF, even with the rupee sign and apostrophes in the text", async () => {
    const pdf = await letterPdf(await letterFor(hr, ann.id, "offer"));
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1500);
    for (const t of LETTER_TYPES.filter((x) => x.id !== "promotion")) expect((await letterPdf(await letterFor(hr, bob.id, t.id, "2027-01-31"))).length).toBeGreaterThan(1500);
  });

  it("turns a candidate's offer into a letter and refuses email when mail isn't set up", async () => {
    const job = await db.hrJob.create({ data: { title: "Engineer", dept: "Engineering", location: "Bokaro", type: "Full-time", status: "active" } });
    const c = await db.hrCandidate.create({ data: { jobId: job.id, name: "Cara Das", email: "cara@example.com", role: "Engineer", stage: "offer", offer: { position: "Engineer", empType: "Full-time", pay: "₹ 8,00,000 per year", joinDate: "2027-01-10", mode: "On-site", terms: "Probation of three months.", by: "Hari Hr", on: "2026-11-11" } } });
    const l = await candidateLetter(hr, c.id);
    expect(letterText(l)).toContain("₹ 8,00,000 per year");
    expect(letterText(l)).toContain("10 January 2027");
    expect(letterText(l)).toContain("Hari Hr");
    await expect(candidateLetter(bob, c.id)).rejects.toThrow("Your role can’t do that");
    expect(letterText(buildLetter("offer", { empNo: "MS-1", name: "X Y", email: "x@y.in", phone: "", address: "", desig: "", dept: "", empType: "", location: "", manager: "", joinDate: null, ctc: 0, sales: false, incentivePct: 0 }, { name: "", address: "" }))).toContain("the date agreed with HR");
    delete process.env.MAIL_PROVIDER;
    await expect(emailOffer(hr, c.id)).rejects.toThrow("Email isn’t set up");
    await expect(emailLetter(hr, ann.id, "offer")).rejects.toThrow("Email isn’t set up");
    await expect(emailLetter(bob, ann.id, "offer")).rejects.toThrow("Your role can’t do that");
  });

  it("sends letters to the employee's screen with a notification, and exit letters appear only once sent", async () => {
    delete process.env.MAIL_PROVIDER;
    await expect(sendLetters(bob, ann.id, ["offer"], "", false)).rejects.toThrow("Your role can’t do that");
    await expect(sendLetters(hr, ann.id, [], "", false)).rejects.toThrow("at least one letter");
    await expect(sendLetters(hr, ann.id, ["relieving"], "", false)).rejects.toThrow("last working day");
    await expect(sendLetters(hr, ann.id, ["offer"], "", true)).rejects.toThrow("Email isn’t set up");
    expect(await db.hrLetter.count()).toBe(0); // nothing half-sent
    // Before HR sends it, an employee cannot read their own exit letter.
    await expect(letterFor(ann, ann.id, "relieving", "2027-06-30")).rejects.toThrow("Your role can’t do that");

    const r = await sendLetters(hr, ann.id, ["offer", "appointment", "relieving"], "2027-06-30", false);
    expect(r).toEqual({ sent: 3, emailed: [] });
    const note = await db.hrNotification.findFirstOrThrow({ where: { staffId: ann.id }, orderBy: { createdAt: "desc" } });
    expect(note).toMatchObject({ screen: "profile" }); expect(note.text).toContain("offer letter"); expect(note.text).toContain("relieving letter");
    expect(await unreadLetters(ann.id)).toBe(3);
    expect((await sentLetters(ann)).map((x) => [x.type, x.lastDay, x.unread]).sort()).toEqual([["appointment", "", true], ["offer", "", true], ["relieving", "2027-06-30", true]]);

    // The employee opens the exit letter HR sent, and only for that day.
    expect(letterText(await letterFor(ann, ann.id, "relieving", "2027-06-30"))).toContain("30 June 2027");
    await expect(letterFor(bob, ann.id, "relieving", "2027-06-30")).rejects.toThrow("Your role can’t do that"); // nobody else
    expect(await unreadLetters(ann.id)).toBe(2); // opening marks that letter read
    await letterFor(ann, ann.id, "offer");
    expect((await sentLetters(ann)).find((x) => x.type === "offer")?.unread).toBe(false);
    // Sending again puts it back as new.
    await sendLetters(hr, ann.id, ["offer"], "", false);
    expect((await sentLetters(ann)).find((x) => x.type === "offer")?.unread).toBe(true);
    expect(await db.hrLetter.count({ where: { staffId: ann.id, type: "offer" } })).toBe(1);
  });

  it("can also email the sent letters as PDFs when mail is set up", async () => {
    process.env.MAIL_PROVIDER = "console";
    const r = await sendLetters(hr, bob.id, ["offer", "nda"], "", true);
    expect(r.sent).toBe(2); expect(r.emailed).toEqual(["bob@medoro.in"]);
    expect(await db.hrLetter.count({ where: { staffId: bob.id } })).toBe(2);
    delete process.env.MAIL_PROVIDER;
  });

  it("reads like a corporate letter: terms, numbered clauses, notice period, salary annexure and signature blocks", async () => {
    const offer = await letterFor(hr, ann.id, "offer");
    expect(offer).toMatchObject({ confidential: true, subject: "Offer of employment as Sales Executive" });
    expect(offer.contact).toContain("medoro.in");
    expect(offer.registration).toContain("UDYAM-JH-01-0071761");
    const facts = offer.blocks.find((b) => b.k === "facts");
    expect(facts && facts.k === "facts" && Object.fromEntries(facts.rows)).toMatchObject({ Designation: "Sales Executive", Probation: "6 months", "Notice period": "One (1) month (30 days), either side", "Date of joining": "1 December 2026" });
    const clauses = offer.blocks.filter((b) => b.k === "clause");
    expect(clauses.map((c) => c.k === "clause" && c.title)).toEqual(expect.arrayContaining(["Compensation", "Probation", "Notice period and termination", "Confidentiality and data protection", "Non-solicitation and outside work", "Governing law"]));
    expect(clauses.map((c) => c.k === "clause" && c.n)).toEqual(clauses.map((_, i) => i + 1)); // numbered 1, 2, 3…
    expect(letterText(offer)).toContain("one) month’s written notice");
    expect(letterText(offer)).toContain("casual leave"); // from the leave policy
    expect(offer.blocks.some((b) => b.k === "sign")).toBe(true);
    // Annexure A adds up to the CTC and matches what payroll pays.
    const table = offer.blocks.find((b) => b.k === "table");
    expect(table && table.k === "table" && table.title).toBe("Annexure A · Compensation structure");
    const s = salarySplit(600000), slip = computeSlip(600000, { workDays: 26, lopDays: 0, incentive: 0, reimburse: 0, ptax: 200 });
    expect([s.basic, s.hra, s.special]).toEqual([slip.basic, slip.hra, slip.special]);
    expect(s.basic + s.hra + s.special).toBe(50000);
    expect(table && table.k === "table" && table.foot).toEqual(["Total fixed pay (CTC)", "₹50,000", "₹6,00,000"]);
    // The NDA and the appointment letter carry their own clauses; exit letters stay short.
    expect(letterText(await letterFor(hr, ann.id, "nda"))).toContain("Return of material");
    expect(letterText(await letterFor(hr, ann.id, "appointment"))).toContain("Employee ID: MS-303");
    expect((await letterFor(hr, ann.id, "experience", "2027-06-30")).confidential).toBe(false);
    // A longer letter runs to a second page for the annexure, with page numbers, and still opens as a PDF.
    const pdf = await letterPdf(offer);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThanOrEqual(3);
  });
});

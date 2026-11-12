import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => (v ? jar.set(k, v) : jar.delete(k)), delete: (k: string) => jar.delete(k) }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.8", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { loadPerms, type Me } from "@/staff/hrms/auth";
import { buildLetter, JOINING_LETTERS, LETTER_TYPES } from "@/staff/hrms/letters";
import { candidateLetter, emailLetter, emailOffer, letterFor, letterPdf, sendLetters, sentLetters, unreadLetters } from "@/staff/hrms/letters-server";
import { resetDb } from "./helpers";

let admin: Me, hr: Me, ann: Me, bob: Me;
const mkMe = async (id: string): Promise<Me> => { const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } }); return { id, empNo: u.empNo, name: u.name, first: u.name.split(" ")[0], email: u.email, staffRole: u.role, role: u.hr!.role, perms: await loadPerms(), sessionId: "t", phone: u.phone, personalEmail: "", dept: "", designation: "", photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true }; };
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
    expect(offer).toMatchObject({ title: "Offer of Employment", to: "Ann Sharma", toLine: "Sales Executive, Sales", ref: "MDR/HR/OFR/303" });
    const text = offer.paras.join(" ");
    expect(text).toContain("Sales Executive in the Sales team");
    expect(text).toContain("1 December 2026");
    expect(text).toContain("₹6,00,000");
    expect(text).toContain("3% on the annual subscription value"); // the sales incentive appears for sales staff
    expect((await letterFor(ann, ann.id, "appointment")).paras.join(" ")).toContain("MS-303");
    expect((await letterFor(ann, ann.id, "nda")).title).toBe("Non-Disclosure Agreement");
    expect((await letterFor(bob, bob.id, "offer")).paras.join(" ")).not.toContain("incentive");
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
    expect(exp.paras.join(" ")).toContain("from 1 December 2026 to 30 June 2027");
    expect((await letterFor(hr, ann.id, "relieving", "2027-06-30")).paras.join(" ")).toContain("close of business on 30 June 2027");
    await expect(letterFor(hr, ann.id, "relieving", "30/06/2027")).rejects.toThrow("last working day");
  });

  it("makes a real PDF, even with the rupee sign and apostrophes in the text", async () => {
    const pdf = await letterPdf(await letterFor(hr, ann.id, "offer"));
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1500);
    for (const t of LETTER_TYPES) expect((await letterPdf(await letterFor(hr, bob.id, t.id, "2027-01-31"))).length).toBeGreaterThan(1500);
  });

  it("turns a candidate's offer into a letter and refuses email when mail isn't set up", async () => {
    const job = await db.hrJob.create({ data: { title: "Engineer", dept: "Engineering", location: "Bokaro", type: "Full-time", status: "active" } });
    const c = await db.hrCandidate.create({ data: { jobId: job.id, name: "Cara Das", email: "cara@example.com", role: "Engineer", stage: "offer", offer: { position: "Engineer", empType: "Full-time", pay: "₹ 8,00,000 per year", joinDate: "2027-01-10", mode: "On-site", terms: "Probation of three months.", by: "Hari Hr", on: "2026-11-11" } } });
    const l = await candidateLetter(hr, c.id);
    expect(l.paras.join(" ")).toContain("₹ 8,00,000 per year");
    expect(l.paras.join(" ")).toContain("10 January 2027");
    expect(l.signoff[0]).toBe("Hari Hr");
    await expect(candidateLetter(bob, c.id)).rejects.toThrow("Your role can’t do that");
    expect(buildLetter("offer", { empNo: "MS-1", name: "X Y", email: "x@y.in", desig: "", dept: "", empType: "", location: "", manager: "", joinDate: null, ctc: 0, sales: false, incentivePct: 0 }, { name: "", address: "" }).paras.join(" ")).toContain("the agreed date");
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
    expect((await letterFor(ann, ann.id, "relieving", "2027-06-30")).paras.join(" ")).toContain("30 June 2027");
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
});

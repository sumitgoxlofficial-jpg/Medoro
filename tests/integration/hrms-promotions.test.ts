import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => (v ? jar.set(k, v) : jar.delete(k)), delete: (k: string) => jar.delete(k) }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.8", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { addDays, todayISO } from "@/lib/dates";
import { loadPerms, type Me } from "@/staff/hrms/auth";
import { letterText, responsibilityLines } from "@/staff/hrms/letters";
import { letterFor, letterPdf, sendLetters, sentLetters } from "@/staff/hrms/letters-server";
import { applyDuePromotions, cancelPromotion, promote, promotions } from "@/staff/hrms/promotions";
import { myProfile, salaryRevisions, updateEmployee } from "@/staff/hrms/people";
import { PDFDocument } from "pdf-lib";
import { resetDb } from "./helpers";

let hr: Me, ann: Me, bob: Me, lead: Me;
const mkMe = async (id: string): Promise<Me> => { const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } }); return { id, empNo: u.empNo, name: u.name, first: u.name.split(" ")[0], email: u.email, staffRole: u.role, role: u.hr!.role, perms: await loadPerms(), sessionId: "t", phone: u.phone, personalEmail: "", dept: "", designation: "", photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true, kycSubmitted: true, kycVerified: true }; };
const mk = (n: number, name: string, role: "super_admin" | "employee" | "sales", hrRole: "admin" | "hr" | "employee" | "sales", extra: object = {}) =>
  db.staffUser.create({ data: { empNo: `MS-40${n}`, name, email: `${name.split(" ")[0].toLowerCase()}@medoro.in`, kind: "team", phone: `98600000${n}0`, role, status: "active", hr: { create: { role: hrRole, profileDone: true, docsAcceptedAt: new Date(), ...extra } } } });
const today = todayISO();

beforeAll(async () => {
  await resetDb();
  process.env.SESSION_SECRET ||= "test-only-secret-0123456789abcdef0123";
  delete process.env.MAIL_PROVIDER;
  await mk(1, "Asha Admin", "super_admin", "admin");
  hr = await mkMe((await mk(2, "Hari Hr", "employee", "hr")).id);
  lead = await mkMe((await mk(5, "Lata Lead", "sales", "sales", { designation: "Sales Manager", dept: "Sales" })).id);
  ann = await mkMe((await mk(3, "Ann Sharma", "sales", "sales", { designation: "Sales Executive", dept: "Sales", ctc: 600000, joinDate: new Date("2025-04-01"), incentivePct: 3 })).id);
  bob = await mkMe((await mk(4, "Bob Rao", "employee", "employee", { designation: "Engineer", dept: "Engineering", ctc: 900000, joinDate: new Date("2025-06-01") })).id);
});
beforeEach(() => jar.clear());

describe("promotions", () => {
  it("promotes today: the profile, CTC and salary revision change at once, and the letter reads before and after", async () => {
    const r = await promote(hr, ann.id, { toDesig: "Senior Sales Executive", toDept: "Sales", toManagerId: lead.id, toCtc: 720000, effective: today, responsibilities: "- Lead a team of 3 executives\n2. Own the Jharkhand target\n\n• Train new joiners", note: "Thank you for opening 40 pharmacies in Dhanbad." });
    expect(r.applied).toBe(true);
    const h = await db.hrProfile.findUniqueOrThrow({ where: { staffId: ann.id } });
    expect(h).toMatchObject({ designation: "Senior Sales Executive", ctc: 720000, managerId: lead.id, responsibilities: "Lead a team of 3 executives\nOwn the Jharkhand target\nTrain new joiners" });
    expect((await salaryRevisions()).find((x) => x.staffId === ann.id)).toMatchObject({ from: 600000, to: 720000 });
    expect((await myProfile(ann)).responsibilities).toContain("Own the Jharkhand target");

    const l = await letterFor(hr, ann.id, "promotion", today);
    expect(l).toMatchObject({ title: "Letter of Promotion", subject: "Promotion to Senior Sales Executive", toLine: "Senior Sales Executive, Sales", ref: expect.stringMatching(/^MDR\/HR\/PRM\/\d{4}\/403\/\d{2}$/) });
    const t = letterText(l);
    expect(t).toContain("promoted from Sales Executive to Senior Sales Executive");
    expect(t).toContain("₹7,20,000 per annum (previously ₹6,00,000, an increase of 20%)");
    expect(t).toContain("(a)  Lead a team of 3 executives");
    expect(t).toContain("(c)  Train new joiners");
    expect(t).toContain("Lata Lead");
    expect(t).toContain("40 pharmacies in Dhanbad");
    const ann1 = l.blocks.find((b) => b.k === "table");
    expect(ann1 && ann1.k === "table" && ann1.title).toBe("Annexure A · Revised compensation structure");
    expect(ann1 && ann1.k === "table" && ann1.foot).toEqual(["Total fixed pay (CTC)", "₹60,000", "₹7,20,000"]);
    expect((await PDFDocument.load(await letterPdf(l))).getPageCount()).toBeGreaterThanOrEqual(2);

    // The employee sees it only once HR sends it, then with a "New" tag and a notification.
    await expect(letterFor(ann, ann.id, "promotion", today)).rejects.toThrow("Your role can’t do that");
    await sendLetters(hr, ann.id, ["promotion"], today, false);
    expect((await sentLetters(ann)).find((x) => x.type === "promotion")).toMatchObject({ lastDay: today, unread: true });
    expect((await db.hrNotification.findFirstOrThrow({ where: { staffId: ann.id, text: { contains: "letter of promotion" } } })).screen).toBe("profile");
    expect(letterText(await letterFor(ann, ann.id, "promotion", today))).toContain("Senior Sales Executive");
    expect((await sentLetters(ann)).find((x) => x.type === "promotion")?.unread).toBe(false);
    await expect(letterFor(bob, ann.id, "promotion", today)).rejects.toThrow("Your role can’t do that");
  });

  it("keeps the letter as written even when the profile changes later", async () => {
    await updateEmployee(hr, ann.id, { role: "sales", dept: "Sales", designation: "Area Manager", empType: "Full-time", location: "", homeState: "", managerId: null, ctc: 800000, incentivePct: 3 });
    const t = letterText(await letterFor(hr, ann.id, "promotion", today));
    expect(t).toContain("to Senior Sales Executive"); expect(t).not.toContain("Area Manager"); expect(t).toContain("₹7,20,000");
    // Edit left the responsibilities alone because it didn't send them.
    expect((await db.hrProfile.findUniqueOrThrow({ where: { staffId: ann.id } })).responsibilities).toContain("Train new joiners");
  });

  it("waits for a future effective date, then applies it; a pending promotion can be cancelled with its letter", async () => {
    const later = addDays(today, 10);
    const r = await promote(hr, bob.id, { toDesig: "Senior Engineer", toDept: "Engineering", toCtc: 900000, effective: later, responsibilities: "" });
    expect(r.applied).toBe(false);
    expect((await db.hrProfile.findUniqueOrThrow({ where: { staffId: bob.id } })).designation).toBe("Engineer");
    await expect(promote(hr, bob.id, { toDesig: "Tech Lead", toDept: "Engineering", toCtc: 1000000, effective: addDays(today, 20) })).rejects.toThrow("is waiting");
    const t = letterText(await letterFor(hr, bob.id, "promotion", later));
    expect(t).toContain("Your compensation remains unchanged."); expect(t).toContain("Your manager will brief you");
    expect((await letterFor(hr, bob.id, "promotion", later)).blocks.some((b) => b.k === "table")).toBe(false); // no annexure without a raise

    await sendLetters(hr, bob.id, ["promotion"], later, false);
    const id = (await promotions()).find((x) => x.staffId === bob.id)!.id;
    await cancelPromotion(hr, id);
    expect(await db.hrLetter.count({ where: { staffId: bob.id, type: "promotion" } })).toBe(0);
    await expect(letterFor(hr, bob.id, "promotion", later)).rejects.toThrow("No promotion is recorded");

    // Recorded again; the day arrives (simulated by moving the date back) and housekeeping applies it once.
    await promote(hr, bob.id, { toDesig: "Senior Engineer", toDept: "Engineering", toCtc: 1100000, effective: later });
    await db.hrPromotion.updateMany({ where: { staffId: bob.id }, data: { effective: today } });
    expect(await applyDuePromotions(true)).toBe(1);
    expect(await applyDuePromotions(true)).toBe(0);
    expect(await db.hrProfile.findUniqueOrThrow({ where: { staffId: bob.id } })).toMatchObject({ designation: "Senior Engineer", ctc: 1100000 });
    expect(await db.hrSalaryRevision.count({ where: { staffId: bob.id } })).toBe(1);
    const applied = (await promotions()).find((x) => x.staffId === bob.id)!;
    await expect(cancelPromotion(hr, applied.id)).rejects.toThrow("taken effect already");
  });

  it("refuses what makes no sense", async () => {
    await expect(promote(bob, ann.id, { toDesig: "Boss", toDept: "Sales", toCtc: 1, effective: today })).rejects.toThrow("Your role can’t do that");
    await expect(promote(hr, hr.id, { toDesig: "Head of HR", toDept: "HR", toCtc: 1, effective: today })).rejects.toThrow("can’t promote yourself");
    await expect(promote(hr, lead.id, { toDesig: "Sales Manager", toDept: "Sales", toCtc: 0, effective: addDays(today, 1) })).rejects.toThrow("Nothing changes");
    await expect(promote(hr, lead.id, { toDesig: "Head of Sales", toDept: "Sales", toCtc: 0, effective: addDays(today, 365) })).rejects.toThrow("within 90 days back");
    await expect(promote(hr, lead.id, { toDesig: "Head of Sales", toDept: "Sales", toCtc: 0, effective: addDays(today, 1), toManagerId: lead.id })).rejects.toThrow("report to themselves");
    await expect(promote(hr, ann.id, { toDesig: "Area Manager", toDept: "Sales", toCtc: 900000, effective: "2025-03-01" })).rejects.toThrow();
    await expect(sendLetters(hr, ann.id, ["promotion"], "2026-01-01", false)).rejects.toThrow("No promotion is recorded");
    await expect(sendLetters(hr, ann.id, ["promotion", "relieving"], today, false)).rejects.toThrow("on its own");
    expect(responsibilityLines("a) one\n b. two\n\n- three\n* four")).toEqual(["one", "two", "three", "four"]);
  });
});

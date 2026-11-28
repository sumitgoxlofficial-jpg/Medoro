import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { PDFDocument } from "pdf-lib";
import { db } from "@/server/db";
import { loadPerms, type Me } from "@/staff/hrms/auth";
import { letterText } from "@/staff/hrms/letters";
import { letterFor, letterPdf, letterSignatures, pdfOf, signJoiningLetter } from "@/staff/hrms/letters-server";
import { acceptDocuments } from "@/staff/hrms/people";
import { resetDb } from "./helpers";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const ctx = { ip: "10.4.5.6", userAgent: "vitest browser" };
const sign = { name: "Ravi Kumar", place: "Ranchi", lat: 23.3441, lng: 85.3096, accuracy: 22, type: "drawn", png: PNG, consent: true, dataConsent: true };
let hr: Me, ravi: Me;
const mkMe = async (id: string): Promise<Me> => { const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } }); return { id, empNo: u.empNo, name: u.name, first: u.name.split(" ")[0], email: u.email, staffRole: u.role, role: u.hr!.role, perms: await loadPerms(), sessionId: "t", phone: u.phone, personalEmail: "", dept: "", designation: "", photo: null, mustChangePassword: false, profileDone: true, docsAccepted: false, kycSubmitted: true, kycSkipped: false, kycVerified: true }; };

beforeAll(async () => {
  await resetDb();
  process.env.MAIL_PROVIDER = "console";
  hr = await mkMe((await db.staffUser.create({ data: { empNo: "MS-601", name: "Hari Hr", email: "hari@medoro.in", kind: "team", phone: "9850000601", role: "employee", status: "active", hr: { create: { role: "hr", profileDone: true, docsAcceptedAt: new Date() } } } })).id);
  ravi = await mkMe((await db.staffUser.create({ data: { empNo: "MS-602", name: "Ravi Kumar", email: "ravi@medoro.in", kind: "team", phone: "9850000602", role: "employee", status: "active", hr: { create: { role: "employee", designation: "Engineer", dept: "Engineering", ctc: 720000, joinDate: new Date("2026-12-01"), profileDone: true, personalEmail: "ravi@example.com" } } } })).id);
});

describe("employees e-sign their appointment letter and NDA", () => {
  it("needs both signed before the joining step can be completed", async () => {
    await expect(acceptDocuments(ravi)).rejects.toThrow("Sign your appointment letter and non-disclosure agreement first");
    expect(await letterSignatures(ravi.id)).toEqual({});
  });

  it("signs the NDA: the signature, initials and certificate are in the letter, and the signed PDF is kept and served", async () => {
    await expect(signJoiningLetter(ravi, "offer", sign, ctx)).rejects.toThrow("Choose the letter to sign");
    await expect(signJoiningLetter(ravi, "nda", { ...sign, place: "" }, ctx)).rejects.toThrow("place");
    await expect(signJoiningLetter(ravi, "nda", { ...sign, dataConsent: false }, ctx)).rejects.toThrow();
    await signJoiningLetter(ravi, "nda", sign, ctx);
    await expect(signJoiningLetter(ravi, "nda", sign, ctx)).rejects.toThrow("already signed");

    const l = await letterFor(ravi, ravi.id, "nda");
    expect(l.initialsText).toBe("RK");
    const box = l.blocks.flatMap((b) => (b.k === "sign" ? b.boxes : [])).find((b) => b.title === "The Employee");
    expect(box).toMatchObject({ img: PNG, lines: expect.arrayContaining(["Name: Ravi Kumar", "Signed electronically", expect.stringContaining("Ranchi")]) });
    const text = letterText(l);
    expect(text).toContain("Certificate of electronic signature");
    expect(text).toContain("Signed in to the HRMS with their own account (ravi@medoro.in)");
    expect(text).toContain("section 10A of the Information Technology Act, 2000");
    // HR sees the same signed letter.
    expect((await letterFor(hr, ravi.id, "nda")).initialsText).toBe("RK");

    const row = await db.hrLetterSign.findUniqueOrThrow({ where: { staffId_type: { staffId: ravi.id, type: "nda" } } });
    expect(row).toMatchObject({ signerName: "Ravi Kumar", place: "Ranchi", ip: "10.4.5.6", sigType: "drawn" });
    const pdf = await pdfOf(ravi.id, l);
    expect(Buffer.from(pdf).equals(Buffer.from(row.signedPdf))).toBe(true); // exactly the copy that was signed
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan((await PDFDocument.load(await letterPdf(await letterFor(hr, hr.id, "nda")))).getPageCount());
    expect(await db.hrNotification.count({ where: { staffId: hr.id, text: { contains: "signed their non-disclosure agreement" } } })).toBe(1);
  });

  it("signs the appointment letter, then the joining step completes", async () => {
    await expect(acceptDocuments(ravi)).rejects.toThrow("Sign your");
    await signJoiningLetter(ravi, "appointment", { ...sign, type: "typed" }, ctx);
    expect(Object.keys(await letterSignatures(ravi.id)).sort()).toEqual(["appointment", "nda"]);
    expect(letterText(await letterFor(ravi, ravi.id, "appointment"))).toContain("Certificate of electronic signature");
    await acceptDocuments(ravi);
    expect((await db.hrProfile.findUniqueOrThrow({ where: { staffId: ravi.id } })).docsAcceptedAt).not.toBeNull();
  });
});

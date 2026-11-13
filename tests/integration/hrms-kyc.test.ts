import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => (v ? jar.set(k, v) : jar.delete(k)), delete: (k: string) => jar.delete(k) }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.9", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { loadPerms, type Me } from "@/staff/hrms/auth";
import { removeDoc, uploadDoc, verifyDoc, myDocs } from "@/staff/hrms/docs";
import { kycState, refreshKyc, revealKyc, saveKycNumbers } from "@/staff/hrms/kyc";
import { beginVerify, digilockerConfigured, finishVerify, isoDob, matchAadhaar, namesMatch, parseEAadhaar } from "@/staff/hrms/digilocker";
import { verhoeffDigit } from "@/lib/aadhaar";
import { resetDb } from "./helpers";

const body = "23412341234", AADHAAR = body + verhoeffDigit(body), LAST4 = AADHAAR.slice(-4);
let hr: Me, riya: Me, sam: Me;
const mkMe = async (id: string): Promise<Me> => { const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } }); return { id, empNo: u.empNo, name: u.name, first: u.name.split(" ")[0], email: u.email, staffRole: u.role, role: u.hr!.role, perms: await loadPerms(), sessionId: "t", phone: u.phone, personalEmail: "", dept: "", designation: "", photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true, kycSubmitted: !!u.hr!.kycSubmittedAt, kycVerified: !!u.hr!.kycVerifiedAt }; };
const mk = (empNo: string, name: string, email: string, role: "hr" | "employee", n: number, dob?: string) =>
  db.staffUser.create({ data: { empNo, name, email, kind: "team", phone: "982000100" + n, role: "employee", status: "active", hr: { create: { role, profileDone: true, ...(dob ? { dob: new Date(dob + "T00:00:00Z") } : {}) } } } });
const file = (name = "card.pdf", type = "application/pdf") => { const f = new FormData(); f.set("file", new File([new Uint8Array([37, 80, 68, 70, 45])], name, { type })); return f; };
const upload = (m: Me, kind: string) => { const f = file(); f.set("kind", kind); return uploadDoc(m, f); };
const xml = (o: { uid?: string; name?: string; dob?: string } = {}) => `<?xml version="1.0"?><KycRes><UidData uid="${o.uid ?? "xxxxxxxx" + LAST4}"><Poi name="${o.name ?? "Riya Sharma"}" dob="${o.dob ?? "12-04-1997"}" gender="F"/></UidData></KycRes>`;

type Call = { url: string; body: string; auth: string };
let calls: Call[] = [], eaadhaar = xml(), tokenOk = true, readOk = true;

beforeAll(async () => {
  await resetDb();
  process.env.SESSION_SECRET ||= "test-only-secret-0123456789abcdef0123";
  Object.assign(process.env, { DIGILOCKER_CLIENT_ID: "dl-client", DIGILOCKER_CLIENT_SECRET: "dl-secret", DIGILOCKER_BASE: "https://digilocker.test", APP_URL: "https://hr.test" });
  hr = await mkMe((await mk("MS-001", "Hari HR", "hari@medoro.in", "hr", 1)).id);
  riya = await mkMe((await mk("MS-002", "Riya Sharma", "riya@medoro.in", "employee", 2, "1997-04-12")).id);
  sam = await mkMe((await mk("MS-003", "Sam Singh", "sam@medoro.in", "employee", 3)).id);
});
beforeEach(() => {
  jar.clear(); calls = []; eaadhaar = xml(); tokenOk = true; readOk = true;
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? String(init.body) : "", auth: String((init?.headers as Record<string, string> | undefined)?.authorization ?? "") });
    if (url.endsWith("/public/oauth2/1/token")) return tokenOk ? Response.json({ access_token: "DL-TOKEN" }) : Response.json({ error: "invalid_grant" }, { status: 400 });
    if (url.endsWith("/public/oauth2/3/xml/eaadhaar")) return readOk ? new Response(eaadhaar) : new Response("no", { status: 404 });
    throw new Error("unexpected fetch " + url);
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

/** The flow cookie holds the state the redirect must come back with: read it from the start URL instead. */
const stateOf = (url: string) => new URL(url).searchParams.get("state")!;

describe("Aadhaar and PAN verification", () => {
  it("reads and matches the e-Aadhaar: last four digits, name and date of birth", () => {
    expect(parseEAadhaar(xml())).toEqual({ last4: LAST4, name: "Riya Sharma", dob: "1997-04-12" });
    expect(parseEAadhaar("<nothing/>")).toBeNull();
    expect([isoDob("12-04-1997"), isoDob("12/04/1997"), isoDob("12041997"), isoDob("1997-04-12"), isoDob("soon")]).toEqual(["1997-04-12", "1997-04-12", "1997-04-12", "1997-04-12", ""]);
    expect([namesMatch("Riya Sharma", "Riya Kumar Sharma"), namesMatch("R Sharma", "Riya Sharma"), namesMatch("Mrs Riya  Sharma", "riya sharma"), namesMatch("Riya Sharma", "Priya Sharma"), namesMatch("Riya Sharma", "Riya Verma")]).toEqual([true, true, true, false, false]);
    const mine = { last4: LAST4, name: "Riya Sharma", dob: "1997-04-12" };
    expect(matchAadhaar(parseEAadhaar(xml())!, mine)).toEqual([]);
    expect(matchAadhaar(parseEAadhaar(xml({ uid: "xxxxxxxx9999" }))!, mine)).toHaveLength(1);
    expect(matchAadhaar(parseEAadhaar(xml({ name: "Asha Rao" }))!, mine)).toHaveLength(1);
    expect(matchAadhaar(parseEAadhaar(xml({ dob: "01-01-1990" }))!, mine)).toHaveLength(1);
    expect(matchAadhaar(parseEAadhaar(xml({ dob: "01-01-1990" }))!, { ...mine, dob: null })).toEqual([]); // no date of birth on file: not compared
  });

  it("takes the numbers with consent, rejects mistakes, and seals them", async () => {
    await expect(saveKycNumbers(riya, { aadhaar: "123456789012", pan: "", consent: true })).rejects.toThrow(/isn’t valid/);
    await expect(saveKycNumbers(riya, { aadhaar: AADHAAR, pan: "BAD", consent: true })).rejects.toThrow(/PAN looks wrong/);
    await expect(saveKycNumbers(riya, { aadhaar: AADHAAR, pan: "ABCPS1234K", consent: false })).rejects.toThrow(/Tick the box/);
    await expect(saveKycNumbers(riya, { aadhaar: "", pan: "", consent: true })).rejects.toThrow(/Enter your Aadhaar/);
    await saveKycNumbers(riya, { aadhaar: AADHAAR.replace(/(\d{4})(?=\d)/g, "$1 "), pan: "abcps1234k", consent: true });
    const p = await db.hrProfile.findUniqueOrThrow({ where: { staffId: riya.id } });
    expect(p).toMatchObject({ aadhaarLast4: LAST4, panMasked: "AB•••••34K" });
    expect(Buffer.from(p.aadhaarSealed!).toString("utf8")).not.toContain(AADHAAR); // sealed, not stored in the clear
    expect(await kycState(riya.id)).toMatchObject({ aadhaar: { masked: "XXXX XXXX " + LAST4, entered: true, doc: "none", verified: false }, pan: { entered: true, doc: "none" }, submitted: false, verified: false });
  });

  it("is submitted once both numbers have proof, and verified once HR has checked both cards", async () => {
    await upload(riya, "Aadhaar card");
    expect((await kycState(riya.id)).submitted).toBe(false); // the PAN card is still missing
    await upload(riya, "PAN card");
    expect(await kycState(riya.id)).toMatchObject({ submitted: true, verified: false });
    const [pan, aadhaar] = await myDocs(riya.id); // newest first
    expect([pan.kind, aadhaar.kind]).toEqual(["PAN card", "Aadhaar card"]);
    await expect(verifyDoc(sam, aadhaar.id, true)).rejects.toThrow(/role can’t/);
    await verifyDoc(hr, aadhaar.id, true);
    expect((await kycState(riya.id)).verified).toBe(false); // only one card checked
    await verifyDoc(hr, pan.id, true);
    expect(await kycState(riya.id)).toMatchObject({ submitted: true, verified: true, aadhaar: { doc: "verified", verified: true } });
    expect(await db.hrNotification.count({ where: { staffId: riya.id, text: { contains: "Aadhaar and PAN are verified" } } })).toBe(1);
    // Un-verifying a card, or removing it, takes the person back a step.
    await verifyDoc(hr, pan.id, false);
    expect((await kycState(riya.id)).verified).toBe(false);
    await removeDoc(hr, pan.id);
    expect((await kycState(riya.id)).submitted).toBe(false);
  });

  it("HR can open the full numbers, only with the Employees module, and each opening is audited", async () => {
    await expect(revealKyc(sam, riya.id)).rejects.toThrow(/role can’t/);
    const before = await db.staffAudit.count({ where: { action: "HRMS · KYC numbers opened" } });
    expect(await revealKyc(hr, riya.id)).toEqual({ aadhaar: AADHAAR.replace(/(\d{4})(?=\d)/g, "$1 "), pan: "ABCPS1234K" });
    expect(await db.staffAudit.count({ where: { action: "HRMS · KYC numbers opened" } })).toBe(before + 1);
  });

  it("DigiLocker stays off until its host is set too", () => {
    const base = process.env.DIGILOCKER_BASE;
    delete process.env.DIGILOCKER_BASE;
    expect(digilockerConfigured()).toBe(false);
    process.env.DIGILOCKER_BASE = base;
    expect(digilockerConfigured()).toBe(true);
  });

  it("DigiLocker: needs the number saved first, then a match verifies the Aadhaar with no HR step", async () => {
    expect(digilockerConfigured()).toBe(true);
    await expect(beginVerify(sam)).rejects.toThrow(/Enter and save your Aadhaar/);
    await db.hrProfile.update({ where: { staffId: riya.id }, data: { aadhaarVerifiedAt: null, aadhaarVerifiedBy: "" } });
    await db.hrDocument.deleteMany({ where: { staffId: riya.id } });
    await upload(riya, "PAN card");
    expect((await kycState(riya.id)).submitted).toBe(false); // no Aadhaar proof yet
    const url = await beginVerify(riya);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://digilocker.test/public/oauth2/1/authorize");
    expect(u.searchParams.get("client_id")).toBe("dl-client");
    expect(u.searchParams.get("redirect_uri")).toBe("https://hr.test/staff/hrms/digilocker/callback");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    const r = await finishVerify("CODE-1", stateOf(url));
    expect(r).toEqual({ staffId: riya.id, result: "verified", why: [] });
    expect(calls[0].body).toContain("grant_type=authorization_code");
    expect(calls[0].body).toContain("code_verifier=");
    expect(calls[1].auth).toBe("Bearer DL-TOKEN");
    const p = await db.hrProfile.findUniqueOrThrow({ where: { staffId: riya.id } });
    expect(p).toMatchObject({ aadhaarVerifiedBy: "DigiLocker" });
    expect(p.aadhaarVerifiedAt).not.toBeNull();
    expect(JSON.stringify(await db.hrProfile.findUnique({ where: { staffId: riya.id } }))).not.toContain("DL-TOKEN"); // nothing from DigiLocker is kept
    expect(await kycState(riya.id)).toMatchObject({ submitted: true, aadhaar: { digilocker: true, verified: true } });
    expect(await db.staffAudit.count({ where: { action: "HRMS · Aadhaar verified with DigiLocker" } })).toBe(1);
  });

  it("DigiLocker: a different person, number or birth date is not accepted, and the sign-in must be this browser's", async () => {
    await db.hrProfile.update({ where: { staffId: riya.id }, data: { aadhaarVerifiedAt: null, aadhaarVerifiedBy: "" } });
    for (const [x, re] of [[xml({ uid: "xxxxxxxx0000" }), /last four digits/], [xml({ name: "Asha Rao" }), /name on your Aadhaar/], [xml({ dob: "01-01-1990" }), /date of birth/]] as const) {
      eaadhaar = x;
      const url = await beginVerify(riya);
      const r = await finishVerify("CODE", stateOf(url));
      expect(r.result).toBe("review");
      expect(r.why.join(" ")).toMatch(re);
      expect((await db.hrProfile.findUniqueOrThrow({ where: { staffId: riya.id } })).aadhaarVerifiedAt).toBeNull(); // nothing changed
    }
    // A redirect that doesn't carry this browser's state (or comes back twice) is refused.
    eaadhaar = xml();
    const url = await beginVerify(riya);
    await expect(finishVerify("CODE", "someone-elses-state")).rejects.toThrow(/expired/);
    await expect(finishVerify("CODE", stateOf(url))).rejects.toThrow(/expired/); // the flow cookie was used up by the failed try
    // DigiLocker refusing the code, or having no Aadhaar to read, is a clear message, not a crash.
    for (const fail of ["token", "read"] as const) {
      tokenOk = fail !== "token"; readOk = fail !== "read";
      const u2 = await beginVerify(riya);
      await expect(finishVerify("CODE", stateOf(u2))).rejects.toThrow(UserError);
    }
  });

  it("changing the Aadhaar number clears a DigiLocker match, and the directory shows the state", async () => {
    eaadhaar = xml();
    const url = await beginVerify(riya);
    await finishVerify("CODE", stateOf(url));
    expect((await kycState(riya.id)).aadhaar.digilocker).toBe(true);
    const other = "34512345123"; // a different number
    await saveKycNumbers(riya, { aadhaar: other + verhoeffDigit(other), pan: "", consent: true });
    expect(await kycState(riya.id)).toMatchObject({ aadhaar: { digilocker: false, verified: false }, submitted: false });
    expect(await refreshKyc(riya.id)).toMatchObject({ submitted: false, verified: false });
  });
});

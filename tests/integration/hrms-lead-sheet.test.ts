import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => (v ? jar.set(k, v) : jar.delete(k)), delete: (k: string) => jar.delete(k) }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.9", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { loadPerms, type Me } from "@/staff/hrms/auth";
import { leadSheetTick, parseSheetUrl, saveSheet, sheetStatus, syncSheet } from "@/staff/hrms/lead-sheet";
import { resetDb } from "./helpers";

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const URL_OK = `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=777`;
let hr: Me, emp: Me, s1: Me, s2: Me;
const mkMe = async (id: string): Promise<Me> => { const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } }); return { id, empNo: u.empNo, name: u.name, first: u.name.split(" ")[0], email: u.email, staffRole: u.role, role: u.hr!.role, perms: await loadPerms(), sessionId: "t", phone: u.phone, personalEmail: "", dept: "", designation: "", photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true }; };
const mk = (n: number, name: string, role: "super_admin" | "employee" | "sales", hrRole: "admin" | "employee" | "sales") =>
  db.staffUser.create({ data: { empNo: `MS-40${n}`, name, email: `${name.split(" ")[0].toLowerCase()}@medoro.in`, kind: "team", phone: `98600000${n}0`, role, status: "active", referralCode: role === "sales" ? "SS" + n : null, hr: { create: { role: hrRole, profileDone: true, docsAcceptedAt: new Date() } } } });

let body = "", type = "text/csv", status = 200, called: string[] = [];
beforeAll(async () => {
  await resetDb();
  process.env.SESSION_SECRET ||= "test-only-secret-0123456789abcdef0123";
  hr = await mkMe((await mk(1, "Asha Admin", "super_admin", "admin")).id);
  emp = await mkMe((await mk(2, "Eve Employee", "employee", "employee")).id);
  s1 = await mkMe((await mk(3, "Sam Sales", "sales", "sales")).id);
  s2 = await mkMe((await mk(4, "Sia Sales", "sales", "sales")).id);
});
beforeEach(() => {
  jar.clear(); called = []; status = 200; type = "text/csv";
  vi.stubGlobal("fetch", vi.fn(async (u: string) => { called.push(String(u)); return new Response(body, { status, headers: { "content-type": type } }); }));
});
afterEach(() => vi.unstubAllGlobals());

const CSV = [
  "Store,Owner,Mobile Number,City,Plan,Source",
  "Gupta Chemists,Arun Thakur,9876543210,Hazaribagh,Starter,Field visit",
  "Balaji Drug House,Pankaj Mishra,+91 98765 43211,Bokaro,Professional,Referral",
  "Sunrise Medical Hall,Sushil Oraon,9876543212,Giridih,Pro,Field visit",
  "Bad Row,Nobody,12345,Ranchi,Starter,Field visit",
].join("\n");

describe("master lead sheet", () => {
  it("accepts only Google Sheets links and finds the tab", () => {
    expect(parseSheetUrl(URL_OK)).toEqual({ id: ID, gid: "777" });
    expect(parseSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}`)).toEqual({ id: ID, gid: "0" });
    expect(parseSheetUrl("https://evil.example.com/spreadsheets/d/" + ID)).toBeNull();
    expect(parseSheetUrl("https://docs.google.com/spreadsheets/d/short")).toBeNull();
    expect(parseSheetUrl("http://docs.google.com/spreadsheets/d/" + ID)).toBeNull();
  });

  it("is for people with the Leads module only, and rejects other links", async () => {
    await expect(saveSheet(emp, { url: URL_OK, auto: false, assign: true })).rejects.toThrow("Your role can’t do that");
    await expect(sheetStatus(emp)).rejects.toThrow("Your role can’t do that");
    await expect(saveSheet(hr, { url: "https://example.com/x", auto: false, assign: true })).rejects.toThrow("Google Sheet link");
    await expect(syncSheet(hr)).rejects.toThrow("Paste the Google Sheet link");
  });

  it("reads the sheet, adds new leads, skips bad rows and duplicates, and gives them to the sales team", async () => {
    body = CSV;
    await saveSheet(hr, { url: URL_OK, auto: false, assign: true });
    const r = await syncSheet(hr);
    expect(called[0]).toBe(`https://docs.google.com/spreadsheets/d/${ID}/export?format=csv&gid=777`);
    expect(r).toMatchObject({ added: 3, assigned: 3, skipped: 1 });
    expect(r.skippedRows[0]).toContain("Row 5");
    const leads = await db.lead.findMany({ orderBy: { code: "asc" } });
    expect(leads.map((l) => l.phone)).toEqual(["9876543210", "9876543211", "9876543212"]);
    expect(leads.every((l) => l.staffId && l.nextOn)).toBe(true);
    const per = [s1.id, s2.id].map((id) => leads.filter((l) => l.staffId === id).length).sort();
    expect(per).toEqual([1, 2]); // spread across the two salespeople
    expect(await db.hrNotification.count({ where: { staffId: { in: [s1.id, s2.id] } } })).toBeGreaterThan(0);
    // Syncing again adds only what is new.
    body = CSV + "\nNew Pharma,Ravi,9876543299,Patna,Starter,Referral";
    const again = await syncSheet(hr);
    expect(again).toMatchObject({ added: 1, assigned: 1 });
    expect(await db.lead.count()).toBe(4);
    expect((await sheetStatus(hr)).last).toMatchObject({ added: 1, by: "Asha Admin", error: "" });
  });

  it("leaves leads unassigned when automatic giving-out is off, and honours an 'assigned to' column", async () => {
    await db.lead.deleteMany({});
    body = "Pharmacy,Phone,Assigned To\nAlpha Meds,9123456780,MS-404\nBeta Meds,9123456781,\nGamma Meds,9123456782,Sam Sales";
    await saveSheet(hr, { url: URL_OK, auto: false, assign: false });
    const r = await syncSheet(hr);
    expect(r).toMatchObject({ added: 3, assigned: 2 });
    const byPhone = Object.fromEntries((await db.lead.findMany()).map((l) => [l.phone, l.staffId]));
    expect(byPhone["9123456780"]).toBe(s2.id);
    expect(byPhone["9123456781"]).toBe("");
    expect(byPhone["9123456782"]).toBe(s1.id);
  });

  it("explains a private sheet and remembers the failure", async () => {
    body = "<html>Sign in</html>"; type = "text/html; charset=utf-8";
    await expect(syncSheet(hr)).rejects.toThrow("Anyone with the link");
    expect((await sheetStatus(hr)).last?.error).toContain("Anyone with the link");
    type = "text/csv"; body = "just one line"; 
    await expect(syncSheet(hr)).rejects.toThrow("no leads");
    body = "Foo,Bar\n1,2";
    await expect(syncSheet(hr)).rejects.toThrow("first row must name the columns");
  });

  it("syncs by itself each day only when switched on", async () => {
    await db.lead.deleteMany({});
    body = "Store,Phone\nDaily Meds,9000000001";
    await saveSheet(hr, { url: URL_OK, auto: false, assign: false });
    await leadSheetTick();
    expect(await db.lead.count()).toBe(0);
    await saveSheet(hr, { url: URL_OK, auto: true, assign: false });
    await leadSheetTick();
    expect(await db.lead.count()).toBe(1);
    expect((await sheetStatus(hr)).last?.by).toBe("Daily sync");
    // A failing sheet never throws out of the daily job.
    status = 403; type = "text/html";
    await expect(leadSheetTick()).resolves.toBeUndefined();
  });
});

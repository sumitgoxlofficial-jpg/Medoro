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
import { langOf, speaks, stateName, stateOf } from "@/staff/hrms/states";
import { updateEmployee } from "@/staff/hrms/people";
import { strToU8, zipSync } from "fflate";
import { readXlsx } from "@/staff/hrms/xlsx";
import { resetDb } from "./helpers";

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const URL_OK = `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=777`;
let hr: Me, emp: Me, s1: Me, s2: Me;
const mkMe = async (id: string): Promise<Me> => { const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } }); return { id, empNo: u.empNo, name: u.name, first: u.name.split(" ")[0], email: u.email, staffRole: u.role, role: u.hr!.role, perms: await loadPerms(), sessionId: "t", phone: u.phone, personalEmail: "", dept: "", designation: "", photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true }; };
const mk = (n: number, name: string, role: "super_admin" | "employee" | "sales", hrRole: "admin" | "employee" | "sales") =>
  db.staffUser.create({ data: { empNo: `MS-40${n}`, name, email: `${name.split(" ")[0].toLowerCase()}@medoro.in`, kind: "team", phone: `98600000${n}0`, role, status: "active", referralCode: role === "sales" ? "SS" + n : null, hr: { create: { role: hrRole, profileDone: true, docsAcceptedAt: new Date() } } } });

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** A minimal .xlsx workbook, the way Google Sheets exports it. */
function xlsx(tabs: { name: string; rows: string[][] }[]) {
  const shared: string[] = [];
  const si = (v: string) => { let i = shared.indexOf(v); if (i < 0) { shared.push(v); i = shared.length - 1; } return i; };
  const letter = (n: number) => String.fromCharCode(65 + n);
  const sheets = tabs.map((t) => `<worksheet><sheetData>${t.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => (v === "" ? "" : `<c r="${letter(ci)}${ri + 1}" t="s"><v>${si(v)}</v></c>`)).join("")}</row>`).join("")}</sheetData></worksheet>`);
  const files: Record<string, Uint8Array> = {
    "xl/workbook.xml": strToU8(`<workbook xmlns:r="x"><sheets>${tabs.map((t, i) => `<sheet name="${esc(t.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<Relationships>${tabs.map((_, i) => `<Relationship Id="rId${i + 1}" Type="t" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`),
  };
  sheets.forEach((x, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(x); });
  files["xl/sharedStrings.xml"] = strToU8(`<sst>${shared.map((v) => `<si><t>${esc(v)}</t></si>`).join("")}</sst>`);
  return zipSync(files);
}
const HEADER = ["PIN Code", "Locality / Area", "Shop Name", "Phone Number", "Full Address", "Rating", "Reviews Count", "Website"];
const BOOK = [
  { name: "Summary", rows: [["Totals"], ["Bihar", "179"]] },
  { name: "Bihar", rows: [["Bihar Medical Shops Directory"], ["Verified Directory • PIN Code & Locality Wise"], ["179", "34", "4.60", "83", "809"], ["Total Shops", "Unique PIN Codes", "Average Rating"], HEADER,
    ["800001", "Dak Bunglow", "Chemist Box - Dakbunglow", "+91 80 3701 6711", "Gupta Mansion, New Dakbunglow Road, Dak Bunglow, Chouraha, Patna, Bihar 800001", "4.9", "7903", "https://x.in"],
    ["800001", "Lodipur", "Sona Medical Stores & Co", "+91 99319 17455", "Bailey Rd, opp. Planetarium, Lodipur, Patna, Bihar 800001", "4.1", "104", "N/A"],
    ["800020", "Kankarbagh", "Pooja Pharmaceuticals", "+91 93047 98168", "Narayan Market, Ashok Nagar, Kankarbagh, Patna, Bihar 800020", "5", "232", "N/A"],
    ["800020", "Kankarbagh", "Duplicate Shop", "+91 99319 17455", "Somewhere, Patna, Bihar 800020", "4", "1", "N/A"]] },
  { name: "Tamil Nadu", rows: [["Shop Name", "Phone Number", "Full Address"], ["Chennai Meds", "+91 98400 11111", "T Nagar, Chennai, Tamil Nadu 600017"]] },
];

let body = "", type = "text/csv", status = 200, called: string[] = [], bytes: Uint8Array | null = null;
beforeAll(async () => {
  await resetDb();
  process.env.SESSION_SECRET ||= "test-only-secret-0123456789abcdef0123";
  hr = await mkMe((await mk(1, "Asha Admin", "super_admin", "admin")).id);
  emp = await mkMe((await mk(2, "Eve Employee", "employee", "employee")).id);
  s1 = await mkMe((await mk(3, "Sam Sales", "sales", "sales")).id);
  s2 = await mkMe((await mk(4, "Sia Sales", "sales", "sales")).id);
});
beforeEach(() => {
  jar.clear(); called = []; status = 200; type = "text/csv"; bytes = null;
  vi.stubGlobal("fetch", vi.fn(async (u: string) => { called.push(String(u)); return new Response((bytes ?? body) as BodyInit, { status, headers: { "content-type": type } }); }));
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
    expect(parseSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}`)).toEqual({ id: ID, gid: null });
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
    expect(r.skippedRows[0]).toContain("row 5");
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
    await expect(syncSheet(hr)).rejects.toThrow("find the columns");
    body = "Foo,Bar\n1,2";
    await expect(syncSheet(hr)).rejects.toThrow("find the columns");
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

  it("knows states, languages and towns", () => {
    expect(stateName(" BIHAR ")).toBe("Bihar"); expect(stateName("U.P.")).toBe("Uttar Pradesh"); expect(stateName("Orissa")).toBe("Odisha"); expect(stateName("Mars")).toBe("");
    expect(langOf("Bihar")).toBe("hindi"); expect(langOf("Jharkhand")).toBe("hindi"); expect(langOf("Tamil Nadu")).toBe("tamil"); expect(langOf("")).toBe("");
    expect(stateOf("", "Patna")).toBe("Bihar"); expect(stateOf("Kerala", "Patna")).toBe("Kerala"); expect(stateOf("", "Nowhereville")).toBe("");
    expect(speaks("Bihar", "Uttar Pradesh")).toBe(true); expect(speaks("Bihar", "Tamil Nadu")).toBe(false); expect(speaks("", "Tamil Nadu")).toBe(true); expect(speaks("Bihar", "")).toBe(true);
  });

  it("gives a salesperson from Bihar Hindi-speaking states only, and keeps other leads for someone who speaks their language", async () => {
    await db.lead.deleteMany({});
    await db.hrProfile.update({ where: { staffId: s1.id }, data: { homeState: "Bihar" } });
    await db.hrProfile.update({ where: { staffId: s2.id }, data: { homeState: "Tamil Nadu" } });
    body = ["Store,Phone,City,State",
      "Patna Meds,9100000001,Patna,", "Ranchi Meds,9100000002,Ranchi,Jharkhand", "Lucknow Meds,9100000003,Lucknow,UP", "Jaipur Meds,9100000004,Jaipur,Rajasthan",
      "Chennai Meds,9100000005,Chennai,Tamil Nadu", "Mystery Meds,9100000006,Smalltown,"].join("\n");
    await saveSheet(hr, { url: URL_OK, auto: false, assign: true });
    const r = await syncSheet(hr);
    expect(r).toMatchObject({ added: 6, assigned: 6, unmatched: 0 });
    const by = Object.fromEntries((await db.lead.findMany()).map((l) => [l.name, { who: l.staffId, state: l.state }]));
    for (const n of ["Patna Meds", "Ranchi Meds", "Lucknow Meds", "Jaipur Meds"]) expect(by[n].who).toBe(s1.id); // Hindi-speaking states go to the Bihar salesperson
    expect(by["Chennai Meds"].who).toBe(s2.id); // Tamil lead goes to the Tamil Nadu salesperson
    expect([s1.id, s2.id]).toContain(by["Mystery Meds"].who); // unknown state: anyone
    expect(by["Patna Meds"].state).toBe("Bihar"); expect(by["Lucknow Meds"].state).toBe("Uttar Pradesh");
  });

  it("leaves a lead waiting when no salesperson speaks its language, and says so", async () => {
    await db.lead.deleteMany({});
    await db.hrProfile.update({ where: { staffId: s2.id }, data: { homeState: "Bihar" } });
    body = "Store,Phone,State\nTamil Meds,9200000001,Tamil Nadu\nHindi Meds,9200000002,Bihar";
    const r = await syncSheet(hr);
    expect(r).toMatchObject({ added: 2, assigned: 1, unmatched: 1, unmatchedLang: ["Tamil"] });
    expect((await db.lead.findFirstOrThrow({ where: { name: "Tamil Meds" } })).staffId).toBe("");
    expect((await sheetStatus(hr)).last).toMatchObject({ unmatched: 1 });
  });

  it("lets HR set an employee's home state, and only a real state", async () => {
    const base = { dept: "Sales", designation: "Exec", role: "sales" as const, empType: "Full-time" as const, location: "Bokaro", managerId: null, incentivePct: 3, ctc: 100000 };
    await updateEmployee(hr, s1.id, { ...base, homeState: "jharkhand" });
    expect((await db.hrProfile.findUniqueOrThrow({ where: { staffId: s1.id } })).homeState).toBe("Jharkhand");
    await expect(updateEmployee(hr, s1.id, { ...base, homeState: "Atlantis" })).rejects.toThrow("Choose the state from the list");
  });

  it("reads a workbook with one tab per state, a title block above the header and the town inside the address", async () => {
    const book = readXlsx(xlsx(BOOK));
    expect(book.map((t) => t.name)).toEqual(["Summary", "Bihar", "Tamil Nadu"]);
    expect(book[1].rows[4][2]).toBe("Shop Name");
    expect(book[1].rows[5][4]).toContain("Patna, Bihar 800001");
    expect(() => readXlsx(strToU8("not a zip"))).toThrow("isn’t a spreadsheet");

    await db.lead.deleteMany({});
    await db.hrProfile.update({ where: { staffId: s1.id }, data: { homeState: "Bihar" } });
    await db.hrProfile.update({ where: { staffId: s2.id }, data: { homeState: "Tamil Nadu" } });
    bytes = xlsx(BOOK); type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    await saveSheet(hr, { url: `https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`, auto: false, assign: true });
    const r = await syncSheet(hr);
    expect(called[0]).toBe(`https://docs.google.com/spreadsheets/d/${ID}/export?format=xlsx`); // no #gid: every tab
    expect(r).toMatchObject({ added: 4, assigned: 4, skipped: 1, unmatched: 0 });
    const leads = Object.fromEntries((await db.lead.findMany()).map((l) => [l.name, l]));
    expect(leads["Sona Medical Stores & Co"]).toMatchObject({ phone: "9931917455", city: "Patna", state: "Bihar", staffId: s1.id });
    expect(leads["Chemist Box - Dakbunglow"].phone).toBe("8037016711");
    expect(leads["Chennai Meds"]).toMatchObject({ city: "Chennai", state: "Tamil Nadu", staffId: s2.id });
    expect(leads["Duplicate Shop"]).toBeUndefined();
    expect(new Set((await db.lead.findMany()).map((l) => l.code)).size).toBe(4); // numbers are unique
    // The next lead made any other way carries on from the reserved numbers.
    expect((await db.sequence.findFirstOrThrow({ where: { key: "LEAD" } })).next).toBeGreaterThan(4);
  });
});

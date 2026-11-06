import { describe, expect, it } from "vitest";
import { domainOf, nameKey, normEmail, similarity, telUri, toE164, maskPhone } from "./normalize";
import { canonicalState, ROLE_PERMS } from "./constants";
import { computeScore, deriveVerification, type ScoreFacts } from "./score";
import { splitPlan } from "./distribution";
import { nextStage } from "./calls";
import { checkUrl, isPrivateIp, UnsafeUrl } from "./safe-fetch";
import { fromOsm, overpassQuery } from "./discovery";
import { recommendFollowUp } from "./ai";
import { autoMap } from "./imports";
import { normalizeLead } from "./leads";
import { render } from "./comms";

describe("phone numbers", () => {
  it("normalises Indian mobiles and landlines to E.164", () => {
    expect(toE164("98765 43210")).toBe("+919876543210");
    expect(toE164("+91-98765-43210")).toBe("+919876543210");
    expect(toE164("098765 43210")).toBe("+919876543210");
    expect(toE164("020-2553 1234")).toBe("+912025531234");
    expect(toE164("91 20 2553 1234")).toBe("+912025531234");
  });
  it("rejects foreign, toll-free, short and junk numbers", () => {
    for (const bad of ["+1 415 555 0100", "1800 123 4567", "12345", "abc", "", "0000000000", "+44 20 7946 0958"]) expect(toE164(bad)).toBeNull();
  });
  it("builds only validated tel: URIs", () => {
    expect(telUri("+919876543210")).toBe("tel:+919876543210");
    expect(() => telUri("tel:+91;evil")).toThrow();
    expect(() => telUri("+919876")).toThrow();
    expect(maskPhone("+919876543210")).toBe("+91•••••43210");
  });
});

describe("names, websites, states", () => {
  it("matches pharmacy names ignoring noise words", () => {
    expect(nameKey("Shree Ganesh Medical & General Stores")).toBe(nameKey("SHREE GANESH MEDICALS AND GENERAL STORE"));
    expect(nameKey("Shivam Medical & General Stores")).toBe(nameKey("Shivam Medicals"));
    expect(similarity(nameKey("Shivam Medicals"), nameKey("Shivam Medical Store"))).toBe(1);
    expect(similarity("shivam", "satyam")).toBeLessThan(0.6);
  });
  it("reduces websites to a domain and validates email", () => {
    expect(domainOf("https://www.ShivamMedicals.in/contact")).toBe("shivammedicals.in");
    expect(domainOf("not a site")).toBe("");
    expect(domainOf("http://10.0.0.1")).toBe("");
    expect(normEmail(" Owner@Example.IN ")).toBe("owner@example.in");
    expect(normEmail("owner@")).toBe("");
  });
  it("canonicalises states and abbreviations", () => {
    expect(canonicalState("maharashtra")).toBe("Maharashtra");
    expect(canonicalState("MH")).toBe("Maharashtra");
    expect(canonicalState("Orissa")).toBe("Odisha");
    expect(canonicalState("New Delhi")).toBe("Delhi");
    expect(canonicalState("Atlantis")).toBe("");
  });
  it("normalises a raw record with errors and warnings", () => {
    const ok = normalizeLead({ name: "Shivam Medicals", phone: "98230 55120", state: "MH", pin: "411005", website: "shivam.example.in" });
    expect(ok.errors).toEqual([]);
    expect(ok.value).toMatchObject({ phone: "+919823055120", state: "Maharashtra", domain: "shivam.example.in", website: "https://shivam.example.in" });
    const bad = normalizeLead({ name: "X", pin: "12", state: "Atlantis", phone: "12" });
    expect(bad.errors.length).toBeGreaterThanOrEqual(3);
    expect(bad.warnings[0]).toMatch(/isn’t a valid Indian number/);
  });
  it("maps common column headers", () => {
    expect(autoMap(["Pharmacy Name", "Mobile No", "Pincode", "State", "E-mail", "Web Site", "City"])).toEqual({ name: 0, phone: 1, pin: 2, state: 3, email: 4, website: 5, city: 6 });
  });
});

describe("lead score", () => {
  const base: ScoreFacts = { businessVerifiedAt: null, phoneVerifiedAt: null, emailVerifiedAt: null, websiteVerifiedAt: null, locationVerifiedAt: null, phone: null, email: "", website: "", address: "", pin: "", state: "", district: "", city: "", lat: null, softwareStatus: "", bestOutcome: null, demo: false, converted: false };
  it("gives nothing for unknowns and never more than 100", () => {
    expect(computeScore(base).total).toBe(0);
    const d = new Date("2026-11-01");
    const full = computeScore({ ...base, businessVerifiedAt: d, phoneVerifiedAt: d, websiteVerifiedAt: d, locationVerifiedAt: d, softwareStatus: "paper", converted: true, phone: "+919800000000" });
    expect(full.total).toBe(100);
    expect(full.lines.map((l) => l.max).reduce((a, b) => a + b)).toBe(100);
  });
  it("labels provenance: listed facts are not verified", () => {
    const s = computeScore({ ...base, phone: "+919800000000", website: "https://x.in", address: "FC Road", pin: "411005", state: "Maharashtra", city: "Pune", bestOutcome: "INTERESTED" });
    const by = Object.fromEntries(s.lines.map((l) => [l.key, l]));
    expect(by.contact).toMatchObject({ points: 0, provenance: "source" });
    expect(by.digital).toMatchObject({ points: 5, provenance: "source" });
    expect(by.location).toMatchObject({ points: 6, provenance: "source" });
    expect(by.engagement).toMatchObject({ points: 12, provenance: "user_provided" });
    expect(by.software).toMatchObject({ points: 0, provenance: "unknown" });
  });
  it("derives the summary verification status", () => {
    const n = { invalidReason: null, duplicateOfId: null, businessVerifiedAt: null, phoneVerifiedAt: null, emailVerifiedAt: null, websiteVerifiedAt: null };
    expect(deriveVerification(n)).toBe("UNVERIFIED");
    expect(deriveVerification({ ...n, phoneVerifiedAt: new Date() })).toBe("PHONE_VERIFIED");
    expect(deriveVerification({ ...n, phoneVerifiedAt: new Date(), websiteVerifiedAt: new Date() })).toBe("PARTIALLY_VERIFIED");
    expect(deriveVerification({ ...n, phoneVerifiedAt: new Date(), invalidReason: "closed" })).toBe("INVALID");
    expect(deriveVerification({ ...n, duplicateOfId: "x" })).toBe("DUPLICATE");
  });
});

describe("distribution split", () => {
  const leads = Array.from({ length: 302 }, (_, i) => i);
  it("splits equally in contiguous blocks; the first employees take the remainder", () => {
    const p = splitPlan(leads, ["a", "b", "c"]);
    expect([...p.values()].map((x) => x.length)).toEqual([101, 101, 100]);
    expect(p.get("a")![0]).toBe(0); expect(p.get("b")![0]).toBe(101);
    expect(new Set([...p.values()].flat()).size).toBe(302);
  });
  it("300 leads to 3 employees is 100 each", () => {
    expect([...splitPlan(leads.slice(0, 300), ["a", "b", "c"]).values()].map((x) => x.length)).toEqual([100, 100, 100]);
  });
  it("balance mode tops up whoever holds fewer", () => {
    const p = splitPlan(leads.slice(0, 30), ["a", "b"], "balance", { a: 20, b: 0 });
    expect(p.get("a")!.length).toBe(5); expect(p.get("b")!.length).toBe(25);
  });
});

describe("stage after a call", () => {
  it("moves forward only, and handles terminal outcomes", () => {
    expect(nextStage("ASSIGNED", "CONNECTED", false)).toBe("FIRST_CONTACT");
    expect(nextStage("DEMO_SCHEDULED", "CONNECTED", false)).toBe("DEMO_SCHEDULED");
    expect(nextStage("ASSIGNED", "INTERESTED", true)).toBe("INTERESTED");
    expect(nextStage("ASSIGNED", "NO_ANSWER", false)).toBe("ASSIGNED");
    expect(nextStage("INTERESTED", "NOT_INTERESTED", false)).toBe("LOST");
    expect(nextStage("INTERESTED", "NOT_INTERESTED", true)).toBe("FOLLOW_UP_LATER");
    expect(nextStage("FIRST_CONTACT", "DO_NOT_CONTACT", false)).toBe("DO_NOT_CONTACT");
    expect(nextStage("ASSIGNED", "WRONG_NUMBER", false)).toBe("RESEARCH_PENDING");
    expect(nextStage("CONVERTED", "NOT_INTERESTED", false)).toBe("CONVERTED");
  });
});

describe("SSRF guard", () => {
  it("flags private, loopback, link-local and metadata addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) expect(isPrivateIp(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "103.21.244.1", "2606:4700::1111"]) expect(isPrivateIp(ip)).toBe(false);
  });
  it("refuses unsafe URLs before fetching", async () => {
    const pub = async () => ["93.184.216.34"];
    await expect(checkUrl("file:///etc/passwd", pub)).rejects.toBeInstanceOf(UnsafeUrl);
    await expect(checkUrl("http://localhost/", pub)).rejects.toBeInstanceOf(UnsafeUrl);
    await expect(checkUrl("http://169.254.169.254/latest/meta-data", pub)).rejects.toBeInstanceOf(UnsafeUrl);
    await expect(checkUrl("http://evil.example/", async () => ["10.0.0.5"])).rejects.toBeInstanceOf(UnsafeUrl);
    await expect(checkUrl("http://user:pw@shop.example/", pub)).rejects.toBeInstanceOf(UnsafeUrl);
    await expect(checkUrl("http://shop.example:8080/", pub)).rejects.toBeInstanceOf(UnsafeUrl);
    expect((await checkUrl("https://shop.example/x", pub)).hostname).toBe("shop.example");
  });
});

describe("OpenStreetMap discovery", () => {
  it("builds an Overpass query for a state and PIN, escaping input", () => {
    const q = overpassQuery({ state: "Maharashtra", district: "", city: "Pune", pin: "411005" });
    expect(q).toContain(`["name:en"~"^Maharashtra$",i]`);
    expect(q).toContain(`["addr:postcode"="411005"]`);
    expect(q).toContain(`nwr["amenity"="pharmacy"]`);
    expect(overpassQuery({ state: "Goa", district: "", city: `x"];out;`, pin: "" })).not.toContain(`x"]`);
  });
  it("maps an OSM element with attribution link", () => {
    const r = fromOsm({ type: "node", id: 42, lat: 18.52, lon: 73.85, tags: { name: "Lifeline Pharmacy", amenity: "pharmacy", phone: "+91 20 2553 1234; +91 98230 00000", "addr:postcode": "411004", "addr:street": "FC Road" } }, { state: "Maharashtra", district: "", city: "Pune", pin: "" });
    expect(r).toMatchObject({ name: "Lifeline Pharmacy", phone: "+91 20 2553 1234", pin: "411004", city: "Pune", sourceRef: "osm:node/42", sourceUrl: "https://www.openstreetmap.org/node/42", lat: 18.52 });
  });
});

describe("AI helpers", () => {
  it("recommends the next step from history", () => {
    expect(recommendFollowUp([], [], "ASSIGNED").action).toBe("First call");
    expect(recommendFollowUp([{ outcome: "INTERESTED", at: new Date() }], [], "INTERESTED").action).toBe("Book a demo");
    expect(recommendFollowUp([{ outcome: "NO_ANSWER", at: new Date() }, { outcome: "NO_ANSWER", at: new Date() }, { outcome: "BUSY", at: new Date() }], [], "ASSIGNED").when).toBe("in 3 days");
    expect(recommendFollowUp([], [], "DO_NOT_CONTACT").action).toBe("Do not contact");
    expect(recommendFollowUp([], ["completed"], "DEMO_COMPLETED").action).toMatch(/trial/);
  });
  it("renders templates with known variables only", () => {
    expect(render("Hi {{owner}} at {{pharmacy}}, {{city}} — {{me}} {{unknown}}", { pharmacy: "Shivam", city: "Pune", owner: "", me: "Asha" })).toBe("Hi  at Shivam, Pune — Asha {{unknown}}");
    expect(render("{{1}} in {{2}} from {{3}}", { pharmacy: "S", city: "P", owner: "", me: "A" })).toBe("S in P from A");
  });
});

describe("permissions", () => {
  it("keeps analysts read-only and sales without assignment or export", () => {
    expect(ROLE_PERMS.analyst).toEqual(["performance.view", "analytics.view"]);
    expect(ROLE_PERMS.sales).not.toContain("assign");
    expect(ROLE_PERMS.sales).not.toContain("leads.export");
    expect(ROLE_PERMS.manager).not.toContain("campaigns.approve");
    expect(ROLE_PERMS.manager).not.toContain("compliance.manage");
  });
});

describe("data isolation (static)", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dir = join(__dirname);
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => [f, readFileSync(join(dir, f), "utf8")] as const);
  // Pharmacy (tenant) models: customers, patients' prescriptions, sales, stock, the pharmacy's own integrations and Drive files.
  const PHARMACY = ["tenant", "branch", "user", "customer", "consentRecord", "sale", "saleItem", "prescription", "medicine", "batch", "doctor", "deliveryOrder", "integration", "backupManifest", "fileObject", "driveDevice", "waMessage", "campaign", "auditEvent", "loyaltyLedger"];
  it("never reads or writes pharmacy tables (customers, patients, sales, Drive files)", () => {
    for (const [f, src] of files) for (const m of PHARMACY) expect(src, `${f} uses db.${m}`).not.toMatch(new RegExp(`\\b(db|tx)\\.${m}\\.`));
  });
  it("imports nothing from pharmacy services or merchant Google Drive storage", () => {
    const allowed = ["@/domain/ai/llm", "@/domain/comms/graph", "@/domain/imports/parse"];
    for (const [f, src] of files) {
      for (const m of src.matchAll(/from "(@\/domain\/[^"]+)"/g)) expect(allowed, `${f} imports ${m[1]}`).toContain(m[1]);
      expect(src, f).not.toMatch(/@\/server\/(storage|setup-drive|context)|google-drive|drive-/i);
    }
  });
});

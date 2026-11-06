import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => jar.set(k, v), delete: (k: string | { name: string }) => jar.delete(typeof k === "string" ? k : k.name) }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.9", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import type { Staff } from "@/staff/auth";
import { actorFor, findLead, type Actor } from "@/staff/growth/access";
import { setMember, saveTeam, setTarget, addTerritory } from "@/staff/growth/team";
import { createLead, listLeads, leadDetail, exportLeads, updateLead } from "@/staff/growth/leads";
import { commitImport, importErrorsCsv, previewImport } from "@/staff/growth/imports";
import { checkWebsite, mergeDuplicate, verificationQueue, verifyLead } from "@/staff/growth/verify";
import { assignByTerritory, assignLeads, distribute, distributionOverview, reassignFrom, withdraw } from "@/staff/growth/distribution";
import { callHistory, launchCall, reportCall } from "@/staff/growth/calls";
import { createFollowUp, escalateOverdue, listFollowUps } from "@/staff/growth/followups";
import { dashboard, employeePerformance, myDashboard } from "@/staff/growth/analytics";
import { approveCampaign, connectWhatsApp, createCampaign, handleEmailEvent, handleWaWebhook, saveTemplate, sendCampaignBatches, sendMessage, setSender, unsubscribe, unsubscribeUrl } from "@/staff/growth/comms";
import { eraseLead, recordConsent, savePolicy, suppress } from "@/staff/growth/compliance";
import { setStage, convertLead, handOffToPipeline } from "@/staff/growth/pipeline";
import { draftMessage, research } from "@/staff/growth/ai";
import { enqueue, runJobs, retryJob, register } from "@/staff/growth/jobs";
import { runDiscovery } from "@/staff/growth/discovery";
import { resetDb } from "./helpers";
import { xlsx } from "../xlsx";

let n = 0;
async function staff(name: string, role: "super_admin" | "sales" | "care" | "partner", kind = "team"): Promise<Staff> {
  n++;
  const u = await db.staffUser.create({ data: { empNo: `MS-${100 + n}`, name, email: `${name.split(" ")[0].toLowerCase()}${n}@medoro.in`, kind, phone: `98220${String(10000 + n)}`, role, status: "active" } });
  return { id: u.id, empNo: u.empNo, name: u.name, email: u.email, role: u.role, referralCode: null, sessionId: "t" };
}
const as = async (s: Staff) => (await actorFor(s))!;
const csv = (rows: string[][]) => new TextEncoder().encode(rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n"));
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

let admin: Actor, manager: Actor, priya: Actor, rahul: Actor, kiran: Actor, analyst: Actor, outsider: Actor;
let priyaS: Staff, rahulS: Staff, kiranS: Staff, careS: Staff, partnerS: Staff;

describe("Growth Intelligence", () => {
  beforeAll(async () => {
    await resetDb();
    process.env.SESSION_SECRET ||= "test-only-secret-0123456789abcdef0123";
    const adminS = await staff("Aarti Admin", "super_admin");
    const managerS = await staff("Meera Manager", "sales");
    priyaS = await staff("Priya Sales", "sales"); rahulS = await staff("Rahul Sales", "sales"); kiranS = await staff("Kiran Sales", "sales");
    const analystS = await staff("Anil Analyst", "care"); careS = await staff("Outside Care", "care"); partnerS = await staff("Partner MR", "partner", "partner");
    admin = await as(adminS);
    await setMember(admin, { staffId: managerS.id, role: "manager" });
    for (const s of [priyaS, rahulS, kiranS]) await setMember(admin, { staffId: s.id, role: "sales" });
    await setMember(admin, { staffId: analystS.id, role: "analyst" });
    const team = await saveTeam(admin, { name: "Pune West", managerId: managerS.id });
    for (const s of [priyaS, rahulS]) await setMember(admin, { staffId: s.id, role: "sales", teamId: team });
    manager = await as(managerS); priya = await as(priyaS); rahul = await as(rahulS); kiran = await as(kiranS); analyst = await as(analystS);
    outsider = kiran;
  });
  beforeEach(() => jar.clear());

  it("roles: super admin is admin; staff need a Growth role; partners never get one", async () => {
    expect(admin.growthRole).toBe("admin");
    expect(manager.teamStaffIds.sort()).toEqual([manager.id, priya.id, rahul.id].sort());
    expect(await actorFor(careS)).toBeNull();
    await expect(setMember(admin, { staffId: partnerS.id, role: "sales" })).rejects.toThrow(/Reference partners/);
    await expect(setMember(manager, { staffId: careS.id, role: "sales" })).rejects.toThrow(/Growth role can’t/);
    await expect(createLead(analyst, { name: "Should Fail", phone: "9800000000" })).rejects.toThrow(/Growth role can’t/);
  });

  it("creates leads, refuses strong duplicates and queues possible ones", async () => {
    const a = await createLead(admin, { name: "Shivam Medical & General Stores", phone: "020-2553 1234", address: "Shop 4, FC Road", city: "Pune", district: "Pune", state: "MH", pin: "411005", website: "shivam.example.in" });
    expect(a.code).toMatch(/^GL-\d{6}$/);
    await expect(createLead(admin, { name: "Other name", phone: "+91 20 2553 1234", pin: "411001", state: "Maharashtra" })).rejects.toThrow(/Already a lead.*same phone/i);
    await expect(createLead(admin, { name: "Other", website: "https://www.shivam.example.in/x", state: "Maharashtra" })).rejects.toThrow(/same website/i);
    const b = await createLead(admin, { name: "Shivam Medicals", phone: "9823055120", address: "FC Road", city: "Pune", state: "Maharashtra", pin: "411005" });
    expect(b.possible).toBe(1);
    const q = await verificationQueue(admin);
    expect(q.duplicates).toHaveLength(1);
    expect(q.duplicates[0].reason).toMatch(/Similar name in PIN 411005/);
  });

  it("safe merge keeps both histories and fills only blanks", async () => {
    const q = await verificationQueue(admin);
    const c = q.duplicates[0];
    await mergeDuplicate(admin, c.id, c.matchId);
    const kept = await db.pharmacyLead.findUniqueOrThrow({ where: { id: c.matchId } });
    const dropped = await db.pharmacyLead.findUniqueOrThrow({ where: { id: c.leadId } });
    expect(kept.phone).toBe("+912025531234"); // its own value is kept
    expect(dropped).toMatchObject({ verification: "DUPLICATE", duplicateOfId: kept.id });
    expect(dropped.deletedAt).not.toBeNull();
    expect(await db.leadActivity.count({ where: { leadId: dropped.id } })).toBeGreaterThanOrEqual(2);
    await expect(db.leadActivity.updateMany({ where: { leadId: dropped.id }, data: { text: "x" } })).rejects.toThrow(/append-only/);
  });

  it("imports CSV with preview, validation, in-file and existing duplicates and an error report", async () => {
    const file = csv([
      ["Pharmacy Name", "Mobile", "Address", "City", "District", "State", "Pincode", "Email", "Website"],
      ["Lifeline Pharmacy", "98230 11111", "JM Road", "Pune", "Pune", "Maharashtra", "411004", "lifeline@example.in", ""],
      ["Lifeline Pharmacy Branch", "+91 98230 11111", "JM Road", "Pune", "Pune", "Maharashtra", "411004", "", ""],
      ["Shivam Old Listing", "02025531234", "", "Pune", "Pune", "Maharashtra", "411005", "", ""],
      ["Bad State", "9823022222", "", "X", "", "Atlantis", "411004", "", ""],
      ["No Contact", "", "", "Pune", "", "Maharashtra", "", "", ""],
      ["=HYPERLINK(\"http://evil\")", "9823033333", "", "Pune", "", "Maharashtra", "41100", "", ""],
      ["Sai Krupa Medical", "9823044444", "Karve Road", "Pune", "Pune", "Maharashtra", "411038", "", "saikrupa.example.in"],
    ]);
    const p = await previewImport(admin, "pune.csv", file);
    expect(p.counts).toEqual({ total: 7, new: 2, possible: 0, duplicate: 2, invalid: 3, erased: 0 });
    expect(p.rows.find((r) => r.line === 3)!.messages[0]).toMatch(/Same as line 2/);
    await expect(commitImport(admin, "pune.csv", file, undefined, {} as never)).rejects.toThrow(/collected lawfully/);
    const j = await commitImport(admin, "pune.csv", file, undefined, { confirmLawful: true, newSource: { name: "Pune Chemists Association list", kind: "public_directory", licence: "", attribution: "", termsUrl: "", allowsExport: true } });
    expect(j).toMatchObject({ status: "completed", created: 2, duplicates: 2, invalid: 3 });
    const shivam = await db.pharmacyLead.findFirstOrThrow({ where: { phone: "+912025531234", deletedAt: null } });
    expect(await db.leadEvidence.count({ where: { leadId: shivam.id, detail: { contains: j.code } } })).toBe(1); // source record kept on the existing lead
    const err = await importErrorsCsv(admin, j.id);
    expect(err.csv).toContain("Atlantis");
    expect(err.csv).toContain(`"'=HYPERLINK`); // formula injection neutralised
    // XLSX works the same way.
    const x = xlsx([["Store Name", "Phone", "State", "PIN"], ["Wellness Chemist", "9823055555", "Maharashtra", "411001"]]);
    const xp = await previewImport(admin, "list.xlsx", x);
    expect(xp.counts.new).toBe(1);
    await expect(previewImport(admin, "list.xls", x)).rejects.toThrow(/\.csv or \.xlsx/);
    await commitImport(admin, "list.xlsx", x, undefined, { confirmLawful: true });
  });

  it("verifies only with evidence; website check is SSRF-safe and content-based", async () => {
    const l = await db.pharmacyLead.findFirstOrThrow({ where: { name: "Sai Krupa Medical" } });
    await expect(verifyLead(admin, l.id, { kind: "business", method: "document", detail: "ok" })).rejects.toThrow(/Describe the evidence/);
    await verifyLead(admin, l.id, { kind: "business", method: "document", detail: "Drug licence MH-PZ3-123456 checked on the FDA Maharashtra portal" });
    const html = new Response("<html><title>Sai Krupa Medical, Karve Road</title></html>", { status: 200 });
    const r = await checkWebsite(admin, l.id, { fetchImpl: (async () => html) as unknown as typeof fetch, resolve: async () => ["93.184.216.34"] });
    expect(r.verified).toBe(true);
    const after = await db.pharmacyLead.findUniqueOrThrow({ where: { id: l.id } });
    expect(after.verification).toBe("PARTIALLY_VERIFIED");
    expect(after.score).toBe(20 + 15 + 6); // business + website + listed address; nothing for unverified phone
    const bad = await checkWebsite(admin, l.id, { fetchImpl: (async () => html) as unknown as typeof fetch, resolve: async () => ["127.0.0.1"] });
    expect(bad).toMatchObject({ verified: false, detail: expect.stringMatching(/private network/) });
    // Changing the website withdraws its verification.
    await updateLead(admin, l.id, { name: after.name, phone: after.phone!, website: "saikrupa2.example.in", state: after.state, pin: after.pin, address: after.address, city: after.city, updatedAt: after.updatedAt.toISOString() });
    expect((await db.pharmacyLead.findUniqueOrThrow({ where: { id: l.id } })).websiteVerifiedAt).toBeNull();
  });

  it("distributes 300 leads equally, transactionally, with one active owner per lead", async () => {
    const rows = [["Name", "Phone", "State", "PIN", "City"], ...Array.from({ length: 300 }, (_, i) => [`Bulk Pharmacy ${i}`, `97${String(10000000 + i)}`, "Maharashtra", String(411001 + (i % 40)), "Pune"])];
    const j = await commitImport(admin, "bulk.csv", csv(rows), undefined, { confirmLawful: true });
    expect(await db.backgroundJob.count({ where: { kind: "import" } })).toBe(1); // over the inline limit: a background job owns it
    for (let k = 0; k < 5 && (await db.leadImportJob.findUniqueOrThrow({ where: { id: j.id } })).status !== "completed"; k++) await runJobs(new Date(), 30_000);
    expect(await db.leadImportJob.findUniqueOrThrow({ where: { id: j.id } })).toMatchObject({ status: "completed", created: 300 });
    const r = await distribute(admin, { filter: { q: "Bulk Pharmacy" }, staffIds: [priya.id, rahul.id, kiran.id] });
    expect(Object.values(r.byStaff)).toEqual([100, 100, 100]);
    expect(await db.leadAssignment.count({ where: { active: true } })).toBe(300);
    // A second active primary assignment is impossible at the database.
    const one = await db.leadAssignment.findFirstOrThrow({ where: { active: true } });
    await expect(db.leadAssignment.create({ data: { leadId: one.leadId, staffId: kiran.id, activeLeadKey: null, assignedById: admin.id } })).rejects.toThrow(/LeadAssignment_one_active_primary|Unique constraint/);
    // Without "reassign", assigned leads are skipped rather than moved.
    const again = await assignLeads(admin, { leadIds: [one.leadId], staffId: one.staffId === kiran.id ? priya.id : kiran.id });
    expect(again).toMatchObject({ assigned: 0, skipped: [{ reason: expect.stringMatching(/already assigned/) }] });
  });

  it("managers distribute only within their team; employees see only their leads", async () => {
    await expect(assignLeads(manager, { filter: { q: "Lifeline" }, staffId: kiran.id })).rejects.toThrow(/in your team/);
    const r = await assignLeads(manager, { filter: { q: "Lifeline" }, staffId: priya.id });
    expect(r.assigned).toBe(1);
    const mine = await listLeads(priya, { pageSize: 200 });
    expect(mine.total).toBe(101);
    expect(mine.rows.every((x) => x.assignedStaffId === priya.id)).toBe(true);
    const lifeline = await db.pharmacyLead.findFirstOrThrow({ where: { name: "Lifeline Pharmacy" } });
    await expect(findLead(rahul, lifeline.id)).rejects.toThrow(/isn’t assigned to you/);
    await expect(leadDetail(analyst, lifeline.id)).rejects.toThrow(/Growth role can’t/);
    // Kiran is not in Meera's team: the manager can't see Kiran's leads.
    const kLead = await db.pharmacyLead.findFirstOrThrow({ where: { assignedStaffId: kiran.id } });
    await expect(findLead(manager, kLead.id)).rejects.toThrow();
  });

  it("calls: validated launch → tel: URI; report once; follow-up and stage in one transaction", async () => {
    const lead = await db.pharmacyLead.findFirstOrThrow({ where: { name: "Lifeline Pharmacy" } });
    await expect(launchCall(rahul, lead.id)).rejects.toThrow(/isn’t assigned to you/);
    const l = await launchCall(priya, lead.id);
    expect(l).toMatchObject({ success: true, phone: "+919823011111", dialerUri: "tel:+919823011111", reused: false });
    expect((await launchCall(priya, lead.id)).callSessionId).toBe(l.callSessionId); // double tap reuses the session
    await expect(reportCall(rahul, l.callSessionId, { outcome: "INTERESTED", interestLevel: "high", notes: "x x x", followUpAt: future(2) })).rejects.toThrow(/only report calls you started/);
    await expect(reportCall(priya, l.callSessionId, { outcome: "INTERESTED", interestLevel: "high", notes: "Interested" })).rejects.toThrow(/next follow-up/);
    const key = "rep-" + l.callSessionId;
    const rep = await reportCall(priya, l.callSessionId, { outcome: "INTERESTED", interestLevel: "high", notes: "Interested in Medoro pharmacy billing software.", followUpAt: future(2), numberConfirmed: true, softwareStatus: "paper", consentChannels: ["whatsapp"], idempotencyKey: key });
    expect(rep).toMatchObject({ duplicate: false, stage: "INTERESTED" });
    expect(await reportCall(priya, l.callSessionId, { outcome: "INTERESTED", interestLevel: "high", notes: "again", followUpAt: future(2), idempotencyKey: key })).toMatchObject({ duplicate: true });
    await expect(reportCall(priya, l.callSessionId, { outcome: "CONNECTED", interestLevel: "low", notes: "dup without key" })).rejects.toThrow(/already reported/);
    const after = await db.pharmacyLead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after).toMatchObject({ stage: "INTERESTED", softwareStatus: "paper", verification: "PHONE_VERIFIED" });
    expect(after.nextFollowUpAt).not.toBeNull();
    expect(await db.followUpTask.count({ where: { leadId: lead.id, status: "open", staffId: priya.id } })).toBe(1);
    expect(await db.contactConsent.count({ where: { leadId: lead.id, channel: "whatsapp", revokedAt: null } })).toBe(1);
    expect(after.score).toBe(20 + 6 + 15 + 12); // phone verified + listed address + paper billing + interested
    const d = await leadDetail(priya, lead.id);
    expect(d.score.lines.find((x) => x.key === "software")!.provenance).toBe("user_provided");
  });

  it("dialer launches are not calls: performance counts only reported calls", async () => {
    const [a1, a2] = await db.pharmacyLead.findMany({ where: { assignedStaffId: rahul.id }, take: 2 });
    await launchCall(rahul, a1.id); // never reported
    const s = await launchCall(rahul, a2.id);
    await reportCall(rahul, s.callSessionId, { outcome: "NO_ANSWER", interestLevel: "none", notes: "No answer, rang out" });
    const perf = await employeePerformance(admin, {});
    const r = perf.rows.find((x) => x.id === rahul.id)!;
    expect(r).toMatchObject({ assigned: 100, launches: 2, reported: 1, connected: 0, interested: 0 });
    const p = perf.rows.find((x) => x.id === priya.id)!;
    expect(p).toMatchObject({ launches: 1, reported: 1, connected: 1, interested: 1 });
    await expect(employeePerformance(priya, {})).rejects.toThrow(/Growth role can’t/);
    const mgr = await employeePerformance(manager, {});
    expect(mgr.rows.map((x) => x.id)).not.toContain(kiran.id);
    expect((await employeePerformance(analyst, {})).rows.length).toBeGreaterThanOrEqual(3);
    await setTarget(manager, { staffId: rahul.id, period: "daily", calls: 4 });
    await expect(setTarget(manager, { staffId: kiran.id, period: "daily", calls: 4 })).rejects.toThrow(/in your team/);
    const md = await myDashboard(rahul);
    expect(md).toMatchObject({ assigned: 100, attemptedToday: 1, connectedToday: 0, targets: { daily: { calls: 4 } } });
    expect((await employeePerformance(admin, { staffId: rahul.id })).rows[0].dailyPct).toBe(25);
  });

  it("reassignment keeps call reports and history; inactive employees' leads move", async () => {
    const lead = await db.pharmacyLead.findFirstOrThrow({ where: { name: "Lifeline Pharmacy" } });
    await assignLeads(admin, { leadIds: [lead.id], staffId: rahul.id, reassign: true, reason: "Priya on leave" });
    expect((await db.pharmacyLead.findUniqueOrThrow({ where: { id: lead.id } })).assignedStaffId).toBe(rahul.id);
    expect(await db.callSession.count({ where: { leadId: lead.id, staffId: priya.id, status: "reported" } })).toBe(1);
    expect(await db.followUpTask.count({ where: { leadId: lead.id, status: "open", staffId: rahul.id } })).toBe(1); // follow-up moved
    expect(await db.leadAssignmentHistory.count({ where: { leadId: lead.id } })).toBe(2);
    await expect(launchCall(priya, lead.id)).rejects.toThrow();
    // Kiran leaves: their leads go to the others.
    await db.staffUser.update({ where: { id: kiran.id }, data: { status: "deactivated" } });
    expect((await distributionOverview(admin)).inactive).toEqual([{ staffId: kiran.id, name: "Kiran Sales", leads: 100 }]);
    const r = await reassignFrom(admin, kiran.id, [priya.id, rahul.id]);
    expect(r.assigned).toBe(100);
    expect(await db.leadAssignment.count({ where: { staffId: kiran.id, active: true } })).toBe(0);
    expect(await db.leadAssignment.count({ where: { staffId: kiran.id, active: false } })).toBe(100);
  });

  it("territories assign unassigned leads by PIN, district and state", async () => {
    await addTerritory(admin, priya.id, { state: "Maharashtra", pin: "411001" });
    await addTerritory(admin, rahul.id, { state: "Maharashtra" });
    const w = await db.pharmacyLead.findFirstOrThrow({ where: { name: "Wellness Chemist" } });
    const sai = await db.pharmacyLead.findFirstOrThrow({ where: { name: "Sai Krupa Medical" } });
    const r = await assignByTerritory(admin, { state: "Maharashtra" });
    expect(r.assigned).toBeGreaterThanOrEqual(2);
    expect((await db.pharmacyLead.findUniqueOrThrow({ where: { id: w.id } })).assignedStaffId).toBe(priya.id);
    expect((await db.pharmacyLead.findUniqueOrThrow({ where: { id: sai.id } })).assignedStaffId).toBe(rahul.id);
  });

  it("do-not-contact blocks calls and messages; wrong numbers are suppressed", async () => {
    const [x, y] = await db.pharmacyLead.findMany({ where: { assignedStaffId: priya.id, name: { startsWith: "Bulk" } }, take: 2 });
    const s = await launchCall(priya, x.id);
    await reportCall(priya, s.callSessionId, { outcome: "DO_NOT_CONTACT", interestLevel: "none", notes: "Asked us not to call again" });
    expect((await db.pharmacyLead.findUniqueOrThrow({ where: { id: x.id } })).stage).toBe("DO_NOT_CONTACT");
    await expect(launchCall(priya, x.id)).rejects.toThrow(/asked not to be contacted/);
    await expect(recordConsent(priya, { leadId: x.id, channel: "whatsapp", purpose: "marketing", lawfulBasis: "consent", evidence: "Said yes on a call" })).rejects.toThrow(/do-not-contact/);
    const s2 = await launchCall(priya, y.id);
    await reportCall(priya, s2.callSessionId, { outcome: "WRONG_NUMBER", interestLevel: "none", notes: "Not a pharmacy" });
    await expect(launchCall(priya, y.id)).rejects.toThrow(/do-not-contact list/);
    // Policy "authorised contacts only" needs permission before the first call.
    await savePolicy(admin, { callPolicy: "authorized_only", retentionMonths: 24, campaignDailyCap: 200 });
    const z = await db.pharmacyLead.findFirstOrThrow({ where: { assignedStaffId: priya.id, stage: "ASSIGNED" } });
    await expect(launchCall(priya, z.id)).rejects.toThrow(/permission first/);
    await recordConsent(priya, { leadId: z.id, channel: "phone", purpose: "marketing", lawfulBasis: "consent", evidence: "Owner filled the website demo form asking for a call", source: "form" });
    expect((await launchCall(priya, z.id)).success).toBe(true);
    await savePolicy(admin, { callPolicy: "dnc_only", retentionMonths: 24, campaignDailyCap: 200 });
  });

  it("follow-ups: list, create for the assignee only, escalate when overdue", async () => {
    const lead = await db.pharmacyLead.findFirstOrThrow({ where: { assignedStaffId: rahul.id, stage: "ASSIGNED" } });
    await expect(createFollowUp(priya, { leadId: lead.id, dueAt: future(1) })).rejects.toThrow();
    await createFollowUp(rahul, { leadId: lead.id, dueAt: future(1), note: "Call after lunch" });
    expect((await listFollowUps(rahul, { view: "upcoming" })).rows.length).toBeGreaterThanOrEqual(1);
    await db.followUpTask.updateMany({ where: { leadId: lead.id }, data: { dueAt: new Date(Date.now() - 3 * 86_400_000) } });
    expect(await escalateOverdue()).toBeGreaterThanOrEqual(1);
    expect(await escalateOverdue()).toBe(0); // once
    expect(await db.eventOutbox.count({ where: { topic: "followup.escalated" } })).toBeGreaterThanOrEqual(1);
    expect((await listFollowUps(manager, { view: "overdue" })).overdue).toBeGreaterThanOrEqual(1);
  });

  it("pipeline: lost needs a reason, conversion records revenue, hand-off to the commission pipeline", async () => {
    const lead = await db.pharmacyLead.findFirstOrThrow({ where: { name: "Lifeline Pharmacy" } });
    await expect(setStage(rahul, lead.id, { stage: "LOST" })).rejects.toThrow(/why the lead was lost/);
    await expect(setStage(rahul, lead.id, { stage: "CONVERTED" })).rejects.toThrow(/Record the conversion/);
    await convertLead(rahul, lead.id, { product: "pro", cycle: "m", amountRupees: 2499, reference: "UTR123" });
    await expect(convertLead(rahul, lead.id, { product: "pro", cycle: "m", amountRupees: 2499 })).rejects.toThrow(/already converted/);
    expect((await db.pharmacyLead.findUniqueOrThrow({ where: { id: lead.id } })).stage).toBe("CONVERTED");
    const code = await handOffToPipeline(rahul, lead.id, "pro");
    expect(await db.lead.findFirstOrThrow({ where: { code } })).toMatchObject({ phone: "9823011111", staffId: rahul.id });
    const dash = await dashboard(admin, {});
    expect(dash.kpi).toMatchObject({ conversions: 1, revenuePaise: 249900 });
    expect(dash.callingFunnel[0].n).toBeGreaterThan(dash.callingFunnel[1].n - 1);
  });

  it("messages need consent; campaigns need approval and skip unconsented leads; STOP opts out", async () => {
    const sent: { to: string; payload: unknown }[] = [];
    setSender({ whatsapp: async (_c, to, payload) => { sent.push({ to, payload }); return "wamid." + sent.length; }, email: async () => null });
    await connectWhatsApp(admin, { phoneNumberId: "1234567890", wabaId: "9876543210", token: "x".repeat(30), appSecret: "app-secret-0123456789" }, false);
    const consented = await db.pharmacyLead.findFirstOrThrow({ where: { name: "Lifeline Pharmacy" } });
    const other = await db.pharmacyLead.findFirstOrThrow({ where: { assignedStaffId: rahul.id, stage: "ASSIGNED", phone: { not: null } } });
    const tId = await saveTemplate(admin, { channel: "whatsapp", name: "medoro_intro", language: "en", body: "Hello {{1}} in {{2}}, this is {{3}} from Medoro. Reply STOP to opt out." });
    await expect(sendMessage(rahul, { leadId: other.id, channel: "whatsapp", templateId: tId })).rejects.toThrow(/approved template|consent/);
    await db.messageTemplate.update({ where: { id: tId }, data: { status: "approved" } }); // as if synced from Meta
    await expect(sendMessage(rahul, { leadId: other.id, channel: "whatsapp", templateId: tId })).rejects.toThrow(/No recorded whatsapp consent/);
    await sendMessage(rahul, { leadId: consented.id, channel: "whatsapp", templateId: tId });
    expect(sent).toHaveLength(1);
    // Campaign over Rahul's leads: only the consented one is queued.
    const cId = await createCampaign(manager, { name: "Pune intro", channel: "whatsapp", templateId: tId, audience: { staffId: rahul.id } });
    await expect(approveCampaign(manager, cId, true)).rejects.toThrow(/Growth role can’t/);
    await approveCampaign(admin, cId, true);
    const rec = await db.campaignRecipient.groupBy({ by: ["status"], where: { campaignId: cId }, _count: true });
    expect(rec.find((r) => r.status === "queued")?._count).toBe(1);
    expect(rec.find((r) => r.status === "skipped")!._count).toBeGreaterThan(50);
    expect(await sendCampaignBatches()).toBe(1);
    expect(sent).toHaveLength(2);
    // Webhook: bad signature rejected; good one records delivery and a STOP opt-out.
    const body = JSON.stringify({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "1234567890" }, statuses: [{ id: "wamid.2", status: "delivered" }], messages: [{ id: "in.1", from: "919823011111", type: "text", text: { body: "STOP" } }] } }] }] });
    await expect(handleWaWebhook(body, "sha256=bad")).rejects.toThrow(/signature/);
    await handleWaWebhook(body, "sha256=" + createHmac("sha256", "app-secret-0123456789").update(body).digest("hex"));
    expect((await db.campaignRecipient.findFirstOrThrow({ where: { campaignId: cId, status: { notIn: ["skipped"] } } })).status).toBe("replied");
    await expect(sendMessage(rahul, { leadId: consented.id, channel: "whatsapp", templateId: tId })).rejects.toThrow(/opted out/);
    setSender(null);
  });

  it("email events are signed; unsubscribe links work only with a valid token", async () => {
    process.env.GROWTH_EMAIL_WEBHOOK_SECRET = "email-webhook-secret-0123";
    const raw = JSON.stringify({ type: "bounce", email: "lifeline@example.in" });
    await expect(handleEmailEvent(raw, "nope")).rejects.toThrow(/signature/);
    expect(await handleEmailEvent(raw, createHmac("sha256", "email-webhook-secret-0123").update(raw).digest("hex"))).toBe("bounce");
    expect(await db.suppressionRecord.count({ where: { reason: "bounce", channel: "email" } })).toBe(1);
    const l = await db.pharmacyLead.findFirstOrThrow({ where: { name: "Sai Krupa Medical" } });
    const t = new URL(unsubscribeUrl(l.id, "whatsapp"), "http://x").searchParams.get("t")!;
    expect(await unsubscribe(l.id, "whatsapp", "forged-token-forged-token-forged0")).toBe(false);
    expect(await unsubscribe(l.id, "whatsapp", t)).toBe(true);
    expect(await db.suppressionRecord.count({ where: { leadId: l.id, reason: "opt_out" } })).toBe(1);
  });

  it("erasure removes personal data, keeps a hashed do-not-contact entry and blocks re-import", async () => {
    const l = await db.pharmacyLead.findFirstOrThrow({ where: { name: "Wellness Chemist" } });
    await expect(eraseLead(manager, l.id, "Requested by email")).rejects.toThrow(/Growth role can’t/);
    await eraseLead(admin, l.id, "Erasure request by email, 6 Nov");
    const e = await db.pharmacyLead.findUniqueOrThrow({ where: { id: l.id } });
    expect(e).toMatchObject({ name: "Erased lead", phone: null, email: "", stage: "DO_NOT_CONTACT" });
    expect((await db.suppressionRecord.findFirstOrThrow({ where: { reason: "erasure" } })).hint).toBe("+91•••••55555");
    const again = await previewImport(admin, "again.csv", csv([["Name", "Phone", "State"], ["Wellness Chemist", "9823055555", "Maharashtra"]]));
    expect(again.counts.erased).toBe(1);
  });

  it("export: managers and admins only, audited, rate limited, formula-safe", async () => {
    await expect(exportLeads(rahul, {}, "Weekly review")).rejects.toThrow(/Growth role can’t/);
    const r = await exportLeads(admin, { q: "Shivam" }, "Weekly review for the founders");
    expect(r.count).toBe(1);
    expect(r.csv.split("\n")[0]).toContain("Source licence / attribution");
    expect(await db.growthAuditLog.count({ where: { action: "Leads exported" } })).toBe(1);
    for (let k = 0; k < 4; k++) await exportLeads(admin, {}, "Rate limit check");
    await expect(exportLeads(admin, {}, "Rate limit check")).rejects.toThrow(/Too many lead exports/);
  });

  it("AI research labels facts and drafts in Hindi without inventing owner details", async () => {
    const l = await db.pharmacyLead.findFirstOrThrow({ where: { name: "Lifeline Pharmacy" } });
    const r = await research(rahul, l.id);
    expect(r.facts.find((f) => f.label === "Turnover / revenue")).toMatchObject({ provenance: "unknown" });
    expect(r.facts.find((f) => f.label === "Owner / contact")).toMatchObject({ value: "Not known", provenance: "unknown" });
    expect(r.facts.find((f) => f.label === "Current billing software")).toMatchObject({ provenance: "user_provided" });
    expect(r.inferred.every((f) => f.provenance === "inferred")).toBe(true);
    const d = await draftMessage(rahul, { leadId: l.id, lang: "hi", purpose: "intro" });
    expect(d.text).toContain("Lifeline Pharmacy");
    expect(d.text).toContain("STOP");
    expect(d.text).not.toMatch(/जी,/); // no owner greeting: the owner isn't verified
    expect(d.source).toBe("template");
  });

  it("jobs retry with backoff and go dead after max attempts; retry revives them", async () => {
    let calls = 0;
    await import("@/staff/growth/workers"); // the real handlers first, then the failing stub replaces one
    register("rescore_all", async () => { calls++; throw new Error("boom"); });
    const j = await enqueue("rescore_all", {}, { key: "test-dead", maxAttempts: 2 });
    expect((await enqueue("rescore_all", {}, { key: "test-dead" })).id).toBe(j.id); // idempotent
    await runJobs(new Date(), 2000);
    let row = await db.backgroundJob.findUniqueOrThrow({ where: { id: j.id } });
    expect(row).toMatchObject({ status: "failed", attempts: 1 });
    expect(row.runAt.getTime()).toBeGreaterThan(Date.now() + 20_000);
    await db.backgroundJob.update({ where: { id: j.id }, data: { runAt: new Date() } });
    await runJobs(new Date(), 2000);
    row = await db.backgroundJob.findUniqueOrThrow({ where: { id: j.id } });
    expect(row.status).toBe("dead");
    expect(await retryJob(j.id)).toBe(true);
    expect(calls).toBe(2);
  });

  it("OpenStreetMap discovery imports idempotently with attribution", async () => {
    const src = await db.leadSource.upsert({ where: { key: "osm" }, create: { key: "osm", name: "OpenStreetMap", kind: "open_data", licence: "ODbL 1.0", attribution: "© OpenStreetMap contributors" }, update: {} });
    const job = await db.leadImportJob.create({ data: { code: "IMP-OSM1", fileName: "OpenStreetMap: Goa", sourceId: src.id, status: "running", mapping: {}, createdById: admin.id } });
    const res = { elements: [
      { type: "node", id: 1, lat: 15.49, lon: 73.82, tags: { amenity: "pharmacy", name: "Panaji Medical Hall", phone: "0832 222 3344", "addr:postcode": "403001" } },
      { type: "way", id: 2, center: { lat: 15.5, lon: 73.83 }, tags: { amenity: "pharmacy", name: "Map Only Chemist" } },
      { type: "node", id: 3, lat: 15.51, lon: 73.84, tags: { amenity: "pharmacy" } },
    ] };
    const f = (async () => new Response(JSON.stringify(res), { status: 200 })) as unknown as typeof fetch;
    await runDiscovery({ importJobId: job.id, state: "Goa", district: "", city: "Panaji", pin: "" }, f);
    expect(await db.leadImportJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "completed", created: 2, invalid: 1 });
    const p = await db.pharmacyLead.findFirstOrThrow({ where: { name: "Panaji Medical Hall" } });
    expect(p).toMatchObject({ phone: "+918322223344", sourceUrl: "https://www.openstreetmap.org/node/1", state: "Goa" });
    expect((await db.pharmacyLead.findFirstOrThrow({ where: { name: "Map Only Chemist" } })).stage).toBe("RESEARCH_PENDING");
    await db.leadImportJob.update({ where: { id: job.id }, data: { status: "running" } });
    await runDiscovery({ importJobId: job.id, state: "Goa", district: "", city: "Panaji", pin: "" }, f);
    expect(await db.pharmacyLead.count({ where: { sourceId: src.id } })).toBe(2);
  });

  it("withdraws assignments and keeps the audit trail append-only", async () => {
    const l = await db.pharmacyLead.findFirstOrThrow({ where: { assignedStaffId: priya.id } });
    await expect(withdraw(admin, [l.id], "")).rejects.toThrow(/reason/);
    expect(await withdraw(admin, [l.id], "Duplicate effort")).toBe(1);
    expect((await db.pharmacyLead.findUniqueOrThrow({ where: { id: l.id } })).assignedStaffId).toBeNull();
    await expect(db.growthAuditLog.deleteMany({})).rejects.toThrow(/append-only/);
    expect(await db.growthAuditLog.count()).toBeGreaterThan(10);
    expect((await callHistory(priya, {})).rows.every((r) => r.staffId === priya.id)).toBe(true);
    // Suppression by hand and the outsider check.
    await expect(suppress(outsider, { value: "9999999999", channel: "all", reason: "manual" })).resolves.toBeTruthy();
  });
  it("JSON API: session, role, CSRF and the call-launch contract", async () => {
    const { createStaffSession, STAFF_COOKIE } = await import("@/staff/auth");
    const launchRoute = await import("@/app/staff/api/growth/calls/launch/route");
    const perfRoute = await import("@/app/staff/api/growth/admin/employee-performance/route");
    const post = (b: unknown, h: Record<string, string> = {}) => new Request("http://localhost/staff/api/growth/calls/launch", { method: "POST", headers: { "content-type": "application/json", host: "localhost", ...h }, body: JSON.stringify(b) });
    jar.clear();
    expect((await launchRoute.POST(post({ leadId: "00000000-0000-0000-0000-000000000000" }))).status).toBe(401);
    // Sign in as Rahul (sales) by creating a real session with MFA passed.
    await createStaffSession(rahul.id, 0, { mfaPassed: true });
    expect(jar.get(STAFF_COOKIE)).toBeTruthy();
    const lead = await db.pharmacyLead.findFirstOrThrow({ where: { assignedStaffId: rahul.id, stage: "ASSIGNED", phone: { not: null } } });
    expect((await launchRoute.POST(post({ leadId: lead.id }, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }))).status).toBe(403);
    const ok = await launchRoute.POST(post({ leadId: lead.id }, { origin: "http://localhost" }));
    expect(ok.status).toBe(200);
    const j = await ok.json();
    expect(j).toMatchObject({ success: true, phone: lead.phone, dialerUri: "tel:" + lead.phone });
    expect(j.callSessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await launchRoute.POST(post({ leadId: "not-a-uuid" }))).status).toBe(400);
    // Sales can't read employee performance.
    expect((await perfRoute.GET(new Request("http://localhost/staff/api/growth/admin/employee-performance"))).status).toBe(403);
    jar.clear();
  });
});

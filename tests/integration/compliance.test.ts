import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { db } from "@/server/db";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { commitSale } from "@/domain/sales/service";
import { addDocument, addInspection, closeInspection, complianceCounts, complianceOverview, complianceReminders, documentFor, saveComplianceSettings, saveItem, setItemActive } from "@/domain/system/compliance";
import { badgesAndAlerts } from "@/domain/reports/alerts";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const key = () => "k_" + randomUUID().replace(/-/g, "");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
let main = "", second = "", lic = "";

describe("compliance centre", () => {
  beforeAll(async () => {
    process.env.STORAGE_DIR = await mkdtemp(path.join(os.tmpdir(), "medoro-comp-"));
    await resetDb(); await makePharmacy();
    const o = await ctxFor();
    main = o.branches.find((b) => b.name === "Main")!.id; second = o.branches.find((b) => b.name === "Second")!.id;
  });

  it("starts from suggested requirements, flagged as suggestions, and reports every branch as missing them", async () => {
    const o = await complianceOverview(await ctxFor());
    expect(o.settings.requiredIsDefault).toBe(true);
    expect(o.branches.every((b) => b.level === "critical" && b.missing.includes("retail_licence") && b.missing.includes("pharmacist_registration"))).toBe(true);
    expect(o.retention.configured).toEqual([]);                    // no retention period is invented
    expect(o.retention.system.length).toBeGreaterThan(0);          // what the system already does is shown
  });

  it("validates items and keeps them inside the user's branches and permissions", async () => {
    const o = await ctxFor();
    const ok = { branchId: main, kind: "retail_licence", title: "Retail licence Main", number: "MH-RL-1", expiresOn: addDays(todayISO(), 45) };
    await expect(saveItem(o, null, { ...ok, title: "x" })).rejects.toThrow(/title/);
    await expect(saveItem(o, null, { ...ok, issuedOn: addDays(todayISO(), 60) })).rejects.toThrow(/before the issue/);
    await expect(saveItem(o, null, { ...ok, kind: "made_up" })).rejects.toThrow();
    await expect(saveItem({ ...o, branches: o.branches.filter((b) => b.id === main) }, null, { ...ok, branchId: second })).rejects.toThrow(/access/);
    await expect(saveItem(await ctxFor("Cashier"), null, ok)).rejects.toThrow();
    lic = await saveItem(o, null, { ...ok, holder: "A. Kulkarni", authority: "State Drugs Control" });
    const row = (await complianceOverview(o)).items.find((i) => i.id === lic)!;
    expect(row).toMatchObject({ status: "expiring", daysLeft: 45, remindDays: [60, 30, 7], branch: "Main" });
    await expect(saveItem(o, lic, { ...ok, title: "Renamed" }, 99)).rejects.toThrow(/Someone else/);    // stale version
    await saveItem(o, lic, { ...ok, title: "Retail licence Main (renewed copy)" }, row.version);
  });

  it("rolls items up into a branch status that says why", async () => {
    const o = await complianceOverview(await ctxFor());
    const m = o.branches.find((b) => b.branchId === main)!;
    expect(m.missing).toEqual(["pharmacist_registration"]);
    expect(m.level).toBe("critical");
    expect(m.reasons.join(" ")).toMatch(/Expiring soon: Retail licence Main \(renewed copy\) \(45 d\)/);
    const own = await ctxFor();
    await saveItem(own, null, { branchId: main, kind: "pharmacist_registration", title: "Pharmacist reg", holder: "A. Kulkarni", expiresOn: addDays(todayISO(), 400) });
    const m2 = (await complianceOverview(own)).branches.find((b) => b.branchId === main)!;
    expect(m2.missing).toEqual([]);
    expect(m2.level).toBe("attention");                               // nothing missing or expired, but one licence is due for renewal
    await saveComplianceSettings(own, { required: [{ kind: "retail_licence", scope: "branch" }], retention: [{ label: "Prescription copies", years: 3, note: "set with our adviser" }] });
    const o3 = await complianceOverview(own);
    expect(o3.settings.requiredIsDefault).toBe(false);
    expect(o3.retention.configured[0]).toMatchObject({ label: "Prescription copies", years: 3 });
    await expect(saveComplianceSettings(await ctxFor("Manager"), { required: [], retention: [] })).rejects.toThrow();
  });

  it("sends each reminder once, records honestly when email is not set up, and re-arms on renewal", async () => {
    const t = (await ctxFor()).tenantId;
    const first = await complianceReminders(t);
    expect(first).toMatchObject({ due: 1, emailed: 0 });
    const rem = await db.complianceReminder.findMany();
    expect(rem).toHaveLength(1);
    expect(rem[0]).toMatchObject({ threshold: 60, outcome: "not_emailed", itemId: lic });
    expect(rem[0].detail).toMatch(/Email isn’t set up/);
    expect(await complianceReminders(t)).toMatchObject({ due: 0 });                    // not repeated
    const own = await ctxFor();
    const row = (await complianceOverview(own)).items.find((i) => i.id === lic)!;
    await saveItem(own, lic, { branchId: main, kind: "retail_licence", title: row.title, expiresOn: addDays(todayISO(), 20) }, row.version);   // a new, nearer date
    expect(await complianceReminders(t)).toMatchObject({ due: 1 });
    expect((await db.complianceReminder.findMany({ orderBy: { sentAt: "asc" } })).map((r) => r.threshold)).toEqual([60, 30]);
    await expect(db.complianceReminder.update({ where: { id: rem[0].id }, data: { outcome: "emailed" } })).rejects.toThrow();   // history is append-only
  });

  it("raises a badge and an alert for expired and expiring items, and handles expiry", async () => {
    const own = await ctxFor();
    const row = (await complianceOverview(own)).items.find((i) => i.id === lic)!;
    expect(await complianceCounts(own.tenantId)).toMatchObject({ expired: 0, expiring: 1 });
    await saveItem(own, lic, { branchId: main, kind: "retail_licence", title: row.title, expiresOn: addDays(todayISO(), -2) }, row.version);
    expect(await complianceCounts(own.tenantId)).toMatchObject({ expired: 1 });
    const b = await badgesAndAlerts(own.tenantId, own.branchId, own.perms);
    expect(b.badges.comp).toEqual([1, "red"]);
    expect(b.alerts.join(" ")).toMatch(/1 licence or registration expired/);
    expect((await badgesAndAlerts(own.tenantId, own.branchId, ["sale"])).badges.comp).toBeUndefined();   // not shown to a role with no view permission
    expect(await complianceReminders(own.tenantId)).toMatchObject({ due: 1 });
    expect((await db.complianceReminder.findMany({ orderBy: { sentAt: "asc" } })).map((r) => r.threshold)).toEqual([60, 30, 0]);
    const m = (await complianceOverview(own)).branches.find((x) => x.branchId === main)!;
    expect(m.level).toBe("critical");                                               // an expired licence no longer satisfies the requirement
    expect(m.missing).toEqual(["retail_licence"]);
    await setItemActive(own, lic, false);
    expect(await complianceCounts(own.tenantId)).toMatchObject({ expired: 0, expiring: 0 });   // switched-off items stop alerting
    await setItemActive(own, lic, true);
  });

  it("tracks inspections: open findings need a closing note, and overdue actions are critical", async () => {
    const own = await ctxFor();
    await expect(addInspection(own, { branchId: main, inspectedOn: addDays(todayISO(), 3), authority: "Drug Inspector", outcome: "observations", findings: "Labels missing" })).rejects.toThrow(/future/);
    const id = await addInspection(own, { branchId: second, inspectedOn: addDays(todayISO(), -20), authority: "Drug Inspector", inspector: "R. Patil", outcome: "observations", findings: "Cold-chain log incomplete", actionDue: addDays(todayISO(), -5) });
    let s = (await complianceOverview(own)).branches.find((b) => b.branchId === second)!;
    expect(s.reasons.join(" ")).toMatch(/1 inspection finding\(s\) past their action date/);
    expect(s.level).toBe("critical");
    await expect(closeInspection(own, id, "ok")).rejects.toThrow(/what was done/);
    await closeInspection(own, id, "Cold-chain log restarted and reviewed weekly");
    s = (await complianceOverview(own)).branches.find((b) => b.branchId === second)!;
    expect(s.reasons.join(" ")).not.toMatch(/inspection/);
    await expect(closeInspection(own, id, "Closed again")).rejects.toThrow(/Already closed/);
    const clean = await addInspection(own, { branchId: main, inspectedOn: todayISO(), authority: "Drug Inspector", outcome: "no_findings", findings: "No findings" });
    expect((await complianceOverview(own)).inspections.find((i) => i.id === clean)!.open).toBe(false);
  });

  it("stores documents by their real type and shows them only to people who can see the branch", async () => {
    const own = await ctxFor();
    await expect(addDocument(own, { itemId: lic, kind: "licence_copy", title: "Licence scan", fileName: "a.pdf", bytes: Buffer.from("not a pdf at all") })).rejects.toThrow(/PDF, JPG, PNG or WebP/);
    await expect(addDocument(own, { itemId: lic, kind: "licence_copy", title: "Licence scan", fileName: "a.pdf", bytes: Buffer.alloc(0) })).rejects.toThrow(/empty/);
    await expect(addDocument(own, { kind: "licence_copy", title: "Licence scan", fileName: "a.pdf", bytes: PDF })).rejects.toThrow(/Attach/);
    await expect(addDocument(await ctxFor("Cashier"), { itemId: lic, kind: "licence_copy", title: "Licence scan", fileName: "a.pdf", bytes: PDF })).rejects.toThrow();
    const id = await addDocument(own, { itemId: lic, kind: "licence_copy", title: "Licence scan", fileName: "../evil name.pdf", bytes: PDF });
    const d = await db.complianceDocument.findUniqueOrThrow({ where: { id } });
    expect(d).toMatchObject({ mime: "application/pdf", sizeBytes: PDF.length });
    expect(d.fileName).not.toContain("/");
    expect((await documentFor(own, id))?.id).toBe(id);
    expect((await complianceOverview(own)).items.find((i) => i.id === lic)!.documents).toHaveLength(1);
    // a Second-branch licence's scan is invisible to a user limited to Main
    const other = await saveItem(own, null, { branchId: second, kind: "retail_licence", title: "Retail licence Second", expiresOn: addDays(todayISO(), 400) });
    const oid = await addDocument(own, { itemId: other, kind: "licence_copy", title: "Second scan", fileName: "b.pdf", bytes: PDF });
    const limited = { ...own, branches: own.branches.filter((b) => b.id === main) };
    expect(await documentFor(limited, oid)).toBeNull();
    expect(JSON.stringify(await complianceOverview(limited))).not.toContain("Retail licence Second");
    await expect(documentFor(await ctxFor("Cashier"), id)).rejects.toThrow();
    await expect(db.complianceDocument.delete({ where: { id } })).rejects.toThrow();     // append-only
  });

  it("checks Schedule H1 / X sale records for the details the register needs", async () => {
    const own = await ctxFor("Manager");
    const base = { form: "Tablet" as const, manufacturer: "Alkem", pack: "10", reorderLevel: 0, barcode: "", hsn: "3004", rack: "", gstRate: 12 };
    const h1 = await createMedicine(own, { ...base, name: "Azee 500", generic: "Azithromycin", strength: "500 mg", mrp: "120", schedule: "H1" });
    await receiveBatch(own, { medicineId: h1, batchNo: "H1B", expiry: addDays(todayISO(), 300).slice(0, 7), qty: 20, cost: "60", mrp: "120", supplierId: null, invoiceNo: "" });
    const batch = await db.batch.findFirstOrThrow({ where: { medicineId: h1 } });
    const sell = (extra: object) => commitSale(own, { idempotencyKey: key(), lines: [{ medicineId: h1, batchId: batch.id, qty: 1 }], customerId: null, discountPct: 0, pay: { mode: "cash" }, ...extra } as never);
    // Billing itself refuses an H1 sale without prescriber, registration and patient, so complete records are the norm.
    await expect(sell({})).rejects.toThrow(/prescriber/);
    await expect(sell({ prescriber: "Dr Rao" })).rejects.toThrow(/patient’s name and prescriber’s registration/);
    const full = { prescriber: "Dr Rao", prescriberReg: "MMC-1234", patientName: "S. Joshi" };
    const a = await sell(full); await sell({ ...full, rxNo: "" });
    let m = (await complianceOverview(own)).branches.find((b) => b.branchId === main)!;
    expect(m.h1).toEqual({ lines: 2, incomplete: 0 });          // no Rx number is not counted as a gap
    expect(m.reasons.join(" ")).not.toMatch(/Schedule H1/);
    // An older or imported record can still lack details: blank one (sales are append-only, so bypass the trigger as a legacy row would exist).
    await db.$transaction([db.$executeRaw`SET LOCAL session_replication_role = replica`, db.$executeRaw`UPDATE "Sale" SET "prescriberReg" = '' WHERE id = ${a.saleId}`]);
    m = (await complianceOverview(own)).branches.find((b) => b.branchId === main)!;
    expect(m.h1).toEqual({ lines: 2, incomplete: 1 });
    expect(m.reasons.join(" ")).toMatch(/1 of 2 Schedule H1\/X sale line\(s\) in the last 90 days lack the prescriber, prescriber registration or patient/);
  });

  it("requires a view permission", async () => {
    await expect(complianceOverview(await ctxFor("Cashier"))).rejects.toThrow();
    await expect(complianceOverview(await ctxFor("Accountant"))).resolves.toBeDefined();   // reports permission may look, not change
    await expect(saveItem(await ctxFor("Accountant"), null, { branchId: main, kind: "other", title: "Anything" })).rejects.toThrow();
  });
});

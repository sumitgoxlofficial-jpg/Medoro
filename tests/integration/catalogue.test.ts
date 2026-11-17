import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import type { Staff } from "@/staff/auth";
import { addBarcode, catalogueVersion, createEntry, deprecateEntry, findDuplicates, importEntries, listCorrections, resolveCorrection, updateEntry, verifyBarcode, verifyEntry } from "@/staff/catalogue";
import { addFromCatalogue, applyCatalogue, catalogueDiff, linkMedicine, linkSuggestions, markCatalogueReviewed, myCorrections, requestCorrection, searchCentral, syncStatus, unlinkMedicine } from "@/domain/inventory/catalogue-sync";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { commitSale } from "@/domain/sales/service";
import { internalCode } from "@/lib/barcode";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const admin = { id: "staff-admin", empNo: "E1", name: "Catalogue Admin", email: "cat-admin@medoro.in", role: "super_admin", referralCode: null, sessionId: "s1" } as Staff;
const sales = { ...admin, id: "staff-sales", role: "sales" } as Staff;
const dolo = { brand: "Dolo 650", generic: "Paracetamol", strength: "650 mg", form: "Tablet", manufacturer: "Micro Labs Ltd", packSize: 15, packLabel: "strip of 15", hsn: "3004", gstRate: 12, source: "Manufacturer pack leaflet" } as const;
const key = () => "k_" + randomUUID().replace(/-/g, "");
let gid = "", localDolo = "", custom = "";
const validEan = (n: number) => { const base = "890123456" + String(n).padStart(3, "0"); const sum = [...base].reverse().reduce((a, d, i) => a + Number(d) * (i % 2 === 0 ? 3 : 1), 0); return base + ((10 - (sum % 10)) % 10); };

describe("central medicine catalogue", () => {
  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    await db.$executeRawUnsafe(`TRUNCATE "CatalogueBarcode", "CatalogueMedicine" CASCADE`);
    await db.$executeRawUnsafe(`ALTER SEQUENCE catalogue_gid_seq RESTART WITH 1`);
  });

  it("is curated by Medoro super admins only, and starts empty and unverified", async () => {
    await expect(createEntry(sales, dolo)).rejects.toThrow();
    gid = await createEntry(admin, dolo);
    expect(gid).toBe("CM-000001");
    const e = await db.catalogueMedicine.findUniqueOrThrow({ where: { gid } });
    expect(e).toMatchObject({ status: "draft", verifiedOn: null, verifiedBy: null, version: 1 });
    expect(e.saltKey).toBe("paracetamol 650mg");
    expect(await searchCentral(await ctxFor(), "dolo")).toEqual([]);             // drafts are invisible to pharmacies
  });

  it("validates entries and blocks duplicates of a live entry, naming the existing one", async () => {
    await expect(createEntry(admin, { ...dolo, source: "" })).rejects.toThrow();
    await expect(createEntry(admin, { ...dolo, gstRate: 7 })).rejects.toThrow();
    await expect(createEntry(admin, { ...dolo, brand: "DOLO-650", manufacturer: "micro labs ltd." })).rejects.toThrow(/already in the catalogue as CM-000001/);
    expect(await createEntry(admin, { ...dolo, packSize: 10, packLabel: "strip of 10" })).toBe("CM-000002");   // a different pack is a different product
  });

  it("verifies only with a recorded source and date, then shows the entry to pharmacies", async () => {
    await expect(verifyEntry(admin, gid, { sourceRef: "" })).rejects.toThrow(/source reference/);
    await expect(verifyEntry(admin, gid, { sourceRef: "leaflet p.2", verifiedOn: addDays(todayISO(), 3) })).rejects.toThrow(/future/);
    await expect(verifyEntry(sales, gid, { sourceRef: "leaflet p.2" })).rejects.toThrow();
    await verifyEntry(admin, gid, { sourceRef: "Micro Labs leaflet rev. 11/2025, p.2" });
    const e = await db.catalogueMedicine.findUniqueOrThrow({ where: { gid } });
    expect(e).toMatchObject({ status: "verified", verifiedBy: "cat-admin@medoro.in", sourceRef: "Micro Labs leaflet rev. 11/2025, p.2" });
    expect(e.verifiedOn).not.toBeNull();
    const hits = await searchCentral(await ctxFor(), "dolo");
    expect(hits.map((h) => h.gid)).toEqual([gid]);
    expect(Object.keys(hits[0])).not.toEqual(expect.arrayContaining(["createdBy", "verifiedBy", "dedupeKey"]));   // staff-only fields are not exposed
  });

  it("keeps an append-only change log whose sequence is the catalogue version", async () => {
    const log = await db.catalogueChange.findMany({ where: { gid }, orderBy: { seq: "asc" } });
    expect(log.map((l) => l.action)).toEqual(["create", "verify"]);
    expect(log[1].version).toBe(2);
    expect(await catalogueVersion()).toBe(Number((await db.catalogueChange.aggregate({ _max: { seq: true } }))._max.seq));
    await expect(db.catalogueChange.update({ where: { seq: log[0].seq }, data: { by: "x" } })).rejects.toThrow();
    await expect(db.catalogueChange.delete({ where: { seq: log[0].seq } })).rejects.toThrow();
  });

  it("an edit to a verified entry needs the source again and a current version", async () => {
    const e = await db.catalogueMedicine.findUniqueOrThrow({ where: { gid } });
    await expect(updateEntry(admin, gid, { ...dolo, gstRate: 12, sourceRef: "" }, e.version)).rejects.toThrow(/source reference/);
    await expect(updateEntry(admin, gid, { ...dolo, sourceRef: "x ref 1" }, e.version + 5)).rejects.toThrow(/Someone else/);
    expect(await updateEntry(admin, gid, { ...dolo, sourceRef: "Micro Labs leaflet rev. 11/2025, p.2", packLabel: "strip of 15 tablets" }, e.version)).toBe(e.version + 1);
  });

  it("accepts only real, unique product barcodes", async () => {
    await expect(addBarcode(admin, gid, "8901234567891", "pack photo", true)).rejects.toThrow(/check digit/);
    await expect(addBarcode(admin, gid, internalCode(5), "pack photo", true)).rejects.toThrow(/internal/);
    await expect(addBarcode(admin, gid, validEan(1), "", true)).rejects.toThrow(/where the barcode/);
    await addBarcode(admin, gid, validEan(1), "pack photo", false);
    await expect(addBarcode(admin, "CM-000002", validEan(1), "pack photo", true)).rejects.toThrow(/already belongs to CM-000001/);
    expect((await searchCentral(await ctxFor(), "dolo"))[0].barcodes).toEqual([]);   // unverified barcodes aren't offered
    await verifyBarcode(admin, validEan(1));
    expect((await searchCentral(await ctxFor(), "dolo"))[0].barcodes).toEqual([validEan(1)]);
    await expect(verifyBarcode(admin, validEan(1))).rejects.toThrow(/Already/);
  });

  it("imports in bulk as drafts, reporting duplicates and invalid rows instead of overwriting", async () => {
    const r = await importEntries(admin, [
      { ...dolo, brand: "Pan 40", generic: "Pantoprazole", strength: "40 mg", manufacturer: "Alkem", gstRate: 12 },
      { ...dolo },                                                        // already live
      { ...dolo, brand: "Bad Row", hsn: "1" },                            // invalid
    ]);
    expect(r.created).toHaveLength(1);
    expect(r.duplicates).toEqual([{ row: 2, message: expect.stringContaining("CM-000001") }]);
    expect(r.invalid).toHaveLength(1);
    expect((await db.catalogueMedicine.findUniqueOrThrow({ where: { gid: r.created[0] } })).status).toBe("draft");
    await expect(importEntries(admin, Array.from({ length: 501 }, () => ({ ...dolo })))).rejects.toThrow(/at most 500/);
  });

  it("flags near-duplicate entries (a brand typo) for review, but not different products", async () => {
    const aug = { ...dolo, generic: "Amoxicillin + Clavulanic acid", strength: "500 mg + 125 mg", manufacturer: "GSK Pharma", packSize: 10 };
    const a = await createEntry(admin, { ...aug, brand: "Augmentin Duo 625 Tablets" });
    const b = await createEntry(admin, { ...aug, brand: "Augmentin Dou 625 Tablets" });      // typo: a different key, so it was accepted
    await createEntry(admin, { ...aug, brand: "Augmentin Duo 625 Tablets", strength: "250 mg + 125 mg" });   // a different strength: not a duplicate
    const pairs = await findDuplicates();
    const p = pairs.find((x) => [x.a, x.b].includes(a) && [x.a, x.b].includes(b));
    expect(p).toBeDefined();
    expect(p!.reason).toMatch(/near-identical brand/);
    expect(pairs.filter((x) => [x.a, x.b].includes(a)).length).toBe(1);               // only the typo twin
  });

  describe("pharmacy side", () => {
    beforeAll(async () => {
      const m = await ctxFor("Manager");
      const base = { form: "Tablet" as const, pack: "15", schedule: "" as const, reorderLevel: 5, barcode: "", hsn: "3004", rack: "A-3", gstRate: 12, packSize: 15 };
      localDolo = await createMedicine(m, { ...base, name: "Dolo 650", generic: "Paracetamol", strength: "650 mg", manufacturer: "Micro Labs Ltd", mrp: "33.60" });
      custom = await createMedicine(m, { ...base, name: "Aunty's Special Tonic", generic: "Herbal tonic", strength: "100 ml", manufacturer: "Home Brand", mrp: "99", rack: "Z-9" });
      await receiveBatch(m, { medicineId: localDolo, batchNo: "DL1", expiry: addDays(todayISO(), 300).slice(0, 10), qty: 150, cost: "20", mrp: "33.60", supplierId: null, invoiceNo: "" });
    });

    it("suggests links, never links by itself, and leaves custom medicines alone", async () => {
      const s = await linkSuggestions(await ctxFor());
      expect(s.map((x) => x.name)).toEqual(["Dolo 650"]);
      expect(s[0].matches[0]).toMatchObject({ kind: "exact" });
      expect(s[0].matches[0].entry.gid).toBe(gid);
      expect((await db.medicine.findUniqueOrThrow({ where: { id: localDolo } })).catalogueGid).toBeNull();
      await expect(linkMedicine(await ctxFor("Cashier"), localDolo, gid)).rejects.toThrow();
      await expect(linkMedicine(await ctxFor("Manager"), localDolo, "CM-000002")).rejects.toThrow(/isn’t available/);   // a draft can't be linked
      await linkMedicine(await ctxFor("Manager"), localDolo, gid);
      expect((await db.medicine.findUniqueOrThrow({ where: { id: localDolo } })).catalogueGid).toBe(gid);
      expect((await db.medicine.findUniqueOrThrow({ where: { id: custom } })).catalogueGid).toBeNull();
    });

    it("shows differences without changing anything, and applies only the chosen fields", async () => {
      // a bill at 12% before the catalogue's tax class changes
      const m = await ctxFor("Manager");
      const batch = await db.batch.findFirstOrThrow({ where: { medicineId: localDolo } });
      const sale = await commitSale(m, { idempotencyKey: key(), lines: [{ medicineId: localDolo, batchId: batch.id, qty: 1 }], customerId: null, discountPct: 0, pay: { mode: "cash" } });
      const e = await db.catalogueMedicine.findUniqueOrThrow({ where: { gid } });
      await updateEntry(admin, gid, { ...dolo, gstRate: 5, hsn: "30049099", packLabel: e.packLabel, sourceRef: "GST notification, schedule I", source: "Notification" }, e.version);
      const diffs = await catalogueDiff(await ctxFor());
      expect(diffs).toHaveLength(1);
      expect(diffs[0].diffs.map((d) => d.field).sort()).toEqual(["gstRate", "hsn"]);
      expect(diffs[0].diffs.every((d) => d.sensitive)).toBe(true);
      const before = await db.medicine.findUniqueOrThrow({ where: { id: localDolo } });
      expect(before.gstRate).toBe(12);                                              // viewing the diff changed nothing

      await expect(applyCatalogue(m, localDolo, [])).rejects.toThrow(/at least one/);
      await expect(applyCatalogue(m, localDolo, ["mrp" as never])).rejects.toThrow(/can’t come from the catalogue/);
      await expect(applyCatalogue(m, custom, ["gstRate"])).rejects.toThrow(/isn’t linked/);
      await expect(applyCatalogue(await ctxFor("Cashier"), localDolo, ["gstRate"])).rejects.toThrow();
      await applyCatalogue(m, localDolo, ["gstRate"]);                              // only the tax rate, not the HSN
      const after = await db.medicine.findUniqueOrThrow({ where: { id: localDolo } });
      expect(after.gstRate).toBe(5);
      expect(after.hsn).toBe("3004");
      expect(after.version).toBe(before.version + 1);
      // the pharmacy's own data is untouched
      expect(after.mrpPaise).toBe(before.mrpPaise); expect(after.rack).toBe("A-3"); expect(after.reorderLevel).toBe(5); expect(after.name).toBe("Dolo 650"); expect(after.packSize).toBe(15);
      expect((await db.batch.findUniqueOrThrow({ where: { id: batch.id } })).costPaise).toBe(batch.costPaise);
      expect((await db.saleItem.findFirstOrThrow({ where: { saleId: sale.saleId } })).gstRate).toBe(12);   // past bills keep the rate they were billed at
      const audit = await db.auditEvent.findFirstOrThrow({ where: { action: "Catalogue update applied" } });
      expect(audit.detail).toMatch(/gstRate: 12 → 5/);
      expect((await catalogueDiff(await ctxFor()))[0].diffs.map((d) => d.field)).toEqual(["hsn"]);
      // custom records are never touched by any of this
      const c = await db.medicine.findUniqueOrThrow({ where: { id: custom } });
      expect(c).toMatchObject({ gstRate: 12, rack: "Z-9", catalogueGid: null });
    });

    it("adds a medicine from the catalogue with the pharmacy's own MRP and the verified barcode, and links it", async () => {
      const id = await addFromCatalogue(await ctxFor("Manager"), "CM-000001", { mrp: "40" }).catch((e) => e);
      expect(String(id)).toMatch(/already exists/);                                 // the pharmacy already has Dolo 650: no duplicate is made
      await unlinkMedicine(await ctxFor("Manager"), localDolo);
      await db.medicine.update({ where: { id: localDolo }, data: { active: false } });
      const added = await addFromCatalogue(await ctxFor("Manager"), "CM-000001", { mrp: "40" });
      const m = await db.medicine.findUniqueOrThrow({ where: { id: added } });
      expect(m).toMatchObject({ name: "Dolo 650", catalogueGid: gid, mrpPaise: 4000n, barcode: validEan(1) });
    });

    it("takes correction requests, blocks repeats, and lets staff accept (edits the entry) or decline", async () => {
      const m = await ctxFor("Manager");
      await expect(requestCorrection(m, { gid, field: "manufacturer", proposed: "Micro Labs Limited", reason: "x" })).rejects.toThrow(/Say how you know/);
      await expect(requestCorrection(await ctxFor("Cashier"), { gid, field: "manufacturer", proposed: "Micro Labs Limited", reason: "pack shows Limited" })).rejects.toThrow();
      const c1 = await requestCorrection(m, { gid, field: "packLabel", proposed: "strip of 15 tabs", reason: "printed on my packs" });
      await expect(requestCorrection(m, { gid, field: "packLabel", proposed: "other", reason: "again please" })).rejects.toThrow(/already have an open/);
      const c2 = await requestCorrection(m, { gid, field: "gstRate", proposed: "18", reason: "supplier invoice shows 18" });
      await db.catalogueCorrection.create({ data: { tenantId: "another-pharmacy", gid, field: "form", proposed: "Capsule", reason: "someone else's", createdBy: "u", createdByName: "Other" } });
      expect((await myCorrections(m)).map((c) => c.id).sort()).toEqual([c1, c2].sort());   // never another pharmacy's
      expect((await listCorrections("open")).length).toBe(3);                              // staff see every pharmacy's
      await expect(resolveCorrection(sales, c1, true, "ok")).rejects.toThrow();
      const v0 = (await db.catalogueMedicine.findUniqueOrThrow({ where: { gid } })).version;
      await resolveCorrection(admin, c1, true, "Matches the pack photo sent");
      const e = await db.catalogueMedicine.findUniqueOrThrow({ where: { gid } });
      expect(e.packLabel).toBe("strip of 15 tabs");
      expect(e.version).toBe(v0 + 1);
      expect((await db.catalogueChange.findFirstOrThrow({ where: { gid }, orderBy: { seq: "desc" } })).action).toBe("correction_accepted");
      await expect(resolveCorrection(admin, c2, false, "no")).rejects.toThrow(/why the correction is declined/);
      await resolveCorrection(admin, c2, false, "Invoice shows the old rate; the notification says 12%");
      expect((await db.catalogueCorrection.findUniqueOrThrow({ where: { id: c2 } })).status).toBe("rejected");
      await expect(resolveCorrection(admin, c2, true, "again")).rejects.toThrow(/Already rejected/);
      expect((await db.catalogueMedicine.findUniqueOrThrow({ where: { gid } })).gstRate).toBe(5);   // a declined correction changed nothing
    });

    it("reports what changed since the pharmacy last reviewed, and can be marked reviewed", async () => {
      const m = await ctxFor("Manager");
      await db.medicine.update({ where: { id: localDolo }, data: { active: true, catalogueGid: gid } });
      const before = await syncStatus(m);
      expect(before.reviewedVersion).toBe(0);
      expect(before.linked).toBeGreaterThanOrEqual(1);
      expect(before.changedEntries).toBe(1);
      expect(before.catalogueVersion).toBeGreaterThan(5);
      const v = await markCatalogueReviewed(m);
      const after = await syncStatus(m);
      expect(after).toMatchObject({ reviewedVersion: v, changedEntries: 0 });
      const e = await db.catalogueMedicine.findUniqueOrThrow({ where: { gid } });
      await updateEntry(admin, gid, { ...dolo, gstRate: 5, hsn: "30049099", packLabel: "strip of 15 tabs", sourceRef: "recheck against notification", source: "Notification recheck" }, e.version);
      expect((await syncStatus(m)).changedEntries).toBe(1);
    });

    it("tells a pharmacy when a linked entry was withdrawn, and what replaced it", async () => {
      const newGid = await createEntry(admin, { ...dolo, brand: "Dolo 650 Plus", packSize: 20, packLabel: "strip of 20" });
      await verifyEntry(admin, newGid, { sourceRef: "pack photo 2026-11" });
      await deprecateEntry(admin, gid, "Withdrawn by the manufacturer", newGid);
      const d = (await catalogueDiff(await ctxFor())).find((x) => x.gid === gid)!;
      expect(d.withdrawn).toEqual({ replacedBy: newGid });
      await expect(linkMedicine(await ctxFor("Manager"), custom, gid)).rejects.toThrow(/isn’t available/);
      await expect(updateEntry(admin, gid, { ...dolo, sourceRef: "x ref" }, 1)).rejects.toThrow(/deprecated/);
      await expect(deprecateEntry(admin, gid, "again and again", newGid)).rejects.toThrow(/Already deprecated/);
    });
  });
});

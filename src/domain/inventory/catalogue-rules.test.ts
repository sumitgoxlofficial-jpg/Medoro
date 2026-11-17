import { describe, expect, it } from "vitest";
import { internalCode } from "@/lib/barcode";
import { dedupeKeyOf, duplicatePairs, entrySchema, globalBarcode, matchLocal, SENSITIVE_FIELDS, SYNC_FIELDS, type CatEntry } from "./catalogue-rules";

const ok = { brand: "Dolo 650", generic: "Paracetamol", strength: "650 mg", form: "Tablet", manufacturer: "Micro Labs Ltd", hsn: "3004", gstRate: 12, source: "Manufacturer pack leaflet" };
const entry = (o: Partial<CatEntry> = {}): CatEntry => { const base = { gid: "CM-000001", brand: "Dolo 650", generic: "Paracetamol", strength: "650 mg", form: "Tablet", manufacturer: "Micro Labs Ltd", packSize: 15, barcodes: [] as string[], status: "verified" }; const e = { ...base, ...o }; return { ...e, dedupeKey: o.dedupeKey ?? dedupeKeyOf(e) }; };

describe("central catalogue rules", () => {
  it("validates an entry and demands a source", () => {
    expect(entrySchema.safeParse(ok).success).toBe(true);
    expect(entrySchema.safeParse({ ...ok, source: "" }).success).toBe(false);
    expect(entrySchema.safeParse({ ...ok, hsn: "30" }).success).toBe(false);
    expect(entrySchema.safeParse({ ...ok, gstRate: 7 }).success).toBe(false);
    expect(entrySchema.safeParse({ ...ok, form: "Potion" }).success).toBe(false);
    expect(entrySchema.safeParse({ ...ok, schedule: "Z" }).success).toBe(false);
    expect(entrySchema.parse(ok).packSize).toBe(1);
  });
  it("gives the same identity to spelling and spacing variants, and a different one when pack, strength or maker differ", () => {
    const k = (o: object) => dedupeKeyOf({ brand: "Dolo 650", generic: "Paracetamol", strength: "650 mg", form: "Tablet", manufacturer: "Micro Labs Ltd", packSize: 15, ...o });
    expect(k({})).toBe(k({ brand: "DOLO-650", strength: "650MG", manufacturer: "micro labs ltd." }));
    expect(k({})).not.toBe(k({ packSize: 10 }));
    expect(k({})).not.toBe(k({ strength: "500 mg" }));
    expect(k({})).not.toBe(k({ manufacturer: "Cipla" }));
    expect(k({ generic: "Paracetamol + Caffeine", strength: "500 mg + 25 mg" })).not.toBe(k({ generic: "Paracetamol", strength: "500 mg" }));
  });
  it("accepts only real product barcodes", () => {
    expect(globalBarcode("8901234567890")).toMatchObject({ ok: true });
    expect(globalBarcode("8901234567891")).toMatchObject({ ok: false, reason: expect.stringMatching(/check digit/) });
    expect(globalBarcode("12345")).toMatchObject({ ok: false });
    expect(globalBarcode("89012345ABC90")).toMatchObject({ ok: false });
    expect(globalBarcode(internalCode(1))).toMatchObject({ ok: false, reason: expect.stringMatching(/internal/) });
  });
  it("finds typo duplicates among same-salt entries and ignores genuinely different products", () => {
    const a = entry({ gid: "CM-1" }), b = entry({ gid: "CM-2", brand: "Dolo 650 ", dedupeKey: "different-key" });
    const c = entry({ gid: "CM-3", brand: "Dolo 500", strength: "500 mg" }), d = entry({ gid: "CM-4", manufacturer: "Cipla", brand: "Calpol 650" });
    const p = duplicatePairs([a, b, c, d]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ a: "CM-1", b: "CM-2" });
    expect(duplicatePairs([a, entry({ gid: "CM-9" })])[0].reason).toMatch(/Same brand, salt/);
  });
  it("links a pharmacy medicine by verified barcode, then identity, and only suggests near matches", () => {
    const e1 = entry({ gid: "CM-1", barcodes: ["8901234567890"] }), e2 = entry({ gid: "CM-2", brand: "Dolo 650 DS", packSize: 10 });
    const local = { id: "m", name: "Dolo 650", generic: "Paracetamol", composition: null, strength: "650 mg", form: "Tablet", manufacturer: "Micro Labs Ltd", packSize: 15, barcode: null as string | null };
    expect(matchLocal(local, [e1, e2])[0]).toMatchObject({ gid: "CM-1", kind: "exact" });
    expect(matchLocal({ ...local, barcode: "8901234567890", name: "Totally different label" }, [e1, e2])[0]).toMatchObject({ gid: "CM-1", kind: "barcode" });
    expect(matchLocal({ ...local, name: "Dolo650 " }, [e1])[0].kind).toBe("exact");
    expect(matchLocal({ ...local, manufacturer: "Cipla" }, [e1, e2])).toEqual([]);
    expect(matchLocal({ ...local, strength: "500 mg" }, [e1])).toEqual([]);
  });
  it("never lets sync touch a pharmacy's own prices, rates, racks or setup", () => {
    for (const f of ["mrp", "mrpPaise", "price", "rate", "cost", "rack", "reorderLevel", "packSize", "allowLoose", "barcode", "name"]) expect(SYNC_FIELDS as readonly string[]).not.toContain(f);
    expect(SENSITIVE_FIELDS).toEqual(expect.arrayContaining(["gstRate", "hsn", "schedule"]));
  });
});

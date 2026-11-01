import { describe, expect, it } from "vitest";
import { memoryDb, memoryDbFrom } from "./node";
import { memoryStore } from "./drive";
import { decodeCode, encodeCode, newDataKey, open, seal, WrongKeyError } from "./crypto";
import { createVault, unlock, pushChanges, writeSnapshot, restoreFromDrive, driveStatus, VaultLockedError, META, MANIFEST, SNAPSHOT, type KeyStore } from "./sync";
import { addMedicine, createSale, receiveStock, stockOf } from "./pharmacy";
import { addCustomer } from "./trade";

const keyStore = (): KeyStore => { let k: CryptoKey | null = null; return { get: async () => k, set: async (x) => { k = x; } }; };
const B = "branch-1", U = "u1", TODAY = "2026-11-01";

describe("crypto", () => {
  it("recovery codes round-trip and are forgiving about how they're typed", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const code = encodeCode(bytes);
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){12}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(decodeCode(code)).toEqual(bytes);
    expect(decodeCode(code.toLowerCase().replace(/-/g, " "))).toEqual(bytes);
    expect(() => decodeCode("ABCD-1234")).toThrow(WrongKeyError);
  });

  it("sealed files need the right key and purpose, and can't be altered", async () => {
    const k = newDataKey(), plain = new TextEncoder().encode("Dolo 650 · ₹32");
    const s = await seal(k, "log", plain);
    expect(Buffer.from(s).includes(Buffer.from("Dolo"))).toBe(false);
    expect(await open(k, "log", s)).toEqual(plain);
    await expect(open(k, "snapshot", s)).rejects.toThrow(WrongKeyError);
    await expect(open(newDataKey(), "log", s)).rejects.toThrow(WrongKeyError);
    s[s.length - 1] ^= 1;
    await expect(open(k, "log", s)).rejects.toThrow(WrongKeyError);
  });
});

describe("Drive storage", () => {
  async function pharmacy(device = "DEV1") {
    const db = await memoryDb(device);
    const m = addMedicine(db, { name: "Dolo 650", gstRate: 12, mrpPaise: 3200 });
    receiveStock(db, { branchId: B, medicineId: m.id, batchNo: "A", expiryDate: "2027-12-31", qty: 50, costPaise: 2000, mrpPaise: 3200, userId: U });
    db.setMeta("branchId", B); db.setMeta("series", "DDEV1");
    return { db, m };
  }

  it("sets up once, and a device unlocks with its own key; a new device needs the recovery code", async () => {
    const store = memoryStore(), keys = keyStore();
    const { dataKey, recoveryCode } = await createVault(store, keys, "DEV1");
    await expect(createVault(store, keys, "DEV1")).rejects.toThrow(/already set up/);
    expect(await unlock(store, keys, "DEV1")).toEqual(dataKey);
    const meta = new TextDecoder().decode((await store.read((await store.find(META))!.id)));
    expect(meta).not.toContain(recoveryCode.replace(/-/g, "")); // the code itself is never stored
    const other = keyStore();
    await expect(unlock(store, other, "DEV2")).rejects.toThrow(VaultLockedError);
    await expect(unlock(store, other, "DEV2", recoveryCode.replace(/^..../, "0000"))).rejects.toThrow(WrongKeyError);
    expect(await unlock(store, other, "DEV2", recoveryCode)).toEqual(dataKey);
    expect(await unlock(store, other, "DEV2")).toEqual(dataKey); // approved now: no code needed
  });

  it("uploads changes, saves a full copy, and restores everything on a wiped device", async () => {
    const store = memoryStore();
    const { db, m } = await pharmacy();
    const { dataKey, recoveryCode } = await createVault(store, keyStore(), "DEV1");
    expect(await pushChanges(db, store, dataKey)).toBeGreaterThan(0);
    expect(await pushChanges(db, store, dataKey)).toBe(0);
    expect(db.pendingChanges()).toEqual([]);

    const snap = await writeSnapshot(db, store, dataKey, () => db.engine.exportBytes());
    expect(snap.bytes).toBeGreaterThan(0);
    expect([...store.files.values()].map((f) => f.name).sort()).toEqual([META, MANIFEST, SNAPSHOT].sort()); // logs folded in
    // Bills made after the snapshot go into logs.
    const c = addCustomer(db, { name: "Asha", phone: "9822000001" });
    const sale = createSale(db, { branchId: B, series: "DDEV1", userId: U, lines: [{ medicineId: m.id, qty: 3 }], pay: { mode: "cash" }, customerId: c.id }, TODAY);
    db.from("medicine").eq("id", m.id).update({ mrpPaise: 3300 });
    await pushChanges(db, store, dataKey);
    expect((await driveStatus(store)).snapshotAt).toBe(snap.snapshotAt);

    // New device: unlock with the recovery code and rebuild.
    const keys2 = keyStore();
    const key2 = await unlock(store, keys2, "DEV2", recoveryCode);
    const r = await restoreFromDrive(store, key2, "DEV2", (bytes) => memoryDbFrom(bytes, "DEV2"));
    expect(r.applied).toBeGreaterThan(0);
    const back = r.db;
    expect(back.from("sale").eq("id", sale.saleId).first()).toMatchObject({ invoiceNo: sale.invoiceNo, totalPaise: sale.totalPaise });
    expect(stockOf(back, m.id, B, TODAY)).toBe(47);
    expect(back.from("medicine").eq("id", m.id).first()).toMatchObject({ mrpPaise: 3300 });
    expect(back.from("customer").count()).toBe(1);
    expect(back.getMeta("series")).not.toBe("DDEV1"); // its own invoice series
    // The restored device keeps working and its clock is ahead of everything it loaded.
    expect(back.clock.tick() > db.clock.current).toBe(true);
    expect(createSale(back, { branchId: B, series: back.getMeta("series")!, userId: U, lines: [{ medicineId: m.id, qty: 1 }], pay: { mode: "cash" } }, TODAY).invoiceNo).toMatch(/-000001$/);
  });

  it("Drive holds only encrypted bytes", async () => {
    const store = memoryStore();
    const { db } = await pharmacy();
    const { dataKey } = await createVault(store, keyStore(), "DEV1");
    await writeSnapshot(db, store, dataKey, () => db.engine.exportBytes());
    for (const f of store.files.values()) if (f.name.endsWith(".enc")) expect(Buffer.from(f.bytes).includes(Buffer.from("Dolo"))).toBe(false);
  });

  it("restore refuses when nothing has been saved yet", async () => {
    const store = memoryStore();
    const { dataKey } = await createVault(store, keyStore(), "DEV1");
    await expect(restoreFromDrive(store, dataKey, "DEV2", (b) => memoryDbFrom(b))).rejects.toThrow(/No copy/);
  });
});

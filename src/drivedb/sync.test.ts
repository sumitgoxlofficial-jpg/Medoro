import { describe, expect, it } from "vitest";
import { memoryDb, memoryDbFrom } from "./node";
import { memoryStore, type DriveStore } from "./drive";
import { decodeCode, encodeCode, WrongKeyError } from "./crypto";
import { openWith, sealWith, type DeviceKeys } from "./keyring";
import {
  approveDevice, createVault, deviceKeys, pullChanges, pushChanges, readKeyMeta, restoreFromDrive, revokeDevice, unlock, writeSnapshot,
  NeedsRestoreError, VaultLockedError, META, MANIFEST, SNAPSHOT, RETAIN_MS, changeCursors, type KeyStore,
} from "./sync";
import { addMedicine, createSale, receiveStock, stockOf } from "./pharmacy";
import type { DriveDB } from "./client";
import { negativeStock, recordCount } from "./ops";
import { batchesOf } from "./pharmacy";

const keyStore = (): KeyStore => { let k: DeviceKeys | null = null; return { get: async () => k, set: async (x) => { k = x; } }; };
const B = "branch-1", U = "u1", TODAY = "2026-11-01";

describe("recovery code", () => {
  it("round-trips and is forgiving about how it's typed", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const code = encodeCode(bytes);
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){12}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(decodeCode(code.toLowerCase().replace(/-/g, " "))).toEqual(bytes);
    expect(() => decodeCode("ABCD-1234")).toThrow(WrongKeyError);
  });
});

/** An owner device with a pharmacy, Drive storage set up and a first full copy. */
async function ownerSetup(store: DriveStore) {
  const db = await memoryDb("OWNER");
  const m = addMedicine(db, { name: "Dolo 650", gstRate: 12, mrpPaise: 3200 });
  receiveStock(db, { branchId: B, medicineId: m.id, batchNo: "A", expiryDate: "2028-12-31", qty: 100, costPaise: 2000, mrpPaise: 3200, userId: U });
  db.setMeta("branchId", B); db.setMeta("series", "DOWN1");
  const keys = keyStore();
  const { ring, recoveryCode } = await createVault(store, keys, "OWNER");
  await writeSnapshot(db, store, ring, () => db.engine.exportBytes());
  return { db, m, keys, ring, recoveryCode };
}

/** A staff device: asks to join (key pair), the owner approves, it builds itself from Drive. */
async function joinStaff(store: DriveStore, ownerRing: Awaited<ReturnType<typeof ownerSetup>>["ring"], id: string) {
  const keys = keyStore();
  const mine = await deviceKeys(keys);
  await expect(unlock(store, keys, id)).rejects.toThrow(VaultLockedError);
  await approveDevice(store, ownerRing, id, mine.publicJwk, "staff", `Counter ${id}`);
  const ring = await unlock(store, keys, id);
  expect(ring.rk).toBeNull(); // staff never get the pharmacy key
  const { db } = await restoreFromDrive(store, ring, id, (b) => memoryDbFrom(b, id));
  return { db, keys, ring };
}

const sell = (db: DriveDB, medicineId: string, qty: number) =>
  createSale(db, { branchId: B, series: db.getMeta("series")!, userId: U, lines: [{ medicineId, qty }], pay: { mode: "cash" } }, TODAY);
const sync = async (db: DriveDB, store: DriveStore, ring: Parameters<typeof pushChanges>[2]) => { await pushChanges(db, store, ring); await pullChanges(db, store, ring); };

describe("keys", () => {
  it("owner device opens with its own key; a new device needs the recovery code and becomes an owner device", async () => {
    const store = memoryStore();
    const { keys, recoveryCode, ring } = await ownerSetup(store);
    expect((await unlock(store, keys, "OWNER")).current.key).toEqual(ring.current.key);
    expect(JSON.stringify(await readKeyMeta(store))).not.toContain(recoveryCode.replace(/-/g, ""));
    const k2 = keyStore();
    await expect(unlock(store, k2, "LAPTOP")).rejects.toThrow(VaultLockedError);
    await expect(unlock(store, k2, "LAPTOP", recoveryCode.replace(/^..../, "0000"))).rejects.toThrow(WrongKeyError);
    expect((await unlock(store, k2, "LAPTOP", recoveryCode)).rk).not.toBeNull();
    expect((await unlock(store, k2, "LAPTOP")).rk).not.toBeNull(); // no code needed next time
  });

  it("removing a device starts a new key: it can read what it had, not what comes after", async () => {
    const store = memoryStore();
    const owner = await ownerSetup(store);
    const staff = await joinStaff(store, owner.ring, "STAFF1");
    const before = await sealWith(owner.ring, "log", new TextEncoder().encode("old"));
    expect(new TextDecoder().decode(await openWith(staff.ring, "log", before))).toBe("old");
    const ring2 = await revokeDevice(store, owner.ring, "STAFF1");
    expect(ring2.current.v).toBe(2);
    const after = await sealWith(ring2, "log", new TextEncoder().encode("new"));
    await expect(openWith(staff.ring, "log", after)).rejects.toThrow(WrongKeyError);
    await expect(unlock(store, staff.keys, "STAFF1")).rejects.toThrow(VaultLockedError);
    expect(new TextDecoder().decode(await openWith(await unlock(store, owner.keys, "OWNER"), "log", after))).toBe("new");
    // Staff can't approve or remove devices.
    await expect(approveDevice(store, staff.ring, "X", (await deviceKeys(keyStore())).publicJwk, "staff", "x")).rejects.toThrow(/owner/);
  });
});

describe("three counters", () => {
  it("bill the same medicine (one offline for a while) and all end with the same stock and every bill", async () => {
    const store = memoryStore();
    const A = await ownerSetup(store);
    const Bc = await joinStaff(store, A.ring, "STAFFB");
    const C = await joinStaff(store, A.ring, "STAFFC");
    const m = A.m.id;

    sell(A.db, m, 2); sell(Bc.db, m, 3);
    await sync(A.db, store, A.ring); await sync(Bc.db, store, Bc.ring);
    // C is offline: it bills but doesn't sync.
    sell(C.db, m, 5); sell(C.db, m, 1);
    sell(A.db, m, 4);
    await sync(A.db, store, A.ring); await sync(Bc.db, store, Bc.ring);
    expect(stockOf(A.db, m, B, TODAY)).toBe(100 - 2 - 3 - 4);
    // C comes back online.
    for (let round = 0; round < 2; round++) for (const d of [A, Bc, C]) await sync(d.db, store, d.ring);
    for (const d of [A, Bc, C]) {
      expect(stockOf(d.db, m, B, TODAY)).toBe(100 - 2 - 3 - 4 - 5 - 1);
      expect(d.db.from("sale").count()).toBe(5);
    }
    // Invoice numbers never clash: each counter has its own series.
    const nos = A.db.from<{ invoiceNo: string }>("sale").select("invoiceNo").all().map((s) => s.invoiceNo);
    expect(new Set(nos).size).toBe(5);
  });

  it("edits to the same medicine merge field by field; the later edit of one field wins", async () => {
    const store = memoryStore();
    const A = await ownerSetup(store);
    const Bc = await joinStaff(store, A.ring, "STAFFB");
    A.db.from("medicine").eq("id", A.m.id).update({ mrpPaise: 3500 });
    Bc.db.from("medicine").eq("id", A.m.id).update({ rack: "R7" });
    await sync(A.db, store, A.ring); await sync(Bc.db, store, Bc.ring); await sync(A.db, store, A.ring);
    for (const d of [A.db, Bc.db]) expect(d.from("medicine").eq("id", A.m.id).first()).toMatchObject({ mrpPaise: 3500, rack: "R7" });
    // Same field on both: the later clock wins everywhere.
    A.db.from("medicine").eq("id", A.m.id).update({ mrpPaise: 3600 });
    Bc.db.from("medicine").eq("id", A.m.id).update({ mrpPaise: 3700 });
    await sync(A.db, store, A.ring); await sync(Bc.db, store, Bc.ring); await sync(A.db, store, A.ring);
    const a = A.db.from("medicine").eq("id", A.m.id).first()!.mrpPaise, b = Bc.db.from("medicine").eq("id", A.m.id).first()!.mrpPaise;
    expect(a).toBe(b);
    expect([3600, 3700]).toContain(a);
  });

  it("a fresh device restored later gets everyone's changes, including ones the copy didn't hold", async () => {
    const store = memoryStore();
    const A = await ownerSetup(store);
    const Bc = await joinStaff(store, A.ring, "STAFFB");
    sell(Bc.db, A.m.id, 7);
    await pushChanges(Bc.db, store, Bc.ring); // A hasn't pulled this yet…
    sell(A.db, A.m.id, 1);
    await writeSnapshot(A.db, store, A.ring, () => A.db.engine.exportBytes()); // …but a snapshot pulls first
    sell(Bc.db, A.m.id, 2);
    await pushChanges(Bc.db, store, Bc.ring);
    const D = await joinStaff(store, A.ring, "STAFFD");
    expect(stockOf(D.db, A.m.id, B, TODAY)).toBe(100 - 7 - 1 - 2);
    expect(D.db.from("sale").count()).toBe(3);
  });
});

describe("stock below zero", () => {
  it("two counters sell the last units while one is offline: the batch shows below zero with the short bills, and a count clears it", async () => {
    const store = memoryStore();
    const owner = await ownerSetup(store);
    const staff = await joinStaff(store, owner.ring, "STAFF1");
    expect(negativeStock(owner.db)).toEqual([]);
    sell(owner.db, owner.m.id, 90); // 10 left
    await sync(owner.db, store, owner.ring); await sync(staff.db, store, staff.ring);
    // Both see 10 and sell 8 each; staff is offline, so neither knows about the other's sale.
    const a = sell(owner.db, owner.m.id, 8), b = sell(staff.db, owner.m.id, 8);
    expect(negativeStock(owner.db)).toEqual([]);
    await sync(owner.db, store, owner.ring); await sync(staff.db, store, staff.ring); await sync(owner.db, store, owner.ring);
    for (const db of [owner.db, staff.db]) {
      const neg = negativeStock(db, B);
      expect(neg).toHaveLength(1);
      expect(neg[0]).toMatchObject({ name: "Dolo 650", batchNo: "A", qty: -6 });
      // Only the bill that came second in time sold units that weren't there, and only 6 of its 8.
      expect(neg[0].bills).toEqual([{ invoiceNo: expect.any(String), at: expect.any(String), qty: 6 }]);
      expect([a.invoiceNo, b.invoiceNo]).toContain(neg[0].bills[0].invoiceNo);
    }
    expect(negativeStock(owner.db, "other-branch")).toEqual([]);
    // The owner counts 2 strips on the shelf (a strip was found): the count corrects the batch, everywhere.
    const batch = batchesOf(owner.db, owner.m.id, B)[0];
    recordCount(owner.db, { branchId: B, userId: U, counts: [{ batchId: batch.id, counted: 2 }] });
    await sync(owner.db, store, owner.ring); await sync(staff.db, store, staff.ring);
    for (const db of [owner.db, staff.db]) { expect(negativeStock(db)).toEqual([]); expect(stockOf(db, owner.m.id, B, TODAY)).toBe(2); }
  });
});

describe("a pharmacy rebuilt on one device (pilot moved from Medoro)", () => {
  it("other counters must restore from the new copy, and the old change files are never applied again", async () => {
    const store = memoryStore();
    const owner = await ownerSetup(store); // 100 of Dolo in the old data, in a change file and the first copy
    const staff = await joinStaff(store, owner.ring, "STAFF1");
    sell(staff.db, owner.m.id, 7);
    await pushChanges(staff.db, store, staff.ring);
    // The move reads Drive as it is now (that copy includes the sale of 7)…
    const { db: read } = await restoreFromDrive(store, owner.ring, "OWNER", (b) => memoryDbFrom(b, "OWNER"));
    const from = changeCursors(read);
    // …and the staff counter keeps billing while the move runs: this bill must not be lost.
    sell(staff.db, owner.m.id, 3);
    await pushChanges(staff.db, store, staff.ring);
    // The owner's device is rebuilt with the merged data: same medicine and batch, with 60 in stock (Medoro's figure).
    const rebuilt = await memoryDb("OWNER2");
    const batchRow = owner.db.engine.all<Record<string, string | number | null>>("SELECT id, branchId, medicineId, batchNo, expiryDate, costPaise, mrpPaise, supplierId, status FROM batch")[0];
    rebuilt.from("medicine").insert({ id: owner.m.id, name: "Dolo 650", gstRate: 12, mrpPaise: 3200 });
    rebuilt.from("batch").insert(batchRow);
    rebuilt.from("stockMovement").insert({ branchId: B, batchId: String(batchRow.id), qty: 60, type: "opening", refType: "opening", refId: String(batchRow.id), userId: U, at: new Date().toISOString(), note: null });
    rebuilt.setMeta("branchId", B); rebuilt.setMeta("series", "DWNR2");
    const ring = await unlock(store, owner.keys, "OWNER");
    const m = await writeSnapshot(rebuilt, store, ring, () => rebuilt.engine.exportBytes(), Date.now(), { newGeneration: true, from });
    expect(m.generation).toBeTruthy();
    // Old files up to what the move read weren't pulled again (else +100 received, −7 sold); the bill of 3 made during
    // the move was.
    expect(stockOf(rebuilt, owner.m.id, B, TODAY)).toBe(57);
    // The staff counter holds the old data: it is told to restore, and then has exactly the new data.
    await expect(pullChanges(staff.db, store, staff.ring)).rejects.toThrow(NeedsRestoreError);
    const { db: fresh } = await restoreFromDrive(store, staff.ring, "STAFF1", (b) => memoryDbFrom(b, "STAFF1"));
    expect(stockOf(fresh, owner.m.id, B, TODAY)).toBe(57);
    // From then on they sync normally.
    sell(fresh, owner.m.id, 2);
    await sync(fresh, store, staff.ring); await sync(rebuilt, store, ring);
    expect(stockOf(rebuilt, owner.m.id, B, TODAY)).toBe(55);
    // A later full copy keeps the same generation.
    expect((await writeSnapshot(rebuilt, store, ring, () => rebuilt.engine.exportBytes())).generation).toBe(m.generation);
  });
});

describe("restoring a counter", () => {
  it("carries on its own invoice numbers instead of starting again", async () => {
    const store = memoryStore();
    const A = await ownerSetup(store);
    const Bc = await joinStaff(store, A.ring, "STAFFB");
    const first = sell(Bc.db, A.m.id, 1), second = sell(Bc.db, A.m.id, 1);
    await pushChanges(Bc.db, store, Bc.ring);
    // Same device rebuilt (e.g. browser data cleared): the next bill must be number 3.
    const again = await restoreFromDrive(store, Bc.ring, "STAFFB", (b) => memoryDbFrom(b, "STAFFB"));
    const third = sell(again.db, A.m.id, 1);
    expect([first.invoiceNo, second.invoiceNo, third.invoiceNo].map((n) => n.slice(-6))).toEqual(["000001", "000002", "000003"]);
  });
});

describe("Drive tidy-up", () => {
  it("keeps change files 7 days; a counter behind deleted files is told to restore", async () => {
    const store = memoryStore();
    const A = await ownerSetup(store);
    const Bc = await joinStaff(store, A.ring, "STAFFB");
    sell(A.db, A.m.id, 1);
    await pushChanges(A.db, store, A.ring);
    const logs = () => [...(store as ReturnType<typeof memoryStore>).files.values()].filter((f) => f.name.startsWith("log-OWNER"));
    await writeSnapshot(A.db, store, A.ring, () => A.db.engine.exportBytes());
    expect(logs().length).toBeGreaterThan(0); // too new to delete
    await writeSnapshot(A.db, store, A.ring, () => A.db.engine.exportBytes(), Date.now() + RETAIN_MS + 60_000);
    expect(logs()).toHaveLength(0);
    // B never pulled the deleted file.
    await expect(pullChanges(Bc.db, store, Bc.ring)).rejects.toThrow(NeedsRestoreError);
    const fresh = await restoreFromDrive(store, Bc.ring, "STAFFB2", (b) => memoryDbFrom(b, "STAFFB2"));
    expect(fresh.db.from("sale").count()).toBe(1);
  });

  it("Drive holds only encrypted bytes and the expected files", async () => {
    const store = memoryStore();
    await ownerSetup(store);
    const names = [...store.files.values()].map((f) => f.name);
    expect(names.filter((n) => !n.startsWith("log-OWNER-")).sort()).toEqual([META, MANIFEST, SNAPSHOT].sort());
    for (const f of store.files.values()) if (f.name.endsWith(".enc")) expect(Buffer.from(f.bytes).includes(Buffer.from("Dolo"))).toBe(false);
  });
});

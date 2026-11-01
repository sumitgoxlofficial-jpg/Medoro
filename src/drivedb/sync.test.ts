import { describe, expect, it } from "vitest";
import { memoryDb, memoryDbFrom } from "./node";
import { memoryStore, type DriveStore } from "./drive";
import { decodeCode, encodeCode, WrongKeyError } from "./crypto";
import { openWith, sealWith, type DeviceKeys } from "./keyring";
import {
  approveDevice, createVault, deviceKeys, pullChanges, pushChanges, readKeyMeta, restoreFromDrive, revokeDevice, unlock, writeSnapshot,
  NeedsRestoreError, VaultLockedError, META, MANIFEST, SNAPSHOT, RETAIN_MS, type KeyStore,
} from "./sync";
import { addMedicine, createSale, receiveStock, stockOf } from "./pharmacy";
import type { DriveDB } from "./client";

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

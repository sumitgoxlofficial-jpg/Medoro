import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { setDriveMode } from "@/domain/system/drive-mode";
import { decideDevice, listDevices, registerDevice, relay } from "@/domain/system/drivedb-relay";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const key = { kty: "RSA" as const, n: "n".repeat(342), e: "AQAB" };
const P = (o: Record<string, string | number> = {}) => new URLSearchParams(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])));
const LOG = (dev: string) => `log-${dev}-1730000000000-0001-${dev}.enc`;

describe("DriveDB relay", () => {
  const prev = process.env.E2E_FAKE_DRIVE;
  beforeAll(async () => {
    process.env.E2E_FAKE_DRIVE = "1"; delete process.env.VERCEL;
    await resetDb(); await makePharmacy();
    await setDriveMode(await ctxFor(), true);
  });
  afterAll(() => { if (prev === undefined) delete process.env.E2E_FAKE_DRIVE; else process.env.E2E_FAKE_DRIVE = prev; });

  it("owner devices join at once; staff devices wait for the owner; a device stays with its person", async () => {
    const owner = await ctxFor(), staff = { ...(await ctxFor("Cashier")), userId: "staff-user", userName: "Ravi", realRole: "Cashier" };
    expect(await registerDevice(owner, { deviceId: "OWN1", name: "PC", publicKey: key })).toEqual({ status: "approved", role: "owner" });
    expect(await registerDevice(staff, { deviceId: "STF1", name: "Phone", publicKey: key })).toEqual({ status: "pending", role: "staff" });
    await expect(registerDevice({ ...staff, userId: "someone-else" }, { deviceId: "STF1", name: "x", publicKey: key })).rejects.toThrow(/someone else/);
    await expect(relay(staff, "STF1", "list", P(), Buffer.alloc(0))).rejects.toThrow(/Waiting for the owner/);
    await expect(listDevices(staff)).rejects.toThrow(/Only the owner/);
    expect((await listDevices(owner)).map((d) => [d.deviceId, d.status])).toEqual([["OWN1", "approved"], ["STF1", "pending"]]);
    await decideDevice(owner, "STF1", true);
    expect((await relay(staff, "STF1", "list", P(), Buffer.alloc(0)))).toEqual({ files: [] });
    expect(await db.auditEvent.count({ where: { action: { in: ["Drive mode device asked to join", "Drive mode device approved"] } } })).toBe(2);
  });

  it("each device writes and deletes only its own change files; only owner devices write keys and copies", async () => {
    const owner = await ctxFor(), staff = { ...(await ctxFor("Cashier")), userId: "staff-user", userName: "Ravi", realRole: "Cashier" };
    const bytes = Buffer.from("ciphertext");
    await relay(staff, "STF1", "write", P({ name: LOG("STF1") }), bytes);
    await expect(relay(staff, "STF1", "write", P({ name: LOG("OWN1") }), bytes)).rejects.toThrow(/can’t write/);
    await expect(relay(staff, "STF1", "write", P({ name: "encryption-meta.json" }), bytes)).rejects.toThrow(/can’t write/);
    await expect(relay(staff, "STF1", "write", P({ name: "pharmacy.db.enc" }), bytes)).rejects.toThrow(/can’t write/);
    await expect(relay(staff, "STF1", "write", P({ name: "../evil.txt" }), bytes)).rejects.toThrow(/can’t write/);
    await relay(owner, "OWN1", "write", P({ name: "encryption-meta.json" }), Buffer.from("{}"));
    await relay(owner, "OWN1", "write", P({ name: LOG("OWN1") }), bytes);
    expect((await relay(staff, "STF1", "list", P({ prefix: "log-" }), Buffer.alloc(0)) as { files: { name: string }[] }).files.map((f) => f.name).sort()).toEqual([LOG("OWN1"), LOG("STF1")].sort());
    expect(await relay(staff, "STF1", "read", P({ name: LOG("OWN1"), offset: 4, length: 4 }), Buffer.alloc(0))).toMatchObject({ bytes: Buffer.from("erte"), size: bytes.length });
    await expect(relay(staff, "STF1", "remove", P({ name: LOG("OWN1") }), Buffer.alloc(0))).rejects.toThrow(/only its own/);
    await relay(staff, "STF1", "remove", P({ name: LOG("STF1") }), Buffer.alloc(0));
    await expect(relay(staff, "STF1", "read", P({ name: "../../backups" }), Buffer.alloc(0))).rejects.toThrow(/Bad file name/);
  });

  it("big files go up in pieces with a sealed upload token bound to the pharmacy and device", async () => {
    const owner = await ctxFor();
    const big = Buffer.alloc(5 * 1024 * 1024, 7);
    const { token } = (await relay(owner, "OWN1", "start", P({ name: "pharmacy.db.enc", size: big.length }), Buffer.alloc(0))) as { token: string };
    await expect(relay({ ...owner, tenantId: "other" }, "OWN1", "chunk", P({ token, offset: 0 }), big.subarray(0, 10))).rejects.toThrow();
    expect(await relay(owner, "OWN1", "chunk", P({ token, offset: 0 }), big.subarray(0, 3 * 1024 * 1024))).toEqual({ done: false });
    expect(await relay(owner, "OWN1", "chunk", P({ token, offset: 3 * 1024 * 1024 }), big.subarray(3 * 1024 * 1024))).toEqual({ done: true });
    expect((await relay(owner, "OWN1", "read", P({ name: "pharmacy.db.enc", offset: 0, length: 3 }), Buffer.alloc(0)) as { size: number }).size).toBe(big.length);
  });

  it("a removed device is shut out", async () => {
    const owner = await ctxFor(), staff = { ...(await ctxFor("Cashier")), userId: "staff-user", userName: "Ravi", realRole: "Cashier" };
    await decideDevice(owner, "STF1", false);
    await expect(relay(staff, "STF1", "list", P(), Buffer.alloc(0))).rejects.toThrow(/removed this device/);
  });
});

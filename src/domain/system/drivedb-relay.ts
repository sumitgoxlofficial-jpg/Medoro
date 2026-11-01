import "server-only";
import { ackInbox, inboxFor } from "./customer-pay";
import { z } from "zod";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { UserError } from "@/server/action";
import { seal, unseal } from "@/server/vault";
import type { Ctx } from "@/server/context";
import { can } from "@/server/context";
import { driveModeOn } from "./drive-mode";
import { deviceDriveEnabled, relayStore } from "./gdrive";

/**
 * DriveDB relay: devices of a Drive mode pharmacy read and write their encrypted sync files in the owner's Google
 * Drive through Medoro, which uses the pharmacy's Drive access and keeps nothing. Medoro only sees encrypted
 * files. Rules: a device must be approved and used by the person who registered it; each device may write and
 * delete only its own change files; only the owner's devices write the keys, the index and the full copy.
 */

export const CHUNK_MAX = 3 * 1024 * 1024;
export const META = "encryption-meta.json", MANIFEST = "manifest.json", SNAPSHOT = "pharmacy.db.enc";
const DEVICE_RE = /^[A-Za-z0-9_]{1,40}$/;
const LOG_RE = /^log-([A-Za-z0-9_]{1,40})-\d{13}-\d{4}-[A-Za-z0-9_]{1,40}\.enc$/;
const OWNER_FILES = new Set([META, MANIFEST, SNAPSHOT]);
const isOwner = (ctx: Ctx) => ctx.realRole === "Owner" && ctx.role === "Owner";

async function usable(ctx: Ctx) {
  if (!(await driveModeOn(ctx.tenantId))) throw new UserError("Drive mode is off for this pharmacy.");
  if (!can(ctx, "sale")) throw new UserError("Your role can’t bill, so it can’t use Drive mode.");
  if (!(await deviceDriveEnabled(ctx.tenantId))) throw new UserError("The owner needs to connect Google Drive on the Backup page first.");
}

export const registerInput = z.object({
  deviceId: z.string().regex(DEVICE_RE),
  name: z.string().trim().min(1).max(60),
  publicKey: z.object({ kty: z.literal("RSA"), n: z.string().max(1000), e: z.string().max(20), alg: z.string().max(20).optional() }),
});

/**
 * A device asks to sync. The owner's own devices are approved at once; a staff device waits for the owner.
 * A device id stays with the person who registered it.
 */
export async function registerDevice(ctx: Ctx, input: z.input<typeof registerInput>) {
  await usable(ctx);
  const d = registerInput.parse(input);
  const existing = await db.driveDevice.findUnique({ where: { tenantId_deviceId: { tenantId: ctx.tenantId, deviceId: d.deviceId } } });
  if (existing && existing.userId !== ctx.userId) throw new UserError("This device is registered to someone else. Sign in as them, or reset the device.");
  if (existing) {
    await db.driveDevice.update({ where: { id: existing.id }, data: { lastSeen: new Date() } });
    return { status: existing.status, role: existing.role };
  }
  const role = isOwner(ctx) ? "owner" : "staff";
  await db.driveDevice.create({ data: { tenantId: ctx.tenantId, deviceId: d.deviceId, userId: ctx.userId, name: `${d.name} · ${ctx.userName}`, role, status: role === "owner" ? "approved" : "pending", publicKey: { kty: d.publicKey.kty, n: d.publicKey.n, e: d.publicKey.e, alg: d.publicKey.alg ?? "RSA-OAEP-256" }, decidedAt: role === "owner" ? new Date() : null, lastSeen: new Date() } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: role === "owner" ? "Drive mode device added" : "Drive mode device asked to join", entity: "device", entityId: d.deviceId, detail: d.name });
  return { status: role === "owner" ? "approved" : "pending", role };
}

/** Owner: every device of the pharmacy, with its public key (to give it the keys when approving). */
export async function listDevices(ctx: Ctx) {
  if (!isOwner(ctx)) throw new UserError("Only the owner can manage Drive mode devices.");
  const rows = await db.driveDevice.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({ deviceId: r.deviceId, name: r.name, role: r.role, status: r.status, publicKey: r.publicKey as JsonWebKey, createdAt: r.createdAt.toISOString(), lastSeen: r.lastSeen?.toISOString() ?? null, lastSyncAt: r.lastSyncAt?.toISOString() ?? null, lastError: r.lastError }));
}

/** Owner: approve (after their device has given it the keys) or remove a device. */
export async function decideDevice(ctx: Ctx, deviceId: string, approve: boolean) {
  if (!isOwner(ctx)) throw new UserError("Only the owner can manage Drive mode devices.");
  const d = await db.driveDevice.findUnique({ where: { tenantId_deviceId: { tenantId: ctx.tenantId, deviceId } } });
  if (!d) throw new UserError("Device not found.");
  await db.driveDevice.update({ where: { id: d.id }, data: { status: approve ? "approved" : "removed", decidedAt: new Date() } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: approve ? "Drive mode device approved" : "Drive mode device removed", entity: "device", entityId: deviceId, detail: d.name });
  return true;
}

async function approvedDevice(ctx: Ctx, deviceId: string) {
  await usable(ctx);
  if (!DEVICE_RE.test(deviceId)) throw new UserError("Bad device id.");
  const d = await db.driveDevice.findUnique({ where: { tenantId_deviceId: { tenantId: ctx.tenantId, deviceId } } });
  if (!d || d.userId !== ctx.userId) throw new UserError("This device isn’t registered for Drive mode.");
  if (d.status !== "approved") throw new UserError(d.status === "removed" ? "The owner removed this device from Drive mode." : "Waiting for the owner to approve this device.");
  if (!d.lastSeen || Date.now() - d.lastSeen.getTime() > 60_000) await db.driveDevice.update({ where: { id: d.id }, data: { lastSeen: new Date() } });
  return d;
}

function mayWrite(device: { deviceId: string; role: string }, name: string) {
  const log = LOG_RE.exec(name);
  if (log) return log[1] === device.deviceId;
  return OWNER_FILES.has(name) && device.role === "owner";
}
const validName = (name: string) => OWNER_FILES.has(name) || LOG_RE.test(name);

/** One relay call. Files are addressed by name; reads come in pieces of at most CHUNK_MAX bytes. */
export async function relay(ctx: Ctx, deviceId: string, op: string, p: URLSearchParams, body: Buffer) {
  const device = await approvedDevice(ctx, deviceId);
  const store = relayStore(ctx.tenantId);
  const name = p.get("name") ?? "";
  const byName = async () => (await store.list(name)).find((f) => f.name === name);
  switch (op) {
    case "list": {
      const prefix = p.get("prefix") ?? "";
      if (prefix && !/^[A-Za-z0-9_.-]{1,80}$/.test(prefix)) throw new UserError("Bad prefix.");
      return { files: (await store.list(prefix)).filter((f) => validName(f.name)).map((f) => ({ name: f.name, size: f.size })) };
    }
    case "read": {
      if (!validName(name)) throw new UserError("Bad file name.");
      const f = await byName();
      if (!f) return { missing: true };
      const offset = Math.max(0, Number(p.get("offset") ?? 0) | 0), length = Math.min(CHUNK_MAX, Math.max(1, Number(p.get("length") ?? CHUNK_MAX) | 0));
      const r = await store.read(f.id, offset, length);
      return { bytes: r.bytes, size: r.size || f.size };
    }
    case "write": {
      if (!validName(name) || !mayWrite(device, name)) throw new UserError("This device can’t write that file.");
      if (body.length > CHUNK_MAX) throw new UserError("Too big for one piece; upload it in parts.");
      await store.write(name, body);
      return { ok: true };
    }
    case "start": {
      if (!validName(name) || !mayWrite(device, name)) throw new UserError("This device can’t write that file.");
      const size = Number(p.get("size") ?? 0) | 0;
      if (size <= 0 || size > 500 * 1024 * 1024) throw new UserError("Bad size.");
      const session = await store.startUpload(name, size);
      const token = seal(JSON.stringify({ t: ctx.tenantId, d: deviceId, name, session, size, exp: Date.now() + 3600_000 })).toString("base64url");
      return { token };
    }
    case "chunk": {
      let s: { t: string; d: string; name: string; session: string; size: number; exp: number };
      try { s = JSON.parse(unseal(Buffer.from(p.get("token") ?? "", "base64url")).toString()); } catch { throw new UserError("Bad upload token."); }
      if (s.t !== ctx.tenantId || s.d !== deviceId || s.exp < Date.now()) throw new UserError("This upload has expired. Try again.");
      if (body.length > CHUNK_MAX) throw new UserError("Piece too big.");
      const offset = Number(p.get("offset") ?? -1);
      if (!Number.isInteger(offset) || offset < 0 || offset + body.length > s.size) throw new UserError("Bad offset.");
      const id = await store.uploadChunk(s.session, offset, body, s.size);
      return { done: !!id };
    }
    case "remove": {
      const log = LOG_RE.exec(name);
      if (!log || log[1] !== deviceId) throw new UserError("A device can delete only its own change files.");
      const f = await byName();
      if (f) await store.remove(f.id);
      return { ok: true };
    }
    case "inbox": return { payments: await inboxFor(ctx.tenantId, device.deviceId) };
    case "inbox-ack": {
      const ids = (p.get("ids") ?? "").split(",").filter(Boolean);
      return { deleted: await ackInbox(ctx.tenantId, ids) };
    }
    case "health": {
      // The device's own report after a sync: worked, or the error text. No data, only for the owner's alerts.
      const ok = p.get("ok") === "1", error = (p.get("error") ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
      await db.driveDevice.update({ where: { id: device.id }, data: ok ? { lastSyncAt: new Date(), lastError: null, lastErrorAt: null } : { lastError: error || "Sync failed", lastErrorAt: new Date() } });
      return { ok: true };
    }
    default:
      throw new UserError("Unknown relay call.");
  }
}

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { db } from "@/server/db";
import { seal } from "@/server/vault";
import { getObject, readDocument, saveDocument } from "@/server/storage";
import { newTotpSecret } from "@/server/totp";
import { backupFile, discardRestore, prune, runBackup, saveBackupSettings, testRestore } from "@/domain/system/backup";
import { consentUrl, driveDisconnect, driveState, DriveScopeMissing, exchangeCode, pkce, saveDriveToken } from "@/domain/system/gdrive";
import { freshRestore, importBackup, parseKit, previewFreshRestore, reenterKit } from "@/domain/system/recovery";
import { backupHealth, badgesAndAlerts } from "@/domain/reports/alerts";
import { recoveryKitHtml } from "@/components/recovery-kit";
import { ctxFor, KEY, makePharmacy, resetDb } from "./helpers";
import { purgeTenant } from "@/domain/system/deletion";

type DFile = { id: string; name: string; parents: string[]; mimeType: string; appProperties?: Record<string, string>; bytes: Buffer; createdTime: string };
type Call = { method: string; url: string; auth?: string; body?: string };

/** A small stand-in for Google's OAuth and Drive v3 endpoints. */
function fakeGoogle() {
  const g = {
    files: new Map<string, DFile>(), calls: [] as Call[], seq: 0, access: 0, revoked: new Set<string>(), expired: new Set<string>(),
    grantScope: "https://www.googleapis.com/auth/drive.file openid email",
    add(f: Omit<DFile, "id" | "createdTime"> & { createdTime?: string }) { const id = "f" + ++g.seq; g.files.set(id, { createdTime: new Date().toISOString(), ...f, id }); return id; },
  };
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  const matches = (f: DFile, q: string) => {
    if (/trashed = false/.test(q) === false && q) return false;
    for (const [, k, v] of q.matchAll(/appProperties has \{ key='(\w+)' and value='([^']*)' \}/g)) if (f.appProperties?.[k] !== v) return false;
    const name = /name = '((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\(.)/g, "$1");
    if (name !== undefined && f.name !== name) return false;
    const parent = /'([^']+)' in parents/.exec(q)?.[1];
    if (parent && !f.parents.includes(parent)) return false;
    if (/mimeType = 'application\/vnd.google-apps.folder'/.test(q) && f.mimeType !== "application/vnd.google-apps.folder") return false;
    if (/mimeType != 'application\/vnd.google-apps.folder'/.test(q) && f.mimeType === "application/vnd.google-apps.folder") return false;
    return true;
  };
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input), method = init.method ?? "GET";
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = init.body instanceof URLSearchParams ? init.body.toString() : typeof init.body === "string" ? init.body : undefined;
    g.calls.push({ method, url, auth: headers.Authorization, body });
    if (url === "https://oauth2.googleapis.com/token") {
      const p = new URLSearchParams(body);
      if (p.get("grant_type") === "authorization_code") {
        if (!p.get("code_verifier")) return json({ error: "invalid_request" }, 400);
        const idt = "x." + Buffer.from(JSON.stringify({ email: "owner@gmail.com" })).toString("base64url") + ".y";
        return json({ access_token: "at-0", expires_in: 3599, refresh_token: "rt-" + p.get("code"), scope: g.grantScope, id_token: idt });
      }
      if (g.revoked.has(p.get("refresh_token")!)) return json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400);
      return json({ access_token: "at-" + ++g.access, expires_in: 3599 });
    }
    if (url === "https://oauth2.googleapis.com/revoke") { g.revoked.add(new URLSearchParams(body).get("token")!); return json({}); }
    const token = headers.Authorization?.replace("Bearer ", "") ?? "";
    // Revoking the grant also kills its access tokens.
    if (g.expired.has(token) || g.revoked.size) return json({ error: { message: "Invalid Credentials" } }, 401);
    const u = new URL(url);
    if (u.pathname === "/upload/drive/v3/files" && u.searchParams.get("uploadType") === "multipart") {
      const b = Buffer.from(init.body as Uint8Array);
      const boundary = /boundary=(\S+)/.exec(headers["Content-Type"])![1];
      const parts = b.toString("latin1").split(`--${boundary}`);
      const meta = JSON.parse(parts[1].split("\r\n\r\n")[1].trim()) as { name: string; parents: string[]; mimeType: string; appProperties?: Record<string, string> };
      if (meta.parents.some((p) => !g.files.has(p))) return json({ error: { message: "File not found" } }, 404);
      const start = b.indexOf("\r\n\r\n", b.indexOf("\r\n\r\n") + 4) + 4, end = b.lastIndexOf(`\r\n--${boundary}--`);
      return json({ id: g.add({ ...meta, bytes: b.subarray(start, end) }) });
    }
    if (u.pathname === "/drive/v3/files" && method === "POST") {
      const meta = JSON.parse(body!) as { name: string; mimeType: string; parents?: string[] };
      return json({ id: g.add({ name: meta.name, mimeType: meta.mimeType, parents: meta.parents ?? ["root"], bytes: Buffer.alloc(0) }) });
    }
    if (u.pathname === "/drive/v3/files" && method === "GET") {
      const q = u.searchParams.get("q") ?? "";
      const files = [...g.files.values()].filter((f) => matches(f, q)).sort((a, b) => b.createdTime.localeCompare(a.createdTime));
      return json({ files: files.map((f) => ({ id: f.id, name: f.name, size: String(f.bytes.length), createdTime: f.createdTime, appProperties: f.appProperties })) });
    }
    const id = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname)?.[1];
    if (id && method === "DELETE") return g.files.delete(id) ? new Response(null, { status: 204 }) : json({ error: { message: "File not found" } }, 404);
    if (id && u.searchParams.get("alt") === "media") { const f = g.files.get(id); return f ? new Response(new Uint8Array(f.bytes)) : json({ error: { message: "File not found" } }, 404); }
    return json({ error: { message: "unexpected " + method + " " + url } }, 500);
  });
  return g;
}

const folder = (g: ReturnType<typeof fakeGoogle>, name: string) => [...g.files.values()].find((f) => f.name === name && f.mimeType === "application/vnd.google-apps.folder");
const refreshCalls = (g: ReturnType<typeof fakeGoogle>) => g.calls.filter((c) => c.url.endsWith("/token") && c.body?.includes("grant_type=refresh_token")).length;

describe("Google Drive: connect, back up, store files, prune and recover", () => {
  let g: ReturnType<typeof fakeGoogle>;
  beforeAll(async () => {
    process.env.STORAGE_DIR = await mkdtemp(path.join(os.tmpdir(), "medoro-drive-"));
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "cid.apps.googleusercontent.com");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "csecret");
    vi.stubEnv("GOOGLE_OAUTH_REDIRECT_URI", "https://pharmacy.example.in/api/integrations/google/callback");
  });
  beforeEach(async () => { await resetDb(); await makePharmacy(); g = fakeGoogle(); });
  afterAll(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  const connect = async () => {
    const ctx = await ctxFor();
    const { verifier } = pkce();
    const t = await exchangeCode("authcode", verifier);
    await saveDriveToken(ctx.tenantId, t.refreshToken, t.email);
    return ctx;
  };

  it("consent asks for drive.file offline with PKCE; the code exchange sends the verifier and the token is stored sealed", async () => {
    const { verifier, challenge } = pkce();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    const u = new URL(consentUrl("st4te", challenge));
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ scope: "https://www.googleapis.com/auth/drive.file openid email", access_type: "offline", prompt: "consent", state: "st4te", code_challenge: challenge, code_challenge_method: "S256", response_type: "code" });
    const t = await exchangeCode("authcode", verifier);
    expect(new URLSearchParams(g.calls[0].body).get("code_verifier")).toBe(verifier);
    expect(t).toEqual({ refreshToken: "rt-authcode", email: "owner@gmail.com" });
    const ctx = await ctxFor();
    await saveDriveToken(ctx.tenantId, t.refreshToken, t.email);
    const i = await db.integration.findUniqueOrThrow({ where: { tenantId_kind: { tenantId: ctx.tenantId, kind: "gdrive" } } });
    expect(Buffer.from(i.encryptedSecret!).includes(Buffer.from("rt-authcode"))).toBe(false);
    expect(await driveState(ctx.tenantId)).toMatchObject({ status: "connected", account: "owner@gmail.com" });
    g.grantScope = "openid email";
    await expect(exchangeCode("again", verifier)).rejects.toBeInstanceOf(DriveScopeMissing);
  });

  it("backs up into Medoro/<pharmacy>/backups with tags, reuses folders and the access token, and refreshes once on 401", async () => {
    const ctx = await connect();
    const first = await runBackup(ctx.tenantId, "manual", { id: ctx.userId, name: ctx.userName });
    expect(first.drive).toBe(true);
    const root = folder(g, "Medoro")!, pharmacy = folder(g, "Test Medical Store (TEST-PUNE)")!, backups = folder(g, "backups")!;
    expect(pharmacy.parents).toEqual([root.id]);
    expect(backups.parents).toEqual([pharmacy.id]);
    const m = await db.backupManifest.findUniqueOrThrow({ where: { id: first.id } });
    const up = g.files.get(m.driveFileId!)!;
    expect(up.parents).toEqual([backups.id]);
    expect(up.appProperties).toMatchObject({ medoroKind: "backup", medoroTenant: ctx.tenantId, medoroCode: "TEST-PUNE", medoroPharmacy: "Test Medical Store" });
    expect(up.bytes.equals((await backupFile(ctx, first.id))!.bytes)).toBe(true);
    expect(g.calls.filter((c) => c.url.includes("/upload/")).every((c) => c.auth === "Bearer at-1")).toBe(true);

    const folders = g.files.size;
    g.expired.add("at-1");
    const second = await runBackup(ctx.tenantId, "manual", { id: ctx.userId, name: ctx.userName });
    expect(second.drive).toBe(true);
    expect(g.files.size).toBe(folders + 1); // no new folders
    expect(refreshCalls(g)).toBe(2); // one at the start, one after the 401
    expect(g.calls.filter((c) => c.url.includes("/upload/")).at(-1)!.auth).toBe("Bearer at-2");
  });

  it("a revoked token marks Drive as lost, keeps backups on the server, raises an alert and a nav badge; disconnect revokes at Google", async () => {
    const ctx = await connect();
    g.revoked.add("rt-authcode");
    const r = await runBackup(ctx.tenantId, "manual", { id: ctx.userId, name: ctx.userName });
    expect(r.drive).toBe(false);
    expect(r.note).toMatch(/Reconnect Google Drive/);
    expect((await db.backupManifest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("partial");
    expect(await driveState(ctx.tenantId)).toMatchObject({ status: "lost" });
    expect(await db.auditEvent.count({ where: { action: "Google Drive access lost" } })).toBe(1);
    const health = await backupHealth(ctx.tenantId);
    expect(health.join(" ")).toMatch(/Google Drive access was lost/);
    const { badges, alerts } = await badgesAndAlerts(ctx.tenantId, ctx.branchId, ctx.perms);
    expect(badges.bak?.[1]).toBe("red");
    expect(alerts.join(" ")).toMatch(/Reconnect it/);
    expect((await badgesAndAlerts(ctx.tenantId, ctx.branchId, ["sale"])).badges.bak).toBeUndefined();

    g.revoked.clear();
    await connect();
    expect(await driveState(ctx.tenantId)).toMatchObject({ status: "connected" });
    expect(await driveDisconnect(ctx.tenantId)).toBe(true);
    const revoke = g.calls.find((c) => c.url === "https://oauth2.googleapis.com/revoke")!;
    expect(new URLSearchParams(revoke.body).get("token")).toBe("rt-authcode");
    expect(await driveState(ctx.tenantId)).toEqual({ status: "off" });
    expect((await backupHealth(ctx.tenantId)).join(" ")).not.toMatch(/access was lost/);
  });

  it("flags failed and overdue backups", async () => {
    const ctx = await ctxFor();
    const now = new Date();
    await db.tenant.update({ where: { id: ctx.tenantId }, data: { createdAt: new Date(now.getTime() - 3 * 86400_000) } });
    expect((await backupHealth(ctx.tenantId, now)).join(" ")).toMatch(/No successful backup yet/);
    await db.backupManifest.create({ data: { tenantId: ctx.tenantId, kind: "scheduled", schemaVersion: "x", status: "verified", startedAt: new Date(now.getTime() - 27 * 3600_000) } });
    expect((await backupHealth(ctx.tenantId, now)).join(" ")).toMatch(/No successful backup for 27 hours/);
    await db.backupManifest.create({ data: { tenantId: ctx.tenantId, kind: "retry", schemaVersion: "x", status: "failed", error: "disk full", startedAt: new Date(now.getTime() - 3600_000) } });
    expect((await backupHealth(ctx.tenantId, now)).join(" ")).toMatch(/Last backup failed: disk full/);
    await db.backupManifest.create({ data: { tenantId: ctx.tenantId, kind: "manual", schemaVersion: "x", status: "verified", startedAt: now } });
    expect(await backupHealth(ctx.tenantId, now)).toEqual([]);
  });

  it("stores uploaded files in Drive when chosen, streams them back, falls back to the server, and backs them up", async () => {
    const ctx = await connect();
    await saveBackupSettings(ctx, { schedule: "02:30", retention: 30, files: "gdrive" });
    const pdf = Buffer.from("%PDF-1.4 supplier invoice");
    const saved = await saveDocument(ctx.tenantId, pdf, "application/pdf");
    expect(saved.store).toBe("gdrive");
    const row = await db.fileObject.findUniqueOrThrow({ where: { key: saved.rel } });
    expect(row.bytes).toBeNull();
    const inDrive = g.files.get(row.driveFileId!)!;
    expect(inDrive.parents).toEqual([folder(g, "files")!.id]);
    expect(inDrive.mimeType).toBe("application/pdf");
    expect(await getObject(saved.rel)).toBeNull(); // not on the server
    expect((await readDocument(saved.rel)).equals(pdf)).toBe(true);
    await db.scanDocument.create({ data: { tenantId: ctx.tenantId, fileName: "inv.pdf", storagePath: saved.rel, mime: "application/pdf", sha256: saved.sha256, status: "review", extracted: {}, confidence: {}, createdBy: ctx.userId } });

    const b = await runBackup(ctx.tenantId, "manual", { id: ctx.userId, name: ctx.userName });
    expect(((await db.backupManifest.findUniqueOrThrow({ where: { id: b.id } })).rowCounts as Record<string, number>).Files).toBe(1);
    await testRestore(ctx, b.id);

    g.revoked.add("rt-authcode");
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const fallback = await saveDocument(ctx.tenantId, png, "image/png");
    expect(fallback.store).toBe("server");
    expect((await getObject(fallback.rel))!.equals(png)).toBe(true);
    await expect(saveBackupSettings(ctx, { schedule: "02:30", retention: 30, files: "server" })).resolves.toBeUndefined();
    await expect(saveBackupSettings(ctx, { schedule: "02:30", retention: 30, files: "gdrive" })).rejects.toThrow(/Connect Google Drive first/);
  });

  it("retention prunes old backups on the server and in Drive but never the newest successful one", async () => {
    const ctx = await connect();
    await saveBackupSettings(ctx, { schedule: "02:30", retention: 7, files: "server" });
    const r1 = await runBackup(ctx.tenantId, "manual", { id: ctx.userId, name: ctx.userName });
    const r2 = await runBackup(ctx.tenantId, "manual", { id: ctx.userId, name: ctx.userName });
    const old = new Date(Date.now() - 10 * 86400_000);
    for (const id of [r1.id, r2.id]) await db.backupManifest.update({ where: { id }, data: { startedAt: id === r1.id ? new Date(old.getTime() - 60_000) : old } });
    const m1 = await db.backupManifest.findUniqueOrThrow({ where: { id: r1.id } }), m2 = await db.backupManifest.findUniqueOrThrow({ where: { id: r2.id } });
    // Like WhatsApp: once Drive has a verified copy, this server keeps none.
    expect([m1.localPath, m2.localPath]).toEqual([null, null]);
    expect(await db.fileObject.count({ where: { tenantId: ctx.tenantId, key: { contains: "/backups/" } } })).toBe(0);
    g.files.get(m1.driveFileId!)!.createdTime = new Date(old.getTime() - 60_000).toISOString();
    g.files.get(m2.driveFileId!)!.createdTime = old.toISOString();
    const stray = g.add({ name: "other-server.mdrbak", parents: [folder(g, "backups")!.id], mimeType: "application/octet-stream", bytes: Buffer.from("x"), appProperties: { medoroKind: "backup", medoroTenant: ctx.tenantId }, createdTime: new Date(old.getTime() - 86400_000).toISOString() });
    await prune(ctx.tenantId);
    expect((await db.backupManifest.findUniqueOrThrow({ where: { id: r1.id } })).status).toBe("expired");
    expect(g.files.has(m1.driveFileId!)).toBe(false);
    expect(g.files.has(stray)).toBe(false);
    // r2 is the newest successful backup: kept in Drive although it's past retention.
    expect((await db.backupManifest.findUniqueOrThrow({ where: { id: r2.id } })).status).toBe("verified");
    expect(g.files.has(m2.driveFileId!)).toBe(true);
  });

  it("files kept on the server while Drive was down move to Drive with the next backup", async () => {
    const ctx = await connect();
    const key = `${ctx.tenantId}/scans/${"a".repeat(64)}.png`, png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9]);
    await db.fileObject.create({ data: { key, tenantId: ctx.tenantId, contentType: "image/png", bytes: new Uint8Array(png) } });
    await runBackup(ctx.tenantId, "manual", { id: ctx.userId, name: ctx.userName });
    const row = await db.fileObject.findUniqueOrThrow({ where: { key } });
    expect(row.bytes).toBeNull();
    expect(g.files.get(row.driveFileId!)!.bytes.equals(png)).toBe(true);
  });

  it("hosted server: an old Medoro backup can't be restored onto it (records live in each pharmacy's Google Drive)", async () => {
    const ctx = await connect();
    const b = await runBackup(ctx.tenantId, "manual", { id: ctx.userId, name: ctx.userName });
    const file = (await backupFile(ctx, b.id))!.bytes;
    vi.stubEnv("PUBLIC_SIGNUP", "1");
    try {
      expect(await purgeTenant(ctx.tenantId)).toBe(true);
      await expect(previewFreshRestore(file, KEY)).rejects.toThrow(/own Google Drive/);
      await expect(freshRestore(file, KEY, "TEST-PUNE")).rejects.toThrow(/own Google Drive/);
      expect(await db.tenant.count({ where: { code: "TEST-PUNE" } })).toBe(0);
    } finally { vi.stubEnv("PUBLIC_SIGNUP", ""); }
  });

  it("restores a backup picked in Drive with the recovery kit, through the test copy", async () => {
    const ctx = await connect();
    const b = await runBackup(ctx.tenantId, "manual", { id: ctx.userId, name: ctx.userName });
    const id = (await db.backupManifest.findUniqueOrThrow({ where: { id: b.id } })).driveFileId!;
    await expect(importBackup(ctx, { driveFileId: id }, "B".repeat(43))).rejects.toThrow(/doesn’t open this backup/);
    const p = await importBackup(ctx, { driveFileId: id }, `MEDORO BACKUP RECOVERY KIT\nBackup decryption key:\n${KEY}\nKey fingerprint: …`);
    expect(p.summary.problems).toEqual([]);
    const imported = await db.backupManifest.findFirstOrThrow({ where: { tenantId: ctx.tenantId, kind: "imported" } });
    expect(imported.driveFileId).toBe(id);
    expect(await db.restoreRun.count({ where: { status: "prepared" } })).toBe(1);
    await expect(importBackup(await ctxFor("Manager"), { driveFileId: id })).rejects.toThrow(/role/);
    await discardRestore(ctx, p.runId);
  });

  it("brings the pharmacy back on a new server from the backup file and the recovery kit", async () => {
    vi.stubEnv("HOST_KEY", "o".repeat(40));
    const ctx = await connect();
    await db.user.update({ where: { id: ctx.userId }, data: { mfaSecret: newTotpSecret().sealed, mfaEnabled: true } });
    await saveBackupSettings(ctx, { schedule: "02:30", retention: 30, files: "gdrive" });
    const pdf = Buffer.from("%PDF-1.4 scan kept in drive");
    const saved = await saveDocument(ctx.tenantId, pdf, "application/pdf");
    await db.scanDocument.create({ data: { tenantId: ctx.tenantId, fileName: "inv.pdf", storagePath: saved.rel, mime: "application/pdf", sha256: saved.sha256, status: "review", extracted: {}, confidence: {}, createdBy: ctx.userId } });
    const b = await runBackup(ctx.tenantId, "manual", { id: ctx.userId, name: ctx.userName });
    const file = (await backupFile(ctx, b.id))!.bytes;

    // A new server: empty database and its own HOST_KEY.
    await resetDb();
    vi.stubEnv("HOST_KEY", "n".repeat(40));
    expect(() => parseKit("not a key")).toThrow(/43-character/);
    const kitPage = recoveryKitHtml({ pharmacy: "Test Medical Store", code: "TEST-PUNE", key: KEY, fingerprint: "AB:CD:EF:01" });
    expect(parseKit(kitPage).equals(Buffer.from(KEY, "base64url"))).toBe(true);
    expect(parseKit(KEY.match(/.{1,4}/g)!.join(" ")).equals(Buffer.from(KEY, "base64url"))).toBe(true);
    await expect(previewFreshRestore(file, "C".repeat(43))).rejects.toThrow(/doesn’t open this backup/);
    const pv = await previewFreshRestore(file, KEY);
    expect(pv).toMatchObject({ pharmacy: "Test Medical Store", code: "TEST-PUNE", users: 1, branches: 2, files: 1 });
    expect(await db.tenant.count()).toBe(0);
    await expect(freshRestore(file, KEY, "WRONG")).rejects.toThrow(/TEST-PUNE/);
    const done = await freshRestore(file, KEY, "test-pune", { refreshToken: "rt-new", account: "owner@gmail.com" });
    expect(done).toMatchObject({ code: "TEST-PUNE", mfaReset: 1, drive: true });
    const t = await db.tenant.findUniqueOrThrow({ where: { code: "TEST-PUNE" } });
    expect(t.id).toBe(ctx.tenantId);
    expect(await db.branch.count()).toBe(2);
    const owner = await db.user.findFirstOrThrow({ where: { email: "owner@test.in" } });
    expect(owner).toMatchObject({ mfaSecret: null, mfaEnabled: false, mfaRequired: true });
    expect((await readDocument(saved.rel)).equals(pdf)).toBe(true);
    expect((await db.fileObject.findUnique({ where: { key: saved.rel } }))?.driveFileId ?? null).toBeNull();
    expect(await driveState(t.id)).toMatchObject({ status: "connected" });
    expect(await db.auditEvent.count({ where: { action: "Backup restored" } })).toBe(1);
    expect(await db.backupManifest.count({ where: { kind: "imported" } })).toBe(1);
    // The kit is now this server's backup key, sealed with the new HOST_KEY: backups work straight away.
    const next = await runBackup(t.id, "manual");
    expect((await db.backupManifest.findUniqueOrThrow({ where: { id: next.id } })).status).toBe("verified");
    await expect(freshRestore(file, KEY, "TEST-PUNE")).rejects.toThrow(/already set up/);
    vi.stubEnv("HOST_KEY", "");
  });

  it("re-entering the recovery kit re-seals a backup key this server can no longer open", async () => {
    const ctx = await ctxFor();
    const i = await db.integration.findUniqueOrThrow({ where: { tenantId_kind: { tenantId: ctx.tenantId, kind: "backup_key" } } });
    vi.stubEnv("HOST_KEY", "z".repeat(40));
    await db.integration.update({ where: { id: i.id }, data: { encryptedSecret: new Uint8Array(seal(Buffer.from("garbage-sealed-under-new-key"))) } });
    vi.stubEnv("HOST_KEY", "y".repeat(40));
    await expect(runBackup(ctx.tenantId, "manual")).rejects.toThrow(/Enter the recovery kit/);
    await expect(reenterKit(ctx, "D".repeat(43))).rejects.toThrow(/fingerprint/);
    await reenterKit(ctx, KEY);
    const r = await runBackup(ctx.tenantId, "manual");
    expect((await db.backupManifest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("verified");
    vi.stubEnv("HOST_KEY", "");
  });
});

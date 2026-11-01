import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { UserError } from "@/server/action";
import { reseal, seal, unseal } from "@/server/vault";

// Google Drive with the drive.file scope: Medoro can only see files it creates (with this OAuth client).
const env = () => ({ id: process.env.GOOGLE_OAUTH_CLIENT_ID, secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET, redirect: process.env.GOOGLE_OAUTH_REDIRECT_URI });
export const driveAppConfigured = () => { const e = env(); return !!(e.id && e.secret && e.redirect); };

export const SCOPE = "https://www.googleapis.com/auth/drive.file";
const TOKEN = "https://oauth2.googleapis.com/token";
const REVOKE = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER = "application/vnd.google-apps.folder";
// Google allows multipart uploads up to 5 MB; larger files need a resumable session.
export const MULTIPART_MAX = 5 * 1024 * 1024;
// Resumable chunks must be multiples of 256 KiB.
export const CHUNK = 32 * 256 * 1024;

export type DriveConfig = {
  account?: string; scope?: string;
  /** "Medoro Backups" folder used by earlier versions. */
  folderId?: string;
  folders?: { root?: string; pharmacy?: string; backups?: string; files?: string; drivedb?: string };
  /** Set when Google refused the stored token (revoked, expired or password changed). */
  lostAt?: string; lostReason?: string;
};

export class DriveAccessLost extends UserError {}
export class DriveScopeMissing extends UserError {}
export class DriveHttpError extends Error { constructor(message: string, public status: number) { super(message); } }

/** PKCE pair for the consent redirect. */
export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function consentUrl(state: string, challenge: string) {
  const e = env();
  const q = new URLSearchParams({
    client_id: e.id!, redirect_uri: e.redirect!, response_type: "code", scope: `${SCOPE} openid email`, access_type: "offline", prompt: "consent",
    state, code_challenge: challenge, code_challenge_method: "S256",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

const form = (b: Record<string, string>) => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(b), signal: AbortSignal.timeout(30_000) });

/** Swaps the authorization code (with the PKCE verifier) for a refresh token and the Google account's email. */
export async function exchangeCode(code: string, verifier: string) {
  const e = env();
  const r = await fetch(TOKEN, form({ code, client_id: e.id!, client_secret: e.secret!, redirect_uri: e.redirect!, grant_type: "authorization_code", code_verifier: verifier }));
  const j = (await r.json().catch(() => ({}))) as { refresh_token?: string; id_token?: string; scope?: string; error?: string; error_description?: string };
  if (!r.ok) throw new Error(j.error_description ?? j.error ?? `Google returned ${r.status}`);
  if (!(j.scope ?? "").split(" ").includes(SCOPE)) throw new DriveScopeMissing("Drive access wasn’t granted. Tick “See, edit, create and delete only the specific Google Drive files you use with this app”.");
  if (!j.refresh_token) throw new Error("Google didn’t return a refresh token.");
  const email = j.id_token ? (JSON.parse(Buffer.from(j.id_token.split(".")[1], "base64url").toString()) as { email?: string }).email : undefined;
  return { refreshToken: j.refresh_token, email: email ?? "" };
}

const integration = (tenantId: string) => db.integration.findUnique({ where: { tenantId_kind: { tenantId, kind: "gdrive" } } });

/** Stores the refresh token, sealed with HOST_KEY. Folder ids are kept when the same Google account reconnects. */
export async function saveDriveToken(tenantId: string, refreshToken: string, account: string) {
  const old = ((await integration(tenantId))?.config ?? {}) as DriveConfig;
  const config: DriveConfig = { account, scope: "drive.file", ...(old.account === account ? { folderId: old.folderId, folders: old.folders } : {}) };
  const data = { config: config as object, encryptedSecret: new Uint8Array(seal(refreshToken)), connectedAt: new Date() };
  await db.integration.upsert({ where: { tenantId_kind: { tenantId, kind: "gdrive" } }, create: { tenantId, kind: "gdrive", ...data }, update: data });
  tokens.delete(tenantId);
}

export async function driveConfigured(tenantId: string) {
  const i = await integration(tenantId);
  return !!(i?.connectedAt && i.encryptedSecret && driveAppConfigured());
}

export type DriveState = { status: "connected"; account: string; since: string } | { status: "lost"; account: string; at: string; reason: string } | { status: "off" };
export async function driveState(tenantId: string): Promise<DriveState> {
  const i = await integration(tenantId);
  const c = (i?.config ?? {}) as DriveConfig;
  if (i?.connectedAt && i.encryptedSecret) return { status: "connected", account: c.account ?? "", since: i.connectedAt.toISOString() };
  if (c.lostAt) return { status: "lost", account: c.account ?? "", at: c.lostAt, reason: c.lostReason ?? "" };
  return { status: "off" };
}

/** Google refused the stored token: forget it, record why, and tell the owner (alerts read lostAt). */
async function markLost(tenantId: string, reason: string) {
  const i = await integration(tenantId);
  tokens.delete(tenantId);
  if (!i?.connectedAt) return;
  await db.integration.update({ where: { id: i.id }, data: { encryptedSecret: null, connectedAt: null, config: { ...(i.config as object), lostAt: new Date().toISOString(), lostReason: reason.slice(0, 200) } } });
  await writeAudit(db, { tenantId, userId: null, userName: "System", action: "Google Drive access lost", entity: "integration", detail: reason.slice(0, 200) });
}

/** Where access tokens come from: a pharmacy's stored token, or (during setup) a token held in a sealed cookie. */
export type DriveAuth = { key: string; refreshToken: () => Promise<string>; lost: (reason: string) => Promise<void> };

export const tenantDrive = (tenantId: string): DriveAuth => ({
  key: tenantId,
  refreshToken: async () => {
    const i = await integration(tenantId);
    if (!i?.encryptedSecret || !i.connectedAt) throw new DriveAccessLost("Google Drive isn’t connected.");
    const token = unseal(i.encryptedSecret).toString();
    const again = reseal(i.encryptedSecret);
    if (again) await db.integration.update({ where: { id: i.id }, data: { encryptedSecret: new Uint8Array(again) } });
    return token;
  },
  lost: (reason) => markLost(tenantId, reason),
});

export const tokenDrive = (refreshToken: string): DriveAuth => ({
  key: "rt:" + createHash("sha256").update(refreshToken).digest("hex"), refreshToken: async () => refreshToken, lost: async () => {},
});

const tokens = new Map<string, { token: string; exp: number }>();

async function accessToken(a: DriveAuth, force = false) {
  const c = tokens.get(a.key);
  if (!force && c && c.exp - 60_000 > Date.now()) return c.token;
  const e = env();
  const r = await fetch(TOKEN, form({ refresh_token: await a.refreshToken(), client_id: e.id!, client_secret: e.secret!, grant_type: "refresh_token" }));
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (j.access_token) {
    tokens.set(a.key, { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 });
    return j.access_token;
  }
  tokens.delete(a.key);
  if (j.error === "invalid_grant" || j.error === "unauthorized_client") {
    const why = `Google refused the saved access (${j.error_description ?? j.error}). Reconnect Google Drive.`;
    await a.lost(why);
    throw new DriveAccessLost(why);
  }
  throw new Error(`Couldn’t refresh Google access: ${j.error ?? r.status}`);
}

/** Runs a Drive request with a fresh access token; on 401 the token is refreshed once and the request retried. */
async function withToken<T>(a: DriveAuth, fn: (token: string) => Promise<T>) {
  try { return await fn(await accessToken(a)); }
  catch (e) {
    if (!(e instanceof DriveHttpError && e.status === 401)) throw e;
    return fn(await accessToken(a, true));
  }
}

async function driveError(r: Response, what: string) {
  const j = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
  return new DriveHttpError(`${what}: Drive returned ${r.status}${j?.error?.message ? ` (${j.error.message})` : ""}`, r.status);
}

async function api(a: DriveAuth, url: string, what: string, init: RequestInit = {}) {
  return withToken(a, async (token) => {
    const r = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(120_000) });
    if (!r.ok && !(init.method === "DELETE" && r.status === 404)) throw await driveError(r, what);
    return r;
  });
}

export type UploadMeta = { mimeType?: string; appProperties?: Record<string, string> };

/** Uploads bytes into a Drive folder and returns the new file id. */
export async function uploadToDrive(token: string, folderId: string, name: string, bytes: Buffer, f: typeof fetch = fetch, extra: UploadMeta = {}) {
  const auth = `Bearer ${token}`;
  const type = extra.mimeType ?? "application/octet-stream";
  const meta = JSON.stringify({ name, parents: [folderId], mimeType: type, ...(extra.appProperties ? { appProperties: extra.appProperties } : {}) });
  if (bytes.length <= MULTIPART_MAX) {
    const boundary = "medoro" + Date.now();
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--`)]);
    const r = await f(`${UPLOAD}?uploadType=multipart&fields=id`, { method: "POST", headers: { Authorization: auth, "Content-Type": `multipart/related; boundary=${boundary}` }, body: new Uint8Array(body), signal: AbortSignal.timeout(120_000) });
    if (!r.ok) throw await driveError(r, "Upload failed");
    return ((await r.json()) as { id: string }).id;
  }
  const init = await f(`${UPLOAD}?uploadType=resumable&fields=id`, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": type, "X-Upload-Content-Length": String(bytes.length) }, body: meta, signal: AbortSignal.timeout(60_000) });
  const session = init.headers.get("location");
  if (!init.ok || !session) throw await driveError(init, "Couldn’t start the Drive upload");
  let start = 0, stalls = 0;
  while (start < bytes.length) {
    const end = Math.min(start + CHUNK, bytes.length) - 1;
    // redirect: "manual" because Drive answers an unfinished upload with 308 and no Location.
    const r = await f(session, { method: "PUT", redirect: "manual", headers: { Authorization: auth, "Content-Range": `bytes ${start}-${end}/${bytes.length}` }, body: new Uint8Array(bytes.subarray(start, end + 1)), signal: AbortSignal.timeout(120_000) });
    if (r.status === 200 || r.status === 201) return ((await r.json()) as { id: string }).id;
    if (r.status !== 308) throw await driveError(r, "Upload failed");
    const range = /bytes=0-(\d+)/.exec(r.headers.get("range") ?? "");
    const next = range ? Number(range[1]) + 1 : 0;
    stalls = next > start ? 0 : stalls + 1;
    if (stalls >= 3) throw new Error("Upload failed: Drive stopped accepting data.");
    start = next;
  }
  throw new Error("Upload failed: Drive didn’t confirm the finished file.");
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function findOrCreateFolder(a: DriveAuth, name: string, parent?: string) {
  const q = `mimeType = '${FOLDER}' and name = '${esc(name)}' and trashed = false and '${esc(parent ?? "root")}' in parents`;
  const r = await api(a, `${API}?${new URLSearchParams({ q, fields: "files(id)", pageSize: "1", spaces: "drive" })}`, `Couldn’t look for the ${name} folder`);
  const found = ((await r.json()) as { files?: { id: string }[] }).files?.[0]?.id;
  if (found) return found;
  const c = await api(a, `${API}?fields=id`, `Couldn’t create the ${name} folder`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }) });
  const id = ((await c.json()) as { id?: string }).id;
  if (!id) throw new Error(`Couldn’t create the ${name} folder: Drive returned no folder id.`);
  return id;
}

export const pharmacyFolderName = (t: { name: string; code: string }) => `${t.name.replace(/[/\\]/g, "-")} (${t.code})`;

/** Medoro/<pharmacy>/<kind>, created on first use; ids are cached in the integration's config. */
async function folderFor(tenantId: string, a: DriveAuth, kind: "backups" | "files" | "drivedb") {
  const cfg = ((await integration(tenantId))?.config ?? {}) as DriveConfig;
  if (cfg.folders?.[kind]) return cfg.folders[kind];
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const root = cfg.folders?.root ?? await findOrCreateFolder(a, "Medoro");
  const pharmacy = cfg.folders?.pharmacy ?? await findOrCreateFolder(a, pharmacyFolderName(t), root);
  const id = await findOrCreateFolder(a, kind, pharmacy);
  const latest = await integration(tenantId);
  if (latest) await db.integration.update({ where: { id: latest.id }, data: { config: { ...(latest.config as object), folders: { ...cfg.folders, root, pharmacy, [kind]: id } } } });
  return id;
}

async function forgetFolders(tenantId: string) {
  const i = await integration(tenantId);
  if (i) await db.integration.update({ where: { id: i.id }, data: { config: { ...(i.config as DriveConfig), folders: {} } as object } });
}

/** Uploads into Medoro/<pharmacy>/<kind> in the pharmacy's Drive. A folder the owner deleted is recreated. */
export async function driveUpload(tenantId: string, kind: "backups" | "files", name: string, bytes: Buffer, meta: UploadMeta = {}) {
  const a = tenantDrive(tenantId);
  const go = async (retry: boolean): Promise<string> => {
    const folder = await folderFor(tenantId, a, kind);
    try { return await withToken(a, (token) => uploadToDrive(token, folder, name, bytes, fetch, meta)); }
    catch (e) {
      if (retry && e instanceof DriveHttpError && e.status === 404) { await forgetFolders(tenantId); return go(false); }
      throw e;
    }
  };
  return go(true);
}

export async function driveDownload(a: DriveAuth, fileId: string) {
  const r = await api(a, `${API}/${encodeURIComponent(fileId)}?alt=media`, "Couldn’t download from Drive");
  return Buffer.from(await r.arrayBuffer());
}

export async function driveDelete(a: DriveAuth, fileId: string) {
  await api(a, `${API}/${encodeURIComponent(fileId)}`, "Couldn’t delete from Drive", { method: "DELETE" });
}

export type DriveBackup = { id: string; name: string; size: number; createdTime: string; pharmacy: string | null; code: string | null; tenantId: string | null };

async function listQuery(a: DriveAuth, q: string) {
  const out: DriveBackup[] = [];
  let pageToken = "";
  do {
    const p = new URLSearchParams({ q, fields: "nextPageToken,files(id,name,size,createdTime,appProperties)", orderBy: "createdTime desc", pageSize: "200", spaces: "drive", ...(pageToken ? { pageToken } : {}) });
    const j = (await (await api(a, `${API}?${p}`, "Couldn’t list backups in Drive")).json()) as { nextPageToken?: string; files?: { id: string; name: string; size?: string; createdTime: string; appProperties?: Record<string, string> }[] };
    for (const f of j.files ?? []) out.push({ id: f.id, name: f.name, size: Number(f.size ?? 0), createdTime: f.createdTime, pharmacy: f.appProperties?.medoroPharmacy ?? null, code: f.appProperties?.medoroCode ?? null, tenantId: f.appProperties?.medoroTenant ?? null });
    pageToken = j.nextPageToken ?? "";
  } while (pageToken && out.length < 2000);
  return out;
}

/**
 * Medoro backups visible to this OAuth client, newest first. With a tenant, only that pharmacy's.
 * Backups uploaded by earlier versions sit in a "Medoro Backups" folder without tags.
 */
export async function listDriveBackups(a: DriveAuth, tenantId?: string) {
  const tagged = `trashed = false and appProperties has { key='medoroKind' and value='backup' }` + (tenantId ? ` and appProperties has { key='medoroTenant' and value='${esc(tenantId)}' }` : "");
  const all = await listQuery(a, tagged);
  const legacy = tenantId
    ? [((await integration(tenantId))?.config as DriveConfig | undefined)?.folderId].filter((x): x is string => !!x)
    : (await listQuery(a, `mimeType = '${FOLDER}' and name = 'Medoro Backups' and trashed = false`)).map((f) => f.id);
  for (const folder of legacy) {
    for (const f of await listQuery(a, `'${esc(folder)}' in parents and trashed = false and mimeType != '${FOLDER}'`)) if (!all.some((x) => x.id === f.id)) all.push(f);
  }
  return all.sort((x, y) => y.createdTime.localeCompare(x.createdTime));
}

/** Revokes the token at Google and forgets it. Returns false if Google couldn't be reached to revoke it. */
export async function driveDisconnect(tenantId: string) {
  const i = await integration(tenantId);
  let revoked = true;
  if (i?.encryptedSecret) {
    const r = await fetch(REVOKE, form({ token: unseal(i.encryptedSecret).toString() })).catch(() => null);
    // 400 means Google no longer knows the token, which is what we want.
    revoked = !!r && (r.ok || r.status === 400);
  }
  if (i) {
    const c = { ...(i.config as DriveConfig) };
    delete c.lostAt; delete c.lostReason;
    await db.integration.update({ where: { id: i.id }, data: { encryptedSecret: null, connectedAt: null, config: c as object } });
  }
  tokens.delete(tenantId);
  return revoked;
}

/**
 * A short-lived (about an hour) Drive access token for the owner's own device, so the device can read and write its
 * DriveDB files directly and pharmacy data never passes through Medoro. Owner only; the refresh token stays here.
 */
export async function deviceDriveToken(tenantId: string) {
  return accessToken(tenantDrive(tenantId));
}

/**
 * Browser tests only: E2E_FAKE_DRIVE=1 makes devices talk to a fake Google Drive the test provides.
 * Never honoured on Vercel.
 */
const fakeDrive = () => process.env.E2E_FAKE_DRIVE === "1" && !process.env.VERCEL;

/** Can devices of this pharmacy keep DriveDB in Google Drive? */
export async function deviceDriveEnabled(tenantId: string) {
  return fakeDrive() || driveConfigured(tenantId);
}

/** The device's Drive pass for DriveDB: a short-lived token and the Medoro/<pharmacy>/DriveDB folder id. */
export async function deviceDriveAccess(tenantId: string) {
  if (fakeDrive()) return { token: "e2e-fake", folderId: "e2e-folder", expiresAt: Date.now() + 50 * 60_000 };
  const a = tenantDrive(tenantId);
  const folderId = await folderFor(tenantId, a, "drivedb");
  return { token: await accessToken(a), folderId, expiresAt: Date.now() + 50 * 60_000 };
}

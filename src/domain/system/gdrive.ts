import "server-only";
import { db } from "@/server/db";
import { seal, unseal } from "@/server/vault";

// Google Drive with the drive.file scope: Medoro can only see files it creates.
const env = () => ({ id: process.env.GOOGLE_OAUTH_CLIENT_ID, secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET, redirect: process.env.GOOGLE_OAUTH_REDIRECT_URI });
export const driveAppConfigured = () => { const e = env(); return !!(e.id && e.secret && e.redirect); };

export function consentUrl(state: string) {
  const e = env();
  const q = new URLSearchParams({ client_id: e.id!, redirect_uri: e.redirect!, response_type: "code", scope: "https://www.googleapis.com/auth/drive.file openid email", access_type: "offline", prompt: "consent", state });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export async function exchangeCode(tenantId: string, code: string) {
  const e = env();
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: e.id!, client_secret: e.secret!, redirect_uri: e.redirect!, grant_type: "authorization_code" }) });
  const j = (await r.json()) as { refresh_token?: string; id_token?: string; error?: string };
  if (!r.ok || !j.refresh_token) throw new Error(j.error ?? "Google didn’t return a refresh token.");
  const email = j.id_token ? (JSON.parse(Buffer.from(j.id_token.split(".")[1], "base64url").toString()) as { email?: string }).email : undefined;
  await db.integration.upsert({
    where: { tenantId_kind: { tenantId, kind: "gdrive" } },
    create: { tenantId, kind: "gdrive", config: { account: email ?? "", scope: "drive.file" }, encryptedSecret: new Uint8Array(seal(j.refresh_token)), connectedAt: new Date() },
    update: { config: { account: email ?? "", scope: "drive.file" }, encryptedSecret: new Uint8Array(seal(j.refresh_token)), connectedAt: new Date() },
  });
  return email;
}

export async function driveConfigured(tenantId: string) {
  const i = await db.integration.findUnique({ where: { tenantId_kind: { tenantId, kind: "gdrive" } } });
  return !!(i?.connectedAt && i.encryptedSecret && driveAppConfigured());
}

async function accessToken(tenantId: string) {
  const i = await db.integration.findUniqueOrThrow({ where: { tenantId_kind: { tenantId, kind: "gdrive" } } });
  const e = env();
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ refresh_token: unseal(i.encryptedSecret!).toString(), client_id: e.id!, client_secret: e.secret!, grant_type: "refresh_token" }) });
  const j = (await r.json()) as { access_token?: string; error?: string };
  if (!j.access_token) throw new Error(j.error ?? "Couldn’t refresh Google access.");
  return { token: j.access_token, cfg: i.config as { folderId?: string } };
}

export async function driveUpload(tenantId: string, name: string, bytes: Buffer) {
  const { token, cfg } = await accessToken(tenantId);
  let folderId = cfg.folderId;
  if (!folderId) {
    const f = await fetch("https://www.googleapis.com/drive/v3/files", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Medoro Backups", mimeType: "application/vnd.google-apps.folder" }) });
    folderId = ((await f.json()) as { id: string }).id;
    const i = await db.integration.findUniqueOrThrow({ where: { tenantId_kind: { tenantId, kind: "gdrive" } } });
    await db.integration.update({ where: { id: i.id }, data: { config: { ...(i.config as object), folderId } } });
  }
  const boundary = "medoro" + Date.now();
  const meta = JSON.stringify({ name, parents: [folderId], mimeType: "application/octet-stream" });
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--`)]);
  const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` }, body: new Uint8Array(body), signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`Drive returned ${r.status}`);
  return ((await r.json()) as { id: string }).id;
}

export async function driveDisconnect(tenantId: string) {
  const i = await db.integration.findUnique({ where: { tenantId_kind: { tenantId, kind: "gdrive" } } });
  if (i?.encryptedSecret) await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: unseal(i.encryptedSecret).toString() }) }).catch(() => {});
  if (i) await db.integration.update({ where: { id: i.id }, data: { encryptedSecret: null, connectedAt: null } });
}

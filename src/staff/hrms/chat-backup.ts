import "server-only";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { log } from "@/server/log";
import { seal, unseal } from "@/server/vault";
import { audit, type Me } from "./auth";
import { gcalConfig } from "./gcal";

// Chat backup, like WhatsApp's: each employee can connect their OWN Google account, and Medoro keeps one encrypted copy of
// their conversations in Drive's hidden app folder (scope drive.appdata: Medoro sees only the file it made, and the employee
// sees nothing in their Drive). The file is sealed with HOST_KEY, so even someone who gets into that Drive cannot read it:
// only this Medoro server can open it again (for "Restore"). Pictures are not included; deleted messages stay deleted.
const TOKEN_URL = "https://oauth2.googleapis.com/token", REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const FILES = "https://www.googleapis.com/drive/v3/files", UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const NAME = "medoro-chat-backup.bin";
const PER_CHAT = 3000, MAX_BYTES = 8_000_000, DUE_HOURS = 20, MAX_PER_TICK = 12;

type Msg = { id: string; seq: number; senderId: string; kind: string; body: string; at: string };
type Chat = { id: string; kind: string; name: string; with: string[]; messages: Msg[] };
export type Backup = { v: 1; staffId: string; at: string; chats: Chat[] };

const form = (o: Record<string, string>) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o), signal: AbortSignal.timeout(15_000) });

export async function backupStatus(staffId: string) {
  const row = await db.hrChatBackup.findUnique({ where: { staffId }, select: { email: true, lastAt: true, lastCount: true, lastBytes: true, lastError: true } });
  return { configured: !!gcalConfig(), connected: !!row, email: row?.email ?? "", lastAt: row?.lastAt?.toISOString() ?? "", lastCount: row?.lastCount ?? 0, lastBytes: row?.lastBytes ?? 0, error: row?.lastError ?? "" };
}

/** Everything the person can read in their conversations (text, polls, call links), oldest first. */
export async function exportFor(staffId: string): Promise<Backup> {
  const mine = await db.hrChatMember.findMany({ where: { staffId }, select: { chatId: true, fromSeq: true } });
  const ids = mine.map((m) => m.chatId), from = new Map(mine.map((m) => [m.chatId, m.fromSeq]));
  const [chats, members] = await Promise.all([
    db.hrChat.findMany({ where: { id: { in: ids } }, select: { id: true, kind: true, name: true } }),
    db.hrChatMember.findMany({ where: { chatId: { in: ids } }, select: { chatId: true, staffId: true } }),
  ]);
  const names = new Map((await db.staffUser.findMany({ where: { id: { in: [...new Set(members.map((m) => m.staffId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const out: Chat[] = [];
  for (const c of chats) {
    const rows = (await db.hrChatMessage.findMany({ where: { chatId: c.id, seq: { gt: from.get(c.id) ?? 0 }, deletedAt: null }, orderBy: { seq: "desc" }, take: PER_CHAT, select: { id: true, seq: true, senderId: true, kind: true, body: true, createdAt: true } })).reverse();
    out.push({
      id: c.id, kind: c.kind, name: c.name, with: members.filter((m) => m.chatId === c.id).map((m) => names.get(m.staffId) ?? "Former colleague"),
      messages: rows.map((m) => ({ id: m.id, seq: m.seq, senderId: m.senderId, kind: m.kind, body: m.kind === "image" ? "" : unseal(m.body).toString("utf8"), at: m.createdAt.toISOString() })),
    });
  }
  return { v: 1, staffId, at: new Date().toISOString(), chats: out.filter((c) => c.messages.length) };
}

const tokens = new Map<string, { token: string; exp: number }>();
async function access(staffId: string) {
  const hit = tokens.get(staffId);
  if (hit && hit.exp - 60_000 > Date.now()) return hit.token;
  const g = gcalConfig(), row = await db.hrChatBackup.findUnique({ where: { staffId } });
  if (!g || !row) throw new UserError("Connect Google Drive first.");
  const r = await fetch(TOKEN_URL, form({ refresh_token: unseal(row.tokenSealed).toString(), client_id: g.id, client_secret: g.secret, grant_type: "refresh_token" }));
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (j.access_token) { tokens.set(staffId, { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 }); return j.access_token; }
  if (j.error === "invalid_grant") {
    await db.hrChatBackup.update({ where: { staffId }, data: { lastError: "Google access was removed. Connect again." } });
    throw new UserError("Google access was removed. Connect Google Drive again.");
  }
  throw new UserError("Couldn’t reach Google. Try again in a moment.");
}
const g = async (staffId: string, url: string, init: RequestInit = {}) => {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000), headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${await access(staffId)}` } }).catch(() => null);
  if (!r) throw new UserError("Couldn’t reach Google Drive. Try again in a moment.");
  if (r.status === 403) throw new UserError("Google refused the request. Check that the Google Drive API is enabled for this server’s Google project.");
  return r;
};

async function findFile(staffId: string, known: string) {
  if (known) { const r = await g(staffId, `${FILES}/${known}?fields=id`); if (r.ok) return known; }
  const q = new URLSearchParams({ spaces: "appDataFolder", q: `name='${NAME}'`, fields: "files(id)" });
  const j = (await (await g(staffId, `${FILES}?${q}`)).json().catch(() => ({}))) as { files?: { id: string }[] };
  return j.files?.[0]?.id ?? "";
}

/** Writes the person's encrypted chat copy to their Drive (replacing the last one). */
export async function backUp(staffId: string, who?: { id: string; name: string }) {
  const row = await db.hrChatBackup.findUnique({ where: { staffId } });
  if (!row) throw new UserError("Connect Google Drive first.");
  try {
    let data = await exportFor(staffId);
    let blob = seal(JSON.stringify(data));
    while (blob.length > MAX_BYTES && data.chats.some((c) => c.messages.length > 50)) { // the newest messages matter most
      data = { ...data, chats: data.chats.map((c) => ({ ...c, messages: c.messages.slice(Math.ceil(c.messages.length / 4)) })) };
      blob = seal(JSON.stringify(data));
    }
    const count = data.chats.reduce((a, c) => a + c.messages.length, 0);
    let id = await findFile(staffId, row.fileId);
    if (id) {
      const r = await g(staffId, `${UPLOAD}/${id}?uploadType=media`, { method: "PATCH", headers: { "content-type": "application/octet-stream" }, body: new Uint8Array(blob) });
      if (!r.ok) throw new UserError("Google Drive didn’t accept the backup. Try again.");
    } else {
      const boundary = "medoro" + Math.random().toString(36).slice(2);
      const head = Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: NAME, parents: ["appDataFolder"] })}\r\n--${boundary}\r\ncontent-type: application/octet-stream\r\n\r\n`);
      const r = await g(staffId, `${UPLOAD}?uploadType=multipart&fields=id`, { method: "POST", headers: { "content-type": `multipart/related; boundary=${boundary}` }, body: new Uint8Array(Buffer.concat([head, blob, Buffer.from(`\r\n--${boundary}--`)])) });
      const j = (await r.json().catch(() => ({}))) as { id?: string };
      if (!r.ok || !j.id) throw new UserError("Google Drive didn’t accept the backup. Try again.");
      id = j.id;
    }
    await db.hrChatBackup.update({ where: { staffId }, data: { fileId: id, lastAt: new Date(), lastCount: count, lastBytes: blob.length, lastError: "" } });
    if (who) await audit(who, "Chat backed up to Google Drive", `${count} messages`);
    return { count, bytes: blob.length };
  } catch (e) {
    const msg = e instanceof UserError ? e.message : "The backup didn’t finish. It will try again.";
    if (!(e instanceof UserError)) log.error("chat backup failed", { err: e, staffId });
    await db.hrChatBackup.update({ where: { staffId }, data: { lastError: msg } }).catch(() => {});
    throw e;
  }
}

/** The daily job: backs up everyone who connected and hasn't been backed up in the last day. */
export async function chatBackupTick(now = new Date()) {
  const due = await db.hrChatBackup.findMany({ where: { OR: [{ lastAt: null }, { lastAt: { lt: new Date(now.getTime() - DUE_HOURS * 3600_000) } }] }, select: { staffId: true }, take: MAX_PER_TICK });
  let done = 0;
  for (const d of due) { try { await backUp(d.staffId); done++; } catch { /* the reason is saved on the row; the next tick tries again */ } }
  return done;
}

/** Puts back messages that are missing from conversations the person is still in. Never changes or removes anything. */
export async function restore(me: Me) {
  const row = await db.hrChatBackup.findUnique({ where: { staffId: me.id } });
  if (!row) throw new UserError("Connect Google Drive first.");
  const id = await findFile(me.id, row.fileId);
  if (!id) throw new UserError("No backup found in your Google Drive yet. Use “Back up now” first.");
  const r = await g(me.id, `${FILES}/${id}?alt=media`);
  if (!r.ok) throw new UserError("Couldn’t read the backup from Google Drive.");
  let data: Backup;
  try { data = JSON.parse(unseal(Buffer.from(await r.arrayBuffer())).toString("utf8")) as Backup; } catch { throw new UserError("This backup can’t be opened by this server (it was made on another one)."); }
  if (data.staffId !== me.id) throw new UserError("This backup belongs to someone else.");
  const member = new Set((await db.hrChatMember.findMany({ where: { staffId: me.id }, select: { chatId: true } })).map((m) => m.chatId));
  let restored = 0;
  for (const c of data.chats) {
    if (!member.has(c.id) || !c.messages.length) continue;
    const have = new Set((await db.hrChatMessage.findMany({ where: { id: { in: c.messages.map((m) => m.id) } }, select: { id: true } })).map((m) => m.id));
    const missing = c.messages.filter((m) => !have.has(m.id));
    if (!missing.length) continue;
    const made = await db.hrChatMessage.createMany({ skipDuplicates: true, data: missing.map((m) => ({ id: m.id, seq: m.seq, chatId: c.id, senderId: m.senderId, kind: m.kind, body: new Uint8Array(seal(m.body)), createdAt: new Date(m.at) })) });
    restored += made.count;
  }
  await audit(me, "Chat restored from Google Drive", `${restored} messages`);
  return { restored };
}

export async function disconnect(me: Me) {
  const row = await db.hrChatBackup.findUnique({ where: { staffId: me.id } });
  if (!row) return;
  try { const id = row.fileId || (await findFile(me.id, "")); if (id) await g(me.id, `${FILES}/${id}`, { method: "DELETE" }); } catch { /* the file is hidden and Medoro-only; the connection is removed either way */ }
  await fetch(REVOKE_URL, form({ token: unseal(row.tokenSealed).toString() })).catch(() => {});
  await db.hrChatBackup.delete({ where: { staffId: me.id } });
  tokens.delete(me.id);
  await audit(me, "Chat backup disconnected", row.email);
}

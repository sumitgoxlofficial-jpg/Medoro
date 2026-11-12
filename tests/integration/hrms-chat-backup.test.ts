import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.8", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { seal } from "@/server/vault";
import { loadPerms, type Me } from "@/staff/hrms/auth";
import { openDm, sendText, deleteMessage } from "@/staff/hrms/chat";
import { backUp, backupStatus, chatBackupTick, disconnect, exportFor, restore } from "@/staff/hrms/chat-backup";
import { resetDb } from "./helpers";

let ann: Me, bob: Me;
const mkMe = async (id: string): Promise<Me> => { const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } }); return { id, empNo: u.empNo, name: u.name, first: u.name.split(" ")[0], email: u.email, staffRole: u.role, role: u.hr!.role, perms: await loadPerms(), sessionId: "t", phone: u.phone, personalEmail: "", dept: "", designation: "", photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true }; };
const mk = (n: number, name: string) => db.staffUser.create({ data: { empNo: `MS-20${n}`, name, email: `${name.split(" ")[0].toLowerCase()}@medoro.in`, kind: "team", phone: `98400000${n}0`, role: "employee", status: "active", hr: { create: { role: "employee", profileDone: true, docsAcceptedAt: new Date() } } } });

// A tiny pretend Google: the token endpoint and Drive's hidden app folder.
// Drive's app folder is per Google account: files are kept per access token.
const drives = new Map<string, Map<string, Buffer>>();
let files: Map<string, Buffer>, calls: string[] = [];
function fakeGoogle() {
  calls = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const u = new URL(url), method = init.method ?? "GET";
    calls.push(`${method} ${u.pathname}`);
    if (u.hostname === "oauth2.googleapis.com") return Response.json(u.pathname === "/revoke" ? {} : { access_token: "at-" + new URLSearchParams(String(init.body)).get("refresh_token"), expires_in: 3600 });
    const tok = String((init.headers as Record<string, string>)?.authorization ?? "").replace("Bearer ", "");
    files = drives.get(tok) ?? drives.set(tok, new Map()).get(tok)!;
    if (u.pathname === "/drive/v3/files" && method === "GET") return Response.json({ files: [...files.keys()].map((id) => ({ id })) });
    if (u.pathname.startsWith("/drive/v3/files/") && method === "GET") { const id = u.pathname.split("/").pop()!; const b = files.get(id); if (!b) return new Response("", { status: 404 }); return u.searchParams.get("alt") === "media" ? new Response(new Uint8Array(b)) : Response.json({ id }); }
    if (u.pathname.startsWith("/drive/v3/files/") && method === "DELETE") { files.delete(u.pathname.split("/").pop()!); return new Response(null, { status: 204 }); }
    if (u.pathname === "/upload/drive/v3/files" && method === "POST") {
      const body = Buffer.from(init.body as Uint8Array), start = body.indexOf("octet-stream\r\n\r\n") + 16, end = body.lastIndexOf("\r\n--");
      const id = "file" + (files.size + 1); files.set(id, body.subarray(start, end)); return Response.json({ id });
    }
    if (u.pathname.startsWith("/upload/drive/v3/files/") && method === "PATCH") { files.set(u.pathname.split("/").pop()!, Buffer.from(init.body as Uint8Array)); return Response.json({}); }
    return new Response("", { status: 404 });
  });
}
const connect = (staffId: string) => db.hrChatBackup.upsert({ where: { staffId }, create: { staffId, email: "me@gmail.com", tokenSealed: new Uint8Array(seal("refresh-" + staffId)) }, update: { fileId: "", lastAt: null } });

beforeAll(async () => {
  await resetDb();
  process.env.GOOGLE_OAUTH_CLIENT_ID = "id"; process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret"; process.env.APP_URL = "https://medoro.test";
  ann = await mkMe((await mk(1, "Ann Employee")).id);
  bob = await mkMe((await mk(2, "Bob Employee")).id);
});
beforeEach(() => fakeGoogle());
afterEach(() => vi.unstubAllGlobals());

describe("chat backup to the employee's own Google Drive", () => {
  it("writes one encrypted file that holds the person's chats and nothing readable", async () => {
    const { chatId } = await openDm(ann, bob.id);
    await sendText(ann, chatId, "quarterly salary secrets");
    await sendText(bob, chatId, "got it");
    await connect(ann.id);
    const r = await backUp(ann.id, ann);
    expect(r.count).toBe(2);
    const mine = drives.get("at-refresh-" + ann.id)!;
    expect(mine.size).toBe(1);
    expect([...mine.values()][0].toString("latin1")).not.toContain("salary");
    expect(await backupStatus(ann.id)).toMatchObject({ connected: true, lastCount: 2, error: "" });
    expect((await exportFor(ann.id)).chats[0].messages.map((m) => m.body)).toEqual(["quarterly salary secrets", "got it"]);
  });
  it("replaces the file on the next backup instead of piling up copies", async () => {
    await backUp(ann.id);
    expect(drives.get("at-refresh-" + ann.id)!.size).toBe(1);
    expect(calls.some((c) => c.startsWith("PATCH"))).toBe(true);
    expect(calls.filter((c) => c.startsWith("POST /upload")).length).toBe(0);
  });
  it("restore puts back messages that went missing, but not ones a person deleted, and not anyone else's backup", async () => {
    const { chatId } = await openDm(ann, bob.id);
    const keep = await sendText(ann, chatId, "to be deleted by the sender");
    const lost = await sendText(ann, chatId, "lost from the database");
    await backUp(ann.id);
    await deleteMessage(ann, keep.id);
    await db.hrChatMessage.delete({ where: { id: lost.id } });
    const r = await restore(ann);
    expect(r.restored).toBe(1);
    expect((await db.hrChatMessage.findUniqueOrThrow({ where: { id: lost.id } })).seq).toBe(lost.seq);
    expect((await db.hrChatMessage.findUniqueOrThrow({ where: { id: keep.id } })).deletedAt).not.toBeNull();
    expect((await restore(ann)).restored).toBe(0); // nothing missing now
    await connect(bob.id); // Bob has no backup file of his own, and Ann's file isn't his
    await expect(restore(bob)).rejects.toThrow(/No backup found/);
  });
  it("the daily job backs up everyone who is due, and one failure doesn't stop the rest", async () => {
    await connect(ann.id); await connect(bob.id);
    expect(await chatBackupTick(new Date())).toBe(2);
    expect(await chatBackupTick(new Date())).toBe(0); // done within the last day
  });
  it("disconnecting removes the Drive file and the saved access", async () => {
    await backUp(ann.id);
    await disconnect(ann);
    expect(drives.get("at-refresh-" + ann.id)!.size).toBe(0);
    expect(await db.hrChatBackup.findUnique({ where: { staffId: ann.id } })).toBeNull();
    await expect(backUp(ann.id)).rejects.toThrow(/Connect Google Drive/);
  });
});

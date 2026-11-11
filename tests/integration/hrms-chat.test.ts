import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => (v ? jar.set(k, v) : jar.delete(k)), delete: (k: string) => jar.delete(k) }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.7", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { loadPerms, type Me } from "@/staff/hrms/auth";
import { addToGroup, chatImage, chatList, chatMessages, createGroup, deleteMessage, groupMembers, leaveGroup, openDm, reviewChats, reviewMessages, sendImage, sendText, startMeet, unreadTotal } from "@/staff/hrms/chat";
import { resetDb } from "./helpers";

let admin: Me, hr: Me, ann: Me, bob: Me, cat: Me;
const mkMe = async (id: string): Promise<Me> => { const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } }); return { id, empNo: u.empNo, name: u.name, first: u.name.split(" ")[0], email: u.email, staffRole: u.role, role: u.hr!.role, perms: await loadPerms(), sessionId: "t", phone: u.phone, personalEmail: "", dept: "", designation: "", photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true }; };
const mk = (n: number, name: string, role: "super_admin" | "employee", hr: "admin" | "hr" | "employee") =>
  db.staffUser.create({ data: { empNo: `MS-10${n}`, name, email: `${name.split(" ")[0].toLowerCase()}@medoro.in`, kind: "team", phone: `98300000${n}0`, role, status: "active", hr: { create: { role: hr, profileDone: true, docsAcceptedAt: new Date() } } } });
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
const form = (b: Buffer, name = "p.png", type = "image/png") => { const f = new FormData(); f.set("image", new File([new Uint8Array(b)], name, { type })); return f; };

beforeAll(async () => {
  await resetDb();
  process.env.SESSION_SECRET ||= "test-only-secret-0123456789abcdef0123";
  admin = await mkMe((await mk(1, "Asha Admin", "super_admin", "admin")).id);
  hr = await mkMe((await mk(2, "Hari Hr", "employee", "hr")).id);
  ann = await mkMe((await mk(3, "Ann Employee", "employee", "employee")).id);
  bob = await mkMe((await mk(4, "Bob Employee", "employee", "employee")).id);
  cat = await mkMe((await mk(5, "Cat Employee", "employee", "employee")).id);
});
beforeEach(() => jar.clear());

describe("team chat", () => {
  it("opens one direct chat per pair, whoever starts it", async () => {
    const a = await openDm(ann, bob.id), b = await openDm(bob, ann.id);
    expect(a.chatId).toBe(b.chatId);
    await expect(openDm(ann, ann.id)).rejects.toThrow();
  });

  it("delivers messages, counts unread and shows read ticks", async () => {
    const { chatId } = await openDm(ann, bob.id);
    const m = await sendText(ann, chatId, "  Hello Bob  ");
    expect(m.body).toBe("Hello Bob");
    expect(await unreadTotal(bob.id)).toBe(1);
    expect((await chatList(bob))[0]).toMatchObject({ title: "Ann Employee", unread: 1, last: "Hello Bob" });
    expect((await chatMessages(ann, chatId, null, true)).readUpTo).toBe(0); // not read yet
    const seen = await chatMessages(bob, chatId, null, true);
    expect(seen.msgs.map((x) => x.body)).toEqual(["Hello Bob"]);
    expect(await unreadTotal(bob.id)).toBe(0);
    expect((await chatMessages(ann, chatId, null, false)).readUpTo).toBe(m.seq);
    // Only newer messages come back when `after` is given.
    await sendText(bob, chatId, "Hi Ann");
    const next = await chatMessages(ann, chatId, m.seq, true);
    expect(next.msgs.map((x) => x.body)).toEqual(["Hi Ann"]);
  });

  it("stores nothing readable and keeps it from everyone outside the chat, HR included", async () => {
    const { chatId } = await openDm(ann, bob.id);
    await sendText(ann, chatId, "top secret salary talk");
    const raw = await db.hrChatMessage.findFirstOrThrow({ where: { chatId }, orderBy: { seq: "desc" } });
    expect(Buffer.from(raw.body).toString("utf8")).not.toContain("secret");
    await expect(chatMessages(cat, chatId, null, true)).rejects.toThrow();
    await expect(chatMessages(hr, chatId, null, true)).rejects.toThrow();
    await expect(sendText(cat, chatId, "let me in")).rejects.toThrow();
    expect(await chatList(cat)).toEqual([]);
    await expect(reviewChats(hr, ann.id)).rejects.toThrow("super admin");
    await expect(reviewMessages(hr, ann.id, chatId)).rejects.toThrow("super admin");
  });

  it("lets the super admin review a conversation and records it in the audit log", async () => {
    const { chatId } = await openDm(ann, bob.id);
    expect((await reviewChats(admin, ann.id)).length).toBeGreaterThan(0);
    const r = await reviewMessages(admin, ann.id, chatId);
    expect(r.msgs.some((m) => m.body === "top secret salary talk")).toBe(true);
    const log = await db.staffAudit.findMany({ where: { action: "HRMS · Chat reviewed" } });
    expect(log.length).toBeGreaterThan(0); expect(JSON.stringify(log)).not.toContain("salary");
    // Review doesn't mark anything as read for the people in the chat.
    await sendText(ann, chatId, "one more");
    const before = await unreadTotal(bob.id);
    await reviewMessages(admin, bob.id, chatId);
    expect(await unreadTotal(bob.id)).toBe(before);
    await expect(reviewMessages(admin, cat.id, chatId)).rejects.toThrow();
  });

  it("validates messages and deletes only your own", async () => {
    const { chatId } = await openDm(ann, bob.id);
    await expect(sendText(ann, chatId, "   ")).rejects.toThrow();
    await expect(sendText(ann, chatId, "x".repeat(4001))).rejects.toThrow();
    const m = await sendText(ann, chatId, "oops");
    await expect(deleteMessage(bob, m.id)).rejects.toThrow();
    await deleteMessage(ann, m.id);
    const after = (await chatMessages(bob, chatId, null, false)).msgs.find((x) => x.id === m.id)!;
    expect(after).toMatchObject({ deleted: true, body: "" });
  });

  it("sends pictures sealed, opens them only for the conversation and checks the file", async () => {
    const { chatId } = await openDm(ann, bob.id);
    const m = await sendImage(ann, chatId, form(png()));
    expect(m).toMatchObject({ kind: "image", hasImage: true });
    expect((await chatImage(bob, m.id))?.type).toBe("image/png");
    expect(await chatImage(cat, m.id)).toBeNull();
    expect(await chatImage(hr, m.id)).toBeNull();
    expect((await chatImage(admin, m.id))?.type).toBe("image/png");
    await expect(sendImage(ann, chatId, form(Buffer.from("<script>alert(1)</script>"), "x.png", "image/png"))).rejects.toThrow("JPEG, PNG or WebP");
    await expect(sendImage(ann, chatId, form(Buffer.alloc(2_100_000, 1)))).rejects.toThrow("too large");
  });

  it("runs groups: owner adds people, newcomers don't see older messages, anyone can leave", async () => {
    await expect(createGroup(ann, "", [bob.id])).rejects.toThrow();
    await expect(createGroup(ann, "Team", [])).rejects.toThrow();
    const { chatId } = await createGroup(ann, "Launch team", [bob.id]);
    await sendText(ann, chatId, "before cat joined");
    await expect(addToGroup(bob, chatId, [cat.id])).rejects.toThrow("made the group");
    await addToGroup(ann, chatId, [cat.id]);
    expect((await groupMembers(cat, chatId)).people.map((p) => p.name).sort()).toEqual(["Ann Employee", "Bob Employee", "Cat Employee"]);
    expect((await chatMessages(cat, chatId, null, true)).msgs).toEqual([]);
    await sendText(bob, chatId, "welcome cat");
    expect((await chatMessages(cat, chatId, null, true)).msgs.map((m) => m.body)).toEqual(["welcome cat"]);
    expect((await chatList(cat)).find((c) => c.id === chatId)).toMatchObject({ title: "Launch team", kind: "group", members: 3 });
    await leaveGroup(cat, chatId);
    await expect(chatMessages(cat, chatId, null, true)).rejects.toThrow();
  });

  it("needs Google Calendar connected to start a Meet call", async () => {
    const { chatId } = await openDm(ann, bob.id);
    await expect(startMeet(ann, chatId)).rejects.toThrow("Connect Google Calendar");
    await expect(startMeet(cat, chatId)).rejects.toThrow();
  });

  it("slows down a flood of messages", async () => {
    const { chatId } = await openDm(bob, cat.id);
    let failed = false;
    for (let i = 0; i < 45 && !failed; i++) { try { await sendText(bob, chatId, `m${i}`); } catch { failed = true; } }
    expect(failed).toBe(true);
  });
});

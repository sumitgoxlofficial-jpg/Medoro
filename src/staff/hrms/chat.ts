import "server-only";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { seal, unseal } from "@/server/vault";
import { audit, type Me } from "./auth";
import { instantMeet } from "./gcal";

// Team Chat. Every message (and picture) is sealed with HOST_KEY before it is stored, so nothing readable sits in the
// database, in backups or in logs. The people in a conversation read it normally. Nobody else can: not HR, not Finance.
// The one exception is the super admin, who can open a conversation from the review screen; every such opening is
// written to the audit log, and staff are told about it on the chat screen. (This is encryption at rest with an audited
// admin key, not end-to-end encryption: the server must be able to open messages for delivery, review and backup.)
export const MAX_BODY = 4000, MAX_IMAGE_BYTES = 2_000_000, MAX_GROUP = 100, PAGE = 60, RATE_PER_MIN = 40;

export type ChatMsg = { id: string; seq: number; chatId: string; senderId: string; kind: "text" | "image" | "meet"; body: string; hasImage: boolean; deleted: boolean; at: string };
export type ChatRow = { id: string; kind: "dm" | "group"; title: string; photo: string | null; withId: string | null; members: number; last: string; lastAt: string; unread: number };

const text = (b: Uint8Array | Buffer) => unseal(b).toString("utf8");
const asMsg = (m: { id: string; seq: number; chatId: string; senderId: string; kind: string; body: Uint8Array; image: Uint8Array | null; deletedAt: Date | null; createdAt: Date }): ChatMsg => ({
  id: m.id, seq: m.seq, chatId: m.chatId, senderId: m.senderId, kind: m.kind === "image" || m.kind === "meet" ? m.kind : "text",
  body: m.deletedAt ? "" : text(m.body), hasImage: !m.deletedAt && !!m.image, deleted: !!m.deletedAt, at: m.createdAt.toISOString(),
});
const preview = (m: ChatMsg | undefined) => (!m ? "" : m.deleted ? "Message deleted" : m.kind === "image" ? "📷 Photo" : m.kind === "meet" ? "📹 Video call" : m.body.slice(0, 80));

async function membership(me: Pick<Me, "id">, chatId: string) {
  const m = await db.hrChatMember.findUnique({ where: { chatId_staffId: { chatId, staffId: me.id } } });
  if (!m) throw new UserError("That conversation isn’t available.");
  return m;
}
const activeStaff = (ids: string[]) => db.staffUser.findMany({ where: { id: { in: ids }, kind: "team", status: "active", role: { not: "partner" }, hr: { isNot: null } }, select: { id: true, name: true, email: true } });

/** Everyone a person can start a chat with. */
export async function chatPeople(me: Me) {
  const rows = await db.staffUser.findMany({
    where: { kind: "team", status: "active", role: { not: "partner" }, hr: { isNot: null }, id: { not: me.id } },
    select: { id: true, name: true, empNo: true, hr: { select: { dept: true, designation: true, photo: true } } }, orderBy: { name: "asc" },
  });
  return rows.map((u) => ({ id: u.id, name: u.name, empNo: u.empNo, dept: u.hr?.dept ?? "", designation: u.hr?.designation ?? "", photo: u.hr?.photo ?? null }));
}

/** The person's conversations, newest first, with unread counts. */
export async function chatList(me: Pick<Me, "id">): Promise<ChatRow[]> {
  const mine = await db.hrChatMember.findMany({ where: { staffId: me.id }, select: { chatId: true, fromSeq: true } });
  const from = new Map(mine.map((m) => [m.chatId, m.fromSeq]));
  if (!mine.length) return [];
  const ids = mine.map((m) => m.chatId);
  const [chats, members, lasts, unread] = await Promise.all([
    db.hrChat.findMany({ where: { id: { in: ids } }, orderBy: { lastAt: "desc" } }),
    db.hrChatMember.findMany({ where: { chatId: { in: ids } }, select: { chatId: true, staffId: true } }),
    db.hrChatMessage.findMany({ where: { chatId: { in: ids } }, distinct: ["chatId"], orderBy: [{ chatId: "asc" }, { seq: "desc" }] }),
    db.$queryRaw<{ chatId: string; n: bigint }[]>`
      SELECT m."chatId", count(*) AS n FROM "HrChatMessage" m JOIN "HrChatMember" c ON c."chatId" = m."chatId" AND c."staffId" = ${me.id}
      WHERE m.seq > c."lastReadSeq" AND m."senderId" <> ${me.id} AND m."deletedAt" IS NULL GROUP BY m."chatId"`,
  ]);
  const others = [...new Set(members.filter((m) => m.staffId !== me.id).map((m) => m.staffId))];
  const people = new Map((await db.staffUser.findMany({ where: { id: { in: others } }, select: { id: true, name: true, hr: { select: { photo: true } } } })).map((u) => [u.id, u]));
  const lastOf = new Map(lasts.filter((m) => m.seq > (from.get(m.chatId) ?? 0)).map((m) => [m.chatId, asMsg(m)]));
  const unreadOf = new Map(unread.map((u) => [u.chatId, Number(u.n)]));
  return chats.map((c) => {
    const withId = c.kind === "dm" ? members.find((m) => m.chatId === c.id && m.staffId !== me.id)?.staffId ?? null : null;
    const p = withId ? people.get(withId) : undefined, last = lastOf.get(c.id);
    return {
      id: c.id, kind: c.kind === "dm" ? "dm" : "group", title: c.kind === "dm" ? p?.name ?? "Former colleague" : c.name, photo: p?.hr?.photo ?? null, withId,
      members: members.filter((m) => m.chatId === c.id).length, last: preview(last), lastAt: (last?.at ?? c.lastAt.toISOString()), unread: unreadOf.get(c.id) ?? 0,
    };
  });
}

/** Total unread messages, for the menu badge. */
export async function unreadTotal(staffId: string) {
  const r = await db.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM "HrChatMessage" m JOIN "HrChatMember" c ON c."chatId" = m."chatId" AND c."staffId" = ${staffId}
    WHERE m.seq > c."lastReadSeq" AND m."senderId" <> ${staffId} AND m."deletedAt" IS NULL`;
  return Number(r[0]?.n ?? 0);
}

/** Messages of one conversation: the latest page, or everything after `after`. Opening it marks it read. */
export async function chatMessages(me: Pick<Me, "id">, chatId: string, after: number | null, markRead: boolean) {
  const mem = await membership(me, chatId);
  const rows = after === null
    ? (await db.hrChatMessage.findMany({ where: { chatId, seq: { gt: mem.fromSeq } }, orderBy: { seq: "desc" }, take: PAGE })).reverse()
    : await db.hrChatMessage.findMany({ where: { chatId, seq: { gt: Math.max(after, mem.fromSeq) } }, orderBy: { seq: "asc" }, take: 100 });
  const msgs = rows.map(asMsg);
  const top = msgs.length ? msgs[msgs.length - 1].seq : 0;
  if (markRead && top > mem.lastReadSeq) await db.hrChatMember.update({ where: { chatId_staffId: { chatId, staffId: me.id } }, data: { lastReadSeq: top } });
  const others = await db.hrChatMember.findMany({ where: { chatId, staffId: { not: me.id } }, select: { lastReadSeq: true } });
  return { msgs, readUpTo: others.length ? Math.min(...others.map((o) => o.lastReadSeq)) : 0 };
}

async function throttle(staffId: string) {
  const n = await db.hrChatMessage.count({ where: { senderId: staffId, createdAt: { gt: new Date(Date.now() - 60_000) } } });
  if (n >= RATE_PER_MIN) throw new UserError("You’re sending messages very quickly. Wait a moment.");
}
async function post(me: Pick<Me, "id">, chatId: string, kind: "text" | "image" | "meet", body: string, image?: Buffer) {
  await membership(me, chatId);
  await throttle(me.id);
  const m = await db.hrChatMessage.create({ data: { chatId, senderId: me.id, kind, body: new Uint8Array(seal(body)), image: image ? new Uint8Array(seal(image)) : null } });
  await db.hrChat.update({ where: { id: chatId }, data: { lastAt: m.createdAt } });
  await db.hrChatMember.update({ where: { chatId_staffId: { chatId, staffId: me.id } }, data: { lastReadSeq: m.seq } });
  return asMsg(m);
}
export async function sendText(me: Me, chatId: string, raw: unknown) {
  const body = typeof raw === "string" ? raw.replace(/\r\n/g, "\n").trim() : "";
  if (!body) throw new UserError("Type a message first.");
  if (body.length > MAX_BODY) throw new UserError(`Messages can be up to ${MAX_BODY} characters.`);
  return post(me, chatId, "text", body);
}
const imageKind = (b: Buffer) => (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? "image/jpeg" : b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? "image/png" : b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" ? "image/webp" : "");
export async function sendImage(me: Me, chatId: string, form: FormData) {
  const f = form.get("image"), caption = String(form.get("caption") ?? "").trim().slice(0, 500);
  if (!(f instanceof File) || !f.size) throw new UserError("Choose a picture to send.");
  if (f.size > MAX_IMAGE_BYTES) throw new UserError("That picture is too large (2 MB at most).");
  const b = Buffer.from(await f.arrayBuffer());
  if (!imageKind(b)) throw new UserError("Only JPEG, PNG or WebP pictures can be sent.");
  return post(me, chatId, "image", caption, b);
}
/** Opens a picture for the people in its conversation (or, through review, the super admin). */
export async function chatImage(me: Me, messageId: string) {
  const m = await db.hrChatMessage.findUnique({ where: { id: messageId } });
  if (!m?.image || m.deletedAt) return null;
  const isMember = await db.hrChatMember.findUnique({ where: { chatId_staffId: { chatId: m.chatId, staffId: me.id } } });
  if (!isMember && me.role !== "admin") return null;
  const b = unseal(m.image);
  return { bytes: b, type: imageKind(b) || "application/octet-stream" };
}
export async function deleteMessage(me: Me, id: string) {
  const m = await db.hrChatMessage.findUnique({ where: { id } });
  if (!m || m.senderId !== me.id) throw new UserError("You can only delete your own messages.");
  await db.hrChatMessage.update({ where: { id }, data: { deletedAt: new Date(), body: new Uint8Array(seal("")), image: null } });
  return { id };
}

// ── Starting conversations
export async function openDm(me: Me, otherId: string) {
  if (otherId === me.id) throw new UserError("Pick a colleague to chat with.");
  if (!(await activeStaff([otherId])).length) throw new UserError("That colleague isn’t available.");
  const dmKey = [me.id, otherId].sort().join(":");
  let chat = await db.hrChat.findUnique({ where: { dmKey } });
  if (!chat) {
    try { chat = await db.hrChat.create({ data: { kind: "dm", dmKey, createdById: me.id } }); }
    catch { chat = await db.hrChat.findUnique({ where: { dmKey } }); } // the other person opened it at the same moment
    if (!chat) throw new UserError("Couldn’t start the chat. Try again.");
    await db.hrChatMember.createMany({ data: [{ chatId: chat.id, staffId: me.id }, { chatId: chat.id, staffId: otherId }], skipDuplicates: true });
  }
  return { chatId: chat.id };
}
export async function createGroup(me: Me, nameRaw: unknown, memberIds: unknown) {
  const name = typeof nameRaw === "string" ? nameRaw.trim().slice(0, 60) : "";
  if (!name) throw new UserError("Give the group a name.");
  const ids = [...new Set(Array.isArray(memberIds) ? memberIds.filter((x): x is string => typeof x === "string") : [])].filter((x) => x !== me.id);
  if (!ids.length) throw new UserError("Add at least one colleague.");
  if (ids.length + 1 > MAX_GROUP) throw new UserError(`A group can have up to ${MAX_GROUP} people.`);
  const ok = await activeStaff(ids);
  if (ok.length !== ids.length) throw new UserError("One of the people you picked isn’t available.");
  const chat = await db.hrChat.create({ data: { kind: "group", name, createdById: me.id } });
  await db.hrChatMember.createMany({ data: [me.id, ...ids].map((staffId) => ({ chatId: chat.id, staffId })) });
  return { chatId: chat.id };
}
export async function groupMembers(me: Pick<Me, "id">, chatId: string) {
  await membership(me, chatId);
  const mem = await db.hrChatMember.findMany({ where: { chatId }, select: { staffId: true } });
  const chat = await db.hrChat.findUnique({ where: { id: chatId } });
  const users = await db.staffUser.findMany({ where: { id: { in: mem.map((m) => m.staffId) } }, select: { id: true, name: true, empNo: true } });
  return { owner: chat?.createdById ?? "", people: users.sort((a, b) => a.name.localeCompare(b.name)) };
}
export async function addToGroup(me: Me, chatId: string, memberIds: unknown) {
  const chat = await db.hrChat.findUnique({ where: { id: chatId } });
  if (!chat || chat.kind !== "group" || chat.createdById !== me.id) throw new UserError("Only the person who made the group can add people.");
  const ids = [...new Set(Array.isArray(memberIds) ? memberIds.filter((x): x is string => typeof x === "string") : [])];
  const have = await db.hrChatMember.count({ where: { chatId } });
  if (have + ids.length > MAX_GROUP) throw new UserError(`A group can have up to ${MAX_GROUP} people.`);
  const ok = await activeStaff(ids);
  if (!ok.length) throw new UserError("Pick colleagues to add.");
  // A new member starts at the latest message: they don't see what was said before they joined.
  const top = (await db.hrChatMessage.aggregate({ where: { chatId }, _max: { seq: true } }))._max.seq ?? 0;
  await db.hrChatMember.createMany({ data: ok.map((u) => ({ chatId, staffId: u.id, lastReadSeq: top, fromSeq: top })), skipDuplicates: true });
  return { added: ok.length };
}
export async function leaveGroup(me: Me, chatId: string) {
  const chat = await db.hrChat.findUnique({ where: { id: chatId } });
  if (!chat || chat.kind !== "group") throw new UserError("You can only leave a group.");
  await membership(me, chatId);
  await db.hrChatMember.delete({ where: { chatId_staffId: { chatId, staffId: me.id } } });
  return { left: true };
}

/** A Google Meet call for this conversation. The link is created in the caller's Google Calendar and posted as a message. */
export async function startMeet(me: Me, chatId: string) {
  await membership(me, chatId);
  const mem = await db.hrChatMember.findMany({ where: { chatId, staffId: { not: me.id } }, select: { staffId: true } });
  const guests = await db.staffUser.findMany({ where: { id: { in: mem.map((m) => m.staffId) }, status: "active" }, select: { email: true } });
  const chat = await db.hrChat.findUnique({ where: { id: chatId } });
  const link = await instantMeet(me, chat?.kind === "group" ? chat.name : `${me.first}’s call`, guests.map((g) => g.email));
  return post(me, chatId, "meet", link);
}

// ── Super admin review
/** Who has conversations, for the review screen (super admin only). */
export async function reviewPeople(me: Me) {
  if (me.role !== "admin") throw new UserError("Only the super admin can review conversations.");
  const rows = await db.staffUser.findMany({ where: { kind: "team", role: { not: "partner" } }, select: { id: true, name: true, empNo: true }, orderBy: { name: "asc" } });
  return rows;
}
export async function reviewChats(me: Me, staffId: string) {
  if (me.role !== "admin") throw new UserError("Only the super admin can review conversations.");
  return chatList({ id: staffId });
}
/** Opens one conversation for the super admin. Always audited, and never marks anything read for the people in it. */
export async function reviewMessages(me: Me, staffId: string, chatId: string) {
  if (me.role !== "admin") throw new UserError("Only the super admin can review conversations.");
  const rows = await db.hrChatMessage.findMany({ where: { chatId }, orderBy: { seq: "desc" }, take: 200 });
  const mem = await db.hrChatMember.findMany({ where: { chatId }, select: { staffId: true } });
  const users = await db.staffUser.findMany({ where: { id: { in: mem.map((m) => m.staffId) } }, select: { id: true, name: true, empNo: true } });
  const chat = await db.hrChat.findUnique({ where: { id: chatId } });
  if (!chat || !mem.some((m) => m.staffId === staffId)) throw new UserError("That person isn’t in this conversation.");
  await audit(me, "Chat reviewed", `${chat.kind === "group" ? `group “${chat.name}”` : "direct chat"} · ${users.map((u) => u.empNo).join(", ")} · opened from ${users.find((u) => u.id === staffId)?.empNo ?? staffId}`);
  return { msgs: rows.reverse().map(asMsg), people: users };
}

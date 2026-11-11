import "server-only";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { seal, unseal } from "@/server/vault";
import { audit, type Me } from "./auth";
import { instantMeet } from "./gcal";

// Team Chat. Every message (and picture, and poll) is sealed with HOST_KEY before it is stored, so nothing readable sits in the
// database, in backups or in logs. The people in a conversation read it normally. Nobody else can: not HR, not Finance.
// The one exception is the super admin, who can open a conversation from the review screen; every such opening is
// written to the audit log, and staff are told about it on the chat screen. (This is encryption at rest with an audited
// admin key, not end-to-end encryption: the server must be able to open messages for delivery, review and backup.)
export const MAX_BODY = 4000, MAX_IMAGE_BYTES = 2_000_000, MAX_GROUP = 100, PAGE = 60, RATE_PER_MIN = 40, POLL_MIN = 2, POLL_MAX = 8;
export const REACTIONS = ["👍", "❤️", "😂", "😮", "👏", "🎉"] as const;
export const AVATARS = ["😀", "😎", "🤓", "🥳", "🦊", "🐼", "🦁", "🐯", "🐸", "🦄", "🐙", "🦉", "🚀", "⭐", "🌈", "🍀", "🔥", "💡", "🎯", "🎨", "☕", "🍕", "🎧", "🌻"] as const;

export type PollState = { q: string; multi: boolean; options: { text: string; votes: number; mine: boolean }[]; total: number };
export type ReactionState = { emoji: string; n: number; mine: boolean }[];
export type ChatMsg = {
  id: string; seq: number; chatId: string; senderId: string; kind: "text" | "image" | "meet" | "poll"; body: string; hasImage: boolean; deleted: boolean; at: string;
  reactions: ReactionState; poll: PollState | null;
};
export type ChatRow = {
  id: string; kind: "dm" | "group"; title: string; photo: string | null; avatar: string; withId: string | null; presence: string; sys: boolean; about: string;
  members: number; last: string; lastAt: string; unread: number;
};
export type Presence = Record<string, string>;

type Lite = { id: string; seq: number; chatId: string; senderId: string; kind: string; body: Uint8Array; deletedAt: Date | null; createdAt: Date };
const LITE = { id: true, seq: true, chatId: true, senderId: true, kind: true, body: true, deletedAt: true, createdAt: true } as const; // never the picture bytes

const text = (b: Uint8Array | Buffer) => unseal(b).toString("utf8");
const KINDS = ["text", "image", "meet", "poll"] as const;
type PollDef = { q: string; options: string[]; multi: boolean };
function pollDef(m: Lite): PollDef | null {
  if (m.kind !== "poll" || m.deletedAt) return null;
  try { const j = JSON.parse(text(m.body)) as PollDef; return Array.isArray(j.options) ? j : null; } catch { return null; }
}
const asMsg = (m: Lite): ChatMsg => {
  const kind = (KINDS as readonly string[]).includes(m.kind) ? (m.kind as ChatMsg["kind"]) : "text";
  const def = pollDef(m);
  return { id: m.id, seq: m.seq, chatId: m.chatId, senderId: m.senderId, kind, body: m.deletedAt ? "" : def ? def.q : text(m.body), hasImage: kind === "image" && !m.deletedAt, deleted: !!m.deletedAt, at: m.createdAt.toISOString(), reactions: [], poll: null };
};
const preview = (m: ChatMsg | undefined) => (!m ? "" : m.deleted ? "Message deleted" : m.kind === "image" ? "📷 Photo" : m.kind === "meet" ? "📹 Video call" : m.kind === "poll" ? `📊 ${m.body.slice(0, 70)}` : m.body.slice(0, 80));

/** Adds reactions and poll results for the given messages, as seen by `meId`. */
async function decorate(rows: Lite[], meId: string): Promise<ChatMsg[]> {
  const msgs = rows.map(asMsg);
  if (!msgs.length) return msgs;
  const pollIds = rows.filter((r) => r.kind === "poll" && !r.deletedAt).map((r) => r.id);
  const [rx, votes] = await Promise.all([
    db.hrChatReaction.findMany({ where: { messageId: { in: msgs.map((m) => m.id) } } }),
    pollIds.length ? db.hrChatVote.findMany({ where: { messageId: { in: pollIds } } }) : Promise.resolve([]),
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const m of msgs) {
    if (m.deleted) continue;
    const mine = rx.filter((r) => r.messageId === m.id);
    m.reactions = REACTIONS.map((emoji) => ({ emoji, n: mine.filter((r) => r.emoji === emoji).length, mine: mine.some((r) => r.emoji === emoji && r.staffId === meId) })).filter((r) => r.n > 0);
    const def = pollDef(byId.get(m.id)!);
    if (def) {
      const v = votes.filter((x) => x.messageId === m.id);
      m.poll = { q: def.q, multi: def.multi, total: new Set(v.map((x) => x.staffId)).size, options: def.options.map((t, i) => ({ text: t, votes: v.filter((x) => x.option === i).length, mine: v.some((x) => x.option === i && x.staffId === meId) })) };
    }
  }
  return msgs;
}

async function membership(me: Pick<Me, "id">, chatId: string) {
  const m = await db.hrChatMember.findUnique({ where: { chatId_staffId: { chatId, staffId: me.id } } });
  if (!m) throw new UserError("That conversation isn’t available.");
  return m;
}
const activeStaff = (ids: string[]) => db.staffUser.findMany({ where: { id: { in: ids }, kind: "team", status: "active", role: { not: "partner" }, hr: { isNot: null } }, select: { id: true, name: true, email: true } });
const liveStatus = (presence: string, at: Date | null) => (presence !== "offline" && at && Date.now() - at.getTime() < 5 * 60_000 ? presence : "offline");

/** Who is online right now (active or on a break), by person. */
export async function presenceMap(): Promise<Presence> {
  const rows = await db.hrProfile.findMany({ where: { presence: { not: "offline" }, presenceAt: { gt: new Date(Date.now() - 5 * 60_000) } }, select: { staffId: true, presence: true } });
  return Object.fromEntries(rows.map((r) => [r.staffId, r.presence]));
}

/** Everyone a person can start a chat with. */
export async function chatPeople(me: Me) {
  const rows = await db.staffUser.findMany({
    where: { kind: "team", status: "active", role: { not: "partner" }, hr: { isNot: null }, id: { not: me.id } },
    select: { id: true, name: true, empNo: true, hr: { select: { dept: true, designation: true, photo: true, chatAvatar: true, presence: true, presenceAt: true } } }, orderBy: { name: "asc" },
  });
  return rows.map((u) => ({
    id: u.id, name: u.name, empNo: u.empNo, dept: u.hr?.dept ?? "", designation: u.hr?.designation ?? "", photo: u.hr?.photo ?? null, avatar: u.hr?.chatAvatar ?? "",
    presence: liveStatus(u.hr?.presence ?? "offline", u.hr?.presenceAt ?? null),
  }));
}
export async function myChatProfile(me: Me) {
  const h = await db.hrProfile.findUnique({ where: { staffId: me.id }, select: { photo: true, chatAvatar: true } });
  return { id: me.id, name: me.name, photo: h?.photo ?? null, avatar: h?.chatAvatar ?? "" };
}
export async function setChatAvatar(me: Me, emoji: unknown) {
  const v = typeof emoji === "string" ? emoji : "";
  if (v && !(AVATARS as readonly string[]).includes(v)) throw new UserError("Pick one of the characters shown.");
  await db.hrProfile.update({ where: { staffId: me.id }, data: { chatAvatar: v } });
  return { avatar: v };
}

// ── Company channels: All Hands, one per department and one per live project, kept in step with the team.
let lastSync = 0;
export async function syncChannels(force = false) {
  if (!force && Date.now() - lastSync < 60_000) return;
  lastSync = Date.now();
  const [staff, projects, existing] = await Promise.all([
    db.staffUser.findMany({ where: { kind: "team", status: "active", role: { not: "partner" }, hr: { isNot: null } }, select: { id: true, hr: { select: { dept: true } } } }),
    db.hrProject.findMany({ where: { status: { not: "Done" } }, select: { id: true, name: true, members: true, leadId: true } }),
    db.hrChat.findMany({ where: { sysKey: { not: null } }, select: { id: true, sysKey: true, name: true } }),
  ]);
  const live = new Set(staff.map((s) => s.id));
  const wanted = new Map<string, { name: string; ids: Set<string> }>([["all", { name: "All Hands", ids: new Set(live) }]]);
  for (const d of new Set(staff.map((s) => s.hr?.dept ?? "").filter(Boolean))) {
    const ids = new Set(staff.filter((s) => s.hr?.dept === d).map((s) => s.id));
    if (ids.size >= 2) wanted.set(`dept:${d}`, { name: `${d} Team`, ids });
  }
  for (const p of projects) {
    const ids = new Set([...p.members, ...(p.leadId ? [p.leadId] : [])].filter((x) => live.has(x)));
    if (ids.size >= 2) wanted.set(`project:${p.id}`, { name: `# ${p.name}`, ids });
  }
  for (const [key, w] of wanted) {
    let chat = existing.find((c) => c.sysKey === key);
    if (!chat) {
      try { chat = await db.hrChat.create({ data: { kind: "group", name: w.name, sysKey: key, createdById: "system" }, select: { id: true, sysKey: true, name: true } }); }
      catch { chat = await db.hrChat.findUnique({ where: { sysKey: key }, select: { id: true, sysKey: true, name: true } }) ?? undefined; }
      if (!chat) continue;
    } else if (chat.name !== w.name) await db.hrChat.update({ where: { id: chat.id }, data: { name: w.name } });
    const have = await db.hrChatMember.findMany({ where: { chatId: chat.id }, select: { staffId: true } });
    const haveIds = new Set(have.map((h) => h.staffId));
    const add = [...w.ids].filter((id) => !haveIds.has(id)), drop = have.map((h) => h.staffId).filter((id) => !w.ids.has(id));
    if (add.length) await db.hrChatMember.createMany({ data: add.map((staffId) => ({ chatId: chat!.id, staffId })), skipDuplicates: true });
    if (drop.length) await db.hrChatMember.deleteMany({ where: { chatId: chat.id, staffId: { in: drop } } });
  }
  // A channel that no longer applies (a department down to one person, a finished project) empties out and disappears from lists.
  const stale = existing.filter((c) => c.sysKey && !wanted.has(c.sysKey)).map((c) => c.id);
  if (stale.length) await db.hrChatMember.deleteMany({ where: { chatId: { in: stale } } });
}

/** The person's conversations, newest first, with unread counts. */
export async function chatList(me: Pick<Me, "id">): Promise<ChatRow[]> {
  const mine = await db.hrChatMember.findMany({ where: { staffId: me.id }, select: { chatId: true, fromSeq: true } });
  if (!mine.length) return [];
  const from = new Map(mine.map((m) => [m.chatId, m.fromSeq]));
  const ids = mine.map((m) => m.chatId);
  const [chats, members, lasts, unread] = await Promise.all([
    db.hrChat.findMany({ where: { id: { in: ids } }, orderBy: { lastAt: "desc" } }),
    db.hrChatMember.findMany({ where: { chatId: { in: ids } }, select: { chatId: true, staffId: true } }),
    db.hrChatMessage.findMany({ where: { chatId: { in: ids } }, distinct: ["chatId"], orderBy: [{ chatId: "asc" }, { seq: "desc" }], select: LITE }),
    db.$queryRaw<{ chatId: string; n: bigint }[]>`
      SELECT m."chatId", count(*) AS n FROM "HrChatMessage" m JOIN "HrChatMember" c ON c."chatId" = m."chatId" AND c."staffId" = ${me.id}
      WHERE m.seq > c."lastReadSeq" AND m."senderId" <> ${me.id} AND m."deletedAt" IS NULL GROUP BY m."chatId"`,
  ]);
  const others = [...new Set(members.filter((m) => m.staffId !== me.id).map((m) => m.staffId))];
  const people = new Map((await db.staffUser.findMany({ where: { id: { in: others } }, select: { id: true, name: true, hr: { select: { photo: true, chatAvatar: true, presence: true, presenceAt: true } } } })).map((u) => [u.id, u]));
  const lastOf = new Map(lasts.filter((m) => m.seq > (from.get(m.chatId) ?? 0)).map((m) => [m.chatId, asMsg(m)]));
  const unreadOf = new Map(unread.map((u) => [u.chatId, Number(u.n)]));
  return chats.map((c) => {
    const withId = c.kind === "dm" ? members.find((m) => m.chatId === c.id && m.staffId !== me.id)?.staffId ?? null : null;
    const p = withId ? people.get(withId) : undefined, last = lastOf.get(c.id);
    return {
      id: c.id, kind: c.kind === "dm" ? "dm" : "group", title: c.kind === "dm" ? p?.name ?? "Former colleague" : c.name, photo: c.kind === "dm" ? p?.hr?.photo ?? null : c.photo, avatar: p?.hr?.chatAvatar ?? "",
      withId, presence: p ? liveStatus(p.hr?.presence ?? "offline", p.hr?.presenceAt ?? null) : "offline", sys: !!c.sysKey, about: c.about,
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

/**
 * Messages of one conversation: the latest page, or everything after `after`. Opening it marks it read.
 * With `full`, it also returns the current reactions, poll results and deletions of the latest page, and who is online,
 * so the screen can catch up on changes to messages it already has.
 */
export async function chatMessages(me: Pick<Me, "id">, chatId: string, after: number | null, markRead: boolean, full = false) {
  const mem = await membership(me, chatId);
  const rows = after === null
    ? (await db.hrChatMessage.findMany({ where: { chatId, seq: { gt: mem.fromSeq } }, orderBy: { seq: "desc" }, take: PAGE, select: LITE })).reverse()
    : await db.hrChatMessage.findMany({ where: { chatId, seq: { gt: Math.max(after, mem.fromSeq) } }, orderBy: { seq: "asc" }, take: 100, select: LITE });
  const msgs = await decorate(rows, me.id);
  const top = msgs.length ? msgs[msgs.length - 1].seq : 0;
  if (markRead && top > mem.lastReadSeq) await db.hrChatMember.update({ where: { chatId_staffId: { chatId, staffId: me.id } }, data: { lastReadSeq: top } });
  const [others, typing] = await Promise.all([
    db.hrChatMember.findMany({ where: { chatId, staffId: { not: me.id } }, select: { lastReadSeq: true } }),
    db.hrChatMember.findMany({ where: { chatId, staffId: { not: me.id }, typingAt: { gt: new Date(Date.now() - 4000) } }, select: { staffId: true } }),
  ]);
  let refresh: ChatMsg[] | null = null, presence: Presence | null = null;
  if (full) {
    const win = after === null ? rows : (await db.hrChatMessage.findMany({ where: { chatId, seq: { gt: mem.fromSeq } }, orderBy: { seq: "desc" }, take: PAGE, select: LITE }));
    [refresh, presence] = await Promise.all([decorate(win, me.id), presenceMap()]);
  }
  return { msgs, readUpTo: others.length ? Math.min(...others.map((o) => o.lastReadSeq)) : 0, typing: typing.map((t) => t.staffId), refresh, presence };
}
export async function setTyping(me: Pick<Me, "id">, chatId: string) {
  await membership(me, chatId);
  await db.hrChatMember.update({ where: { chatId_staffId: { chatId, staffId: me.id } }, data: { typingAt: new Date() } });
  return { ok: true };
}

async function throttle(staffId: string) {
  const n = await db.hrChatMessage.count({ where: { senderId: staffId, createdAt: { gt: new Date(Date.now() - 60_000) } } });
  if (n >= RATE_PER_MIN) throw new UserError("You’re sending messages very quickly. Wait a moment.");
}
async function post(me: Pick<Me, "id">, chatId: string, kind: "text" | "image" | "meet" | "poll", body: string, image?: Buffer) {
  await membership(me, chatId);
  await throttle(me.id);
  const m = await db.hrChatMessage.create({ data: { chatId, senderId: me.id, kind, body: new Uint8Array(seal(body)), image: image ? new Uint8Array(seal(image)) : null }, select: LITE });
  await db.hrChat.update({ where: { id: chatId }, data: { lastAt: m.createdAt } });
  await db.hrChatMember.update({ where: { chatId_staffId: { chatId, staffId: me.id } }, data: { lastReadSeq: m.seq, typingAt: null } });
  return (await decorate([m], me.id))[0];
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
  await Promise.all([db.hrChatReaction.deleteMany({ where: { messageId: id } }), db.hrChatVote.deleteMany({ where: { messageId: id } })]);
  return { id };
}

// ── Reactions and polls
export async function react(me: Me, messageId: string, emoji: unknown) {
  if (typeof emoji !== "string" || !(REACTIONS as readonly string[]).includes(emoji)) throw new UserError("Pick one of the reactions shown.");
  const m = await db.hrChatMessage.findUnique({ where: { id: messageId }, select: { chatId: true, deletedAt: true } });
  if (!m || m.deletedAt) throw new UserError("That message isn’t available.");
  await membership(me, m.chatId);
  const key = { messageId_staffId_emoji: { messageId, staffId: me.id, emoji } };
  if (await db.hrChatReaction.findUnique({ where: key })) await db.hrChatReaction.delete({ where: key });
  else await db.hrChatReaction.create({ data: { messageId, staffId: me.id, emoji } });
  const rx = await db.hrChatReaction.findMany({ where: { messageId } });
  return { id: messageId, reactions: REACTIONS.map((e) => ({ emoji: e, n: rx.filter((r) => r.emoji === e).length, mine: rx.some((r) => r.emoji === e && r.staffId === me.id) })).filter((r) => r.n > 0) };
}
export async function sendPoll(me: Me, chatId: string, qRaw: unknown, optionsRaw: unknown, multi: unknown) {
  const q = typeof qRaw === "string" ? qRaw.trim() : "";
  if (!q) throw new UserError("Write the poll question.");
  if (q.length > 200) throw new UserError("The question can be up to 200 characters.");
  const options = [...new Set((Array.isArray(optionsRaw) ? optionsRaw : []).filter((o): o is string => typeof o === "string").map((o) => o.trim()).filter(Boolean))];
  if (options.length < POLL_MIN) throw new UserError(`Give at least ${POLL_MIN} different options.`);
  if (options.length > POLL_MAX) throw new UserError(`A poll can have up to ${POLL_MAX} options.`);
  if (options.some((o) => o.length > 100)) throw new UserError("Each option can be up to 100 characters.");
  return post(me, chatId, "poll", JSON.stringify({ q, options, multi: multi === true } satisfies PollDef));
}
export async function vote(me: Me, messageId: string, option: unknown) {
  const m = await db.hrChatMessage.findUnique({ where: { id: messageId }, select: LITE });
  const def = m ? pollDef(m) : null;
  if (!m || !def) throw new UserError("That poll isn’t available.");
  await membership(me, m.chatId);
  if (typeof option !== "number" || !Number.isInteger(option) || option < 0 || option >= def.options.length) throw new UserError("Pick one of the options.");
  const mine = await db.hrChatVote.findMany({ where: { messageId, staffId: me.id } });
  const had = mine.some((v) => v.option === option);
  if (!def.multi) await db.hrChatVote.deleteMany({ where: { messageId, staffId: me.id } });
  else if (had) await db.hrChatVote.deleteMany({ where: { messageId, staffId: me.id, option } });
  if (!def.multi ? !had : !had) await db.hrChatVote.create({ data: { messageId, staffId: me.id, option } });
  return { id: messageId, poll: (await decorate([m], me.id))[0].poll! };
}

// ── Starting conversations and groups
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
/** Group details for the info window: about, photo, who may edit, and every member with their status. */
export async function groupInfo(me: Me, chatId: string) {
  await membership(me, chatId);
  const chat = await db.hrChat.findUnique({ where: { id: chatId } });
  if (!chat || chat.kind !== "group") throw new UserError("That isn’t a group.");
  const mem = await db.hrChatMember.findMany({ where: { chatId }, select: { staffId: true } });
  const users = await db.staffUser.findMany({ where: { id: { in: mem.map((m) => m.staffId) } }, select: { id: true, name: true, empNo: true, hr: { select: { designation: true, photo: true, chatAvatar: true, presence: true, presenceAt: true } } } });
  return {
    id: chat.id, name: chat.name, about: chat.about, photo: chat.photo, sys: !!chat.sysKey, owner: chat.createdById,
    canEdit: chat.createdById === me.id || (!!chat.sysKey && me.role === "admin"), canAdd: chat.createdById === me.id && !chat.sysKey,
    members: users.sort((a, b) => a.name.localeCompare(b.name)).map((u) => ({
      id: u.id, name: u.name, empNo: u.empNo, designation: u.hr?.designation ?? "", photo: u.hr?.photo ?? null, avatar: u.hr?.chatAvatar ?? "",
      presence: liveStatus(u.hr?.presence ?? "offline", u.hr?.presenceAt ?? null), you: u.id === me.id,
    })),
  };
}
export async function updateGroup(me: Me, chatId: string, input: { about?: unknown; photo?: unknown }) {
  const chat = await db.hrChat.findUnique({ where: { id: chatId } });
  if (!chat || chat.kind !== "group") throw new UserError("That isn’t a group.");
  await membership(me, chatId);
  if (!(chat.createdById === me.id || (chat.sysKey && me.role === "admin"))) throw new UserError("Only the person who made the group can change it.");
  const data: { about?: string; photo?: string | null } = {};
  if (input.about !== undefined) {
    const a = typeof input.about === "string" ? input.about.trim() : "";
    if (a.length > 300) throw new UserError("The description can be up to 300 characters.");
    data.about = a;
  }
  if (input.photo !== undefined) {
    if (input.photo === null) data.photo = null;
    else if (typeof input.photo === "string" && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(input.photo) && input.photo.length <= 150_000) data.photo = input.photo;
    else throw new UserError("Choose a JPG or PNG picture. It is resized to a small square first.");
  }
  await db.hrChat.update({ where: { id: chatId }, data });
  return groupInfo(me, chatId);
}
export async function addToGroup(me: Me, chatId: string, memberIds: unknown) {
  const chat = await db.hrChat.findUnique({ where: { id: chatId } });
  if (chat?.sysKey) throw new UserError("This channel’s members follow the team automatically.");
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
  if (chat.sysKey) throw new UserError("You can’t leave a company channel. Your team membership decides it.");
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
  const rows = await db.hrChatMessage.findMany({ where: { chatId }, orderBy: { seq: "desc" }, take: 200, select: LITE });
  const mem = await db.hrChatMember.findMany({ where: { chatId }, select: { staffId: true } });
  const users = await db.staffUser.findMany({ where: { id: { in: mem.map((m) => m.staffId) } }, select: { id: true, name: true, empNo: true } });
  const chat = await db.hrChat.findUnique({ where: { id: chatId } });
  if (!chat || !mem.some((m) => m.staffId === staffId)) throw new UserError("That person isn’t in this conversation.");
  await audit(me, "Chat reviewed", `${chat.kind === "group" ? `group “${chat.name}”` : "direct chat"} · ${users.map((u) => u.empNo).join(", ")} · opened from ${users.find((u) => u.id === staffId)?.empNo ?? staffId}`);
  return { msgs: rows.reverse().map(asMsg), people: users };
}

"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChatMsg, ChatRow, PollState, Presence } from "@/staff/hrms/chat";
import type { Data } from "@/staff/hrms/screens";
import {
  chatAddMembers, chatCreateGroup, chatDelete, chatGroupInfo, chatLeave, chatMeet, chatOpenDm, chatPoll, chatReact, chatReviewOpen, chatSend, chatSendImage, chatSetAvatar,
  chatTyping, chatUpdateGroup, chatVote,
} from "../actions";
import { Card, Empty, Field, Modal, Tabs, btnCls, cx, dayLong, inputCls, primaryCls, timeLabel, useRun } from "./kit";

type D = Data<"chat">;
type Person = D["people"][number];
type Poll = { chats: ChatRow[]; unread: number; presence: Presence | null; thread: { msgs: ChatMsg[]; readUpTo: number; typing: string[]; refresh: ChatMsg[] | null } | null };
type Info = Awaited<ReturnType<typeof chatGroupInfo>> extends infer R ? (R extends { ok: true; data: infer T } ? T : never) : never;

const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const shortTime = (iso: string) => {
  const d = new Date(iso), now = new Date();
  return dayKey(iso) === dayKey(now.toISOString()) ? timeLabel(iso) : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
};
const dot = (p: string | undefined) => (p === "active" ? "#14B8A6" : p === "break" ? "#F59E0B" : "#94A3B8");
const statusText = (p: string | undefined) => (p === "active" ? "Online" : p === "break" ? "On a break" : "Offline");
const initialsOf = (n: string) => n.split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase();

/** Shrinks a picture in the browser so a phone photo is a few hundred KB, not several MB. */
async function shrink(file: File, max = 1280, square = false): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Only JPEG, PNG or WebP pictures can be used.");
  const bmp = await createImageBitmap(file);
  const c = document.createElement("canvas"), ctx = c.getContext("2d")!;
  if (square) {
    const side = Math.min(bmp.width, bmp.height); c.width = c.height = Math.min(max, side);
    ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, c.width, c.height);
  } else {
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height)); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
  }
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.8));
  if (!blob) throw new Error("Couldn’t read that picture.");
  return new File([blob], "photo.jpg", { type: "image/jpeg" });
}
const toDataUrl = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error("Couldn’t read that picture.")); r.readAsDataURL(f); });

/** Links in a message become clickable (https only). Everything else stays plain text. */
function Linked({ text }: { text: string }) {
  const parts = text.split(/(https:\/\/[^\s<]+)/g);
  return <>{parts.map((p, i) => (i % 2 ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="underline break-all">{p}</a> : <span key={i}>{p}</span>))}</>;
}

/** A person's picture: their chosen character, else their profile photo, else initials. `status` adds the online dot. */
function Face({ name, photo, avatar, size = 34, status, square }: { name: string; photo?: string | null; avatar?: string; size?: number; status?: string; square?: boolean }) {
  const r = square ? "rounded-[10px]" : "rounded-full";
  return (
    <span className="relative inline-flex flex-none" style={{ width: size, height: size }}>
      {avatar ? <span className={cx(r, "bg-[#EEF2FF] flex items-center justify-center")} style={{ width: size, height: size, fontSize: size * 0.55 }} aria-hidden>{avatar}</span>
        : photo
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={photo} alt="" className={cx(r, "object-cover")} style={{ width: size, height: size }} />
          : <span className={cx(r, "bg-[#D6F3EF] text-[#0B5E5B] font-bold flex items-center justify-center")} style={{ width: size, height: size, fontSize: size * 0.36 }}>{initialsOf(name)}</span>}
      {status !== undefined ? <span className="absolute right-0 bottom-0 rounded-full border-2 border-white" style={{ width: Math.max(9, size * 0.3), height: Math.max(9, size * 0.3), background: dot(status) }} /> : null}
    </span>
  );
}

function PollCard({ poll, onVote }: { poll: PollState; onVote: (i: number) => void }) {
  return (
    <div className="flex flex-col gap-1.5 min-w-[230px]">
      <div className="font-bold text-[13.5px]">📊 {poll.q}</div>
      <div className="text-[11px] text-[#64748B]">{poll.multi ? "Select one or more" : "Select one"} · {poll.total} vote{poll.total === 1 ? "" : "s"}</div>
      {poll.options.map((o, i) => {
        const pct = poll.total ? Math.round((o.votes / poll.total) * 100) : 0;
        return (
          <button key={i} onClick={() => onVote(i)} aria-pressed={o.mine} className={cx("relative overflow-hidden text-left rounded-lg border px-2.5 py-1.5 cursor-pointer bg-white", o.mine ? "border-[#0B5E5B]" : "border-[#CDD2D7]")}>
            <span className="absolute inset-y-0 left-0 bg-[#D6F3EF]" style={{ width: `${pct}%` }} />
            <span className="relative flex items-center gap-2 text-[12.5px]"><span aria-hidden>{o.mine ? "●" : "○"}</span><span className="flex-1">{o.text}</span><span className="font-semibold">{o.votes}</span></span>
          </button>
        );
      })}
    </div>
  );
}

function Bubble({ m, mine, sender, face, read, group, reactions, onReact, onDelete, onVote, onOpenImage, onCopy }: {
  m: ChatMsg; mine: boolean; sender: string; face: { photo?: string | null; avatar?: string }; read: boolean; group: boolean; reactions: readonly string[];
  onReact: (e: string) => void; onDelete: () => void; onVote: (i: number) => void; onOpenImage: () => void; onCopy: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const tick = mine && !m.deleted ? <span className={cx("ml-1 text-[11px]", read ? "text-[#2563EB]" : "text-[#94A3B8]")} aria-label={read ? "Read" : "Sent"}>{read ? "✓✓" : "✓"}</span> : null;
  return (
    <div className={cx("flex gap-2 group items-end", mine ? "flex-row-reverse" : "")}>
      <Face name={sender} photo={face.photo} avatar={face.avatar} size={28} />
      <div className={cx("max-w-[78%] flex flex-col", mine ? "items-end" : "items-start")}>
        <div className={cx("rounded-2xl px-3 py-2 text-[13.5px] leading-snug shadow-sm relative", mine ? "bg-[#D6F3EF] rounded-br-md" : "bg-white border border-[#E2E8F0] rounded-bl-md")}>
          {group && !mine ? <div className="text-[11.5px] font-bold text-[#0B5E5B] mb-0.5">{sender}</div> : null}
          {m.deleted ? <span className="italic text-[#64748B]">This message was deleted</span>
            : m.kind === "meet" ? (
              <div className="flex flex-col gap-1.5">
                <span className="font-semibold">📹 Video call</span>
                <a href={m.body} target="_blank" rel="noopener noreferrer" className="bg-[#0B5E5B] text-white rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-center no-underline">Join Google Meet</a>
                <button onClick={onCopy} className="bg-transparent border-0 cursor-pointer text-[11.5px] text-[#0B5E5B] underline text-left">🔗 Copy meeting link</button>
              </div>
            ) : m.kind === "poll" && m.poll ? <PollCard poll={m.poll} onVote={onVote} /> : (
              <>
                {m.hasImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <button onClick={onOpenImage} aria-label="Open picture" className="block bg-transparent border-0 p-0 cursor-zoom-in"><img src={`/staff/hrms/chat/img/${m.id}`} alt="Photo in chat" className="rounded-lg max-h-[280px] mb-1" loading="lazy" /></button>
                ) : null}
                {m.body ? <div className="whitespace-pre-wrap break-words"><Linked text={m.body} /></div> : null}
              </>
            )}
          <div className="flex items-center justify-end gap-1.5 mt-0.5 text-[10.5px] text-[#64748B]">
            {!m.deleted ? <button onClick={() => setMenu((o) => !o)} aria-label="React" className="opacity-0 group-hover:opacity-100 focus:opacity-100 bg-transparent border-0 cursor-pointer text-[12px]">😊</button> : null}
            {mine && !m.deleted ? <button onClick={onDelete} className="opacity-0 group-hover:opacity-100 focus:opacity-100 bg-transparent border-0 cursor-pointer text-[#B3261E] text-[10.5px]">Delete</button> : null}
            {timeLabel(m.at)}{tick}
          </div>
        </div>
        {menu ? <div className="flex gap-1 bg-white border border-[#E2E8F0] rounded-full px-2 py-1 shadow-md mt-1" role="menu">{reactions.map((e) => <button key={e} role="menuitem" onClick={() => { setMenu(false); onReact(e); }} className="bg-transparent border-0 cursor-pointer text-[16px] hover:scale-125 transition-transform">{e}</button>)}</div> : null}
        {m.reactions.length ? <div className="flex gap-1 mt-1 flex-wrap">{m.reactions.map((r) => <button key={r.emoji} onClick={() => onReact(r.emoji)} aria-pressed={r.mine} className={cx("text-[11px] font-semibold px-2 py-0.5 rounded-full border cursor-pointer", r.mine ? "bg-[#D6F3EF] border-[#0B5E5B] text-[#0B5E5B]" : "bg-white border-[#E2E8F0]")}>{r.emoji} {r.n}</button>)}</div> : null}
      </div>
    </div>
  );
}

export function ChatScreen({ d }: { d: D }) {
  const router = useRouter();
  const { run, toast } = useRun();
  const [chats, setChats] = useState<ChatRow[]>(d.chats);
  const [active, setActive] = useState<string>(d.chats.some((c) => c.id === d.open) ? d.open : "");
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [readUpTo, setReadUpTo] = useState(0), [typing, setTyping] = useState<string[]>([]);
  const [pres, setPres] = useState<Presence>(() => Object.fromEntries(d.people.filter((p) => p.presence !== "offline").map((p) => [p.id, p.presence])));
  const [draft, setDraft] = useState(""), [sending, setSending] = useState(false), [q, setQ] = useState("");
  const [find, setFind] = useState(""), [findOpen, setFindOpen] = useState(false);
  const [modal, setModal] = useState<"" | "new" | "info" | "poll" | "avatar">(""), [showList, setShowList] = useState(!d.open);
  const [viewer, setViewer] = useState<string | null>(null), [incoming, setIncoming] = useState<ChatMsg | null>(null), [avatar, setAvatar] = useState(d.me.avatar);
  const log = useRef<HTMLDivElement>(null), file = useRef<HTMLInputElement>(null), top = useRef(0), pinned = useRef(true), activeRef = useRef(active), tickN = useRef(0), lastTyped = useRef(0), first = useRef(true);
  activeRef.current = active;
  const byId = useMemo(() => new Map<string, { name: string; photo: string | null; avatar: string }>([...d.people.map((p) => [p.id, { name: p.name, photo: p.photo, avatar: p.avatar }] as const), [d.me.id, { name: d.me.name, photo: d.me.photo, avatar }]]), [d.people, d.me, avatar]);
  const chat = chats.find((c) => c.id === active);
  const online = Object.keys(pres).filter((id) => id !== d.me.id).length;

  const apply = useCallback((p: Poll, chatId: string, reset: boolean) => {
    setChats(p.chats);
    if (p.presence) setPres(p.presence);
    if (!p.thread || chatId !== activeRef.current) return;
    const { msgs: add, refresh } = p.thread;
    // A Meet call started by someone else in the last two minutes rings as a banner.
    if (!reset && !first.current) { const call = add.find((m) => m.kind === "meet" && m.senderId !== d.me.id && Date.now() - new Date(m.at).getTime() < 120_000); if (call) setIncoming(call); }
    first.current = false;
    setMsgs((cur) => {
      const base = reset ? [] : cur, seen = new Set(base.map((m) => m.id));
      const merged = [...base, ...add.filter((m) => !seen.has(m.id))];
      const fresh = new Map((refresh ?? []).map((m) => [m.id, m]));
      const out = merged.map((m) => { const r = fresh.get(m.id); return r ? { ...m, reactions: r.reactions, poll: r.poll, deleted: r.deleted, body: r.deleted ? "" : m.body, hasImage: r.deleted ? false : m.hasImage } : m; });
      top.current = out.length ? out[out.length - 1].seq : 0;
      return out;
    });
    setReadUpTo(p.thread.readUpTo); setTyping(p.thread.typing);
  }, [d.me.id]);

  const poll = useCallback(async (reset = false, forceFull = false) => {
    const id = activeRef.current;
    tickN.current += 1;
    const u = new URLSearchParams({ open: document.visibilityState === "visible" ? "1" : "0" });
    if (forceFull || reset || tickN.current % 4 === 0) u.set("full", "1");
    if (id) { u.set("chat", id); if (!reset && top.current) u.set("after", String(top.current)); }
    try {
      const r = await fetch(`/staff/hrms/chat/poll?${u}`, { cache: "no-store" });
      if (r.status === 401) { router.refresh(); return; }
      if (r.ok) apply((await r.json()) as Poll, id, reset || !top.current);
    } catch { /* offline: the next tick tries again */ }
  }, [apply, router]);

  // Live updates: a short poll while the tab is in view, a slower one in the background.
  useEffect(() => {
    let stop = false, t: ReturnType<typeof setTimeout>;
    const tick = async () => { await poll(); if (!stop) t = setTimeout(tick, document.visibilityState === "visible" ? 2500 : 15000); };
    t = setTimeout(tick, 2500);
    const onVis = () => { if (document.visibilityState === "visible") { clearTimeout(t); void tick(); } };
    document.addEventListener("visibilitychange", onVis);
    return () => { stop = true; clearTimeout(t); document.removeEventListener("visibilitychange", onVis); };
  }, [poll]);
  // Opening a conversation loads it fresh.
  useEffect(() => { top.current = 0; setMsgs([]); setTyping([]); setFind(""); setFindOpen(false); pinned.current = true; first.current = true; if (active) void poll(true); }, [active, poll]);
  useEffect(() => { const el = log.current; if (el && pinned.current) el.scrollTop = el.scrollHeight; }, [msgs, typing]);

  const pick = (id: string) => { setActive(id); setShowList(false); window.history.replaceState(null, "", `/staff/hrms/chat?c=${id}`); };
  const afterSend = (m: ChatMsg) => { pinned.current = true; setMsgs((c) => (c.some((x) => x.id === m.id) ? c : [...c, m])); top.current = Math.max(top.current, m.seq); void poll(false, true); };
  const send = async () => {
    const body = draft.trim();
    if (!body || !active || sending) return;
    setSending(true);
    const r = await chatSend(active, body);
    setSending(false);
    if (!r.ok) { toast(r.error, "red"); return; }
    setDraft(""); afterSend(r.data);
  };
  const sendPicture = async (f: File | undefined) => {
    if (!f || !active) return;
    setSending(true);
    try {
      const small = await shrink(f), form = new FormData();
      form.set("image", small);
      const r = await chatSendImage(active, form);
      if (!r.ok) toast(r.error, "red"); else afterSend(r.data);
    } catch (e) { toast(e instanceof Error ? e.message : "Couldn’t send the picture.", "red"); }
    setSending(false);
    if (file.current) file.current.value = "";
  };
  const meet = async () => {
    if (!active) return;
    setSending(true);
    const r = await chatMeet(active);
    setSending(false);
    if (!r.ok) { toast(r.error, "red"); return; }
    afterSend(r.data); window.open(r.data.body, "_blank", "noopener,noreferrer");
  };
  const copy = (link: string) => { void navigator.clipboard?.writeText(link).then(() => toast("Meeting link copied.", "green"), () => toast("Couldn’t copy the link.", "red")); };
  const patch = (id: string, f: (m: ChatMsg) => ChatMsg) => setMsgs((c) => c.map((m) => (m.id === id ? f(m) : m)));
  const react = async (id: string, e: string) => { const r = await chatReact(id, e); if (!r.ok) toast(r.error, "red"); else patch(id, (m) => ({ ...m, reactions: r.data.reactions })); };
  const vote = async (id: string, i: number) => { const r = await chatVote(id, i); if (!r.ok) toast(r.error, "red"); else patch(id, (m) => ({ ...m, poll: r.data.poll })); };
  const del = (id: string) => run(() => chatDelete(id), () => { patch(id, (m) => ({ ...m, deleted: true, body: "", hasImage: false, poll: null, reactions: [] })); });
  const startDm = async (id: string) => {
    const r = await chatOpenDm(id);
    if (!r.ok) { toast(r.error, "red"); return; }
    setModal(""); await poll(false, true); pick(r.data.chatId);
  };
  const onType = (v: string) => { setDraft(v); if (active && Date.now() - lastTyped.current > 2500) { lastTyped.current = Date.now(); void chatTyping(active); } };

  const match = (c: ChatRow) => c.title.toLowerCase().includes(q.trim().toLowerCase());
  const channels = chats.filter((c) => c.kind === "group" && match(c)), dms = chats.filter((c) => c.kind === "dm" && match(c));
  const shown = find.trim() ? msgs.filter((m) => m.body.toLowerCase().includes(find.trim().toLowerCase())) : msgs;
  const typingNames = typing.map((id) => byId.get(id)?.name.split(" ")[0]).filter(Boolean) as string[];
  const row = (c: ChatRow) => (
    <button key={c.id} role="listitem" onClick={() => pick(c.id)} className={cx("w-full text-left flex gap-2.5 px-3 py-2.5 border-0 border-b border-[#F1F5F9] cursor-pointer items-center", c.id === active ? "bg-[#F0FDFA]" : "bg-white hover:bg-[#F8FAFC]")}>
      <Face name={c.title} photo={c.photo} avatar={c.kind === "dm" ? c.avatar : ""} size={38} square={c.kind === "group"} status={c.kind === "dm" ? (pres[c.withId ?? ""] ?? "offline") : undefined} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2"><span className="font-semibold text-[13.5px] truncate">{c.title}</span><span className="ml-auto text-[10.5px] text-[#64748B] flex-none">{shortTime(c.lastAt)}</span></span>
        <span className="flex items-center gap-2"><span className="text-[12px] text-[#64748B] truncate">{c.last || (c.about || "No messages yet")}</span>
          {c.unread ? <span className="ml-auto flex-none bg-[#0B5E5B] text-white text-[10.5px] font-bold rounded-full min-w-[18px] h-[18px] px-1.5 flex items-center justify-center">{c.unread}</span> : null}</span>
      </span>
    </button>
  );
  const sub = !chat ? "" : chat.kind === "group" ? `${chat.members} members${chat.sys ? " · company channel" : ""}` : statusText(pres[chat.withId ?? ""]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-[#64748B]">Messages are encrypted and kept private to the people in each conversation. Only the super admin can open a conversation for review, and every review is recorded in the audit log.</p>
      {incoming ? (
        <div role="alert" className="flex items-center gap-3 bg-[#0B5E5B] text-white rounded-xl px-4 py-3">
          <span className="text-[20px]" aria-hidden>📞</span>
          <div className="flex-1"><div className="text-[12px] opacity-80">Incoming video call</div><div className="font-bold text-[14px]">{byId.get(incoming.senderId)?.name ?? "A colleague"}</div></div>
          <a href={incoming.body} target="_blank" rel="noopener noreferrer" onClick={() => setIncoming(null)} className="bg-white text-[#0B5E5B] rounded-lg px-3 py-1.5 text-[13px] font-bold no-underline">Join</a>
          <button onClick={() => setIncoming(null)} className="bg-white/15 text-white border-0 rounded-lg px-3 py-1.5 text-[13px] cursor-pointer">Decline</button>
        </div>
      ) : null}
      <div className="grid bg-white border border-[#E2E8F0] rounded-[14px] overflow-hidden min-h-[560px] h-[calc(100vh-210px)] grid-cols-1 min-[860px]:grid-cols-[320px_1fr]">
        <div className={cx("border-r border-[#E2E8F0] flex-col min-h-0", showList || !active ? "flex" : "hidden min-[860px]:flex")}>
          <div className="p-3 flex flex-col gap-2">
            <div className="flex items-center gap-2"><span className="font-bold text-[14px]">Team chat</span><span className="text-[11px] text-[#0B5E5B] bg-[#D6F3EF] rounded-full px-2 py-0.5 font-semibold">● Live · {online + 1} online</span>
              <button className="ml-auto bg-transparent border-0 cursor-pointer" aria-label="My chat avatar" title="My chat avatar" onClick={() => setModal("avatar")}><Face name={d.me.name} photo={d.me.photo} avatar={avatar} size={28} /></button></div>
            <div className="flex gap-2"><input className={inputCls} placeholder="Search chats" aria-label="Search chats" value={q} onChange={(e) => setQ(e.target.value)} /><button className={primaryCls} onClick={() => setModal("new")}>+ New</button></div>
          </div>
          <div className="overflow-y-auto flex-1" role="list">
            {channels.length ? <div className="px-3 pt-2 pb-1 text-[10.5px] font-bold tracking-[.1em] text-[#94A3B8]">CHANNELS</div> : null}
            {channels.map(row)}
            {dms.length ? <div className="px-3 pt-3 pb-1 text-[10.5px] font-bold tracking-[.1em] text-[#94A3B8]">DIRECT MESSAGES</div> : null}
            {dms.map(row)}
            {!channels.length && !dms.length ? <Empty>{chats.length ? "No chats match." : "No chats yet. Press + New to message a colleague."}</Empty> : null}
          </div>
        </div>

        <div className={cx("flex-col min-h-0 bg-[#F8FAFC]", !showList && active ? "flex" : "hidden min-[860px]:flex")}>
          {chat ? (
            <>
              <div className="bg-white border-b border-[#E2E8F0] px-3 py-2.5 flex items-center gap-2.5">
                <button className="min-[860px]:hidden bg-transparent border-0 cursor-pointer text-[18px]" aria-label="Back to chats" onClick={() => setShowList(true)}>←</button>
                <button className="flex items-center gap-2.5 bg-transparent border-0 p-0 cursor-pointer text-left min-w-0 mr-auto" onClick={() => chat.kind === "group" && setModal("info")} aria-label={chat.kind === "group" ? "Group info" : chat.title}>
                  <Face name={chat.title} photo={chat.photo} avatar={chat.kind === "dm" ? chat.avatar : ""} size={36} square={chat.kind === "group"} status={chat.kind === "dm" ? (pres[chat.withId ?? ""] ?? "offline") : undefined} />
                  <span className="min-w-0"><span className="block font-bold text-[14px] truncate">{chat.title}</span><span className="block text-[11.5px] text-[#64748B] truncate">{typingNames.length ? <span className="text-[#0B5E5B]">{typingNames.join(", ")} typing…</span> : sub}</span></span>
                </button>
                <button className={btnCls} onClick={() => { setFindOpen((o) => !o); setFind(""); }} aria-label="Search in this chat" aria-pressed={findOpen}>🔍</button>
                <button className={btnCls} onClick={() => setModal("poll")} aria-label="Create a poll">📊 Poll</button>
                <button className={btnCls} onClick={() => void meet()} disabled={sending} title={d.google ? "Start a Google Meet call" : "Connect Google Calendar first"}>📹 Meet</button>
                {chat.kind === "group" ? <button className={btnCls} onClick={() => setModal("info")}>Info</button> : null}
              </div>
              {findOpen ? <div className="bg-white border-b border-[#E2E8F0] px-3 py-2"><input className={inputCls} autoFocus placeholder="Search in this chat" aria-label="Search in this chat" value={find} onChange={(e) => setFind(e.target.value)} /></div> : null}
              <div ref={log} onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2" aria-live="polite">
                {shown.length ? shown.map((m, i) => {
                  const who = byId.get(m.senderId);
                  return (
                    <div key={m.id} className="flex flex-col gap-1.5">
                      {i === 0 || dayKey(shown[i - 1].at) !== dayKey(m.at) ? <div className="self-center text-[11px] bg-[#E2E8F0] text-[#475569] rounded-full px-3 py-0.5 my-1">{dayLong(m.at)}</div> : null}
                      <Bubble m={m} mine={m.senderId === d.me.id} sender={who?.name ?? "Colleague"} face={who ?? {}} read={m.seq <= readUpTo} group={chat.kind === "group"} reactions={d.reactions}
                        onReact={(e) => void react(m.id, e)} onDelete={() => del(m.id)} onVote={(o) => void vote(m.id, o)} onOpenImage={() => setViewer(m.id)} onCopy={() => copy(m.body)} />
                    </div>
                  );
                }) : <Empty>{find ? "No messages match your search." : "Say hello 👋"}</Empty>}
                {typingNames.length ? <div className="text-[12px] text-[#64748B] italic">{typingNames.join(", ")} {typingNames.length > 1 ? "are" : "is"} typing…</div> : null}
              </div>
              <div className="bg-white border-t border-[#E2E8F0] p-2.5 flex gap-2 items-end">
                <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="Choose a picture" onChange={(e) => void sendPicture(e.target.files?.[0])} />
                <button className={btnCls} onClick={() => file.current?.click()} disabled={sending} aria-label="Send a picture">📷</button>
                <textarea className={cx(inputCls, "resize-none max-h-[120px]")} rows={1} placeholder="Type a message" aria-label="Message" value={draft} maxLength={4000}
                  onChange={(e) => onType(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
                <button className={primaryCls} onClick={() => void send()} disabled={sending || !draft.trim()}>Send</button>
              </div>
            </>
          ) : <div className="m-auto text-center text-[#64748B] text-[14px] p-6">Choose a chat, or press <b>+ New</b> to message a colleague.</div>}
        </div>
      </div>

      {modal === "new" ? <NewChat people={d.people} pres={pres} onClose={() => setModal("")} onDm={startDm} onGroup={async (name, ids) => { const r = await chatCreateGroup(name, ids); if (!r.ok) { toast(r.error, "red"); return; } setModal(""); await poll(false, true); pick(r.data.chatId); }} /> : null}
      {modal === "info" && chat ? <GroupInfo chatId={chat.id} people={d.people} onClose={() => setModal("")} onLeft={() => { setModal(""); setActive(""); setShowList(true); void poll(false, true); }} onChanged={() => void poll(false, true)} /> : null}
      {modal === "poll" && chat ? <PollModal title={chat.title} onClose={() => setModal("")} onPost={async (qq, opts, multi) => { const r = await chatPoll(chat.id, qq, opts, multi); if (!r.ok) { toast(r.error, "red"); return; } setModal(""); afterSend(r.data); }} /> : null}
      {modal === "avatar" ? <AvatarModal avatars={d.avatars} me={d.me} current={avatar} onClose={() => setModal("")} onPick={async (e) => { const r = await chatSetAvatar(e); if (!r.ok) { toast(r.error, "red"); return; } setAvatar(r.data.avatar); }} /> : null}
      {viewer ? (
        <div role="dialog" aria-label="Picture" onClick={() => setViewer(null)} className="fixed inset-0 z-[96] bg-black/85 flex items-center justify-center p-8 cursor-zoom-out">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/staff/hrms/chat/img/${viewer}`} alt="Photo in chat" className="max-w-full max-h-full rounded-lg" />
          <a href={`/staff/hrms/chat/img/${viewer}`} download="medoro-chat-photo" onClick={(e) => e.stopPropagation()} className="fixed top-[18px] right-[70px] bg-white text-[#0B5E5B] rounded-lg px-3.5 py-2 text-[12.5px] font-bold no-underline">↓ Download</a>
          <button aria-label="Close" onClick={() => setViewer(null)} className="fixed top-[18px] right-5 bg-white/15 text-white border-0 rounded-lg size-9 text-[16px] cursor-pointer">✕</button>
        </div>
      ) : null}
    </div>
  );
}

function PickList({ people, pres, picked, onToggle, skip }: { people: Person[]; pres: Presence; picked?: Set<string>; onToggle: (id: string) => void; skip?: Set<string> }) {
  const [f, setF] = useState("");
  const rows = people.filter((p) => !skip?.has(p.id) && (p.name + p.empNo + p.dept).toLowerCase().includes(f.trim().toLowerCase()));
  return (
    <div className="flex flex-col gap-2">
      <input className={inputCls} placeholder="Search by name, ID or department" aria-label="Search people" value={f} onChange={(e) => setF(e.target.value)} />
      <div className="max-h-[300px] overflow-y-auto border border-[#E2E8F0] rounded-lg">
        {rows.length ? rows.map((p) => (
          <button key={p.id} type="button" onClick={() => onToggle(p.id)} className="w-full text-left flex gap-2.5 items-center px-3 py-2 bg-white border-0 border-b border-[#F1F5F9] cursor-pointer hover:bg-[#F8FAFC]">
            <Face name={p.name} photo={p.photo} avatar={p.avatar} size={30} status={pres[p.id] ?? "offline"} />
            <span className="flex-1 min-w-0"><span className="block text-[13px] font-semibold truncate">{p.name}</span><span className="block text-[11.5px] text-[#64748B] truncate">{p.empNo}{p.designation ? ` · ${p.designation}` : p.dept ? ` · ${p.dept}` : ""}</span></span>
            {picked ? <span aria-hidden>{picked.has(p.id) ? "☑" : "☐"}</span> : null}
          </button>
        )) : <Empty>No one found.</Empty>}
      </div>
    </div>
  );
}
function NewChat({ people, pres, onClose, onDm, onGroup }: { people: Person[]; pres: Presence; onClose: () => void; onDm: (id: string) => void; onGroup: (name: string, ids: string[]) => void }) {
  const [tab, setTab] = useState<"dm" | "group">("dm"), [name, setName] = useState(""), [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });
  return (
    <Modal title="New chat" onClose={onClose}>
      <Tabs value={tab} options={[["dm", "Message one person"], ["group", "New group"]]} onChange={setTab} />
      {tab === "dm" ? <PickList people={people} pres={pres} onToggle={onDm} /> : (
        <>
          <Field label="Group name"><input className={inputCls} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sales team" /></Field>
          <PickList people={people} pres={pres} picked={picked} onToggle={toggle} />
          <button className={primaryCls} disabled={!name.trim() || !picked.size} onClick={() => onGroup(name, [...picked])}>Create group ({picked.size})</button>
        </>
      )}
    </Modal>
  );
}

function PollModal({ title, onClose, onPost }: { title: string; onClose: () => void; onPost: (q: string, opts: string[], multi: boolean) => void }) {
  const [q, setQ] = useState(""), [opts, setOpts] = useState(["", ""]), [multi, setMulti] = useState(false);
  const set = (i: number, v: string) => setOpts((o) => o.map((x, j) => (j === i ? v : x)));
  return (
    <Modal title="📊 Create a poll" onClose={onClose}>
      <p className="text-[12px] text-[#334155] -mt-2">Posted to {title}</p>
      <Field label="Question"><input className={inputCls} value={q} maxLength={200} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Which day works for the team outing?" /></Field>
      <div className="text-[12px] font-semibold text-[#475569]">Options</div>
      <div className="flex flex-col gap-2">
        {opts.map((o, i) => (
          <div key={i} className="flex gap-2"><input className={inputCls} aria-label={`Option ${i + 1}`} value={o} maxLength={100} placeholder={`Option ${i + 1}`} onChange={(e) => set(i, e.target.value)} />
            {opts.length > 2 ? <button className={btnCls} aria-label={`Remove option ${i + 1}`} onClick={() => setOpts((x) => x.filter((_, j) => j !== i))}>✕</button> : null}</div>
        ))}
      </div>
      {opts.length < 8 ? <button className={cx(btnCls, "self-start")} onClick={() => setOpts((o) => [...o, ""])}>+ Add option</button> : null}
      <label className="flex gap-2 items-center text-[13px]"><input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />Allow multiple answers</label>
      <div className="flex gap-2 justify-end"><button className={btnCls} onClick={onClose}>Cancel</button><button className={primaryCls} disabled={!q.trim() || opts.filter((o) => o.trim()).length < 2} onClick={() => onPost(q, opts, multi)}>Post poll</button></div>
    </Modal>
  );
}

function AvatarModal({ avatars, me, current, onClose, onPick }: { avatars: string[]; me: D["me"]; current: string; onClose: () => void; onPick: (e: string) => void }) {
  return (
    <Modal title="Chat avatar" onClose={onClose}>
      <div className="flex items-center gap-3"><Face name={me.name} photo={me.photo} avatar={current} size={56} /><div><div className="font-bold text-[15px]">Chat avatar</div><div className="text-[12px] text-[#334155]">Shown next to your messages</div></div></div>
      <div className="text-[12px] font-semibold text-[#475569]">Pick a character</div>
      <div className="grid grid-cols-8 gap-1.5">{avatars.map((a) => <button key={a} onClick={() => onPick(a)} aria-pressed={a === current} className={cx("text-[22px] rounded-lg border cursor-pointer py-1 bg-white", a === current ? "border-[#0B5E5B] bg-[#F0FDFA]" : "border-[#E2E8F0]")}>{a}</button>)}</div>
      <div className="flex gap-2 justify-end"><button className={btnCls} onClick={() => onPick("")}>Use my profile photo instead</button><button className={primaryCls} onClick={onClose}>Done</button></div>
    </Modal>
  );
}

function GroupInfo({ chatId, people, onClose, onLeft, onChanged }: { chatId: string; people: Person[]; onClose: () => void; onLeft: () => void; onChanged: () => void }) {
  const [info, setInfo] = useState<Info | null>(null), [edit, setEdit] = useState(false), [adding, setAdding] = useState(false), [picked, setPicked] = useState<Set<string>>(new Set());
  const [about, setAbout] = useState(""), [photo, setPhoto] = useState<string | null | undefined>(undefined), [saving, setSaving] = useState(false);
  const { toast } = useRun();
  const dp = useRef<HTMLInputElement>(null);
  const load = useCallback(() => { void chatGroupInfo(chatId).then((r) => { if (r.ok) setInfo(r.data as Info); }); }, [chatId]);
  useEffect(load, [load]);
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });
  const online = info?.members.filter((m) => m.presence !== "offline").length ?? 0;
  const shownPhoto = photo === undefined ? info?.photo ?? null : photo;
  const pickPhoto = async (f: File | undefined) => { if (!f) return; try { setPhoto(await toDataUrl(await shrink(f, 256, true))); } catch (e) { toast(e instanceof Error ? e.message : "Couldn’t read that picture.", "red"); } };
  const save = async () => {
    setSaving(true);
    const r = await chatUpdateGroup(chatId, { about, ...(photo !== undefined ? { photo } : {}) });
    setSaving(false);
    if (!r.ok) { toast(r.error, "red"); return; }
    setInfo(r.data as Info); setEdit(false); setPhoto(undefined); onChanged(); toast("Group updated.", "green");
  };
  if (!info) return <Modal title="Group info" onClose={onClose}><Empty>Loading…</Empty></Modal>;
  if (edit) {
    return (
      <Modal title="Group settings" onClose={() => { setEdit(false); setPhoto(undefined); }}>
        <p className="text-[12px] text-[#334155] -mt-2">{info.name}</p>
        <input ref={dp} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="Group photo" onChange={(e) => void pickPhoto(e.target.files?.[0])} />
        <div className="flex items-center gap-3"><Face name={info.name} photo={shownPhoto} size={64} square /><button className={btnCls} onClick={() => dp.current?.click()}>📷 Upload group photo</button>{shownPhoto ? <button className={btnCls} onClick={() => setPhoto(null)}>Remove</button> : null}</div>
        <Field label="About this group"><textarea className={inputCls} rows={3} maxLength={300} value={about} onChange={(e) => setAbout(e.target.value)} placeholder="What is this group for?" /></Field>
        <div className="flex gap-2 justify-end"><button className={btnCls} onClick={() => { setEdit(false); setPhoto(undefined); }}>Cancel</button><button className={primaryCls} disabled={saving} onClick={() => void save()}>Save</button></div>
      </Modal>
    );
  }
  return (
    <Modal title="Group info" onClose={onClose}>
      <div className="rounded-xl bg-gradient-to-br from-[#0B5E5B] to-[#14B8A6] text-white p-5 flex flex-col items-center text-center gap-1">
        <Face name={info.name} photo={info.photo} size={72} square />
        <div className="text-[18px] font-extrabold mt-1">{info.name}</div>
        <div className="text-[12px] opacity-90">{info.members.length} members · {online} online{info.sys ? " · company channel" : ""}</div>
      </div>
      {info.about ? <div><div className="text-[11px] font-bold tracking-[.08em] text-[#64748B]">ABOUT</div><div className="text-[13.5px] whitespace-pre-wrap">{info.about}</div></div> : null}
      <div className="text-[11px] font-bold tracking-[.08em] text-[#64748B]">{info.members.length} MEMBERS</div>
      <ul className="flex flex-col max-h-[260px] overflow-y-auto">
        {info.members.map((m) => (
          <li key={m.id} className="flex items-center gap-2.5 py-1.5 border-b border-[#F1F5F9]">
            <Face name={m.name} photo={m.photo} avatar={m.avatar} size={30} status={m.presence} />
            <div className="flex-1 min-w-0"><div className="text-[13px] font-semibold truncate">{m.name}{m.you ? <span className="ml-1.5 text-[10px] bg-[#D6F3EF] text-[#0B5E5B] rounded-full px-1.5 py-0.5">You</span> : null}{m.id === info.owner ? <span className="ml-1.5 text-[10px] text-[#64748B]">made the group</span> : null}</div><div className="text-[11.5px] text-[#64748B] truncate">{m.empNo}{m.designation ? ` · ${m.designation}` : ""}</div></div>
            <span className="text-[11px] text-[#64748B]">{statusText(m.presence)}</span>
          </li>
        ))}
      </ul>
      {adding ? (
        <>
          <PickList people={people} pres={{}} picked={picked} onToggle={toggle} skip={new Set(info.members.map((p) => p.id))} />
          <button className={primaryCls} disabled={!picked.size} onClick={async () => { const r = await chatAddMembers(chatId, [...picked]); if (!r.ok) { toast(r.error, "red"); return; } setAdding(false); setPicked(new Set()); load(); onChanged(); }}>Add {picked.size || ""}</button>
        </>
      ) : null}
      <div className="flex gap-2 flex-wrap">
        {info.canEdit ? <button className={btnCls} onClick={() => { setAbout(info.about); setPhoto(undefined); setEdit(true); }}>✎ Edit group</button> : null}
        {info.canAdd && !adding ? <button className={btnCls} onClick={() => setAdding(true)}>+ Add people</button> : null}
        {!info.sys ? <button className="text-[#B3261E] bg-transparent border-0 cursor-pointer text-[13px]" onClick={async () => { const r = await chatLeave(chatId); if (!r.ok) toast(r.error, "red"); else onLeft(); }}>Leave group</button> : null}
        <button className={cx(btnCls, "ml-auto")} onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

/** Super admin only: open a person's conversation. Every opening is written to the audit log. */
export function ChatReviewScreen({ d }: { d: Data<"chatreview"> }) {
  const router = useRouter();
  const { toast } = useRun();
  const [open, setOpen] = useState<{ title: string; msgs: ChatMsg[]; people: { id: string; name: string; empNo: string }[] } | null>(null);
  const who = new Map(d.people.map((p) => [p.id, p]));
  const show = async (c: ChatRow) => {
    const r = await chatReviewOpen(d.pick, c.id);
    if (!r.ok) { toast(r.error, "red"); return; }
    setOpen({ title: c.title, msgs: r.data.msgs, people: r.data.people });
  };
  return (
    <>
      <Card title="Review a conversation" sub="Pick a person, then one of their chats. This is logged in Audit Logs with who opened what and when." pad>
        <Field label="Person">
          <select className={inputCls} value={d.pick} onChange={(e) => router.push(`/staff/hrms/chatreview${e.target.value ? `?p=${e.target.value}` : ""}`)}>
            <option value="">Choose a person…</option>
            {d.people.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.empNo})</option>)}
          </select>
        </Field>
        {d.pick ? (d.chats.length ? (
          <div className="mt-3 border border-[#E2E8F0] rounded-lg">
            {d.chats.map((c) => (
              <button key={c.id} onClick={() => void show(c)} className="w-full text-left flex gap-3 items-center px-3 py-2.5 bg-white border-0 border-b border-[#F1F5F9] cursor-pointer hover:bg-[#F8FAFC]">
                <span className="font-semibold text-[13.5px]">{c.kind === "group" ? "👥 " : ""}{c.kind === "dm" ? `${who.get(d.pick)?.name ?? "This person"} ↔ ${c.title}` : c.title}</span>
                <span className="ml-auto text-[11.5px] text-[#64748B]">{shortTime(c.lastAt)}</span>
              </button>
            ))}
          </div>
        ) : <Empty>This person has no conversations.</Empty>) : null}
      </Card>
      {open ? (
        <Modal title={`Review: ${open.title}`} wide onClose={() => setOpen(null)}>
          <p className="text-[12px] text-[#64748B]">In this conversation: {open.people.map((p) => `${p.name} (${p.empNo})`).join(", ")}. Opening it was recorded in the audit log.</p>
          <div className="max-h-[60vh] overflow-y-auto flex flex-col gap-2 bg-[#F8FAFC] rounded-lg p-3">
            {open.msgs.length ? open.msgs.map((m) => (
              <div key={m.id} className="text-[13px]">
                <span className="font-semibold">{open.people.find((p) => p.id === m.senderId)?.name ?? "Former colleague"}</span> <span className="text-[11px] text-[#64748B]">{dayLong(m.at)} {timeLabel(m.at)}</span>
                <div className="whitespace-pre-wrap break-words">
                  {m.deleted ? <i className="text-[#64748B]">deleted</i> : m.kind === "meet" ? <a href={m.body} target="_blank" rel="noopener noreferrer" className="underline">Video call link</a> : m.kind === "poll" ? <>📊 Poll: {m.body}</> : <Linked text={m.body} />}
                  {m.hasImage ? <a href={`/staff/hrms/chat/img/${m.id}`} target="_blank" rel="noopener noreferrer" className="block underline">📷 Photo</a> : null}
                </div>
              </div>
            )) : <Empty>No messages.</Empty>}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

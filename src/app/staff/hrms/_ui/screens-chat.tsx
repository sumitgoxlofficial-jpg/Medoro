"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChatMsg, ChatRow } from "@/staff/hrms/chat";
import type { Data } from "@/staff/hrms/screens";
import { chatAddMembers, chatCreateGroup, chatDelete, chatLeave, chatMeet, chatMembers, chatOpenDm, chatReviewOpen, chatSend, chatSendImage } from "../actions";
import { Avatar, Card, Empty, Field, Modal, Tabs, btnCls, cx, dayLong, inputCls, primaryCls, timeLabel, useRun } from "./kit";

type Person = Data<"chat">["people"][number];
type Poll = { chats: ChatRow[]; unread: number; thread: { msgs: ChatMsg[]; readUpTo: number } | null };

const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const shortTime = (iso: string) => {
  const d = new Date(iso), now = new Date();
  return dayKey(iso) === dayKey(now.toISOString()) ? timeLabel(iso) : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
};
/** Shrinks a picture in the browser so a phone photo is a few hundred KB, not several MB. */
async function shrink(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Only JPEG, PNG or WebP pictures can be sent.");
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.8));
  if (!blob) throw new Error("Couldn’t read that picture.");
  return new File([blob], "photo.jpg", { type: "image/jpeg" });
}
/** Links in a message become clickable (https only). Everything else stays plain text. */
function Linked({ text }: { text: string }) {
  const parts = text.split(/(https:\/\/[^\s<]+)/g);
  return <>{parts.map((p, i) => (i % 2 ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="underline break-all">{p}</a> : <span key={i}>{p}</span>))}</>;
}

function Bubble({ m, mine, sender, read, canDelete, onDelete, showSender }: { m: ChatMsg; mine: boolean; sender: string; read: boolean; canDelete: boolean; onDelete: () => void; showSender: boolean }) {
  const tick = mine && !m.deleted ? <span className={cx("ml-1 text-[11px]", read ? "text-[#2563EB]" : "text-[#94A3B8]")} aria-label={read ? "Read" : "Sent"}>{read ? "✓✓" : "✓"}</span> : null;
  return (
    <div className={cx("flex group", mine ? "justify-end" : "justify-start")}>
      <div className={cx("max-w-[78%] rounded-2xl px-3 py-2 text-[13.5px] leading-snug shadow-sm", mine ? "bg-[#D6F3EF] rounded-br-md" : "bg-white border border-[#E2E8F0] rounded-bl-md")}>
        {showSender && !mine ? <div className="text-[11.5px] font-bold text-[#0B5E5B] mb-0.5">{sender}</div> : null}
        {m.deleted ? <span className="italic text-[#64748B]">This message was deleted</span> : m.kind === "meet" ? (
          <div className="flex flex-col gap-1.5">
            <span className="font-semibold">📹 Video call</span>
            <a href={m.body} target="_blank" rel="noopener noreferrer" className="bg-[#0B5E5B] text-white rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-center no-underline">Join Google Meet</a>
          </div>
        ) : (
          <>
            {m.hasImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <a href={`/staff/hrms/chat/img/${m.id}`} target="_blank" rel="noopener noreferrer"><img src={`/staff/hrms/chat/img/${m.id}`} alt="Photo in chat" className="rounded-lg max-h-[280px] mb-1" loading="lazy" /></a>
            ) : null}
            {m.body ? <div className="whitespace-pre-wrap break-words"><Linked text={m.body} /></div> : null}
          </>
        )}
        <div className="flex items-center justify-end gap-1 mt-0.5 text-[10.5px] text-[#64748B]">
          {canDelete && !m.deleted ? <button onClick={onDelete} className="opacity-0 group-hover:opacity-100 focus:opacity-100 bg-transparent border-0 cursor-pointer text-[#B3261E] text-[10.5px]">Delete</button> : null}
          {timeLabel(m.at)}{tick}
        </div>
      </div>
    </div>
  );
}

export function ChatScreen({ d }: { d: Data<"chat"> }) {
  const router = useRouter();
  const { run, toast } = useRun();
  const [chats, setChats] = useState<ChatRow[]>(d.chats);
  const [active, setActive] = useState<string>(d.chats.some((c) => c.id === d.open) ? d.open : "");
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [readUpTo, setReadUpTo] = useState(0);
  const [draft, setDraft] = useState(""), [sending, setSending] = useState(false), [q, setQ] = useState("");
  const [newChat, setNewChat] = useState(false), [members, setMembers] = useState(false), [showList, setShowList] = useState(!d.open);
  const log = useRef<HTMLDivElement>(null), file = useRef<HTMLInputElement>(null), top = useRef(0), pinned = useRef(true), activeRef = useRef(active);
  const names = useMemo(() => new Map([...d.people.map((p) => [p.id, p.name] as const)]), [d.people]);
  const chat = chats.find((c) => c.id === active);
  activeRef.current = active;

  const apply = useCallback((p: Poll, chatId: string, reset: boolean) => {
    setChats(p.chats);
    if (!p.thread || chatId !== activeRef.current) return;
    const add = p.thread.msgs;
    setMsgs((cur) => {
      const base = reset ? [] : cur;
      const seen = new Set(base.map((m) => m.id));
      const merged = [...base, ...add.filter((m) => !seen.has(m.id))];
      // A deleted message arrives as a new copy of an old one: replace in place.
      const byId = new Map(add.map((m) => [m.id, m]));
      const out = merged.map((m) => byId.get(m.id) ?? m);
      top.current = out.length ? out[out.length - 1].seq : 0;
      return out;
    });
    setReadUpTo(p.thread.readUpTo);
  }, []);

  const poll = useCallback(async (reset = false) => {
    const id = activeRef.current;
    const u = new URLSearchParams({ open: document.visibilityState === "visible" ? "1" : "0" });
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
  useEffect(() => { top.current = 0; setMsgs([]); pinned.current = true; if (active) void poll(true); }, [active, poll]);
  // Stay at the bottom when new messages arrive, unless the person scrolled up to read.
  useEffect(() => { const el = log.current; if (el && pinned.current) el.scrollTop = el.scrollHeight; }, [msgs]);

  const pick = (id: string) => { setActive(id); setShowList(false); window.history.replaceState(null, "", `/staff/hrms/chat?c=${id}`); };
  const afterSend = (m: ChatMsg) => { pinned.current = true; setMsgs((c) => (c.some((x) => x.id === m.id) ? c : [...c, m])); top.current = Math.max(top.current, m.seq); void poll(); };
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
  const del = (id: string) => run(() => chatDelete(id), () => { setMsgs((c) => c.map((m) => (m.id === id ? { ...m, deleted: true, body: "", hasImage: false } : m))); });
  const startDm = async (id: string) => {
    const r = await chatOpenDm(id);
    if (!r.ok) { toast(r.error, "red"); return; }
    setNewChat(false); await poll(); pick(r.data.chatId);
  };

  const list = chats.filter((c) => c.title.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-[#64748B]">Messages are encrypted and kept private to the people in each conversation. Only the super admin can open a conversation for review, and every review is recorded in the audit log.</p>
      <div className="grid bg-white border border-[#E2E8F0] rounded-[14px] overflow-hidden min-h-[560px] h-[calc(100vh-210px)] grid-cols-1 min-[860px]:grid-cols-[320px_1fr]">
        <div className={cx("border-r border-[#E2E8F0] flex-col min-h-0", showList || !active ? "flex" : "hidden min-[860px]:flex")}>
          <div className="p-3 flex gap-2">
            <input className={inputCls} placeholder="Search chats" aria-label="Search chats" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className={primaryCls} onClick={() => setNewChat(true)}>+ New</button>
          </div>
          <div className="overflow-y-auto flex-1" role="list">
            {list.length ? list.map((c) => (
              <button key={c.id} role="listitem" onClick={() => pick(c.id)} className={cx("w-full text-left flex gap-2.5 px-3 py-2.5 border-0 border-b border-[#F1F5F9] cursor-pointer items-center", c.id === active ? "bg-[#F0FDFA]" : "bg-white hover:bg-[#F8FAFC]")}>
                <Avatar name={c.title} photo={c.photo} size={38} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2"><span className="font-semibold text-[13.5px] truncate">{c.title}</span><span className="ml-auto text-[10.5px] text-[#64748B] flex-none">{shortTime(c.lastAt)}</span></span>
                  <span className="flex items-center gap-2"><span className="text-[12px] text-[#64748B] truncate">{c.kind === "group" ? "👥 " : ""}{c.last || "No messages yet"}</span>
                    {c.unread ? <span className="ml-auto flex-none bg-[#0B5E5B] text-white text-[10.5px] font-bold rounded-full min-w-[18px] h-[18px] px-1.5 flex items-center justify-center">{c.unread}</span> : null}</span>
                </span>
              </button>
            )) : <Empty>{chats.length ? "No chats match." : "No chats yet. Press + New to message a colleague."}</Empty>}
          </div>
        </div>

        <div className={cx("flex-col min-h-0 bg-[#F8FAFC]", !showList && active ? "flex" : "hidden min-[860px]:flex")}>
          {chat ? (
            <>
              <div className="bg-white border-b border-[#E2E8F0] px-3 py-2.5 flex items-center gap-2.5">
                <button className="min-[860px]:hidden bg-transparent border-0 cursor-pointer text-[18px]" aria-label="Back to chats" onClick={() => setShowList(true)}>←</button>
                <Avatar name={chat.title} photo={chat.photo} size={36} />
                <div className="min-w-0 mr-auto"><div className="font-bold text-[14px] truncate">{chat.title}</div><div className="text-[11.5px] text-[#64748B]">{chat.kind === "group" ? `${chat.members} people` : "Direct message"}</div></div>
                {chat.kind === "group" ? <button className={btnCls} onClick={() => setMembers(true)}>People</button> : null}
                <button className={btnCls} onClick={() => void meet()} disabled={sending} title={d.google ? "Start a Google Meet call" : "Connect Google Calendar first"}>📹 Meet</button>
              </div>
              <div ref={log} onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-1.5" aria-live="polite">
                {msgs.length ? msgs.map((m, i) => (
                  <div key={m.id} className="flex flex-col gap-1.5">
                    {i === 0 || dayKey(msgs[i - 1].at) !== dayKey(m.at) ? <div className="self-center text-[11px] bg-[#E2E8F0] text-[#475569] rounded-full px-3 py-0.5 my-1">{dayLong(m.at)}</div> : null}
                    <Bubble m={m} mine={m.senderId === d.meId} sender={names.get(m.senderId) ?? "Colleague"} read={m.seq <= readUpTo} showSender={chat.kind === "group"} canDelete={m.senderId === d.meId} onDelete={() => del(m.id)} />
                  </div>
                )) : <Empty>Say hello 👋</Empty>}
              </div>
              <div className="bg-white border-t border-[#E2E8F0] p-2.5 flex gap-2 items-end">
                <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="Choose a picture" onChange={(e) => void sendPicture(e.target.files?.[0])} />
                <button className={btnCls} onClick={() => file.current?.click()} disabled={sending} aria-label="Send a picture">📷</button>
                <textarea className={cx(inputCls, "resize-none max-h-[120px]")} rows={1} placeholder="Type a message" aria-label="Message" value={draft} maxLength={4000}
                  onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
                <button className={primaryCls} onClick={() => void send()} disabled={sending || !draft.trim()}>Send</button>
              </div>
            </>
          ) : <div className="m-auto text-center text-[#64748B] text-[14px] p-6">Choose a chat, or press <b>+ New</b> to message a colleague.</div>}
        </div>
      </div>
      {newChat ? <NewChat people={d.people} onClose={() => setNewChat(false)} onDm={startDm} onGroup={async (name, ids) => { const r = await chatCreateGroup(name, ids); if (!r.ok) { toast(r.error, "red"); return; } setNewChat(false); await poll(); pick(r.data.chatId); }} /> : null}
      {members && chat ? <Members chatId={chat.id} meId={d.meId} people={d.people} onClose={() => setMembers(false)} onLeft={() => { setMembers(false); setActive(""); setShowList(true); void poll(); }} /> : null}
    </div>
  );
}

function PickList({ people, picked, onToggle, skip }: { people: Person[]; picked?: Set<string>; onToggle: (id: string) => void; skip?: Set<string> }) {
  const [f, setF] = useState("");
  const rows = people.filter((p) => !skip?.has(p.id) && (p.name + p.empNo + p.dept).toLowerCase().includes(f.trim().toLowerCase()));
  return (
    <div className="flex flex-col gap-2">
      <input className={inputCls} placeholder="Search by name, ID or department" aria-label="Search people" value={f} onChange={(e) => setF(e.target.value)} />
      <div className="max-h-[300px] overflow-y-auto border border-[#E2E8F0] rounded-lg">
        {rows.length ? rows.map((p) => (
          <button key={p.id} type="button" onClick={() => onToggle(p.id)} className="w-full text-left flex gap-2.5 items-center px-3 py-2 bg-white border-0 border-b border-[#F1F5F9] cursor-pointer hover:bg-[#F8FAFC]">
            <Avatar name={p.name} photo={p.photo} size={30} />
            <span className="flex-1 min-w-0"><span className="block text-[13px] font-semibold truncate">{p.name}</span><span className="block text-[11.5px] text-[#64748B] truncate">{p.empNo}{p.dept ? ` · ${p.dept}` : ""}</span></span>
            {picked ? <span aria-hidden>{picked.has(p.id) ? "☑" : "☐"}</span> : null}
          </button>
        )) : <Empty>No one found.</Empty>}
      </div>
    </div>
  );
}
function NewChat({ people, onClose, onDm, onGroup }: { people: Person[]; onClose: () => void; onDm: (id: string) => void; onGroup: (name: string, ids: string[]) => void }) {
  const [tab, setTab] = useState<"dm" | "group">("dm"), [name, setName] = useState(""), [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });
  return (
    <Modal title="New chat" onClose={onClose}>
      <Tabs value={tab} options={[["dm", "Message one person"], ["group", "New group"]]} onChange={setTab} />
      {tab === "dm" ? <PickList people={people} onToggle={onDm} /> : (
        <>
          <Field label="Group name"><input className={inputCls} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sales team" /></Field>
          <PickList people={people} picked={picked} onToggle={toggle} />
          <button className={primaryCls} disabled={!name.trim() || !picked.size} onClick={() => onGroup(name, [...picked])}>Create group ({picked.size})</button>
        </>
      )}
    </Modal>
  );
}
function Members({ chatId, meId, people, onClose, onLeft }: { chatId: string; meId: string; people: Person[]; onClose: () => void; onLeft: () => void }) {
  const [info, setInfo] = useState<{ owner: string; people: { id: string; name: string; empNo: string }[] } | null>(null);
  const [adding, setAdding] = useState(false), [picked, setPicked] = useState<Set<string>>(new Set());
  const { toast } = useRun();
  const load = useCallback(() => { void chatMembers(chatId).then((r) => { if (r.ok) setInfo(r.data); }); }, [chatId]);
  useEffect(load, [load]);
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });
  return (
    <Modal title="Group members" onClose={onClose}>
      {info ? <ul className="flex flex-col gap-1">{info.people.map((p) => <li key={p.id} className="text-[13.5px]">{p.name} <span className="text-[#64748B] text-[12px]">{p.empNo}{p.id === info.owner ? " · made the group" : ""}</span></li>)}</ul> : <Empty>Loading…</Empty>}
      {info?.owner === meId ? (adding ? (
        <>
          <PickList people={people} picked={picked} onToggle={toggle} skip={new Set(info.people.map((p) => p.id))} />
          <button className={primaryCls} disabled={!picked.size} onClick={async () => { const r = await chatAddMembers(chatId, [...picked]); if (!r.ok) { toast(r.error, "red"); return; } setAdding(false); setPicked(new Set()); load(); }}>Add {picked.size || ""}</button>
        </>
      ) : <button className={btnCls} onClick={() => setAdding(true)}>+ Add people</button>) : null}
      <button className="text-[#B3261E] bg-transparent border-0 cursor-pointer text-[13px] text-left" onClick={async () => { const r = await chatLeave(chatId); if (!r.ok) toast(r.error, "red"); else onLeft(); }}>Leave group</button>
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
                  {m.deleted ? <i className="text-[#64748B]">deleted</i> : m.kind === "meet" ? <a href={m.body} target="_blank" rel="noopener noreferrer" className="underline">Video call link</a> : <Linked text={m.body} />}
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

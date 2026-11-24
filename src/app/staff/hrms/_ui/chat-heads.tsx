"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChatMsg, ChatRow } from "@/staff/hrms/chat";
import { chatSend } from "../actions";
import { cx, timeLabel } from "./kit";

/**
 * A floating chat bubble on every HRMS page except the chat screen itself, like Messenger. It shows the profile photo of whoever
 * messaged last (with the unread count), pops up a preview when a new message arrives, and opens a small window where you can
 * read and reply without leaving the page. It listens to the chat list that ChatNotifier already polls, so it adds no requests
 * of its own while closed.
 */
type Popup = { id: string; title: string; text: string; photo: string | null; avatar: string };
type Thread = { msgs: ChatMsg[]; error: string };

const initialsOf = (n: string) => n.split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase();
const preview = (c: ChatRow) => (c.kind === "group" && c.lastBy ? `${c.lastBy}: ` : "") + (c.last || "No messages yet");
const textOf = (m: ChatMsg) => (m.deleted ? "Message deleted" : m.kind === "image" ? "📷 Photo" : m.kind === "meet" ? "📹 Video call" : m.kind === "poll" ? `📊 ${m.body}` : m.body);

function Face({ title, photo, avatar, size }: { title: string; photo: string | null; avatar: string; size: number }) {
  if (avatar) return <span className="rounded-full bg-[#EEF2FF] flex items-center justify-center flex-none" style={{ width: size, height: size, fontSize: size * 0.55 }} aria-hidden>{avatar}</span>;
  // eslint-disable-next-line @next/next/no-img-element
  if (photo) return <img src={photo} alt="" className="rounded-full object-cover flex-none" style={{ width: size, height: size }} />;
  return <span className="rounded-full bg-[#D6F3EF] text-[#0B5E5B] font-bold flex items-center justify-center flex-none" style={{ width: size, height: size, fontSize: size * 0.36 }} aria-hidden>{initialsOf(title) || "?"}</span>;
}

export function ChatHeads({ screen, meId }: { screen: string; meId: string }) {
  const router = useRouter();
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [open, setOpen] = useState(false), [active, setActive] = useState<string | null>(null), [popup, setPopup] = useState<Popup | null>(null);
  const hideT = useRef<ReturnType<typeof setTimeout>>(undefined);
  const activeRef = useRef<string | null>(null), openRef = useRef(false);
  useEffect(() => { activeRef.current = active; openRef.current = open; }, [active, open]);

  useEffect(() => {
    const list = (e: Event) => setChats((e as CustomEvent<{ chats: ChatRow[] }>).detail.chats);
    const fresh = (e: Event) => {
      const c = (e as CustomEvent<{ chat: ChatRow }>).detail.chat;
      if (openRef.current && activeRef.current === c.id) return; // you are reading it right now
      setPopup({ id: c.id, title: c.title, text: preview(c), photo: c.photo, avatar: c.avatar });
      clearTimeout(hideT.current);
      hideT.current = setTimeout(() => setPopup(null), 7000);
    };
    window.addEventListener("hrms:chatlist", list);
    window.addEventListener("hrms:chatnew", fresh);
    return () => { window.removeEventListener("hrms:chatlist", list); window.removeEventListener("hrms:chatnew", fresh); clearTimeout(hideT.current); };
  }, []);

  // The conversation you have open is being read right now: show it as read until the next list arrives.
  const shown = chats.map((c) => (open && c.id === active && c.unread ? { ...c, unread: 0 } : c));
  const unread = shown.reduce((a, c) => a + c.unread, 0);
  const latest = [...shown].filter((c) => c.unread > 0).sort((a, b) => b.lastAt.localeCompare(a.lastAt))[0];
  const sorted = [...shown].sort((a, b) => (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0) || b.lastAt.localeCompare(a.lastAt)).slice(0, 8);
  const current = chats.find((c) => c.id === active) ?? null;

  const openChat = useCallback((id: string) => { setPopup(null); setActive(id); setOpen(true); }, []);
  if (screen === "chat") return null; // the chat screen is the full version of this

  return (
    <div className="fixed z-50 bottom-5 right-5 flex flex-col items-end gap-2 print:hidden" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      {open && current ? <MiniChat chat={current} meId={meId} onBack={() => setActive(null)} onClose={() => { setOpen(false); setActive(null); }} onFull={() => { setOpen(false); router.push(`/staff/hrms/chat?c=${encodeURIComponent(current.id)}`); }} />
        : open ? (
          <div role="dialog" aria-label="Messages" className="w-[min(92vw,340px)] max-h-[440px] flex flex-col bg-white border border-[#CBD5E1] rounded-2xl shadow-2xl overflow-hidden text-[#0f172a]">
            <div className="flex items-center gap-2 px-4 py-3 bg-[#0B5E5B] text-white">
              <strong className="text-[14px] flex-1">Messages</strong>
              <button className="text-[12px] text-white/90 underline bg-transparent border-0 cursor-pointer" onClick={() => { setOpen(false); router.push("/staff/hrms/chat"); }}>Open chat</button>
              <button aria-label="Close messages" className="text-[18px] leading-none bg-transparent border-0 text-white cursor-pointer" onClick={() => setOpen(false)}>×</button>
            </div>
            <ul className="m-0 p-0 list-none overflow-y-auto">
              {sorted.length ? sorted.map((c) => (
                <li key={c.id}>
                  <button onClick={() => openChat(c.id)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left bg-white hover:bg-[#F1F5F9] border-0 border-b border-[#F1F5F9] cursor-pointer">
                    <Face title={c.title} photo={c.photo} avatar={c.avatar} size={38} />
                    <span className="min-w-0 flex-1"><span className={cx("block text-[13.5px] truncate", c.unread ? "font-bold" : "font-semibold")}>{c.title}</span><span className={cx("block text-[12.5px] truncate", c.unread ? "text-[#0f172a] font-semibold" : "text-[#64748B]")}>{preview(c)}</span></span>
                    {c.unread ? <span className="bg-[#DC2626] text-white text-[11px] font-bold rounded-full min-w-5 h-5 px-1.5 flex items-center justify-center">{c.unread}</span> : null}
                  </button>
                </li>
              )) : <li className="px-4 py-6 text-center text-[13px] text-[#64748B]">No conversations yet.</li>}
            </ul>
          </div>
        ) : null}

      {popup && !open ? (
        <button onClick={() => openChat(popup.id)} aria-live="polite" className="w-[min(86vw,300px)] flex items-center gap-3 text-left bg-white border border-[#CBD5E1] rounded-2xl shadow-xl px-3 py-2.5 cursor-pointer text-[#0f172a]">
          <Face title={popup.title} photo={popup.photo} avatar={popup.avatar} size={38} />
          <span className="min-w-0 flex-1"><span className="block font-bold text-[13px] truncate">{popup.title}</span><span className="block text-[12.5px] text-[#475569] truncate">{popup.text}</span></span>
        </button>
      ) : null}

      <button aria-label={unread ? `Messages, ${unread} unread` : "Messages"} aria-expanded={open} onClick={() => { setPopup(null); setOpen((o) => !o); setActive(null); }}
        className="relative size-14 rounded-full border-0 shadow-xl cursor-pointer bg-[#0B5E5B] text-white text-[24px] flex items-center justify-center p-0 hover:scale-105 transition-transform">
        {latest ? <Face title={latest.title} photo={latest.photo} avatar={latest.avatar} size={56} /> : <span aria-hidden>💬</span>}
        {unread ? <span className="absolute -top-1 -right-1 bg-[#DC2626] text-white text-[11px] font-bold rounded-full min-w-5 h-5 px-1.5 flex items-center justify-center border-2 border-white">{unread > 99 ? "99+" : unread}</span> : null}
      </button>
    </div>
  );
}

/** One conversation in a small window: the latest messages, a reply box, and a way to open the full chat. */
function MiniChat({ chat, meId, onBack, onClose, onFull }: { chat: ChatRow; meId: string; onBack: () => void; onClose: () => void; onFull: () => void }) {
  const [t, setT] = useState<Thread>({ msgs: [], error: "" }), [draft, setDraft] = useState(""), [sending, setSending] = useState(false);
  const top = useRef(0), log = useRef<HTMLDivElement>(null), id = chat.id;

  // Opening it reads the conversation (the server marks it read while the window is open); then it picks up anything newer.
  const load = useCallback(async (reset: boolean) => {
    try {
      const q = new URLSearchParams({ open: "1", chat: id });
      if (!reset && top.current) q.set("after", String(top.current));
      const r = await fetch(`/staff/hrms/chat/poll?${q}`, { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as { thread: { msgs: ChatMsg[] } | null };
      const add = j.thread?.msgs ?? [];
      if (!add.length && !reset) return;
      setT((cur) => {
        const base = reset ? [] : cur.msgs, seen = new Set(base.map((m) => m.id));
        const out = [...base, ...add.filter((m) => !seen.has(m.id))];
        top.current = out.length ? out[out.length - 1].seq : 0;
        return { ...cur, msgs: out };
      });
    } catch { /* offline: the next tick tries again */ }
  }, [id]);
  useEffect(() => {
    top.current = 0;
    const first = setTimeout(() => void load(true), 0);
    const tick = setInterval(() => { if (document.visibilityState === "visible") void load(false); }, 3000);
    return () => { clearTimeout(first); clearInterval(tick); };
  }, [load]);
  useEffect(() => { const el = log.current; if (el) el.scrollTop = el.scrollHeight; }, [t.msgs.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    const r = await chatSend(id, body);
    setSending(false);
    if (!r.ok) { setT((cur) => ({ ...cur, error: r.error })); return; }
    setDraft(""); setT((cur) => ({ ...cur, error: "" }));
    void load(false);
  };

  return (
    <div role="dialog" aria-label={`Chat with ${chat.title}`} className="w-[min(92vw,340px)] h-[min(70vh,440px)] flex flex-col bg-white border border-[#CBD5E1] rounded-2xl shadow-2xl overflow-hidden text-[#0f172a]">
      <div className="flex items-center gap-2 px-3 py-2.5 bg-[#0B5E5B] text-white">
        <button aria-label="Back to messages" className="text-[18px] leading-none bg-transparent border-0 text-white cursor-pointer" onClick={onBack}>‹</button>
        <Face title={chat.title} photo={chat.photo} avatar={chat.avatar} size={30} />
        <strong className="text-[13.5px] flex-1 truncate">{chat.title}</strong>
        <button aria-label="Open in full chat" title="Open in full chat" className="text-[14px] bg-transparent border-0 text-white cursor-pointer" onClick={onFull}>↗</button>
        <button aria-label="Close chat" className="text-[18px] leading-none bg-transparent border-0 text-white cursor-pointer" onClick={onClose}>×</button>
      </div>
      <div ref={log} className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-1.5 bg-[#F8FAFC]">
        {t.msgs.length ? t.msgs.map((m) => {
          const mine = m.senderId === meId;
          return (
            <div key={m.id} className={cx("max-w-[82%] rounded-2xl px-3 py-1.5 text-[13px] break-words", mine ? "self-end bg-[#0B5E5B] text-white" : "self-start bg-white border border-[#E2E8F0]")}>
              {!mine && chat.kind === "group" && m.by ? <div className="text-[11px] font-bold text-[#0B5E5B]">{m.by}</div> : null}
              {textOf(m)}
              <div className={cx("text-[10px] mt-0.5", mine ? "text-white/70" : "text-[#94A3B8]")}>{timeLabel(m.at)}</div>
            </div>
          );
        }) : <p className="m-auto text-[12.5px] text-[#64748B]">No messages yet. Say hello.</p>}
      </div>
      {t.error ? <p role="alert" className="m-0 px-3 py-1.5 text-[12px] text-[#B3261E] bg-[#FDECEA]">{t.error}</p> : null}
      <form className="flex items-center gap-2 p-2.5 border-t border-[#E2E8F0] bg-white" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <input aria-label="Message" className="flex-1 min-w-0 border border-[#CDD2D7] rounded-full px-3.5 py-2 text-[13px] outline-none focus:border-[#0B5E5B]" placeholder="Write a message…" value={draft} maxLength={4000} onChange={(e) => setDraft(e.target.value)} />
        <button disabled={sending || !draft.trim()} className="rounded-full bg-[#0B5E5B] text-white text-[13px] font-semibold border-0 px-3.5 py-2 cursor-pointer disabled:opacity-50">Send</button>
      </form>
    </div>
  );
}

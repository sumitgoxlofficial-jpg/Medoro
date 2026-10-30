"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, X, Wrench, ShieldAlert, LoaderCircle, SendHorizontal, HardDrive, Globe, Power } from "lucide-react";
import { aiAsk, aiCancel, aiConfirm, aiSettingsAction } from "@/app/app/ai-actions";
import type { AiReply } from "@/domain/ai/service";
import type { Lang } from "@/lib/i18n";

/** What the shell knows about the assistant for this pharmacy and user. */
export type AiShell = { enabled: boolean; globalOff: boolean; mode: "rules" | "local" | "remote"; canManage: boolean };

type Msg = { id: number; role: "user" | "ai"; text: string; reply?: AiReply; state?: "pending" | "done" | "cancelled" };

/** Open the drawer and ask a question from anywhere in the app. */
export const askAi = (prompt: string) => window.dispatchEvent(new CustomEvent("medoro:ai", { detail: prompt }));

const SUGGEST = {
  en: ["Aaj ki total sale kitni hai?", "Next month kya zyada bikega?", "Expiring in next 30 days", "What should I reorder?", "Supplier payments due", "GST report last month", "Check last backup", "Prepare cash reconciliation"],
  hi: ["आज की बिक्री कितनी है?", "अगले महीने क्या ज़्यादा बिकेगा?", "30 दिन में कौन सी दवा एक्सपायर होगी?", "क्या रीऑर्डर करना है?", "सप्लायर बकाया दिखाओ", "पिछले महीने की GST रिपोर्ट"],
};

export function AiDrawer({ open, floating, onClose, lang, placeholder, ai }: { open: boolean; floating: boolean; onClose: () => void; lang: Lang; placeholder: string; ai: AiShell }) {
  const router = useRouter();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [switching, setSwitching] = useState(false);
  const [switchErr, setSwitchErr] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(1);

  const push = (m: Omit<Msg, "id">) => setMsgs((x) => [...x, { ...m, id: seq.current++ }]);
  const patch = (id: number, p: Partial<Msg>) => setMsgs((x) => x.map((m) => (m.id === id ? { ...m, ...p } : m)));

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    setQ(""); push({ role: "user", text }); setBusy(true);
    const r = await aiAsk(text).catch(() => ({ ok: false as const, error: "Couldn’t reach your server. Check the connection and try again." }));
    setBusy(false);
    if (!r.ok) return push({ role: "ai", text: r.error });
    push({ role: "ai", text: r.data.text, reply: r.data, state: r.data.confirm ? "pending" : undefined });
  };

  const decide = async (m: Msg, yes: boolean) => {
    const token = m.reply?.confirm?.token;
    if (!token || m.state !== "pending") return;
    patch(m.id, { state: yes ? "done" : "cancelled" });
    if (!yes) { await aiCancel(token); return push({ role: "ai", text: "Cancelled. Nothing was changed." }); }
    setBusy(true);
    const r = await aiConfirm(token).catch(() => ({ ok: false as const, error: "Couldn’t reach your server. Nothing was changed." }));
    setBusy(false);
    push(r.ok ? { role: "ai", text: r.data.text, reply: r.data } : { role: "ai", text: r.error });
  };

  const setEnabled = async (enabled: boolean) => {
    if (!enabled && !window.confirm("Turn the AI assistant off for everyone in this pharmacy? Billing and other screens are not affected.")) return;
    setSwitching(true); setSwitchErr("");
    const r = await aiSettingsAction({ enabled }).catch(() => ({ ok: false as const, error: "Couldn’t reach your server." }));
    setSwitching(false);
    if (!r.ok) return setSwitchErr(r.error);
    if (!enabled) onClose();
    router.refresh();
  };

  useEffect(() => {
    const on = (e: Event) => { const p = (e as CustomEvent<string>).detail; if (p && ai.enabled) send(p); };
    window.addEventListener("medoro:ai", on);
    return () => window.removeEventListener("medoro:ai", on);
  });
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" }); }, [msgs, busy]);
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 50); }, [open]);

  return (
    <aside aria-label="Medoro AI" hidden={!open} className={(open ? "flex" : "hidden") + " flex-col min-h-0 h-dvh w-[380px] max-w-[100vw] bg-white border-l border-[#E3E6E9] " + (floating ? "fixed right-0 top-0 z-40 shadow-[-12px_0_32px_rgba(0,0,0,.14)]" : "relative")}>
      <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-[#E3E6E9]">
        <div className="size-[30px] rounded-lg bg-[#E1F1EF] text-teal flex items-center justify-center"><Sparkles size={16} /></div>
        <div className="flex-1 flex flex-col leading-tight"><div className="font-semibold text-[15px]">Medoro AI</div><div className="text-[12px] text-muted">Read-only by default · asks before acting</div></div>
        <button onClick={onClose} title="Close (Ctrl+J)" className="p-1.5 rounded-md text-muted cursor-pointer hover:bg-hover"><X size={18} /></button>
      </div>

      <div ref={list} className="flex-1 overflow-auto p-4 flex flex-col gap-3 bg-[#FAFBFB]">
        {!ai.enabled ? (
          <div className="text-[13px] text-muted bg-white border border-line rounded-xl p-3 flex flex-col gap-2.5">
            <div>The AI assistant is switched off for this pharmacy. Nobody can ask it questions until an owner or manager turns it back on. Billing and every other screen work as usual.</div>
            <button onClick={() => setEnabled(true)} disabled={switching} className="self-start flex items-center gap-1.5 bg-teal text-white rounded-[7px] px-3 py-[7px] text-[13px] font-semibold cursor-pointer disabled:opacity-60"><Power size={14} />Turn the assistant on</button>
            {switchErr ? <div className="text-[12.5px] text-[#B42318]">{switchErr}</div> : null}
          </div>
        ) : !msgs.length ? (
          <div className="text-[13px] text-muted bg-white border border-line rounded-xl p-3">
            Ask about today’s sales, stock and batches, expiring batches, supplier and customer dues, the cash drawer, reports or backups. Answers come from your own data, with the basis shown. I can also prepare a draft purchase order, an expense, a stock adjustment, a refund or a backup, and nothing changes until you confirm.
          </div>
        ) : null}
        {msgs.map((m) => m.role === "user" ? (
          <div key={m.id} className="self-end max-w-[85%] bg-teal text-white px-3 py-[9px] rounded-[12px_12px_2px_12px] text-[13.5px]">{m.text}</div>
        ) : (
          <div key={m.id} className="self-start max-w-[96%] flex flex-col gap-2 bg-white border border-[#E3E6E9] px-3 py-[11px] rounded-[12px_12px_12px_2px] text-[13.5px]">
            {m.reply?.tool ? <div className="self-start flex items-center gap-[5px] font-mono text-[11.5px] text-blue bg-blue-tint px-[7px] py-0.5 rounded-[5px]"><Wrench size={12} />{m.reply.tool}</div> : null}
            <div className="text-pretty">{m.text}</div>
            {m.reply?.rows?.length ? (
              <div className="flex flex-col border border-[#EEF0F2] rounded-lg overflow-hidden">
                {m.reply.rows.map((r, i) => (
                  <div key={i} className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] gap-2 px-[9px] py-1.5 border-b border-[#EEF0F2] last:border-b-0 text-[12.5px] items-center">
                    <span className="truncate font-medium" title={r.a}>{r.a}</span><span className="truncate text-muted" title={r.b}>{r.b}</span><span className="tnum font-semibold text-right">{r.c}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {m.reply?.basis ? <div className="text-[12px] text-muted">Basis: {m.reply.basis}</div> : null}
            {m.reply?.confirm && m.state === "pending" ? (
              <div className="flex flex-col gap-2 p-2.5 bg-[#FDF2E1] rounded-lg">
                <div className="text-[12.5px] text-[#94570A] font-semibold flex gap-1.5 items-center"><ShieldAlert size={14} />Needs your confirmation</div>
                <div className="flex gap-2">
                  <button onClick={() => decide(m, true)} disabled={busy} className="bg-teal text-white rounded-[7px] px-3 py-[7px] text-[13px] font-semibold cursor-pointer disabled:opacity-60">{m.reply.confirm.label}</button>
                  <button onClick={() => decide(m, false)} disabled={busy} className="bg-white text-ink border border-input rounded-[7px] px-3 py-[7px] text-[13px] cursor-pointer">Cancel</button>
                </div>
              </div>
            ) : null}
            {m.reply?.link ? (
              m.reply.link.href.startsWith("#ai:")
                ? <button onClick={() => send(m.reply!.link!.href.slice(4))} className="self-start bg-white text-teal border border-[#9FCFC9] rounded-[7px] px-[11px] py-1.5 text-[13px] font-semibold cursor-pointer">{m.reply.link.label}</button>
                : m.reply.link.href.startsWith("/api/")
                  ? <a href={m.reply.link.href} download className="self-start bg-white text-teal border border-[#9FCFC9] rounded-[7px] px-[11px] py-1.5 text-[13px] font-semibold no-underline">{m.reply.link.label}</a>
                  : <Link href={m.reply.link.href} onClick={() => floating && onClose()} className="self-start bg-white text-teal border border-[#9FCFC9] rounded-[7px] px-[11px] py-1.5 text-[13px] font-semibold no-underline">{m.reply.link.label}</Link>
            ) : null}
          </div>
        ))}
        {busy ? <div className="self-start text-[13px] text-muted flex gap-1.5 items-center"><LoaderCircle size={14} className="animate-spin" />{ai.mode === "remote" ? "Asking the remote model…" : "Querying local data…"}</div> : null}
      </div>

      {ai.enabled ? (
        <>
          <div className="flex flex-wrap gap-1.5 px-4 pt-2.5">
            {SUGGEST[lang].map((s) => <button key={s} onClick={() => send(s)} className="border border-[#E3E6E9] bg-white text-ink-2 rounded-full px-2.5 py-[5px] text-[12.5px] cursor-pointer hover:border-[#9FCFC9] hover:text-teal">{s}</button>)}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); send(q); }} className="flex gap-2 px-4 pt-3 pb-2">
            <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} placeholder={placeholder} aria-label="Ask Medoro AI" className="flex-1 min-w-0 border border-input rounded-lg px-3 py-2.5 text-[14px] outline-none focus:border-teal" />
            <button type="submit" title="Send" disabled={busy} className="bg-teal text-white rounded-lg px-3.5 cursor-pointer disabled:opacity-60"><SendHorizontal size={17} /></button>
          </form>
          <div className="px-4 pb-3.5 text-[11.5px] text-faint flex gap-1.5 items-center flex-wrap">
            {ai.mode === "remote" ? <Globe size={13} /> : <HardDrive size={13} />}
            {ai.mode === "remote" ? "Remote AI provider (owner opted in). Minimised data, no customer names or phones by default." : ai.mode === "local" ? "Local model on your server. Nothing sent to external AI." : "Runs on your server, no AI model needed. Nothing sent to external AI."} Not clinical advice.
            {ai.canManage ? <button onClick={() => setEnabled(false)} disabled={switching} className="underline cursor-pointer text-faint hover:text-ink">Turn off</button> : null}
            {switchErr ? <span className="text-[#B42318]">{switchErr}</span> : null}
          </div>
        </>
      ) : null}
    </aside>
  );
}

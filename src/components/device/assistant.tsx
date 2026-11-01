"use client";
import { useRef, useState } from "react";
import { Sparkles, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deviceDb } from "@/drivedb/device";
import { askModel, type AskReply, type AskScope } from "@/drivedb/assistant";
import { card, input, errText, type Cfg, type Who } from "./ui";

const SUGGEST = ["Sales today", "Stock of Dolo 650", "What expires in 30 days?", "Low stock", "Customer dues", "Cash in drawer"];

/**
 * Ask questions about this pharmacy's own data. Answers come from this device: the built-in rules (also offline), or
 * a model through Medoro's gateway when one is set up, which sees only the question and a few looked-up rows.
 */
export function Assistant({ who, cfg }: { who: Who; cfg: Cfg }) {
  const dev = useRef(deviceDb()).current;
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ q: string; a: AskReply | { error: string } }[]>([]);
  const scope: AskScope = { branchId: cfg.branchId, branchName: cfg.branchName, owner: who.owner, canCredit: who.canCredit, lang: "en" };

  const ask = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true); setQ("");
    let a: AskReply | { error: string };
    try {
      const ai = who.ai;
      a = ai
        ? await askModel(scope, text, async (messages, tools) => { const r = await ai.step({ messages, tools }); if (!r.ok) throw new Error(r.error); return r.data; }, {
            run: (name, inp, hi) => dev.call("aiTool", scope, name, inp, hi),
            names: () => dev.call("aiNames"),
            rules: (t) => dev.call("askRules", scope, t),
          }, { remote: ai.remote, remoteNames: ai.remoteNames })
        : await dev.call("askRules", scope, text);
    } catch (e) { a = { error: errText(e) }; }
    setLog((l) => [{ q: text, a }, ...l].slice(0, 20));
    setBusy(false);
  };

  return (
    <div className={card} data-testid="assistant">
      <div className="flex items-center gap-2 font-semibold"><Sparkles size={18} className="text-teal" />Ask about your pharmacy</div>
      <div className="text-[13px] text-muted">{who.ai ? `Answers use this counter’s data. The AI model sees only your question and a few looked-up rows${who.ai.remote && !who.ai.remoteNames ? ", with customer names and numbers hidden" : ""}; Medoro keeps none of it.` : "Answers come from this counter’s own data, with the built-in rules. Works offline."}</div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. sales this week, stock of Pan 40, who owes money" aria-label="Ask a question" className={`${input} flex-1`} maxLength={500} />
        <Button type="submit" variant="primary" disabled={busy || !q.trim()}><Send size={15} /> {busy ? "Thinking…" : "Ask"}</Button>
      </form>
      <div className="flex gap-1.5 flex-wrap">{SUGGEST.map((s) => <button key={s} type="button" onClick={() => void ask(s)} className="text-[12.5px] border border-line rounded-full px-2.5 py-1 hover:border-teal cursor-pointer">{s}</button>)}</div>
      <ul className="flex flex-col gap-3">
        {log.map((x, i) => (
          <li key={i} className="flex flex-col gap-1">
            <div className="self-end bg-teal-tint rounded-lg px-3 py-1.5 text-[13.5px]">{x.q}</div>
            {"error" in x.a ? <div className="text-[13.5px] text-bad">{x.a.error}</div> : (
              <div className="bg-page rounded-lg px-3 py-2 text-[13.5px] flex flex-col gap-1" data-testid="answer">
                <div>{x.a.text}</div>
                {x.a.rows?.length ? <table className="text-[12.5px]"><tbody>{x.a.rows.map((r, j) => <tr key={j}><td className="pr-3">{r.a}</td><td className="pr-3 text-muted">{r.b}</td><td className="text-right tabular-nums">{r.c}</td></tr>)}</tbody></table> : null}
                {x.a.basis ? <div className="text-[11.5px] text-faint">{x.a.basis}</div> : null}
                <div className="text-[11px] text-faint">{x.a.via === "rules" ? "Built-in rules" : x.a.via === "remote" ? "AI model (remote)" : "AI model (local)"}</div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addRecallAction } from "./actions";
import { autoQuarantineAction, disposeAction, reopenAction, resolveAction } from "./report-actions";

const inp = "border border-line rounded-lg px-2 py-1.5 text-[13px] bg-white min-w-0";
const btn = "rounded-lg border border-line px-3 py-1.5 text-[13px] hover:bg-slate-50 disabled:opacity-50";

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const act = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => start(async () => { const r = await fn(); setMsg({ ok: r.ok, text: r.ok ? (r.message ?? "Done.") : (r.error ?? "Failed.") }); if (r.ok) router.refresh(); });
  return { pending, msg, act };
}
const Msg = ({ m }: { m: { ok: boolean; text: string } | null }) => (m ? <p role="status" className={`m-0 text-[12.5px] ${m.ok ? "text-emerald-700" : "text-red-700"}`}>{m.text}</p> : null);

/** A notice that names a manufacturer and product rather than one catalogue medicine. */
export function NoticeForm() {
  const { pending, msg, act } = useAct();
  const [f, setF] = useState({ manufacturer: "", product: "", batches: "", source: "", noticeNo: "", sourceUrl: "", publishedAt: "", reason: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="grid gap-2" data-testid="notice-form" onSubmit={(e) => { e.preventDefault(); act(async () => { const r = await addRecallAction(f); if (r.ok) setF({ ...f, product: "", batches: "", noticeNo: "", sourceUrl: "", reason: "" }); return r.ok ? { ok: true, message: `Recorded ${r.data}.` } : r; }); }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input className={inp} placeholder="Manufacturer as in the notice" aria-label="Manufacturer" value={f.manufacturer} onChange={set("manufacturer")} />
        <input className={inp} placeholder="Product name" aria-label="Product" value={f.product} onChange={set("product")} />
        <input className={inp} placeholder="Affected batch numbers (comma separated)" aria-label="Batch numbers" value={f.batches} onChange={set("batches")} />
        <input className={inp} placeholder="Source (CDSCO, state drug controller, manufacturer)" aria-label="Source" value={f.source} onChange={set("source")} />
        <input className={inp} placeholder="Notice number (optional)" aria-label="Notice number" value={f.noticeNo} onChange={set("noticeNo")} />
        <input className={inp} placeholder="Link to the notice, https:// (optional)" aria-label="Notice link" value={f.sourceUrl} onChange={set("sourceUrl")} />
        <input className={inp} type="date" aria-label="Published on" value={f.publishedAt} onChange={set("publishedAt")} />
        <input className={inp} placeholder="Reason (optional)" aria-label="Reason" value={f.reason} onChange={set("reason")} />
      </div>
      <div className="flex items-center gap-3"><button className={btn} disabled={pending}>Record notice</button><Msg m={msg} /></div>
    </form>
  );
}

export function SettingToggle({ on }: { on: boolean }) {
  const { pending, msg, act } = useAct();
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-[13px]">Block affected stock in every branch as soon as a notice is recorded: <strong>{on ? "On" : "Off"}</strong></span>
      <button className={btn} disabled={pending} data-testid="auto-quarantine-toggle" onClick={() => act(() => autoQuarantineAction(!on))}>{on ? "Turn off" : "Turn on"}</button>
      <Msg m={msg} />
    </div>
  );
}

export function DisposeForm({ recallId, batchId, max }: { recallId: string; batchId: string; max: number }) {
  const { pending, msg, act } = useAct();
  const [f, setF] = useState({ qty: String(max), method: "destroyed" as "destroyed" | "returned_manufacturer", reference: "" });
  return (
    <form className="flex items-center gap-2 flex-wrap" onSubmit={(e) => { e.preventDefault(); act(() => disposeAction(recallId, batchId, Number(f.qty), f.method, f.reference, "")); }}>
      <input className={`${inp} w-20`} inputMode="numeric" aria-label="Units" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
      <select className={inp} aria-label="Method" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as typeof f.method })}><option value="destroyed">Destroyed</option><option value="returned_manufacturer">Returned to manufacturer</option></select>
      <input className={`${inp} w-48`} placeholder="Certificate / return note no." aria-label="Reference" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
      <button className={btn} disabled={pending}>Record disposal</button><Msg m={msg} />
    </form>
  );
}

export function ResolveForm({ id, resolved, closable }: { id: string; resolved: boolean; closable: boolean }) {
  const { pending, msg, act } = useAct();
  const [note, setNote] = useState("");
  if (resolved) return <div className="flex items-center gap-2"><button className={btn} disabled={pending} onClick={() => act(() => reopenAction(id))}>Reopen</button><Msg m={msg} /></div>;
  return (
    <form className="flex items-center gap-2 flex-wrap" onSubmit={(e) => { e.preventDefault(); act(() => resolveAction(id, note)); }}>
      <input className={`${inp} w-80`} placeholder={closable ? "Closing note (optional)" : "Why does affected stock remain? (required)"} aria-label="Closing note" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className={btn} disabled={pending} data-testid="resolve-btn">Resolve recall</button><Msg m={msg} />
    </form>
  );
}

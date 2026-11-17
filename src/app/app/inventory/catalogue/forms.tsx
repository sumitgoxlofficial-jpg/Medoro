"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SyncField } from "@/domain/inventory/catalogue-rules";
import { addAction, applyAction, correctionAction, linkAction, reviewedAction, unlinkAction } from "./actions";

const inp = "border border-line rounded-lg px-2 py-1.5 text-[13px] bg-white min-w-0";
const btn = "rounded-lg border border-line px-3 py-1.5 text-[13px] hover:bg-slate-50 disabled:opacity-50";
type Res = { ok: boolean; error?: string; message?: string };
function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const act = (fn: () => Promise<Res>) => start(async () => { const r = await fn(); setMsg({ ok: r.ok, text: r.ok ? (r.message ?? "Done.") : (r.error ?? "Failed.") }); if (r.ok) router.refresh(); });
  return { pending, msg, act };
}
const Msg = ({ m }: { m: { ok: boolean; text: string } | null }) => (m ? <span role="status" className={`text-[12.5px] ${m.ok ? "text-emerald-700" : "text-red-700"}`}>{m.text}</span> : null);

export function LinkButton({ medicineId, gid }: { medicineId: string; gid: string }) {
  const { pending, msg, act } = useAct();
  return <span className="inline-flex items-center gap-2"><button className={btn} disabled={pending} onClick={() => act(() => linkAction(medicineId, gid))}>Link</button><Msg m={msg} /></span>;
}
export function UnlinkButton({ medicineId }: { medicineId: string }) {
  const { pending, msg, act } = useAct();
  return <span className="inline-flex items-center gap-2"><button className={btn} disabled={pending} onClick={() => act(() => unlinkAction(medicineId))}>Unlink</button><Msg m={msg} /></span>;
}
export function ReviewedButton() {
  const { pending, msg, act } = useAct();
  return <span className="inline-flex items-center gap-2"><button className={btn} disabled={pending} onClick={() => act(() => reviewedAction())}>Mark as reviewed</button><Msg m={msg} /></span>;
}

export function AddFromCatalogue({ gid }: { gid: string }) {
  const { pending, msg, act } = useAct();
  const [mrp, setMrp] = useState("");
  return (
    <form className="inline-flex items-center gap-2 flex-wrap" onSubmit={(e) => { e.preventDefault(); act(() => addAction(gid, mrp)); }}>
      <input className={`${inp} w-28`} inputMode="decimal" placeholder="Your MRP ₹" aria-label="Your MRP" value={mrp} onChange={(e) => setMrp(e.target.value)} />
      <button className={btn} disabled={pending}>Add to my medicines</button><Msg m={msg} />
    </form>
  );
}

export function ApplyForm({ medicineId, diffs }: { medicineId: string; diffs: { field: SyncField; local: string; central: string; sensitive: boolean }[] }) {
  const { pending, msg, act } = useAct();
  const [sel, setSel] = useState<SyncField[]>([]);
  const toggle = (f: SyncField) => setSel((s) => (s.includes(f) ? s.filter((x) => x !== f) : [...s, f]));
  return (
    <div className="grid gap-1">
      {diffs.map((d) => (
        <label key={d.field} className="flex items-start gap-2 text-[13px]"><input type="checkbox" className="mt-1" checked={sel.includes(d.field)} onChange={() => toggle(d.field)} aria-label={`Update ${d.field}`} />
          <span><strong>{d.field}</strong>: yours “{d.local || "empty"}” → catalogue “{d.central || "empty"}”{d.sensitive ? <span className="ml-1 text-amber-800 text-[12px]"> (affects how new bills are taxed or controlled; old bills keep what they were billed at)</span> : null}</span></label>
      ))}
      <div className="flex items-center gap-2"><button className={btn} disabled={pending || !sel.length} onClick={() => act(() => applyAction(medicineId, sel))}>Update selected fields</button><Msg m={msg} /></div>
    </div>
  );
}

export function CorrectionForm({ gid }: { gid: string }) {
  const { pending, msg, act } = useAct();
  const [f, setF] = useState({ field: "manufacturer", proposed: "", reason: "" });
  return (
    <form className="flex items-center gap-2 flex-wrap" onSubmit={(e) => { e.preventDefault(); act(() => correctionAction({ gid, field: f.field as never, proposed: f.proposed, reason: f.reason })); }}>
      <select className={inp} aria-label="Field" value={f.field} onChange={(e) => setF({ ...f, field: e.target.value })}>{["brand", "generic", "composition", "strength", "form", "manufacturer", "packSize", "packLabel", "hsn", "gstRate", "schedule"].map((x) => <option key={x}>{x}</option>)}</select>
      <input className={`${inp} w-44`} placeholder="Correct value" aria-label="Correct value" value={f.proposed} onChange={(e) => setF({ ...f, proposed: e.target.value })} />
      <input className={`${inp} w-56`} placeholder="How you know (e.g. pack photo)" aria-label="Reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      <button className={btn} disabled={pending}>Report a mistake</button><Msg m={msg} />
    </form>
  );
}

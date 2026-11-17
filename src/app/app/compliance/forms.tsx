"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closeInspectionAction, inspectionAction, itemActiveAction, saveItemAction, settingsAction, uploadAction } from "./actions";

const inp = "border border-line rounded-lg px-2 py-1.5 text-[13px] bg-white min-w-0";
const btn = "rounded-lg border border-line px-3 py-1.5 text-[13px] hover:bg-slate-50 disabled:opacity-50";
type Res = { ok: boolean; error?: string; message?: string };

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const act = (fn: () => Promise<Res>, after?: () => void) => start(async () => { const r = await fn(); setMsg({ ok: r.ok, text: r.ok ? (r.message ?? "Done.") : (r.error ?? "Failed.") }); if (r.ok) { after?.(); router.refresh(); } });
  return { pending, msg, act };
}
const Msg = ({ m }: { m: { ok: boolean; text: string } | null }) => (m ? <p role="status" className={`m-0 text-[12.5px] ${m.ok ? "text-emerald-700" : "text-red-700"}`}>{m.text}</p> : null);

type Opt = readonly (readonly [string, string])[];
export type EditItem = { id: string; version: number; branchId: string | null; kind: string; title: string; number: string | null; holder: string | null; authority: string | null; issuedOn: string | null; expiresOn: string | null; remindDays: number[]; notes: string | null };

export function ItemForm({ branches, kinds, edit }: { branches: { id: string; name: string }[]; kinds: Opt; edit?: EditItem }) {
  const { pending, msg, act } = useAct();
  const [f, setF] = useState({ branchId: edit?.branchId ?? branches[0]?.id ?? "", kind: edit?.kind ?? "retail_licence", title: edit?.title ?? "", number: edit?.number ?? "", holder: edit?.holder ?? "", authority: edit?.authority ?? "", issuedOn: edit?.issuedOn ?? "", expiresOn: edit?.expiresOn ?? "", remind: (edit?.remindDays ?? [60, 30, 7]).join(", "), notes: edit?.notes ?? "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="grid gap-2" data-testid={edit ? "item-edit-form" : "item-form"} onSubmit={(e) => { e.preventDefault(); act(() => saveItemAction(edit?.id ?? null, { branchId: f.branchId || null, kind: f.kind, title: f.title, number: f.number, holder: f.holder, authority: f.authority, issuedOn: f.issuedOn || null, expiresOn: f.expiresOn || null, notes: f.notes, remindDays: f.remind.split(/[,\s]+/).filter(Boolean).map(Number).filter((n) => Number.isFinite(n)) }, edit?.version), () => { if (!edit) setF({ ...f, title: "", number: "", holder: "", expiresOn: "", issuedOn: "" }); }); }}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <select className={inp} aria-label="Applies to" value={f.branchId} onChange={set("branchId")}><option value="">Whole pharmacy</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <select className={inp} aria-label="Kind" value={f.kind} onChange={set("kind")}>{kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input className={inp} placeholder="Title" aria-label="Title" value={f.title} onChange={set("title")} />
        <input className={inp} placeholder="Number" aria-label="Number" value={f.number} onChange={set("number")} />
        <input className={inp} placeholder="Holder (e.g. registered pharmacist)" aria-label="Holder" value={f.holder} onChange={set("holder")} />
        <input className={inp} placeholder="Issuing authority" aria-label="Authority" value={f.authority} onChange={set("authority")} />
        <label className="flex flex-col text-[11px] text-slate-500">Issued on<input className={inp} type="date" aria-label="Issued on" value={f.issuedOn} onChange={set("issuedOn")} /></label>
        <label className="flex flex-col text-[11px] text-slate-500">Expires on (leave empty if it does not expire)<input className={inp} type="date" aria-label="Expires on" value={f.expiresOn} onChange={set("expiresOn")} /></label>
        <label className="flex flex-col text-[11px] text-slate-500">Remind this many days before expiry<input className={inp} aria-label="Remind days" value={f.remind} onChange={set("remind")} /></label>
      </div>
      <input className={inp} placeholder="Notes (optional)" aria-label="Notes" value={f.notes} onChange={set("notes")} />
      <div className="flex items-center gap-3"><button className={btn} disabled={pending}>{edit ? "Save changes" : "Add item"}</button><Msg m={msg} /></div>
    </form>
  );
}

export function ActiveButton({ id, active }: { id: string; active: boolean }) {
  const { pending, msg, act } = useAct();
  return <span className="inline-flex items-center gap-2"><button className={btn} disabled={pending} onClick={() => act(() => itemActiveAction(id, !active))}>{active ? "Switch off" : "Switch on"}</button><Msg m={msg} /></span>;
}

export function UploadForm({ itemId, inspectionId, kind }: { itemId?: string; inspectionId?: string; kind: "licence_copy" | "inspection_report" }) {
  const { pending, msg, act } = useAct();
  return (
    <form className="flex items-center gap-2 flex-wrap" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); fd.set("kind", kind); if (itemId) fd.set("itemId", itemId); if (inspectionId) fd.set("inspectionId", inspectionId); act(() => uploadAction(fd), () => (e.currentTarget as HTMLFormElement | null)?.reset()); }}>
      <input className={`${inp} w-44`} name="title" placeholder="Document title" aria-label="Document title" />
      <input className="text-[12px] max-w-[220px]" name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" aria-label="File" />
      <button className={btn} disabled={pending}>Upload</button><Msg m={msg} />
    </form>
  );
}

export function InspectionForm({ branches, outcomes }: { branches: { id: string; name: string }[]; outcomes: Opt }) {
  const { pending, msg, act } = useAct();
  const [f, setF] = useState({ branchId: branches[0]?.id ?? "", inspectedOn: "", authority: "", inspector: "", outcome: "no_findings", findings: "", actionDue: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="grid gap-2" data-testid="inspection-form" onSubmit={(e) => { e.preventDefault(); act(() => inspectionAction({ ...f, inspector: f.inspector, actionDue: f.actionDue || null }), () => setF({ ...f, findings: "", actionDue: "", inspector: "" })); }}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <select className={inp} aria-label="Branch" value={f.branchId} onChange={set("branchId")}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <input className={inp} type="date" aria-label="Inspected on" value={f.inspectedOn} onChange={set("inspectedOn")} />
        <input className={inp} placeholder="Authority" aria-label="Inspecting authority" value={f.authority} onChange={set("authority")} />
        <input className={inp} placeholder="Inspector (optional)" aria-label="Inspector" value={f.inspector} onChange={set("inspector")} />
        <select className={inp} aria-label="Outcome" value={f.outcome} onChange={set("outcome")}>{outcomes.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <label className="flex flex-col text-[11px] text-slate-500">Action due by (optional)<input className={inp} type="date" aria-label="Action due" value={f.actionDue} onChange={set("actionDue")} /></label>
      </div>
      <input className={inp} placeholder="Findings" aria-label="Findings" value={f.findings} onChange={set("findings")} />
      <div className="flex items-center gap-3"><button className={btn} disabled={pending}>Record inspection</button><Msg m={msg} /></div>
    </form>
  );
}

export function CloseForm({ id }: { id: string }) {
  const { pending, msg, act } = useAct();
  const [note, setNote] = useState("");
  return (
    <form className="flex items-center gap-2 flex-wrap" onSubmit={(e) => { e.preventDefault(); act(() => closeInspectionAction(id, note)); }}>
      <input className={`${inp} w-72`} placeholder="What was done to close the findings" aria-label="Closing note" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className={btn} disabled={pending}>Close findings</button><Msg m={msg} />
    </form>
  );
}

export function SettingsForm({ kinds, required, retention, isDefault }: { kinds: Opt; required: { kind: string; scope: "branch" | "pharmacy" }[]; retention: { label: string; years: number | null; note: string }[]; isDefault: boolean }) {
  const { pending, msg, act } = useAct();
  const [req, setReq] = useState<Record<string, "" | "branch" | "pharmacy">>(Object.fromEntries(kinds.map(([k]) => [k, required.find((r) => r.kind === k)?.scope ?? ""])));
  const [ret, setRet] = useState(retention.map((r) => `${r.label} | ${r.years ?? ""} | ${r.note}`).join("\n"));
  return (
    <form className="grid gap-3" data-testid="compliance-settings" onSubmit={(e) => { e.preventDefault(); act(() => settingsAction({
      required: Object.entries(req).filter(([, v]) => v).map(([kind, scope]) => ({ kind, scope: scope as "branch" | "pharmacy" })),
      retention: ret.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [label, years, ...note] = l.split("|").map((x) => x.trim()); return { label, years: years ? Number(years) : null, note: note.join(" | ") }; }),
    })); }}>
      <p className="m-0 text-[12.5px] text-slate-600">{isDefault ? "You are using suggested starting requirements. Medoro does not know what your licence conditions require: confirm this list with your regulatory adviser and save it." : "These are the items you chose to require."}</p>
      <div className="grid gap-1">{kinds.map(([k, l]) => (
        <label key={k} className="flex items-center gap-2 text-[13px]"><select className={inp} aria-label={`Requirement for ${l}`} value={req[k]} onChange={(e) => setReq({ ...req, [k]: e.target.value as "" | "branch" | "pharmacy" })}><option value="">Not required</option><option value="branch">Each branch needs one</option><option value="pharmacy">The pharmacy needs one</option></select>{l}</label>))}</div>
      <label className="flex flex-col gap-1 text-[12.5px] text-slate-600">Record-retention periods you have decided on, one per line: <em>record | years | note</em>
        <textarea className={`${inp} min-h-[80px] font-mono`} aria-label="Retention periods" value={ret} onChange={(e) => setRet(e.target.value)} placeholder="Prescription copies | 3 | agreed with our adviser" /></label>
      <div className="flex items-center gap-3"><button className={btn} disabled={pending}>Save settings</button><Msg m={msg} /></div>
    </form>
  );
}

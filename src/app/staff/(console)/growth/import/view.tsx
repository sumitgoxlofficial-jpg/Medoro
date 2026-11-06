"use client";
import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { commitImport, continueImport, importErrors, previewImport } from "../../../growth-actions";
import { Empty, Panel, Pill, btn, btnPrimary, fieldCls, lbl, selSm, td, th, useRun } from "../../ui";
import { downloadText, fmtDT } from "../kit";

type Preview = { header: string[]; mapping: Record<string, number>; fields: { key: string; label: string; required: boolean }[]; counts: Record<string, number>; rows: { line: number; name: string; phone: string; city: string; pin: string; status: string; messages: string[] }[] };
type J = { id: string; code: string; fileName: string; status: string; source: string; totalRows: number; created: number; duplicates: number; possibleDuplicates: number; invalid: number; processed: number; createdAt: string };
const TONE: Record<string, [string, string]> = { new: ["#E3F5EC", "#18794E"], possible: ["#FFF4E0", "#94570A"], duplicate: ["#EEF0F2", "#3D454D"], invalid: ["#FBEAE9", "#C0362C"], erased: ["#FBEAE9", "#C0362C"] };
const TEMPLATE = "Pharmacy name,Category,Owner / contact person,Phone,Email,Website,Full address,City,District,State,PIN code,Source URL\nShivam Medical & General Stores,RETAIL,,020-2553 1234,,,\"Shop 4, FC Road\",Pune,Pune,Maharashtra,411005,\n";

export function ImportView({ jobs, sources }: { jobs: J[]; sources: { id: string; name: string; kind: string }[] }) {
  const { run, busy } = useRun();
  const fileRef = useRef<HTMLInputElement>(null);
  const [p, setP] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [src, setSrc] = useState({ sourceId: "", newName: "", kind: "public_directory", licence: "", attribution: "", allowsExport: true, lawful: false });
  const fd = () => { const f = new FormData(); const file = fileRef.current?.files?.[0]; if (file) f.set("file", file); return f; };
  const preview = (m?: Record<string, number>) => run(() => previewImport(fd(), m), (r) => { setP(r); setMapping(r.mapping); });
  const commit = () => run(() => commitImport(fd(), mapping, { sourceId: src.sourceId || undefined, newSource: !src.sourceId && src.newName ? { name: src.newName, kind: src.kind as "upload", licence: src.licence, attribution: src.attribution, termsUrl: "", allowsExport: src.allowsExport } : undefined, confirmLawful: src.lawful as true }),
    (j) => { setP(null); if (fileRef.current) fileRef.current.value = ""; return j.status === "completed" ? `${j.code}: ${j.created} leads created, ${j.duplicates} duplicates, ${j.invalid} rows with problems.` : `${j.code} is running in the background.`; });
  return (
    <>
      <Panel title="Import pharmacy leads" sub="CSV or Excel (.xlsx), up to 10,000 rows and 10 MB. Check the preview; nothing is saved until you import." right={<button className={btn} onClick={() => downloadText("medoro-lead-template.csv", TEMPLATE)}><Download size={14} />Template</button>}>
        <div className="flex gap-2 p-4 flex-wrap items-center">
          <input ref={fileRef} type="file" accept=".csv,.xlsx" className="text-[13px]" onChange={() => setP(null)} />
          <button className={btnPrimary} disabled={busy} onClick={() => preview()}><Upload size={15} />Preview</button>
        </div>
        {p ? (<>
          <div className="px-4 pb-2 flex gap-2 flex-wrap text-[13px]">{Object.entries(p.counts).map(([k, n]) => <Pill key={k} bg={(TONE[k] ?? ["#EEF0F2", "#3D454D"])[0]} fg={(TONE[k] ?? ["#EEF0F2", "#3D454D"])[1]}>{k}: {n}</Pill>)}</div>
          <div className="px-4 pb-3"><strong className="text-[13px]">Column mapping</strong>
            <div className="grid gap-2 mt-2 grid-cols-2 min-[900px]:grid-cols-4">{p.fields.map((f) => (
              <label key={f.key} className={lbl}>{f.label}{f.required ? " *" : ""}<select className={selSm} value={mapping[f.key] ?? ""} onChange={(e) => { const m = { ...mapping }; if (e.target.value === "") delete m[f.key]; else m[f.key] = Number(e.target.value); setMapping(m); }}><option value="">— not in file —</option>{p.header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}</select></label>
            ))}</div>
            <button className={btn + " mt-2"} disabled={busy} onClick={() => preview(mapping)}>Re-check with this mapping</button>
          </div>
          <div className="overflow-auto max-h-[360px] border-y border-[#EEF0F2]"><table className="w-full border-collapse min-w-[760px] text-[13px]">
            <thead className="sticky top-0"><tr className="bg-[#FAFBFB] text-muted text-[12px]"><th className={th}>Line</th><th className={th}>Pharmacy</th><th className={th}>Phone</th><th className={th}>City</th><th className={th}>PIN</th><th className={th}>Result</th><th className={th}>Notes</th></tr></thead>
            <tbody>{p.rows.map((r) => <tr key={r.line}><td className={td}>{r.line}</td><td className={td}>{r.name}</td><td className={td + " tnum"}>{r.phone}</td><td className={td}>{r.city}</td><td className={td}>{r.pin}</td><td className={td}><Pill bg={TONE[r.status][0]} fg={TONE[r.status][1]}>{r.status}</Pill></td><td className={td + " text-[12px]"}>{r.messages.join(" ")}</td></tr>)}</tbody>
          </table></div>
          <div className="grid gap-2.5 p-4 grid-cols-2 min-[900px]:grid-cols-4">
            <label className={lbl}>Source of this list<select className={fieldCls} value={src.sourceId} onChange={(e) => setSrc({ ...src, sourceId: e.target.value })}><option value="">New source…</option>{sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            {!src.sourceId ? (<>
              <label className={lbl}>Source name *<input className={fieldCls} value={src.newName} onChange={(e) => setSrc({ ...src, newName: e.target.value })} placeholder="e.g. Chemists association directory 2026" /></label>
              <label className={lbl}>Kind<select className={fieldCls} value={src.kind} onChange={(e) => setSrc({ ...src, kind: e.target.value })}><option value="public_directory">Official public directory</option><option value="official_api">Official API export</option><option value="provider">Licensed data provider</option><option value="submitted">Submitted by pharmacies</option><option value="upload">Other business list</option></select></label>
              <label className={lbl}>Licence / terms<input className={fieldCls} value={src.licence} onChange={(e) => setSrc({ ...src, licence: e.target.value })} /></label>
              <label className={lbl + " col-span-2"}>Attribution required<input className={fieldCls} value={src.attribution} onChange={(e) => setSrc({ ...src, attribution: e.target.value })} /></label>
              <label className="flex gap-2 items-center text-[13px] col-span-2"><input type="checkbox" checked={src.allowsExport} onChange={(e) => setSrc({ ...src, allowsExport: e.target.checked })} />The source’s terms allow exporting these records</label>
            </>) : null}
            <label className="flex gap-2 items-start text-[13px] col-span-2 min-[900px]:col-span-4"><input type="checkbox" className="mt-1" checked={src.lawful} onChange={(e) => setSrc({ ...src, lawful: e.target.checked })} />I confirm this list was collected lawfully (no scraping against a site’s terms, no patient data) and its terms allow Medoro to use it for B2B prospecting.</label>
            <div className="col-span-2"><button className={btnPrimary} disabled={busy || !src.lawful || (!src.sourceId && src.newName.trim().length < 3)} onClick={commit}>Import {p.counts.new + p.counts.possible} new leads</button></div>
          </div>
        </>) : null}
      </Panel>
      <Panel title="Import history">
        {jobs.length ? (
          <div className="overflow-auto"><table className="w-full border-collapse min-w-[860px] text-[13.5px]">
            <thead><tr className="bg-[#FAFBFB] text-muted text-[12px]"><th className={th}>Import</th><th className={th}>File</th><th className={th}>Source</th><th className={th}>Status</th><th className={th + " text-right"}>Rows</th><th className={th + " text-right"}>Created</th><th className={th + " text-right"}>Duplicates</th><th className={th + " text-right"}>For review</th><th className={th + " text-right"}>Problems</th><th className={th}>When</th></tr></thead>
            <tbody>{jobs.map((j) => <tr key={j.id}><td className={td}>{j.code}</td><td className={td}>{j.fileName}</td><td className={td}>{j.source}</td><td className={td}>{j.status}{j.status === "running" ? <> ({j.processed}) <button className="text-teal underline" disabled={busy} onClick={() => run(() => continueImport(j.id), (r) => `${r.code}: ${r.processed} rows done${r.status === "completed" ? ", finished" : ""}.`)}>continue</button></> : ""}</td><td className={td + " text-right tnum"}>{j.totalRows}</td><td className={td + " text-right tnum"}>{j.created}</td><td className={td + " text-right tnum"}>{j.duplicates}</td><td className={td + " text-right tnum"}>{j.possibleDuplicates}</td><td className={td + " text-right tnum"}>{j.invalid ? <button className="text-teal underline" onClick={() => run(() => importErrors(j.id), (r) => { downloadText(r.name + ".csv", r.csv); })}>{j.invalid} · download</button> : 0}</td><td className={td}>{fmtDT(j.createdAt)}</td></tr>)}</tbody>
          </table></div>
        ) : <Empty>No imports yet.</Empty>}
      </Panel>
    </>
  );
}

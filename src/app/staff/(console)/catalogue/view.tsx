"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { catalogueBarcodeAdd, catalogueBarcodeVerify, catalogueCreate, catalogueDeprecate, catalogueImport, catalogueResolve, catalogueVerify } from "../../actions";
import { Empty, Panel, Pill, btn, btnPrimary, fieldCls, lbl, td, th, useRun } from "../ui";

type E = { gid: string; brand: string; generic: string; strength: string; form: string; manufacturer: string; packSize: number; hsn: string; gstRate: number; schedule: string; status: string; source: string; sourceRef: string | null; verifiedOn: string | null; verifiedBy: string | null; version: number; supersededByGid: string | null; barcodes: { barcode: string; verified: boolean }[] };
type Dup = { a: string; b: string; reason: string; score: number };
type Cor = { id: string; gid: string; field: string; proposed: string; reason: string; pharmacy: string; createdByName: string };
const FORMS = ["Tablet", "Capsule", "Syrup", "Suspension", "Injection", "Gel", "Cream", "Ointment", "Drops", "Sachet", "Powder", "Inhaler", "Device", "Other"];
const ST: Record<string, [string, string]> = { draft: ["#FDF2E1", "#94570A"], verified: ["#E7F6EE", "#18794E"], deprecated: ["#F1F3F4", "#5B636B"] };
const COLS = ["brand", "generic", "composition", "strength", "form", "manufacturer", "packSize", "packLabel", "hsn", "gstRate", "schedule", "source", "sourceRef"] as const;

/** CSV with a header row naming the columns above. Quoted fields may hold commas. */
function parseCsv(text: string) {
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/).filter((l) => l.trim())) {
    const out: string[] = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (c === "," && !q) { out.push(cur.trim()); cur = ""; } else cur += c; }
    out.push(cur.trim()); rows.push(out);
  }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries((head ?? []).map((h, i) => [h, r[i] ?? ""]))) as Record<string, string>[];
}

export function CatalogueView({ entries, version, duplicates, corrections, q, status }: { entries: E[]; version: number; duplicates: Dup[]; corrections: Cor[]; q: string; status: string }) {
  const { run, busy } = useRun();
  const router = useRouter();
  const blank = { brand: "", generic: "", composition: "", strength: "", form: "Tablet", manufacturer: "", packSize: "1", packLabel: "", hsn: "3004", gstRate: "12", schedule: "", source: "", sourceRef: "" };
  const [f, setF] = useState(blank);
  const [csv, setCsv] = useState("");
  const [report, setReport] = useState<string | null>(null);
  const [verifyRef, setVerifyRef] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [bc, setBc] = useState<Record<string, { code: string; source: string }>>({});
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Medicine catalogue" sub={`Catalogue version ${version}. Shared with every pharmacy read-only; no prices and no pharmacy data. Entries are drafts until you verify them against a named source.`}>
        <form className="px-4 py-3 flex gap-2 flex-wrap items-end" onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); router.push(`/staff/catalogue?${new URLSearchParams({ q: String(d.get("q") ?? ""), status: String(d.get("status") ?? "") })}`); }}>
          <label className={lbl}>Search<input name="q" defaultValue={q} className={fieldCls} placeholder="Brand, generic, manufacturer or CM-…" /></label>
          <label className={lbl}>Status<select name="status" defaultValue={status} className={fieldCls}><option value="">All</option><option value="draft">Draft</option><option value="verified">Verified</option><option value="deprecated">Deprecated</option></select></label>
          <button className={btn}>Search</button>
        </form>
        {entries.length ? <div className="overflow-x-auto"><table className="w-full text-[13px]"><thead><tr className="text-muted"><th className={th}>ID</th><th className={th}>Product</th><th className={th}>Tax</th><th className={th}>Status</th><th className={th}>Source and verification</th><th className={th}>Barcodes</th><th className={th}></th></tr></thead>
          <tbody>{entries.map((e) => { const [bg, fg] = ST[e.status]; return (
            <tr key={e.gid} data-testid="cat-entry">
              <td className={td + " font-mono"}>{e.gid}<div className="text-[11px] text-muted">v{e.version}</div></td>
              <td className={td}><strong>{e.brand}</strong> {e.strength} · {e.form}<div className="text-[12px] text-muted">{e.generic} · {e.manufacturer} · pack {e.packSize}{e.schedule ? ` · Schedule ${e.schedule}` : ""}</div></td>
              <td className={td}>HSN {e.hsn}<div className="text-[12px] text-muted">GST {e.gstRate}%</div></td>
              <td className={td}><Pill bg={bg} fg={fg}>{e.status}</Pill>{e.supersededByGid ? <div className="text-[11px] text-muted">→ {e.supersededByGid}</div> : null}</td>
              <td className={td + " text-[12px]"}>{e.source}{e.sourceRef ? <div>ref: {e.sourceRef}</div> : null}{e.verifiedOn ? <div className="text-muted">verified {e.verifiedOn} by {e.verifiedBy}</div> : null}</td>
              <td className={td + " text-[12px]"}>{e.barcodes.map((b) => <div key={b.barcode} className="font-mono">{b.barcode} {b.verified ? "✓" : <button className="underline" disabled={busy} onClick={() => run(() => catalogueBarcodeVerify(b.barcode))}>verify</button>}</div>)}</td>
              <td className={td}>{e.status !== "deprecated" ? (
                <details><summary className="cursor-pointer text-[12.5px] underline">Actions</summary>
                  <div className="mt-2 grid gap-2 min-w-[260px]">
                    {e.status === "draft" ? <div className="flex gap-1"><input className={fieldCls} placeholder="Source reference you checked" value={verifyRef[e.gid] ?? ""} onChange={(x) => setVerifyRef({ ...verifyRef, [e.gid]: x.target.value })} /><button className={btn} disabled={busy} onClick={() => run(() => catalogueVerify(e.gid, verifyRef[e.gid] ?? ""))}>Verify</button></div> : null}
                    <div className="flex gap-1"><input className={fieldCls} placeholder="Barcode (EAN/GTIN)" value={bc[e.gid]?.code ?? ""} onChange={(x) => setBc({ ...bc, [e.gid]: { code: x.target.value, source: bc[e.gid]?.source ?? "" } })} /><input className={fieldCls} placeholder="Where read" value={bc[e.gid]?.source ?? ""} onChange={(x) => setBc({ ...bc, [e.gid]: { code: bc[e.gid]?.code ?? "", source: x.target.value } })} /><button className={btn} disabled={busy} onClick={() => run(() => catalogueBarcodeAdd(e.gid, bc[e.gid]?.code ?? "", bc[e.gid]?.source ?? "", false))}>Add</button></div>
                    <div className="flex gap-1"><input className={fieldCls} placeholder="Why withdrawn; replacement id optional (CM-…)" value={note[e.gid] ?? ""} onChange={(x) => setNote({ ...note, [e.gid]: x.target.value })} /><button className={btn} disabled={busy} onClick={() => { const [why, rep] = (note[e.gid] ?? "").split(";").map((s) => s.trim()); run(() => catalogueDeprecate(e.gid, why ?? "", rep ?? "")); }}>Withdraw</button></div>
                  </div></details>) : null}</td>
            </tr>); })}</tbody></table></div> : <Empty>The catalogue is empty. Add the first entry below; nothing is imported automatically.</Empty>}
      </Panel>

      <Panel title="Possible duplicates" sub="Pairs with the same salt, strength, form, manufacturer and pack and a nearly identical brand name. For a person to review; nothing is merged automatically.">
        {duplicates.length ? <ul className="m-0 px-4 py-3 pl-8 text-[13px]">{duplicates.map((d) => <li key={d.a + d.b}><span className="font-mono">{d.a}</span> and <span className="font-mono">{d.b}</span>: {d.reason}</li>)}</ul> : <Empty>No likely duplicates.</Empty>}
      </Panel>

      <Panel title="Corrections from pharmacies" sub="Accepting applies the proposed value to the entry (and bumps its version); declining needs a reason.">
        {corrections.length ? <div className="overflow-x-auto"><table className="w-full text-[13px]"><tbody>{corrections.map((c) => (
          <tr key={c.id} data-testid="cat-correction"><td className={td}><span className="font-mono">{c.gid}</span> · {c.field} → <strong>{c.proposed}</strong><div className="text-[12px] text-muted">{c.pharmacy} · {c.createdByName}: {c.reason}</div></td>
            <td className={td}><div className="flex gap-1"><input className={fieldCls} placeholder="Note" value={note[c.id] ?? ""} onChange={(x) => setNote({ ...note, [c.id]: x.target.value })} /><button className={btn} disabled={busy} onClick={() => run(() => catalogueResolve(c.id, true, note[c.id] ?? ""))}>Accept</button><button className={btn} disabled={busy} onClick={() => run(() => catalogueResolve(c.id, false, note[c.id] ?? ""))}>Decline</button></div></td></tr>))}</tbody></table></div> : <Empty>No corrections waiting.</Empty>}
      </Panel>

      <Panel title="Add an entry" sub="Name where it comes from. It stays a draft, invisible to pharmacies, until you verify it.">
        <form className="px-4 py-4 grid gap-3" onSubmit={(e) => { e.preventDefault(); run(() => catalogueCreate({ ...f, packSize: Number(f.packSize), gstRate: Number(f.gstRate) } as never), () => setF(blank)); }}>
          <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
            <label className={lbl}>Brand<input className={fieldCls} value={f.brand} onChange={set("brand")} /></label>
            <label className={lbl}>Generic / salt<input className={fieldCls} value={f.generic} onChange={set("generic")} /></label>
            <label className={lbl}>Composition (combinations)<input className={fieldCls} value={f.composition} onChange={set("composition")} /></label>
            <label className={lbl}>Strength<input className={fieldCls} value={f.strength} onChange={set("strength")} /></label>
            <label className={lbl}>Form<select className={fieldCls} value={f.form} onChange={set("form")}>{FORMS.map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className={lbl}>Manufacturer<input className={fieldCls} value={f.manufacturer} onChange={set("manufacturer")} /></label>
            <label className={lbl}>Units per pack<input className={fieldCls} value={f.packSize} onChange={set("packSize")} /></label>
            <label className={lbl}>Pack label<input className={fieldCls} value={f.packLabel} onChange={set("packLabel")} /></label>
            <label className={lbl}>HSN<input className={fieldCls} value={f.hsn} onChange={set("hsn")} /></label>
            <label className={lbl}>GST %<select className={fieldCls} value={f.gstRate} onChange={set("gstRate")}>{[0, 5, 12, 18, 28].map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className={lbl}>Schedule<select className={fieldCls} value={f.schedule} onChange={set("schedule")}>{["", "H", "H1", "X", "G", "NDPS"].map((x) => <option key={x} value={x}>{x || "None"}</option>)}</select></label>
            <label className={lbl}>Source<input className={fieldCls} value={f.source} onChange={set("source")} placeholder="Where this comes from" /></label>
          </div>
          <div><button className={btnPrimary} disabled={busy}>Add draft</button></div>
        </form>
      </Panel>

      <Panel title="Import drafts from CSV" sub={`Header row with: ${COLS.join(", ")}. Up to 500 rows. Rows that duplicate a live entry or fail validation are reported and skipped.`}>
        <div className="px-4 py-4 grid gap-2">
          <textarea className={fieldCls + " min-h-[110px] font-mono text-[12px]"} value={csv} onChange={(e) => setCsv(e.target.value)} aria-label="CSV rows" />
          <div className="flex items-center gap-3"><button className={btn} disabled={busy || !csv.trim()} onClick={() => run(() => catalogueImport(parseCsv(csv) as never), (r: { created: string[]; duplicates: { row: number; message: string }[]; invalid: { row: number; message: string }[] }) => { setReport(`${r.created.length} created. ${r.duplicates.length} duplicate: ${r.duplicates.map((d) => `row ${d.row}`).join(", ") || "none"}. ${r.invalid.length} invalid: ${r.invalid.map((d) => `row ${d.row} (${d.message})`).join("; ") || "none"}.`); })}>Import</button>{report ? <span role="status" className="text-[12.5px]">{report}</span> : null}</div>
        </div>
      </Panel>
    </div>
  );
}

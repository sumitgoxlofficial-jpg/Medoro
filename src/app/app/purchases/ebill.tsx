"use client";
import { useEffect, useState, useTransition } from "react";
import { FileUp, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { inr } from "@/lib/money";
import { EBILL_FIELDS, type EbillField, type EbillMapping } from "@/domain/purchasing/ebill";
import type { EbillResult, MatchedLine } from "@/domain/purchasing/ebill-service";
import { FORMS, GST_RATES } from "@/domain/inventory/contracts";
import { addMedicineAction } from "../inventory/actions";
import { parseEbillAction } from "./pricing-actions";

export type EbillApply = { invoiceNo: string; invoiceDate: string; lines: MatchedLine[] };
type Cat = { id: string; label: string; pack: string; gstRate: number; mrp: number };

const MATCH: Record<NonNullable<MatchedLine["matchedBy"]>, [string, "green" | "teal" | "amber"]> = { barcode: ["Barcode", "green"], code: ["Item code", "green"], learned: ["Learned", "teal"], name: ["Name match: check", "amber"] };
const sel = "border border-input rounded-md px-2 py-1 text-[12.5px] bg-white outline-none focus:border-teal w-full min-w-0";

/**
 * Upload a distributor's digital bill (CSV, Excel, or pipe/tab text), map its columns once per supplier, resolve
 * unmatched items (pick or create the medicine), then load the lines into the GRN form for the usual checks.
 */
export function EbillImport({ open, supplierId, supplier, catalogue, onClose, onApply }: { open: boolean; supplierId: string; supplier: string; catalogue: Cat[]; onClose: () => void; onApply: (d: EbillApply) => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [res, setRes] = useState<EbillResult | null>(null);
  const [mapping, setMapping] = useState<EbillMapping>({ headerRow: -1, cols: {}, rowFilter: null });
  const [mapOpen, setMapOpen] = useState(false), [remember, setRemember] = useState(true);
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [creating, setCreating] = useState<MatchedLine | null>(null);
  const [err, setErr] = useState(""), [pending, start] = useTransition();
  useEffect(() => { if (open) { setFile(null); setRes(null); setErr(""); setPicks({}); setMapOpen(false); } }, [open]);

  const read = (f: File, m?: EbillMapping) => start(async () => {
    setErr("");
    const fd = new FormData();
    fd.append("file", f); fd.append("supplierId", supplierId);
    if (m) { fd.append("mapping", JSON.stringify(m)); fd.append("remember", remember ? "1" : "0"); }
    const r = await parseEbillAction(fd);
    if (!r.ok) return setErr(r.error);
    setRes(r.data); setMapping(r.data.mapping); setPicks({});
    setMapOpen(r.data.needsMapping);
  });

  const draft = res && !res.needsMapping ? res.draft : null;
  const lines = (draft?.lines ?? []).map((l) => (picks[l.row] !== undefined ? { ...l, medicineId: picks[l.row] || null, matchedBy: picks[l.row] ? ("learned" as const) : null, confidence: picks[l.row] ? 1 : 0 } : l));
  const unmatched = lines.filter((l) => !l.medicineId).length;
  const width = Math.max(0, ...(res?.preview ?? []).map((r) => r.length));
  const colName = (i: number) => {
    const h = mapping.headerRow >= 0 ? res?.preview[mapping.headerRow]?.[i] : "";
    const sample = res?.preview[mapping.headerRow + 1]?.[i] ?? res?.preview[0]?.[i] ?? "";
    return `${i + 1}: ${h || "Column " + (i + 1)}${sample && sample !== h ? ` (e.g. ${sample.slice(0, 18)})` : ""}`;
  };

  return (
    <Modal open={open} onClose={onClose} title="Import distributor e-bill" sub={<>{supplier} · CSV, Excel (.xlsx) or text export (pipe or tab separated)</>} width={1080}
      footer={<>
        {draft ? <span className="mr-auto self-center text-[13px] text-muted">{lines.length} line(s){draft.skipped ? ` · ${draft.skipped} row(s) skipped` : ""}{unmatched ? ` · ${unmatched} not matched yet` : ""}</span> : null}
        <Button onClick={onClose}>Cancel</Button>
        {draft ? <Button variant="primary" disabled={!!unmatched || pending} title={unmatched ? "Pick or create a medicine for every line" : ""}
          onClick={() => onApply({ invoiceNo: draft.invoiceNo, invoiceDate: draft.invoiceDate, lines })}>Use these lines</Button> : null}
      </>}>
      <div className="flex items-center gap-2 flex-wrap">
        <label className="inline-flex items-center gap-2 h-[34px] px-3 rounded-lg border border-line bg-white text-[13px] font-medium cursor-pointer hover:bg-page">
          <FileUp size={15} />{file ? file.name : "Choose bill file"}
          <input type="file" className="hidden" accept=".csv,.txt,.tsv,.xlsx,.dat,.prn" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); read(f); } }} />
        </label>
        {file && res ? <Button size="sm" onClick={() => setMapOpen(!mapOpen)}>{mapOpen ? "Hide columns" : "Change columns"}</Button> : null}
        {pending ? <span className="text-[12.5px] text-faint">Reading…</span> : null}
      </div>

      {res && mapOpen ? (
        <div className="border border-line rounded-lg p-3 flex flex-col gap-2.5 bg-subtle">
          {res.needsMapping ? <div className="text-[13px]">Tell Medoro which column holds what. Required: {res.missing.join(", ")}. The mapping is saved for {supplier} so their next bill reads straight away.</div> : null}
          <div className="overflow-auto max-h-[180px] border border-line rounded bg-white">
            <table className="text-[11.5px] font-mono border-collapse">
              <tbody>{res.preview.map((r, i) => <tr key={i} style={{ background: i === mapping.headerRow ? "#E1F1EF" : undefined }}><td className="px-1.5 text-faint border-r border-row">{i + 1}</td>{r.map((c, j) => <td key={j} className="px-1.5 py-0.5 border-r border-row whitespace-nowrap">{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
            <Field label="Header row"><Select value={mapping.headerRow} onChange={(e) => setMapping({ ...mapping, headerRow: Number(e.target.value) })}><option value={-1}>No header row</option>{res.preview.map((_, i) => <option key={i} value={i}>Row {i + 1}</option>)}</Select></Field>
            <Field label="Only rows where column…" hint="For files with record types (e.g. D = detail)">
              <div className="flex gap-1.5">
                <Select value={mapping.rowFilter?.col ?? -1} onChange={(e) => { const col = Number(e.target.value); setMapping({ ...mapping, rowFilter: col < 0 ? null : { col, value: mapping.rowFilter?.value ?? "" } }); }}><option value={-1}>Any row</option>{Array.from({ length: width }, (_, i) => <option key={i} value={i}>{i + 1}</option>)}</Select>
                {mapping.rowFilter ? <Input value={mapping.rowFilter.value} onChange={(e) => setMapping({ ...mapping, rowFilter: { col: mapping.rowFilter!.col, value: e.target.value } })} placeholder="= value" /> : null}
              </div>
            </Field>
            {(Object.keys(EBILL_FIELDS) as EbillField[]).map((f) => (
              <Field key={f} label={`${EBILL_FIELDS[f]}${["name", "batch", "expiry", "qty", "ptr"].includes(f) ? " *" : ""}`}>
                <Select value={mapping.cols[f] ?? -1} onChange={(e) => { const v = Number(e.target.value); const cols = { ...mapping.cols }; if (v < 0) delete cols[f]; else cols[f] = v; setMapping({ ...mapping, cols }); }}>
                  <option value={-1}>—</option>{Array.from({ length: width }, (_, i) => <option key={i} value={i}>{colName(i)}</option>)}
                </Select>
              </Field>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)} label={`Remember these columns for ${supplier}`} />
            <Button variant="primary" size="sm" className="ml-auto" disabled={!file || pending} onClick={() => file && read(file, mapping)}>Read with these columns</Button>
          </div>
        </div>
      ) : null}

      {draft ? (
        <div className="flex flex-col gap-1.5">
          <div className="text-[13px]">Invoice <strong>{draft.invoiceNo || "—"}</strong>{draft.invoiceDate ? ` · ${draft.invoiceDate}` : ""} <span className="text-faint">(you can edit these on the GRN)</span></div>
          <div className="overflow-auto max-h-[420px] border border-line rounded-lg">
            <table className="w-full border-collapse text-[12.5px] min-w-[900px]">
              <thead><tr className="bg-subtle text-left text-muted">{["Bill item", "Batch / exp", "Qty + free", "PTR", "MRP", "Medicine in your catalogue", ""].map((h) => <th key={h} className="px-2 py-2 font-medium border-b border-line">{h}</th>)}</tr></thead>
              <tbody>{lines.map((l) => (
                <tr key={l.row} className="border-b border-row align-top" style={{ background: l.medicineId ? undefined : "#FFFBF5" }}>
                  <td className="px-2 py-1.5"><div className="font-medium">{l.name}</div><div className="text-faint text-[11.5px]">{[l.pack, l.code && "code " + l.code, l.barcode].filter(Boolean).join(" · ")}</div>{l.problems.length ? <div className="text-warn text-[11.5px]">{l.problems.join(" · ")}</div> : null}</td>
                  <td className="px-2 py-1.5 font-mono">{l.batch || "—"}<div className="text-faint">{l.expiry ?? "?"}</div></td>
                  <td className="px-2 py-1.5 tnum">{l.qty}{l.free ? ` + ${l.free}` : ""}{l.scheme ? <div className="text-faint">{l.scheme}</div> : null}</td>
                  <td className="px-2 py-1.5 tnum">{l.ptr ? inr(l.ptr) : "—"}{l.discPct ? <div className="text-faint">TD {l.discPct}%</div> : null}</td>
                  <td className="px-2 py-1.5 tnum">{l.mrp ? inr(l.mrp) : "—"}</td>
                  <td className="px-2 py-1.5 min-w-[240px]">
                    <select className={sel} value={l.medicineId ?? ""} onChange={(e) => setPicks({ ...picks, [l.row]: e.target.value })} aria-label="Catalogue medicine">
                      <option value="">Not matched: choose…</option>{catalogue.map((c) => <option key={c.id} value={c.id}>{c.label} · {c.pack}</option>)}
                    </select>
                    {l.matchedBy && picks[l.row] === undefined ? <Badge tone={MATCH[l.matchedBy][1]} className="mt-1">{MATCH[l.matchedBy][0]}{l.matchedBy === "name" ? ` ${Math.round(l.confidence * 100)}%` : ""}</Badge> : null}
                  </td>
                  <td className="px-2 py-1.5">{!l.medicineId ? <Button size="sm" onClick={() => setCreating(l)}><Plus size={13} />Create</Button> : null}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="text-[12px] text-faint">Matching order: barcode, then {supplier}’s item code, then names you matched before, then a name + pack guess you must confirm on the GRN. Your choices are remembered when the GRN is posted.</div>
        </div>
      ) : null}
      {err ? <div role="alert" className="text-[13px] text-bad">{err}</div> : null}
      <QuickMedicine line={creating} onClose={() => setCreating(null)} onCreated={(id) => { if (creating) setPicks({ ...picks, [creating.row]: id }); setCreating(null); toast("Medicine added to the catalogue.", "green"); }} />
    </Modal>
  );
}

const guessForm = (n: string) => (/\b(tab|tabs|tablet)\b/i.test(n) ? "Tablet" : /\bcap/i.test(n) ? "Capsule" : /\b(syp|syrup)\b/i.test(n) ? "Syrup" : /\binj/i.test(n) ? "Injection" : /\bsusp/i.test(n) ? "Suspension" : /\bdrop/i.test(n) ? "Drops" : /\bcream\b/i.test(n) ? "Cream" : /\bgel\b/i.test(n) ? "Gel" : /\boint/i.test(n) ? "Ointment" : "Other");
const title = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

function QuickMedicine({ line, onClose, onCreated }: { line: MatchedLine | null; onClose: () => void; onCreated: (id: string) => void }) {
  const [f, setF] = useState({ name: "", generic: "", strength: "", form: "Tablet", manufacturer: "", pack: "", mrp: "", gstRate: "12", hsn: "3004", barcode: "" });
  const [err, setErr] = useState(""), [pending, start] = useTransition();
  useEffect(() => {
    if (!line) return;
    setErr("");
    const name = title(line.name.replace(/\b(tab|tabs|tablet|cap|caps|syp|inj)\b\.?/gi, "").replace(/\s+/g, " ").trim());
    setF({ name, generic: "", strength: line.name.match(/\d+(\.\d+)?\s?(mg|ml|mcg|g|iu|%)/i)?.[0] ?? "", form: guessForm(line.name), manufacturer: "", pack: line.pack, mrp: line.mrp ? (line.mrp / 100).toFixed(2) : "",
      gstRate: String(line.gst != null && (GST_RATES as readonly number[]).includes(line.gst) ? line.gst : 12), hsn: /^\d{4,8}$/.test(line.hsn) ? line.hsn : "3004", barcode: line.barcode });
  }, [line]);
  if (!line) return null;
  const save = () => start(async () => {
    const r = await addMedicineAction({ ...f, form: f.form as (typeof FORMS)[number], schedule: "", reorderLevel: 0, rack: "" });
    if (!r.ok) return setErr(r.error);
    onCreated(String(r.data));
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open onClose={onClose} title="Add medicine from the bill" sub={line.name} width={560}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={pending}>Add medicine</Button></>}>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Brand name *" className="col-span-full"><Input value={f.name} onChange={set("name")} /></Field>
        <Field label="Generic / salt *"><Input value={f.generic} onChange={set("generic")} autoFocus /></Field>
        <Field label="Strength *"><Input value={f.strength} onChange={set("strength")} /></Field>
        <Field label="Form"><Select value={f.form} onChange={set("form")}>{FORMS.map((x) => <option key={x}>{x}</option>)}</Select></Field>
        <Field label="Manufacturer *"><Input value={f.manufacturer} onChange={set("manufacturer")} /></Field>
        <Field label="Pack"><Input value={f.pack} onChange={set("pack")} /></Field>
        <Field label="MRP ₹ *"><Input value={f.mrp} onChange={set("mrp")} inputMode="decimal" /></Field>
        <Field label="GST %"><Select value={f.gstRate} onChange={set("gstRate")}>{GST_RATES.map((g) => <option key={g} value={g}>{g}%</option>)}</Select></Field>
        <Field label="HSN"><Input value={f.hsn} onChange={set("hsn")} /></Field>
        <Field label="Barcode"><Input value={f.barcode} onChange={set("barcode")} /></Field>
      </div>
      {err ? <div role="alert" className="text-[13px] text-bad">{err}</div> : null}
    </Modal>
  );
}

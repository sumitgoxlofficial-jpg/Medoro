"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipboardList, FileUp, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/badge";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n-client";
import { deviceDb } from "@/drivedb/device";
import type { DeviceHandlers } from "@/drivedb/device.worker";
import { CLAIM_REASONS, CLAIM_STATUS, ebillLineCost, type ClaimReason, type EbillPreviewLine, type MatchedBy } from "@/drivedb/purchase-tools";
import { EBILL_FIELDS, REQUIRED_FIELDS, type EbillField, type EbillMapping } from "@/domain/purchasing/ebill";
import type { GstBase } from "@/domain/purchasing/pricing";
import { inr, inr0 } from "@/lib/money";
import { dayMonth, monthYear, todayISO } from "@/lib/dates";
import { card, input, label, errText, toPaise, type Cfg, type Who } from "./ui";

type R<K extends keyof DeviceHandlers> = Awaited<ReturnType<DeviceHandlers[K]>>;
type View = "ebill" | "pricing" | "claims";
type Med = { id: string; name: string; gstRate: number; mrpPaise: number; packSize: number };
const table = "w-full text-sm [&_th]:text-left [&_th]:font-medium [&_th]:text-muted [&_th]:py-1.5 [&_th]:pr-3 [&_th]:whitespace-nowrap [&_td]:py-1.5 [&_td]:pr-3 [&_tr]:border-b [&_tr]:border-line align-top";
const month = (e: string | null) => (e ? monthYear(e.length === 7 ? `${e}-01` : e) : "?");

/** Purchase tools on the counter: read a distributor's e-bill into a purchase, pricing and margins, supplier claims. */
export function PurchaseTools({ cfg, who, refresh }: { cfg: Cfg; who: Who; refresh: number }) {
  const t = useT();
  const [view, setView] = useState<View>("ebill");
  const [tick, setTick] = useState(0);
  const r = refresh + tick, bump = () => setTick((x) => x + 1);
  return (
    <div className="flex flex-col gap-4">
      <Segmented value={view} onChange={setView} options={[{ value: "ebill", label: t("E-bill import") }, { value: "pricing", label: t("Pricing") }, { value: "claims", label: t("Claims") }]} />
      {view === "ebill" && <EbillImport cfg={cfg} who={who} refresh={r} onSaved={bump} />}
      {view === "pricing" && <Pricing who={who} refresh={r} />}
      {view === "claims" && <Claims cfg={cfg} who={who} refresh={r} onChange={bump} />}
    </div>
  );
}

// ---------- e-bill import ----------

type Preview = R<"ebillPreview">;
type Line = EbillPreviewLine & { picked?: boolean };
const MATCH: Record<MatchedBy, [string, Tone]> = { barcode: ["Barcode", "green"], code: ["Item code", "green"], learned: ["Learned", "teal"], name: ["Name match: check", "amber"] };

function EbillImport({ cfg, who, refresh, onSaved }: { cfg: Cfg; who: Who; refresh: number; onSaved: () => void }) {
  const t = useT(), toast = useToast();
  const dev = useRef(deviceDb()).current;
  const [sups, setSups] = useState<R<"supplierList">>([]);
  const [supplierId, setSupplierId] = useState("");
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [res, setRes] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<EbillMapping>({ headerRow: -1, cols: {}, rowFilter: null });
  const [mapOpen, setMapOpen] = useState(false), [remember, setRemember] = useState(true);
  const [lines, setLines] = useState<Line[]>([]);
  const [billNo, setBillNo] = useState(""), [billDate, setBillDate] = useState(todayISO());
  const [picking, setPicking] = useState<number | null>(null), [creating, setCreating] = useState<Line | null>(null);
  const [rules, setRules] = useState<R<"pricingRules"> | null>(null);
  const [history, setHistory] = useState<R<"ebillHistory">>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    dev.call("supplierList").then(setSups).catch(() => undefined);
    dev.call("pricingRules").then(setRules).catch(() => undefined);
    dev.call("ebillHistory").then(setHistory).catch(() => undefined);
  }, [dev, refresh]);

  const reset = () => { setFile(null); setRes(null); setLines([]); setMapOpen(false); setBillNo(""); setBillDate(todayISO()); };
  const read = async (f: { name: string; bytes: Uint8Array }, m?: EbillMapping) => {
    if (!supplierId) { toast(t("Choose the supplier first."), "red"); return; }
    setBusy(true);
    try {
      const p = await dev.call("ebillPreview", { supplierId, fileName: f.name, bytes: f.bytes, mapping: m, remember: m ? remember : false });
      setRes(p); setMapping(p.mapping); setMapOpen(p.needsMapping);
      if (!p.needsMapping) {
        setLines(p.lines);
        setBillNo(p.invoiceNo);
        setBillDate(p.invoiceDate && p.invoiceDate <= todayISO() ? p.invoiceDate : todayISO());
      } else setLines([]);
    } catch (e) { toast(errText(e), "red"); }
    setBusy(false);
  };

  const draft = res && !res.needsMapping ? res : null;
  const priced = useMemo(() => lines.map((l) => (l.medicine ? ebillLineCost({ ...l, mrp: l.mrp ?? l.medicine.mrpPaise }, l.medicine.gstRate, rules ?? undefined) : null)), [lines, rules]);
  const total = priced.reduce((a, p) => a + (p?.total ?? 0), 0), gstDiff = priced.reduce((a, p) => a + (p?.gstDiff ?? 0), 0);
  const unmatched = lines.filter((l) => !l.medicineId).length;
  const broken = lines.filter((l) => !l.batch || !l.expiry || !l.ptr).length;
  const width = Math.max(0, ...(res?.preview ?? []).map((row) => row.length));
  const colName = (i: number) => {
    const h = mapping.headerRow >= 0 ? res?.preview[mapping.headerRow]?.[i] : "";
    const sample = res?.preview[mapping.headerRow + 1]?.[i] ?? res?.preview[0]?.[i] ?? "";
    return `${i + 1}: ${h || t("Column {n}", { n: i + 1 })}${sample && sample !== h ? ` (${sample.slice(0, 18)})` : ""}`;
  };
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pick = (i: number, m: Med) => setLine(i, { medicineId: m.id, medicine: m, matchedBy: null, confidence: 1, picked: true, lastRate: null });

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const r = await dev.call("ebillSave", {
        branchId: cfg.branchId, supplierId, userId: who.userId, fingerprint: draft.fingerprint, fileName: file?.name ?? "", billNo, billDate,
        lines: lines.map((l) => ({ medicineId: l.medicineId ?? "", batch: l.batch, expiry: l.expiry ?? "", qty: l.qty, free: l.free, scheme: l.scheme, ptr: l.ptr ?? 0, mrp: l.mrp, schemePct: l.schemePct, discPct: l.discPct, cdPct: l.cdPct, code: l.code, name: l.name, pack: l.pack })),
      });
      toast(t("Bill {no} entered: {n} item(s), {total} incl. GST. Stock updated.", { no: r.billNo, n: r.lines, total: inr(r.totalPaise) }), "green");
      reset(); onSaved();
    } catch (e) { toast(errText(e), "red"); }
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className={card}>
        <div>
          <div className="font-semibold">{t("Import distributor e-bill")}</div>
          <div className="text-[12.5px] text-muted">{t("CSV, Excel (.xlsx) or text export (pipe or tab separated). The file is read on this device and saved as a purchase bill: stock, batches and the supplier’s dues update together.")}</div>
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] items-end">
          <label className={label}>{t("Supplier")}
            <select value={supplierId} onChange={(e) => { setSupplierId(e.target.value); reset(); }} className={input} aria-label={t("Supplier")}>
              <option value="">{t("Choose…")}</option>{sups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <div className="flex gap-2 flex-wrap items-center">
            <label className={`inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-white text-[13px] font-medium ${supplierId ? "cursor-pointer hover:bg-page" : "opacity-50"}`}>
              <FileUp size={15} />{file ? file.name : t("Choose bill file")}
              <input type="file" className="hidden" disabled={!supplierId} accept=".csv,.txt,.tsv,.xlsx,.dat,.prn" aria-label={t("Bill file")}
                onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; const x = { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }; setFile(x); void read(x); }} />
            </label>
            {file && res ? <Button size="sm" onClick={() => setMapOpen(!mapOpen)}>{mapOpen ? t("Hide columns") : t("Change columns")}</Button> : null}
            {busy ? <span className="text-[12.5px] text-muted">{t("Reading…")}</span> : null}
          </div>
        </div>
        {!sups.length && <div className="text-[13px] text-muted">{t("Add the supplier on the Purchases tab first.")}</div>}
      </div>

      {res && mapOpen && (
        <div className={card}>
          {res.needsMapping ? <div className="text-[13px]">{t("Tell Medoro which column holds what. Required: {fields}. The mapping is saved for this supplier so their next bill reads straight away.", { fields: res.missing.map((f) => t(f)).join(", ") })}</div> : null}
          <div className="overflow-auto max-h-[180px] border border-line rounded bg-white">
            <table className="text-[11.5px] font-mono border-collapse">
              <tbody>{res.preview.map((row, i) => <tr key={i} className={i === mapping.headerRow ? "bg-teal-tint" : ""}><td className="px-1.5 text-muted border-r border-line">{i + 1}</td>{row.map((c, j) => <td key={j} className="px-1.5 py-0.5 border-r border-line whitespace-nowrap">{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
            <Field label="Header row"><Select value={mapping.headerRow} onChange={(e) => setMapping({ ...mapping, headerRow: Number(e.target.value) })}><option value={-1}>{t("No header row")}</option>{res.preview.map((_, i) => <option key={i} value={i}>{t("Row {n}", { n: i + 1 })}</option>)}</Select></Field>
            <Field label="Only rows where column…" hint="For files with record types (e.g. D = detail)">
              <div className="flex gap-1.5">
                <Select value={mapping.rowFilter?.col ?? -1} onChange={(e) => { const col = Number(e.target.value); setMapping({ ...mapping, rowFilter: col < 0 ? null : { col, value: mapping.rowFilter?.value ?? "" } }); }}><option value={-1}>{t("Any row")}</option>{Array.from({ length: width }, (_, i) => <option key={i} value={i}>{i + 1}</option>)}</Select>
                {mapping.rowFilter ? <Input value={mapping.rowFilter.value} onChange={(e) => setMapping({ ...mapping, rowFilter: { col: mapping.rowFilter!.col, value: e.target.value } })} placeholder={t("= value")} /> : null}
              </div>
            </Field>
            {(Object.keys(EBILL_FIELDS) as EbillField[]).map((f) => (
              <Field key={f} label={`${t(EBILL_FIELDS[f])}${REQUIRED_FIELDS.includes(f) ? " *" : ""}`}>
                <Select value={mapping.cols[f] ?? -1} onChange={(e) => { const v = Number(e.target.value); const cols = { ...mapping.cols }; if (v < 0) delete cols[f]; else cols[f] = v; setMapping({ ...mapping, cols }); }}>
                  <option value={-1}>—</option>{Array.from({ length: width }, (_, i) => <option key={i} value={i}>{colName(i)}</option>)}
                </Select>
              </Field>
            ))}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)} label="Remember these columns for this supplier" />
            <Button variant="primary" size="sm" className="ml-auto" disabled={!file || busy} onClick={() => file && read(file, mapping)}>Read with these columns</Button>
          </div>
        </div>
      )}

      {draft && (
        <div className={card}>
          {draft.already && <div role="alert" className="text-[13px] text-bad">{t("This file was already entered as bill {no} on {date}. It can’t be entered twice.", { no: draft.already.billNo, date: dayMonth(new Date(draft.already.at), true) })}</div>}
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
            <label className={label}>{t("Bill no.")}<input value={billNo} onChange={(e) => setBillNo(e.target.value)} className={input} aria-label={t("Bill no.")} /></label>
            <label className={label}>{t("Bill date")}<input type="date" value={billDate} max={todayISO()} onChange={(e) => setBillDate(e.target.value)} className={input} aria-label={t("Bill date")} /></label>
          </div>
          <div className="overflow-auto">
            <table className={`${table} min-w-[920px]`}>
              <thead><tr><th>{t("Bill item")}</th><th>{t("Batch / expiry")}</th><th>{t("Qty + free")}</th><th>{t("PTR")}</th><th>{t("MRP")}</th><th>{t("Medicine in your catalogue")}</th><th>{t("Landed / margin")}</th><th /></tr></thead>
              <tbody>{lines.map((l, i) => {
                const p = priced[i];
                return (
                  <tr key={l.row} className={l.medicineId ? "" : "bg-warn-bg"}>
                    <td><div className="font-medium">{l.name}</div><div className="text-muted text-[11.5px]">{[l.pack, l.code && t("code {c}", { c: l.code }), l.barcode].filter(Boolean).join(" · ")}</div>{l.problems.length ? <div className="text-warn text-[11.5px]">{l.problems.map((x) => t(x)).join(" · ")}</div> : null}</td>
                    <td>
                      <input value={l.batch} onChange={(e) => setLine(i, { batch: e.target.value.toUpperCase() })} className={`${input} w-28 h-8 font-mono`} aria-label={t("Batch")} />
                      <input type="month" value={(l.expiry ?? "").slice(0, 7)} onChange={(e) => setLine(i, { expiry: e.target.value || null })} className={`${input} w-36 h-8 mt-1`} aria-label={t("Expiry")} />
                    </td>
                    <td className="tabular-nums whitespace-nowrap">{l.qty}{p?.free ? ` + ${p.free}` : l.free ? ` + ${l.free}` : ""}{l.scheme ? <div className="text-muted text-[11.5px]">{l.scheme}</div> : null}</td>
                    <td className="tabular-nums">{l.ptr ? inr(l.ptr) : "—"}{l.discPct || l.schemePct || l.cdPct ? <div className="text-muted text-[11.5px]">{[l.schemePct && `Sch ${l.schemePct}%`, l.discPct && `TD ${l.discPct}%`, l.cdPct && `CD ${l.cdPct}%`].filter(Boolean).join(" · ")}</div> : null}</td>
                    <td className="tabular-nums">{l.mrp ? inr(l.mrp) : l.medicine ? inr(l.medicine.mrpPaise) : "—"}</td>
                    <td className="min-w-[220px]">
                      <button className="text-left w-full border border-line rounded-lg px-2 py-1 bg-white hover:bg-page cursor-pointer" onClick={() => setPicking(i)}>
                        {l.medicine ? l.medicine.name : <span className="text-muted">{t("Not matched: choose…")}</span>}
                      </button>
                      <div className="flex gap-1.5 items-center mt-1 flex-wrap">
                        {l.matchedBy && !l.picked ? <Badge tone={MATCH[l.matchedBy][1]}>{t(MATCH[l.matchedBy][0])}{l.matchedBy === "name" ? ` ${Math.round(l.confidence * 100)}%` : ""}</Badge> : null}
                        {!l.medicineId ? <Button size="sm" onClick={() => setCreating(l)}><Plus size={13} />{t("Add medicine")}</Button> : null}
                      </div>
                    </td>
                    <td className="tabular-nums whitespace-nowrap">
                      {p ? <>{inr(p.landed)}{p.margin != null ? <div className={`text-[11.5px] ${rules && p.margin < rules.minMarginPct ? "text-bad" : "text-muted"}`}>{t("{n}% margin", { n: p.margin })}</div> : null}</> : "—"}
                      {l.lastRate != null && p && p.ratePaise !== l.lastRate ? <div className={`text-[11.5px] ${p.ratePaise > l.lastRate ? "text-bad" : "text-ok"}`}>{t("last {rate}", { rate: inr(l.lastRate) })}</div> : null}
                    </td>
                    <td><button onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={t("Remove line")} className="p-1 text-muted hover:text-bad cursor-pointer"><Trash2 size={14} /></button></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          <div className="text-[12px] text-muted">{t("Matching order: barcode, then the supplier’s item code, then names you matched before, then a name + pack guess you must check. Your choices are remembered when the bill is saved.")}</div>
          {rules && rules.gstBase !== "net" && gstDiff !== 0 ? <div className="text-[12px] text-warn">{t("The counter books GST on the value after discounts. Under your pricing rules the bill’s GST differs by {amt}.", { amt: inr(gstDiff) })}</div> : null}
          <div className="flex justify-between items-center gap-2 flex-wrap">
            <span className="text-sm">
              {t("{n} line(s)", { n: lines.length })}{draft.skipped ? ` · ${t("{n} row(s) skipped", { n: draft.skipped })}` : ""}{unmatched ? ` · ${t("{n} not matched yet", { n: unmatched })}` : ""} · {t("Bill total (incl. GST)")}: <b className="tabular-nums">{inr(total)}</b>
            </span>
            <div className="flex gap-2">
              <Button onClick={reset}>Cancel</Button>
              <Button variant="primary" onClick={save} disabled={busy || !!draft.already || !!unmatched || !!broken || !lines.length || !billNo.trim()} title={unmatched ? t("Pick or add a medicine for every line.") : broken ? t("Every line needs a batch, expiry and rate.") : ""}>
                {busy ? t("Saving…") : t("Save bill and add stock")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className={card}>
          <div className="font-semibold">{t("E-bills entered")}</div>
          <ul className="text-sm divide-y divide-line">
            {history.map((h) => <li key={h.id} className="py-1.5 flex justify-between gap-2 flex-wrap"><span>{h.supplier} · {h.billNo} <span className="text-muted">· {h.fileName} · {t("{n} line(s)", { n: h.lines })}</span></span><span className="text-muted tabular-nums">{dayMonth(new Date(h.at), true)} · {inr(h.totalPaise)}</span></li>)}
          </ul>
        </div>
      )}

      <PickMedicine open={picking !== null} branchId={cfg.branchId} initial={picking !== null ? lines[picking]?.name ?? "" : ""} onClose={() => setPicking(null)} onPick={(m) => { if (picking !== null) pick(picking, m); setPicking(null); }} />
      <QuickMedicine line={creating} onClose={() => setCreating(null)} onCreated={(m) => { const i = lines.findIndex((l) => l.row === creating?.row); if (i >= 0) pick(i, m); setCreating(null); toast(t("Medicine added to the catalogue."), "green"); }} />
    </div>
  );
}

function PickMedicine({ open, branchId, initial, onClose, onPick }: { open: boolean; branchId: string; initial: string; onClose: () => void; onPick: (m: Med) => void }) {
  const t = useT();
  const dev = useRef(deviceDb()).current;
  const [q, setQ] = useState(""), [found, setFound] = useState<Med[]>([]);
  useEffect(() => { if (open) setQ(initial.replace(/\b(tab|tabs|tablet|cap|caps|syp|inj)\b\.?/gi, "").split(/\s+/).filter(Boolean).slice(0, 2).join(" ")); }, [open, initial]);
  useEffect(() => {
    if (!open || !q.trim()) { setFound([]); return; }
    const h = setTimeout(() => dev.call("search", q, branchId).then((r) => setFound(r.map((m) => ({ id: m.id, name: `${m.name}${m.strength ? " " + m.strength : ""}`, gstRate: m.gstRate, mrpPaise: m.mrpPaise, packSize: m.packSize })))).catch(() => undefined), 120);
    return () => clearTimeout(h);
  }, [q, open, dev, branchId]);
  return (
    <Modal open={open} onClose={onClose} title="Choose the medicine" sub={initial} width={520}>
      <div className="relative"><Search size={15} className="absolute left-2.5 top-2.5 text-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder={t("Search medicine")} aria-label={t("Search medicine")} className={`${input} pl-8`} /></div>
      <ul className="divide-y divide-line text-sm max-h-80 overflow-auto">
        {found.map((m) => <li key={m.id}><button className="w-full text-left px-2 py-2 hover:bg-page cursor-pointer" onClick={() => onPick(m)}>{m.name} <span className="text-muted">· MRP {inr(m.mrpPaise)} · GST {m.gstRate}%</span></button></li>)}
        {q.trim() && !found.length && <li className="py-2 text-muted">{t("No medicine found.")}</li>}
      </ul>
    </Modal>
  );
}

const GST_RATES = [0, 5, 12, 18, 28] as const;
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** Adds a medicine from a bill line, with what the bill tells us filled in. */
function QuickMedicine({ line, onClose, onCreated }: { line: Line | null; onClose: () => void; onCreated: (m: Med) => void }) {
  const t = useT(), toast = useToast();
  const dev = useRef(deviceDb()).current;
  const [f, setF] = useState({ name: "", generic: "", strength: "", manufacturer: "", packSize: "1", mrp: "", gstRate: "12", hsn: "3004", barcode: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!line) return;
    setF({
      name: titleCase(line.name.replace(/\b(tab|tabs|tablet|cap|caps|syp|inj)\b\.?/gi, "").replace(/\s+/g, " ").trim()), generic: "",
      strength: line.name.match(/\d+(\.\d+)?\s?(mg|ml|mcg|g|iu|%)/i)?.[0] ?? "", manufacturer: "", packSize: line.pack.match(/\d+/)?.[0] ?? "1",
      mrp: line.mrp ? (line.mrp / 100).toFixed(2) : "", gstRate: String(line.gst != null && (GST_RATES as readonly number[]).includes(line.gst) ? line.gst : 12),
      hsn: /^\d{4,8}$/.test(line.hsn) ? line.hsn : "3004", barcode: line.barcode,
    });
  }, [line]);
  if (!line) return null;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      const m = await dev.call("addMedicine", {
        name: f.name, generic: f.generic, strength: f.strength, manufacturer: f.manufacturer, packSize: Math.max(1, Math.min(1000, parseInt(f.packSize) || 1)),
        mrpPaise: toPaise(f.mrp), gstRate: Number(f.gstRate) as 0 | 5 | 12 | 18 | 28, hsn: f.hsn, barcode: f.barcode.trim() || null,
      });
      onCreated({ id: m.id, name: `${m.name}${m.strength ? " " + m.strength : ""}`, gstRate: m.gstRate, mrpPaise: m.mrpPaise, packSize: m.packSize });
    } catch (e) { toast(errText(e), "red"); }
    setBusy(false);
  };
  return (
    <Modal open onClose={onClose} title="Add medicine from the bill" sub={line.name} width={560}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={busy || !f.name.trim() || !toPaise(f.mrp)}>Add medicine</Button></>}>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Brand name *" className="col-span-full"><Input value={f.name} onChange={set("name")} /></Field>
        <Field label="Generic / salt"><Input value={f.generic} onChange={set("generic")} autoFocus /></Field>
        <Field label="Strength"><Input value={f.strength} onChange={set("strength")} /></Field>
        <Field label="Manufacturer"><Input value={f.manufacturer} onChange={set("manufacturer")} /></Field>
        <Field label="Units per pack" hint={t("Tablets in a strip, 1 for a bottle")}><Input value={f.packSize} onChange={set("packSize")} inputMode="numeric" /></Field>
        <Field label="MRP ₹ *"><Input value={f.mrp} onChange={set("mrp")} inputMode="decimal" /></Field>
        <Field label="GST %"><Select value={f.gstRate} onChange={set("gstRate")}>{GST_RATES.map((g) => <option key={g} value={g}>{g}%</option>)}</Select></Field>
        <Field label="HSN"><Input value={f.hsn} onChange={set("hsn")} /></Field>
        <Field label="Barcode"><Input value={f.barcode} onChange={set("barcode")} /></Field>
      </div>
    </Modal>
  );
}

// ---------- pricing ----------

const BASES: [GstBase, string, string][] = [
  ["net", "After all discounts on the bill (recommended)", "GST law values a supply net of discounts shown on the invoice (CGST Act s.15(3)(a)). Most distributor software bills this way."],
  ["before_cd", "Before cash discount", "For distributors who treat cash discount as a settlement discount and charge GST before it."],
  ["gross", "On PTR × paid quantity", "For distributors who print GST on the undiscounted PTR value."],
];

function Pricing({ who, refresh }: { who: Who; refresh: number }) {
  const t = useT(), toast = useToast();
  const dev = useRef(deviceDb()).current;
  const [rules, setRules] = useState<R<"pricingRules"> | null>(null);
  const [minPct, setMinPct] = useState("");
  const [q, setQ] = useState(""), [lowOnly, setLowOnly] = useState(false);
  const [rows, setRows] = useState<R<"marginReport">["rows"]>([]);
  const [hist, setHist] = useState<{ name: string; h: R<"priceHistory"> } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => { dev.call("pricingRules").then((r) => { setRules(r); setMinPct(String(r.minMarginPct || "")); }).catch(() => undefined); }, [dev, refresh, tick]);
  useEffect(() => {
    const h = setTimeout(() => dev.call("marginReport", { text: q, lowOnly }).then((r) => setRows(r.rows)).catch((e) => toast(errText(e), "red")), 150);
    return () => clearTimeout(h);
  }, [dev, q, lowOnly, refresh, tick, toast]);

  const save = async () => {
    if (!rules) return;
    try { await dev.call("savePricingRules", { gstBase: rules.gstBase, itc: rules.itc, minMarginPct: Number(minPct) || 0 }); toast(t("Saved. New bills use these rules; saved bills keep theirs."), "green"); setTick((x) => x + 1); }
    catch (e) { toast(errText(e), "red"); }
  };
  const radio = "flex gap-2 items-start text-[13px]" + (who.owner ? " cursor-pointer" : "");

  return (
    <div className="flex flex-col gap-4">
      {rules && (
        <div className={card}>
          <div>
            <div className="font-semibold">{t("Purchase pricing rules")}</div>
            <div className="text-[12.5px] text-muted">{t("How e-bills work out GST and landed cost, and the margin you want on MRP.")}{who.owner ? "" : " " + t("Only the owner can change these.")}</div>
          </div>
          <fieldset disabled={!who.owner} className="flex flex-col gap-2">
            <div className="text-[13px] font-semibold">{t("GST on purchase lines is worked out")}</div>
            {BASES.map(([v, l, hint]) => (
              <label key={v} className={radio}>
                <input type="radio" className="mt-1 accent-teal" checked={rules.gstBase === v} onChange={() => setRules({ ...rules, gstBase: v })} />
                <span><span className="font-medium">{t(l)}</span><br /><span className="text-muted text-[12px]">{t(hint)}</span></span>
              </label>
            ))}
            <div className="text-[13px] font-semibold mt-1">{t("Input GST")}</div>
            <label className={radio}><input type="radio" className="mt-1 accent-teal" checked={rules.itc} onChange={() => setRules({ ...rules, itc: true })} /><span><span className="font-medium">{t("Claimed as input tax credit")}</span><br /><span className="text-muted text-[12px]">{t("Regular GST registration: landed cost and margins are worked out without GST.")}</span></span></label>
            <label className={radio}><input type="radio" className="mt-1 accent-teal" checked={!rules.itc} onChange={() => setRules({ ...rules, itc: false })} /><span><span className="font-medium">{t("Not claimable (composition scheme)")}</span><br /><span className="text-muted text-[12px]">{t("GST is part of the landed cost of each pack.")}</span></span></label>
            <label className={`${label} max-w-[240px] mt-1`}>{t("Lowest margin you want on MRP (%)")}<input value={minPct} onChange={(e) => setMinPct(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="0" className={input} /></label>
          </fieldset>
          <div className="text-[12px] text-muted">{t("Free goods under a scheme (“10+2”) carry no GST and their cost is spread over all packs received.")}</div>
          {who.owner && <div><Button variant="primary" onClick={save}>Save rules</Button></div>}
        </div>
      )}

      <div className={card}>
        <div className="flex justify-between items-center gap-2 flex-wrap">
          <div>
            <div className="font-semibold">{t("Margins on MRP")}</div>
            <div className="text-[12.5px] text-muted">{t("From each medicine’s latest purchase: landed cost per pack against MRP without GST. Tap a row for its purchase rates by supplier.")}</div>
          </div>
          <div className="flex gap-3 items-center flex-wrap">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search medicine")} aria-label={t("Search medicine")} className={`${input} w-48`} />
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> {t("Only low margins")}</label>
          </div>
        </div>
        <div className="overflow-auto">
          <table className={`${table} min-w-[680px]`}>
            <thead><tr><th>{t("Medicine")}</th><th>{t("Last bought")}</th><th className="text-right">{t("Rate / pack")}</th><th className="text-right">{t("Landed")}</th><th className="text-right">{t("MRP")}</th><th className="text-right">{t("Margin")}</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.medicineId} className="cursor-pointer hover:bg-page" onClick={async () => { try { setHist({ name: r.name, h: await dev.call("priceHistory", r.medicineId) }); } catch (e) { toast(errText(e), "red"); } }}>
                <td>{r.name}</td>
                <td className="text-muted">{r.supplier} · {dayMonth(new Date(r.billDate), true)}</td>
                <td className="text-right tabular-nums">{inr(r.ratePaise)}{r.changePaise ? <div className={`text-[11.5px] ${r.changePaise > 0 ? "text-bad" : "text-ok"}`}>{r.changePaise > 0 ? "↑" : "↓"} {inr(Math.abs(r.changePaise))}</div> : null}</td>
                <td className="text-right tabular-nums">{inr(r.landedPaise)}</td>
                <td className="text-right tabular-nums">{inr(r.mrpPaise)}</td>
                <td className={`text-right tabular-nums font-medium ${r.low || (r.margin ?? 0) < 0 ? "text-bad" : ""}`}>{r.margin != null ? `${r.margin}%` : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
          {!rows.length && <div className="text-sm text-muted py-2">{lowOnly ? t("No medicine is below your margin.") : t("Margins show once purchase bills are entered on the counter.")}</div>}
        </div>
      </div>

      {hist && (
        <Modal open onClose={() => setHist(null)} title={hist.name} sub="Purchase rates" width={620}>
          {hist.h.suppliers.length > 1 && (
            <div className="flex flex-col gap-1">
              <div className="text-[13px] font-semibold">{t("By supplier (cheapest first)")}</div>
              {hist.h.suppliers.map((s) => <div key={s.supplierId} className="flex justify-between text-sm"><span>{s.supplier} <span className="text-muted">· {t("{n} bill(s)", { n: s.bills })}</span></span><span className="tabular-nums">{t("last {rate}", { rate: inr(s.lastPaise) })} · {t("best {rate}", { rate: inr(s.bestPaise) })}</span></div>)}
            </div>
          )}
          <div className="overflow-auto">
            <table className={table}>
              <thead><tr><th>{t("Date")}</th><th>{t("Supplier")}</th><th>{t("Bill no.")}</th><th className="text-right">{t("Packs")}</th><th className="text-right">{t("Rate / pack")}</th><th className="text-right">{t("With free goods")}</th><th className="text-right">{t("MRP")}</th></tr></thead>
              <tbody>{hist.h.rows.map((r, i) => <tr key={i}><td className="whitespace-nowrap">{dayMonth(new Date(r.billDate), true)}</td><td>{r.supplier}</td><td>{r.billNo}</td><td className="text-right tabular-nums">{r.packs}{r.freePacks ? ` + ${r.freePacks}` : ""}</td><td className="text-right tabular-nums">{inr(r.costPaise)}</td><td className="text-right tabular-nums">{inr(r.effectivePaise)}</td><td className="text-right tabular-nums">{inr(r.mrpPaise)}</td></tr>)}</tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------- supplier claims ----------

type Claim = R<"claimList">["rows"][number];
type Raise = { batchId: string; item: string; qty: number; days: number; supplier: string };
const TONE: Record<Claim["status"], Tone> = { raised: "amber", acknowledged: "blue", credited: "green", rejected: "red" };

function Claims({ cfg, who, refresh, onChange }: { cfg: Cfg; who: Who; refresh: number; onChange: () => void }) {
  const t = useT(), toast = useToast();
  const dev = useRef(deviceDb()).current;
  const [claims, setClaims] = useState<R<"claimList">>({ rows: [], aging: [] });
  const [near, setNear] = useState<R<"claimSuggestions">>([]);
  const [credit, setCredit] = useState<{ c: Claim; close: boolean } | null>(null);
  const [raise, setRaise] = useState<Raise | null>(null);
  const [byHand, setByHand] = useState(false), [terms, setTerms] = useState(false);
  const load = useCallback(() => {
    dev.call("claimList").then(setClaims).catch((e) => toast(errText(e), "red"));
    dev.call("claimSuggestions", cfg.branchId).then(setNear).catch(() => undefined);
  }, [dev, cfg.branchId, toast]);
  useEffect(() => { load(); }, [load, refresh]);
  const done = () => { load(); onChange(); };
  const ack = async (c: Claim) => { try { await dev.call("acknowledgeClaim", { claimId: c.id, userId: who.userId }); toast(t("Marked acknowledged by the supplier."), "green"); done(); } catch (e) { toast(errText(e), "red"); } };

  return (
    <div className="flex flex-col gap-4">
      <div className={card}>
        <div className="font-semibold">{t("Pending claims by supplier")}</div>
        {claims.aging.length ? (
          <div className="overflow-auto">
            <table className={`${table} min-w-[600px]`}>
              <thead><tr><th>{t("Supplier")}</th><th className="text-right">{t("Open claims")}</th><th className="text-right">{t("0–30 d")}</th><th className="text-right">{t("31–60 d")}</th><th className="text-right">{t("61–90 d")}</th><th className="text-right">{t("Over 90 d")}</th><th className="text-right">{t("Total due")}</th></tr></thead>
              <tbody>{claims.aging.map((a) => <tr key={a.supplierId}><td>{a.supplier}</td><td className="text-right tabular-nums">{a.count}</td>{a.buckets.map((b, i) => <td key={i} className={`text-right tabular-nums ${i === 3 && b ? "text-bad" : ""}`}>{b ? inr0(b) : "—"}</td>)}<td className="text-right tabular-nums font-semibold">{inr(a.open)}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <div className="text-sm text-muted">{t("No pending claims.")}</div>}
      </div>

      <div className={card}>
        <div className="flex justify-between items-center gap-2 flex-wrap">
          <div className="font-semibold">{t("Claims")}</div>
          <Button onClick={() => setByHand(true)}><Plus size={15} />{t("Raise a claim")}</Button>
        </div>
        {claims.rows.length ? (
          <div className="overflow-auto">
            <table className={`${table} min-w-[900px]`}>
              <thead><tr><th>{t("Claim")}</th><th>{t("Supplier")}</th><th>{t("Item")}</th><th>{t("Reason")}</th><th className="text-right">{t("Claimed")}</th><th className="text-right">{t("Credited")}</th><th className="text-right">{t("Open")}</th><th>{t("Status")}</th><th /></tr></thead>
              <tbody>{claims.rows.map((c) => {
                const open = c.status === "raised" || c.status === "acknowledged";
                return (
                  <tr key={c.id}>
                    <td><span className="font-mono text-[12px]">{c.no}</span><div className="text-muted text-[11.5px]">{dayMonth(new Date(c.raisedAt), true)} · {t("{n} d", { n: c.age })}</div></td>
                    <td>{c.supplier}</td>
                    <td>{c.item} × {c.qty}<div className="text-muted text-[11.5px]">{t("exp {date}", { date: month(c.expiry) })}</div></td>
                    <td>{t(CLAIM_REASONS[c.reason])}{c.note ? <div className="text-muted text-[11.5px]">{c.note}</div> : null}</td>
                    <td className="text-right tabular-nums">{inr(c.claim)}</td>
                    <td className="text-right tabular-nums">{c.credit ? inr(c.credit) : "—"}{c.credits.length ? <div className="text-muted text-[11.5px]">{c.credits.map((x) => x.ref).join(", ")}</div> : null}</td>
                    <td className="text-right tabular-nums">{open ? inr(c.open) : c.writeOff ? <span className="text-muted" title={c.writeOffReason ?? ""}>{t("written off {amt}", { amt: inr(c.writeOff) })}</span> : "—"}</td>
                    <td><Badge tone={TONE[c.status]}>{t(CLAIM_STATUS[c.status])}</Badge></td>
                    <td className="text-right whitespace-nowrap">
                      {open ? <div className="flex gap-1.5 justify-end">
                        {c.status === "raised" ? <Button size="sm" onClick={() => ack(c)}>Acknowledged</Button> : null}
                        <Button size="sm" variant="primary" onClick={() => setCredit({ c, close: false })}>Credit note</Button>
                        <Button size="sm" variant="danger-outline" onClick={() => setCredit({ c, close: true })}>Close</Button>
                      </div> : null}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1 py-4 text-center"><ClipboardList size={28} className="text-muted" /><div className="font-medium">{t("No claims yet")}</div><div className="text-sm text-muted">{t("Raise an expiry or breakage claim from a suggestion below, or pick a batch with “Raise a claim”.")}</div></div>
        )}
      </div>

      <div className={card}>
        <div className="flex justify-between items-center gap-2 flex-wrap">
          <div><span className="font-semibold">{t("Claim before it’s too late")}</span> <span className="text-[12px] text-muted">{t("stock inside each supplier’s expiry return window")}</span></div>
          <Button size="sm" onClick={() => setTerms(true)}>Return terms</Button>
        </div>
        {near.length ? near.map((g) => (
          <div key={g.supplierId} className="border-t border-line pt-2">
            <div className="flex justify-between text-sm gap-2 flex-wrap"><b>{g.supplier}</b><span className="text-muted">{t("window {n} d · {amt} at cost", { n: g.window, amt: inr0(g.value) })}</span></div>
            {g.items.map((x) => (
              <div key={x.batchId} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_130px_80px_90px_auto] gap-x-3 gap-y-0.5 items-center py-1 text-sm">
                <span className="truncate">{x.item} <span className="font-mono text-[12px] text-muted">{x.batchNo}</span></span>
                <span className={x.days <= 0 ? "text-bad" : x.days <= 30 ? "text-warn" : ""}>{x.days <= 0 ? t("expired") : t("{n} d left", { n: x.days })} · {month(x.expiry)}</span>
                <span className="tabular-nums sm:text-right">{t("{n} units", { n: x.qty })}</span><span className="tabular-nums sm:text-right">{inr0(x.value)}</span>
                <Button size="sm" onClick={() => setRaise({ batchId: x.batchId, item: `${x.item} · ${x.batchNo}`, qty: x.qty, days: x.days, supplier: g.supplier })}>Raise claim</Button>
              </div>
            ))}
          </div>
        )) : <div className="text-sm text-muted">{t("Nothing is inside a supplier’s return window. Set each supplier’s window under Return terms.")}</div>}
      </div>

      <CreditModal state={credit} who={who} onClose={() => setCredit(null)} onDone={done} />
      <RaiseClaimModal batch={raise} cfg={cfg} who={who} onClose={() => setRaise(null)} onDone={done} />
      {byHand && <PickBatch cfg={cfg} onClose={() => setByHand(false)} onPick={(b) => { setByHand(false); setRaise(b); }} />}
      {terms && <ReturnTerms who={who} onClose={() => { setTerms(false); load(); }} />}
    </div>
  );
}

function CreditModal({ state, who, onClose, onDone }: { state: { c: Claim; close: boolean } | null; who: Who; onClose: () => void; onDone: () => void }) {
  const t = useT(), toast = useToast();
  const dev = useRef(deviceDb()).current;
  const [f, setF] = useState({ ref: "", amount: "", close: false, reason: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (state) setF({ ref: "", amount: state.close ? "" : (state.c.open / 100).toFixed(2), close: state.close, reason: "" }); }, [state]);
  if (!state) return null;
  const amt = toPaise(f.amount), left = Math.max(0, state.c.open - amt);
  const save = async () => {
    setBusy(true);
    try {
      const r = await dev.call("creditClaim", { claimId: state.c.id, userId: who.userId, ref: f.ref, amountPaise: amt, close: f.close, reason: f.reason });
      toast(r.status === "credited" ? t("Claim settled. What you owe the supplier is reduced by the credit note.") : r.status === "rejected" ? t("Claim closed as rejected and written off.") : t("Credit recorded. The rest of the claim stays open."), "green");
      onClose(); onDone();
    } catch (e) { toast(errText(e), "red"); }
    setBusy(false);
  };
  return (
    <Modal open onClose={onClose} title={state.close ? t("Close {no}", { no: state.c.no }) : t("Credit note for {no}", { no: state.c.no })} sub={`${state.c.supplier} · ${t("open {amt}", { amt: inr(state.c.open) })}`} width={460}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={busy}>{f.close && left && !amt ? t("Close as rejected") : t("Record")}</Button></>}>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Supplier credit note no."><Input value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} placeholder={state.close ? t("If any") : ""} autoFocus /></Field>
        <Field label="Amount credited ₹"><Input value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" placeholder="0" /></Field>
      </div>
      <Checkbox checked={f.close} onChange={(e) => setF({ ...f, close: e.target.checked })} label={left ? t("Close the claim and write off what isn’t credited ({amt})", { amt: inr(left) }) : t("Close the claim")} />
      {f.close && left ? <Field label="Why the rest is written off"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder={t("e.g. supplier credits expiry at 80% of PTR")} /></Field> : null}
      <div className="text-[12px] text-muted">{t("The credit note reduces what you owe {supplier}. Anything credited above the claim is a recovery. Leave the box unticked to keep the rest open for a later credit note.", { supplier: state.c.supplier })}</div>
    </Modal>
  );
}

function RaiseClaimModal({ batch, cfg, who, onClose, onDone }: { batch: Raise | null; cfg: Cfg; who: Who; onClose: () => void; onDone: () => void }) {
  const t = useT(), toast = useToast();
  const dev = useRef(deviceDb()).current;
  const [f, setF] = useState({ qty: "", reason: "near_expiry" as ClaimReason, note: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (batch) setF({ qty: String(batch.qty), reason: batch.days <= 0 ? "expiry" : batch.days <= 120 ? "near_expiry" : "breakage", note: "" }); }, [batch]);
  if (!batch) return null;
  const save = async () => {
    setBusy(true);
    try {
      const r = await dev.call("raiseClaim", { branchId: cfg.branchId, batchId: batch.batchId, qty: parseInt(f.qty) || 0, reason: f.reason, note: f.note, userId: who.userId, series: cfg.series });
      toast(t("{no} raised on {supplier}. Stock is out; what you owe them drops when their credit note arrives.", { no: r.claimNo, supplier: r.supplier }), "green");
      onClose(); onDone();
    } catch (e) { toast(errText(e), "red"); }
    setBusy(false);
  };
  return (
    <Modal open onClose={onClose} title="Raise claim on supplier" sub={`${batch.item} · ${t("{n} in stock", { n: batch.qty })} · ${batch.supplier}`} width={460}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={busy}>Raise claim</Button></>}>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Reason"><Select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value as ClaimReason })}>{(Object.entries(CLAIM_REASONS) as [ClaimReason, string][]).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</Select></Field>
        <Field label="Units"><Input value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value.replace(/\D/g, "") })} inputMode="numeric" /></Field>
      </div>
      <Field label="Note"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={t("e.g. handed to salesman with claim form")} /></Field>
      <div className="text-[12px] text-muted">{t("The units leave stock now. What you owe the supplier goes down only when their credit note is recorded here.")}</div>
    </Modal>
  );
}

/** Raise a claim by hand: find the medicine, then the batch (any reason, e.g. breakage or a wrong item). */
function PickBatch({ cfg, onClose, onPick }: { cfg: Cfg; onClose: () => void; onPick: (b: Raise) => void }) {
  const t = useT();
  const dev = useRef(deviceDb()).current;
  const [q, setQ] = useState(""), [found, setFound] = useState<Med[]>([]);
  const [med, setMed] = useState<Med | null>(null), [batches, setBatches] = useState<R<"claimBatches">>([]);
  useEffect(() => {
    if (!q.trim()) { setFound([]); return; }
    const h = setTimeout(() => dev.call("search", q, cfg.branchId).then((r) => setFound(r.map((m) => ({ id: m.id, name: `${m.name}${m.strength ? " " + m.strength : ""}`, gstRate: m.gstRate, mrpPaise: m.mrpPaise, packSize: m.packSize })))).catch(() => undefined), 120);
    return () => clearTimeout(h);
  }, [q, dev, cfg.branchId]);
  useEffect(() => { if (med) dev.call("claimBatches", med.id, cfg.branchId).then(setBatches).catch(() => undefined); }, [med, dev, cfg.branchId]);
  return (
    <Modal open onClose={onClose} title="Raise a claim" sub={med ? med.name : t("Find the medicine, then pick the batch going back.")} width={560}>
      {!med ? (
        <>
          <div className="relative"><Search size={15} className="absolute left-2.5 top-2.5 text-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder={t("Search medicine")} aria-label={t("Search medicine")} className={`${input} pl-8`} /></div>
          <ul className="divide-y divide-line text-sm max-h-80 overflow-auto">{found.map((m) => <li key={m.id}><button className="w-full text-left px-2 py-2 hover:bg-page cursor-pointer" onClick={() => setMed(m)}>{m.name}</button></li>)}</ul>
        </>
      ) : (
        <>
          <ul className="divide-y divide-line text-sm">
            {batches.map((b) => (
              <li key={b.batchId} className="py-2 flex justify-between items-center gap-2 flex-wrap">
                <span><span className="font-mono">{b.batchNo}</span> · {month(b.expiry)} · {t("{n} units", { n: b.qty })}<span className="block text-muted text-[12px]">{b.supplier ?? t("Opening stock: no supplier on record")}</span></span>
                <Button size="sm" disabled={!b.supplier} onClick={() => onPick({ batchId: b.batchId, item: `${b.item} · ${b.batchNo}`, qty: b.qty, days: b.days, supplier: b.supplier ?? "" })}>Raise claim</Button>
              </li>
            ))}
            {!batches.length && <li className="py-2 text-muted">{t("No stock of this medicine.")}</li>}
          </ul>
          <div><Button size="sm" onClick={() => { setMed(null); setBatches([]); }}>Back</Button></div>
        </>
      )}
    </Modal>
  );
}

/** Which suppliers take expiry returns, and up to how many days before expiry. */
function ReturnTerms({ who, onClose }: { who: Who; onClose: () => void }) {
  const t = useT(), toast = useToast();
  const dev = useRef(deviceDb()).current;
  const [rows, setRows] = useState<(R<"supplierTermsList">[number] & { days: string; dirty?: boolean })[]>([]);
  useEffect(() => { dev.call("supplierTermsList").then((r) => setRows(r.map((x) => ({ ...x, days: String(x.returnWindowDays) })))).catch(() => undefined); }, [dev]);
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch, dirty: true } : r)));
  const save = async () => {
    try {
      for (const r of rows.filter((x) => x.dirty)) await dev.call("saveSupplierTerms", { supplierId: r.supplierId, acceptsReturns: r.acceptsReturns, returnWindowDays: parseInt(r.days) || 0 });
      toast(t("Return terms saved."), "green"); onClose();
    } catch (e) { toast(errText(e), "red"); }
  };
  return (
    <Modal open onClose={onClose} title="Supplier return terms" sub={who.owner ? "Expiry returns each supplier accepts" : "Only the owner can change these."} width={520}
      footer={<><Button onClick={onClose}>Close</Button>{who.owner && <Button variant="primary" onClick={save} disabled={!rows.some((r) => r.dirty)}>Save</Button>}</>}>
      <fieldset disabled={!who.owner}>
        <ul className="divide-y divide-line text-sm">
          {rows.map((r, i) => (
            <li key={r.supplierId} className="py-2 flex justify-between items-center gap-3 flex-wrap">
              <span className="font-medium">{r.name}</span>
              <span className="flex items-center gap-3">
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={r.acceptsReturns} onChange={(e) => set(i, { acceptsReturns: e.target.checked })} /> {t("Takes expiry returns")}</label>
                <label className="flex items-center gap-1.5">{t("Window")}<input value={r.days} onChange={(e) => set(i, { days: e.target.value.replace(/\D/g, "") })} inputMode="numeric" className={`${input} w-16 h-8`} aria-label={t("Days before expiry")} />{t("days")}</label>
              </span>
            </li>
          ))}
          {!rows.length && <li className="py-2 text-muted">{t("No suppliers yet.")}</li>}
        </ul>
      </fieldset>
    </Modal>
  );
}

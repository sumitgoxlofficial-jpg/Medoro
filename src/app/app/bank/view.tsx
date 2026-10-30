"use client";
import { useState, useTransition } from "react";
import { Download, FileUp, Link2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Select } from "@/components/ui/field";
import { useActionToast, useToast } from "@/components/ui/toast";
import { inr } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { BANK_FIELDS, type BankField, type BankMapping } from "@/domain/accounting/bank-types";
import type { bankReconciliation } from "@/domain/accounting/bank";
import { importStatementAction, matchAction, unmatchAction } from "./actions";

type Data = Awaited<ReturnType<typeof bankReconciliation>>;
const th = "text-left text-[12px] font-medium text-muted px-3 py-2.5 border-b border-[#E3E6E9] whitespace-nowrap";
const td = "px-3 py-2 border-b border-row";
const wrap = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)]";
const amt = (p: number) => <span className="tnum" style={{ color: p < 0 ? "#B3261E" : "#1E7F4F" }}>{p < 0 ? "−" : "+"}{inr(Math.abs(p))}</span>;

export function BankView({ data, canAct }: { data: Data; canAct: boolean }) {
  const toast = useToast(), toastR = useActionToast();
  const [file, setFile] = useState<File | null>(null);
  const [map, setMap] = useState<{ preview: string[][]; mapping: BankMapping } | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const upload = (f: File, mapping?: BankMapping) => start(async () => {
    const fd = new FormData(); fd.append("file", f);
    if (mapping) fd.append("mapping", JSON.stringify(mapping));
    const r = await importStatementAction(fd);
    if (!r.ok) return toast(r.error, "red");
    if (r.data.needsMapping) { setMap({ preview: r.data.preview, mapping: r.data.mapping }); return toast("Tell Medoro which columns hold the date and amounts.", "blue"); }
    setMap(null); setFile(null);
    toast(`${r.data.imported} new line(s) imported${r.data.duplicates ? `, ${r.data.duplicates} already there` : ""} · ${r.data.matched} matched automatically.`, "green");
  });
  const width = Math.max(0, ...(map?.preview ?? []).map((r) => r.length));
  const exportCsv = () => downloadCsv("bank-unreconciled", [
    ["Side", "Date", "Details", "Reference / voucher", "Amount"],
    ...data.statement.map((s) => ["Bank statement", s.date, s.description, s.ref ?? "", (s.amount / 100).toFixed(2)]),
    ...data.books.map((b) => ["Books (Bank account)", b.date, b.narration, b.no, (b.amount / 100).toFixed(2)]),
  ]);

  return (
    <div className="flex flex-col gap-3.5 max-w-[1400px]">
      <div className={wrap + " p-4 flex flex-wrap gap-x-8 gap-y-2 items-center"}>
        <div className="text-[13.5px]">Matched lines <strong className="tnum">{data.matched}</strong></div>
        <div className="text-[13.5px]">Statement lines to match <strong className="tnum">{data.statement.length}</strong></div>
        <div className="text-[13.5px]">Book entries not on a statement <strong className="tnum">{data.books.length}</strong></div>
        {data.balance ? <div className="text-[13.5px]">On {data.balance.date}: bank <strong className="tnum">{inr(data.balance.bank)}</strong> · books <strong className="tnum">{inr(data.balance.books)}</strong> {data.balance.bank === data.balance.books ? <Badge tone="green">Agrees</Badge> : <Badge tone="amber">Differs by {inr(data.balance.bank - data.balance.books)}</Badge>}</div> : null}
        <div className="ml-auto flex gap-2">
          <Button onClick={exportCsv}><Download size={15} />Unreconciled (CSV)</Button>
          {canAct ? <label className="inline-flex items-center gap-2 h-[34px] px-3 rounded-lg bg-teal text-white text-[13px] font-semibold cursor-pointer"><FileUp size={15} />{pending ? "Importing…" : "Import statement"}
            <input type="file" className="hidden" accept=".csv,.xlsx,.txt" disabled={pending} onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); upload(f); } e.target.value = ""; }} /></label> : null}
        </div>
      </div>

      {map && file ? (
        <div className={wrap + " p-4 flex flex-col gap-2.5"}>
          <div className="font-semibold text-[14px]">Columns in {file.name}</div>
          <div className="overflow-auto max-h-[200px] border border-line rounded">
            <table className="text-[11.5px] font-mono border-collapse"><tbody>{map.preview.map((r, i) => <tr key={i} style={{ background: i === map.mapping.headerRow ? "#E1F1EF" : undefined }}><td className="px-1.5 text-faint">{i + 1}</td>{r.map((c, j) => <td key={j} className="px-1.5 py-0.5 border-l border-row whitespace-nowrap">{c}</td>)}</tr>)}</tbody></table>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
            <Field label="Header row"><Select value={map.mapping.headerRow} onChange={(e) => setMap({ ...map, mapping: { ...map.mapping, headerRow: Number(e.target.value) } })}><option value={-1}>No header row</option>{map.preview.map((_, i) => <option key={i} value={i}>Row {i + 1}</option>)}</Select></Field>
            {(Object.keys(BANK_FIELDS) as BankField[]).map((f) => (
              <Field key={f} label={BANK_FIELDS[f]}>
                <Select value={map.mapping.cols[f] ?? -1} onChange={(e) => { const v = Number(e.target.value); const cols = { ...map.mapping.cols }; if (v < 0) delete cols[f]; else cols[f] = v; setMap({ ...map, mapping: { ...map.mapping, cols } }); }}>
                  <option value={-1}>—</option>{Array.from({ length: width }, (_, i) => <option key={i} value={i}>{i + 1}: {(map.mapping.headerRow >= 0 ? map.preview[map.mapping.headerRow]?.[i] : "") || `Column ${i + 1}`}</option>)}
                </Select>
              </Field>
            ))}
          </div>
          <div className="flex items-center gap-3"><span className="text-[12px] text-faint">Need a date and either one signed amount column or separate withdrawal and deposit columns. The mapping is saved for next time.</span><Button variant="primary" size="sm" className="ml-auto" disabled={pending} onClick={() => upload(file, map.mapping)}>Import with these columns</Button></div>
        </div>
      ) : null}

      <div className={wrap + " overflow-auto"}>
        <div className="px-4 pt-3 pb-1 font-semibold text-[14.5px]">Statement lines not matched</div>
        {data.statement.length ? (
          <table className="w-full border-collapse text-[13px] min-w-[980px]">
            <thead><tr className="bg-subtle"><th className={th}>Date</th><th className={th}>Narration</th><th className={th}>Ref</th><th className={th + " text-right"}>Amount</th><th className={th}>Match to a book entry</th></tr></thead>
            <tbody>{data.statement.map((s) => (
              <tr key={s.id}>
                <td className={td + " whitespace-nowrap"}>{s.date}</td><td className={td + " max-w-[360px] truncate"} title={s.description}>{s.description}</td><td className={td + " font-mono text-[12px]"}>{s.ref}</td><td className={td + " text-right"}>{amt(s.amount)}</td>
                <td className={td}>{s.candidates.length ? (
                  <div className="flex gap-1.5">
                    <select className="border border-input rounded-md px-2 py-1 text-[12.5px] bg-white min-w-0 flex-1" value={picks[s.id] ?? s.candidates[0].id} onChange={(e) => setPicks({ ...picks, [s.id]: e.target.value })} aria-label="Book entry">
                      {s.candidates.map((c) => <option key={c.id} value={c.id}>{c.date} · {c.no} · {c.narration.slice(0, 50)}</option>)}
                    </select>
                    {canAct ? <Button size="sm" disabled={pending} onClick={() => start(async () => { toastR(await matchAction(s.id, picks[s.id] ?? s.candidates[0].id)); })}><Link2 size={13} />Match</Button> : null}
                  </div>
                ) : <span className="text-[12.5px] text-faint">No book entry with this amount within 15 days. Post the missing entry (e.g. bank charges, interest), then match.</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <div className="px-4 pb-3 text-[13px] text-fainter">Nothing to match. Import a statement to start.</div>}
      </div>

      <div className={wrap + " overflow-auto"}>
        <div className="px-4 pt-3 pb-1 font-semibold text-[14.5px]">Book entries not yet on a statement <span className="text-[12px] font-normal text-faint">cheques in transit, deposits not credited</span></div>
        {data.books.length ? (
          <table className="w-full border-collapse text-[13px] min-w-[760px]">
            <thead><tr className="bg-subtle"><th className={th}>Date</th><th className={th}>Voucher</th><th className={th}>Narration</th><th className={th + " text-right"}>Amount</th></tr></thead>
            <tbody>{data.books.map((b) => <tr key={b.id}><td className={td}>{b.date}</td><td className={td + " font-mono text-[12px]"}>{b.no}</td><td className={td}>{b.narration}</td><td className={td + " text-right"}>{amt(b.amount)}</td></tr>)}</tbody>
          </table>
        ) : <div className="px-4 pb-3 text-[13px] text-fainter">Every Bank account entry since your first statement is matched.</div>}
      </div>
      {data.recent.length ? (
        <div className={wrap + " overflow-auto"}>
          <div className="px-4 pt-3 pb-1 font-semibold text-[14.5px]">Recently matched</div>
          <table className="w-full border-collapse text-[13px] min-w-[760px]">
            <thead><tr className="bg-subtle"><th className={th}>Date</th><th className={th}>Narration</th><th className={th + " text-right"}>Amount</th><th className={th}>Voucher</th><th className={th}>How</th>{canAct ? <th className={th} /> : null}</tr></thead>
            <tbody>{data.recent.map((r) => (
              <tr key={r.id}><td className={td}>{r.date}</td><td className={td + " max-w-[360px] truncate"}>{r.description}</td><td className={td + " text-right"}>{amt(r.amount)}</td><td className={td + " font-mono text-[12px]"}>{r.voucherNo}</td><td className={td}><Badge tone={r.matchedBy === "auto" ? "teal" : "gray"}>{r.matchedBy === "auto" ? "Automatic" : "Manual"}</Badge></td>
                {canAct ? <td className={td + " text-right"}><Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { toastR(await unmatchAction(r.id)); })}><Unlink size={13} />Unmatch</Button></td> : null}</tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

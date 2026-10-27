"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { downloadCsv } from "@/lib/csv";
import { importPreview, importRun, importTemplate } from "@/app/app/import-actions";
import type { ImportKind, Preview } from "@/domain/imports/service";

const TITLE: Record<ImportKind, string> = { medicines: "Import medicines and opening stock", suppliers: "Import suppliers", customers: "Import customers" };
const HELP: Record<ImportKind, string> = {
  medicines: "One row per batch. Rows for a medicine you already have only add the batch. Leave Batch, Expiry, Opening qty and Cost empty to add just the medicine. Stock goes into the branch you’re working in.",
  suppliers: "Suppliers that already exist (same name) are skipped. Opening balance is what you owe them today.",
  customers: "Customers whose mobile is already on file are skipped. Mark WhatsApp opt-in only if the customer agreed to messages.",
};
const ACTION_C = { create: "#18794E", "add stock": "#2459C9", skip: "#6B737B" } as const;

/** Upload → check every row → import. Nothing is saved until the last step. */
export function ImportDialog({ kind, open, onClose }: { kind: ImportKind; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<{ created: number; stocked: number; skipped: number; failed: string[] } | null>(null);
  const [err, setErr] = useState("");
  const [busy, start] = useTransition();

  const reset = () => { setFile(null); setPreview(null); setResult(null); setErr(""); if (input.current) input.current.value = ""; };
  const close = () => { reset(); onClose(); };
  const fd = (f: File) => { const d = new FormData(); d.set("kind", kind); d.set("file", f); return d; };

  const pick = (f: File | undefined) => {
    if (!f) return;
    setFile(f); setPreview(null); setResult(null); setErr("");
    start(async () => { const r = await importPreview(fd(f)); if (r.ok) setPreview(r.data); else setErr(r.error); });
  };
  const go = () => file && start(async () => {
    const r = await importRun(fd(file));
    if (!r.ok) return setErr(r.error);
    setResult(r.data); router.refresh();
    toast(`Imported ${r.data.created} ${kind}${kind === "medicines" ? ` and ${r.data.stocked} batches` : ""}.`, r.data.failed.length ? "amber" : "green");
  });
  const template = () => start(async () => { const r = await importTemplate(kind); if (r.ok) downloadCsv(`medoro-${kind}-template`, r.data); });

  const shown = preview ? [...preview.rows.filter((r) => r.errors.length), ...preview.rows.filter((r) => !r.errors.length)].slice(0, 200) : [];

  return (
    <Modal open={open} onClose={close} width={760} title={TITLE[kind]} sub="Excel (.xlsx) or CSV. The first row must be the column headers."
      footer={result ? <Button variant="primary" onClick={close}>Done</Button> : (
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={busy || !preview || !!preview.bad || !preview.ok} onClick={go}>
            {busy && preview ? "Importing…" : preview?.bad ? "Fix the problems to import" : preview && !preview.ok ? "Nothing new to import" : preview ? `Import ${preview.ok} row${preview.ok === 1 ? "" : "s"}` : "Import"}
          </Button>
        </>
      )}>
      {result ? (
        <div className="flex flex-col gap-2 items-start">
          <div className="flex gap-2 items-center text-[15px] font-semibold text-ok"><CheckCircle2 size={18} />Import finished</div>
          <div className="text-[13.5px] text-ink-2">{result.created} created{kind === "medicines" ? ` · ${result.stocked} batches added` : ""} · {result.skipped} skipped (already on file){result.failed.length ? ` · ${result.failed.length} failed` : ""}</div>
          {result.failed.length ? <ul className="m-0 pl-4 text-[13px] text-bad">{result.failed.slice(0, 20).map((f) => <li key={f}>{f}</li>)}</ul> : null}
          <div className="text-[12.5px] text-muted">Running the same file again is safe: rows already imported are skipped.</div>
        </div>
      ) : (
        <>
          <p className="m-0 text-[13.5px] text-ink-2">{HELP[kind]}</p>
          <div className="flex gap-2 flex-wrap items-center">
            <input ref={input} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => pick(e.target.files?.[0])} aria-label="Choose file" />
            <Button variant="primary" disabled={busy} onClick={() => input.current?.click()}><Upload size={15} />{file ? "Choose another file" : "Choose file"}</Button>
            <Button disabled={busy} onClick={template}><Download size={15} />Download template</Button>
            {file ? <span className="text-[13px] text-muted flex gap-1.5 items-center min-w-0"><FileSpreadsheet size={15} /><span className="truncate">{file.name}</span></span> : null}
          </div>
          {busy && !preview ? <div className="text-[13px] text-muted">Checking every row…</div> : null}
          {err ? <div role="alert" className="text-[13px] text-bad bg-bad-bg rounded-lg px-3 py-2">{err}</div> : null}
          {preview ? (
            <>
              <div className="flex gap-3 flex-wrap text-[13px]">
                <span><strong className="text-ok">{preview.ok}</strong> ready</span>
                <span><strong className="text-muted">{preview.skip}</strong> already on file</span>
                <span><strong className={preview.bad ? "text-bad" : "text-muted"}>{preview.bad}</strong> with problems</span>
                <span className="text-muted">· columns found: {preview.columns.filter((c) => c.found).length} of {preview.columns.length}</span>
              </div>
              {preview.bad ? <div className="text-[13px] text-bad">Fix the rows marked in red in your file, then choose it again. Nothing is imported until every row is fine.</div> : null}
              <div className="border border-line rounded-lg overflow-auto max-h-[340px]">
                <table className="w-full border-collapse text-[13px]">
                  <thead className="sticky top-0 bg-subtle"><tr className="text-muted text-[12px]"><th className="text-left px-3 py-2 font-medium w-14">Row</th><th className="text-left px-3 py-2 font-medium">Item</th><th className="text-left px-3 py-2 font-medium">What happens</th></tr></thead>
                  <tbody>{shown.map((r) => (
                    <tr key={r.line} className="border-t border-row align-top">
                      <td className="px-3 py-2 tnum text-muted">{r.line}</td>
                      <td className="px-3 py-2 font-medium">{r.label || "—"}</td>
                      <td className="px-3 py-2">{r.errors.length ? <ul className="m-0 pl-4 text-bad">{r.errors.map((e) => <li key={e}>{e}</li>)}</ul> : <span style={{ color: ACTION_C[r.action] }}>{r.note}</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              {preview.rows.length > shown.length ? <div className="text-[12px] text-muted">Showing the first {shown.length} of {preview.rows.length} rows (problems first).</div> : null}
            </>
          ) : null}
        </>
      )}
    </Modal>
  );
}

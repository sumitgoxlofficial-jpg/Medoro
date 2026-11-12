"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n-client";
import { CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { downloadCsv } from "@/lib/csv";
import { importPreview, importRun, importTemplate } from "@/app/app/import-actions";
import type { ImportKind, Preview } from "@/domain/imports/service";

const TITLE: Record<ImportKind, string> = { medicines: "Import medicines and opening stock", suppliers: "Import suppliers", customers: "Import customers" };
const HELP: Record<ImportKind, string> = {
  medicines: "One row per batch. Rows for a medicine you already have only add the batch. Leave Batch, Expiry, Opening qty and Cost empty to add just the medicine. Stock goes into the branch you’re working in. Moving from another billing program? Upload its stock list as it is (Excel or CSV) with the medicine name, batch, expiry, quantity, MRP and cost. If form, company or GST are missing they are filled in and shown in the preview, so you can check them before anything is saved.",
  suppliers: "Suppliers that already exist (same name) are skipped. Opening balance is what you owe them today.",
  customers: "Customers whose mobile is already on file are skipped. Mark WhatsApp opt-in only if the customer agreed to messages.",
};
const ACTION_C = { create: "#18794E", "add stock": "#2459C9", skip: "#6B737B" } as const;

/** Upload → check every row → import. Nothing is saved until the last step. */
export function ImportDialog({ kind, open, onClose }: { kind: ImportKind; open: boolean; onClose: () => void }) {
  const toast = useToast(), t = useT();
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
    toast(kind === "medicines" ? t("Imported {n} medicines and {b} batches.", { n: r.data.created, b: r.data.stocked }) : t(`Imported {n} ${kind}.`, { n: r.data.created }), r.data.failed.length ? "amber" : "green");
  });
  const template = () => start(async () => { const r = await importTemplate(kind); if (r.ok) downloadCsv(`medoro-${kind}-template`, r.data); });

  const shown = preview ? [...preview.rows.filter((r) => r.errors.length), ...preview.rows.filter((r) => !r.errors.length)].slice(0, 200) : [];

  return (
    <Modal open={open} onClose={close} width={760} title={TITLE[kind]} sub="Excel (.xlsx) or CSV. The first row must be the column headers."
      footer={result ? <Button variant="primary" onClick={close}>Done</Button> : (
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={busy || !preview || !!preview.bad || !preview.ok} onClick={go}>
            {busy && preview ? t("Importing…") : preview?.bad ? t("Fix the problems to import") : preview && !preview.ok ? t("Nothing new to import") : preview ? (preview.ok === 1 ? t("Import 1 row") : t("Import {n} rows", { n: preview.ok })) : t("Import")}
          </Button>
        </>
      )}>
      {result ? (
        <div className="flex flex-col gap-2 items-start">
          <div className="flex gap-2 items-center text-[15px] font-semibold text-ok"><CheckCircle2 size={18} />{t("Import finished")}</div>
          <div className="text-[13.5px] text-ink-2">{t("{n} created", { n: result.created })}{kind === "medicines" ? ` · ${t("{n} batches added", { n: result.stocked })}` : ""} · {t("{n} skipped (already on file)", { n: result.skipped })}{result.failed.length ? ` · ${t("{n} failed", { n: result.failed.length })}` : ""}</div>
          {result.failed.length ? <ul className="m-0 pl-4 text-[13px] text-bad">{result.failed.slice(0, 20).map((f) => <li key={f}>{t(f)}</li>)}</ul> : null}
          <div className="text-[12.5px] text-muted">{t("Running the same file again is safe: rows already imported are skipped.")}</div>
        </div>
      ) : (
        <>
          <p className="m-0 text-[13.5px] text-ink-2">{t(HELP[kind])}</p>
          <div className="flex gap-2 flex-wrap items-center">
            <input ref={input} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => pick(e.target.files?.[0])} aria-label={t("Choose file")} />
            <Button variant="primary" disabled={busy} onClick={() => input.current?.click()}><Upload size={15} />{file ? t("Choose another file") : t("Choose file")}</Button>
            <Button disabled={busy} onClick={template}><Download size={15} />{t("Download template")}</Button>
            {file ? <span className="text-[13px] text-muted flex gap-1.5 items-center min-w-0"><FileSpreadsheet size={15} /><span className="truncate">{file.name}</span></span> : null}
          </div>
          {busy && !preview ? <div className="text-[13px] text-muted">{t("Checking every row…")}</div> : null}
          {err ? <div role="alert" className="text-[13px] text-bad bg-bad-bg rounded-lg px-3 py-2">{t(err)}</div> : null}
          {preview ? (
            <>
              <div className="flex gap-3 flex-wrap text-[13px]">
                <span><strong className="text-ok">{preview.ok}</strong> {t("ready")}</span>
                <span><strong className="text-muted">{preview.skip}</strong> {t("already on file")}</span>
                <span><strong className={preview.bad ? "text-bad" : "text-muted"}>{preview.bad}</strong> {t("with problems")}</span>
                <span className="text-muted">· {t("columns found: {n} of {all}", { n: preview.columns.filter((c) => c.found).length, all: preview.columns.length })}</span>
              </div>
              {preview.bad ? <div className="text-[13px] text-bad">{t("Fix the rows marked in red in your file, then choose it again. Nothing is imported until every row is fine.")}</div> : null}
              <div className="border border-line rounded-lg overflow-auto max-h-[340px]">
                <table className="w-full border-collapse text-[13px]">
                  <thead className="sticky top-0 bg-subtle"><tr className="text-muted text-[12px]"><th className="text-left px-3 py-2 font-medium w-14">{t("Row")}</th><th className="text-left px-3 py-2 font-medium">{t("Item")}</th><th className="text-left px-3 py-2 font-medium">{t("What happens")}</th></tr></thead>
                  <tbody>{shown.map((r) => (
                    <tr key={r.line} className="border-t border-row align-top">
                      <td className="px-3 py-2 tnum text-muted">{r.line}</td>
                      <td className="px-3 py-2 font-medium">{r.label || "—"}</td>
                      <td className="px-3 py-2">{r.errors.length ? <ul className="m-0 pl-4 text-bad">{r.errors.map((e) => <li key={e}>{t(e)}</li>)}</ul> : <span style={{ color: ACTION_C[r.action] }}>{t(r.note)}</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              {preview.rows.length > shown.length ? <div className="text-[12px] text-muted">{t("Showing the first {n} of {all} rows (problems first).", { n: shown.length, all: preview.rows.length })}</div> : null}
            </>
          ) : null}
        </>
      )}
    </Modal>
  );
}

"use client";
import { useState, useTransition } from "react";
import { DatabaseBackup, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { inr0 } from "@/lib/money";
import type { RestoreSummary } from "@/domain/system/restore";
import { applyRestoreAction, discardRestoreAction } from "./actions";

export type PendingRestore = { runId: string; manifestId: string; createdBy: string; createdAt: string; summary: RestoreSummary };

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Step 2 of a restore: compare the test copy with live data, then confirm by typing the pharmacy code. */
export function RestorePanel({ p, code }: { p: PendingRestore; code: string }) {
  const toast = useToast();
  const [typed, setTyped] = useState("");
  const [showTables, setShowTables] = useState(false);
  const [busy, start] = useTransition();
  const s = p.summary, b = s.backupFigures, l = s.liveFigures;
  const rows: [string, string, string][] = [
    ["Invoices", `${b.sales} · ${inr0(b.salesTotal)}`, `${l.sales} · ${inr0(l.salesTotal)}`],
    ["Last invoice", b.lastSale ? when(b.lastSale) : "—", l.lastSale ? when(l.lastSale) : "—"],
    ["Medicines", String(b.medicines), String(l.medicines)],
    ["Units in stock", String(b.stockUnits), String(l.stockUnits)],
    ["Customers · suppliers", `${b.customers} · ${b.suppliers}`, `${l.customers} · ${l.suppliers}`],
    ["Accounting vouchers", String(b.vouchers), String(l.vouchers)],
  ];
  const lost = Math.max(0, l.sales - b.sales);
  const apply = () => start(async () => {
    const r = await applyRestoreAction(p.runId, typed);
    if (!r.ok) { toast(r.error, "red"); return; }
    window.location.href = "/signin?restored=1";
  });

  return (
    <section className="bg-white border-2 border-[#E8C77A] rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2 font-semibold text-[15px]"><DatabaseBackup size={18} className="text-teal" />Restore ready to review</div>
      <div className="text-[13.5px] text-ink-2">The backup from <strong>{when(s.backupAt)}</strong> was loaded into a separate test copy on your server and checked. Live data hasn’t changed. Prepared by {p.createdBy}; the test copy is deleted after 24 hours if not used.</div>
      <div className="border border-line rounded-lg overflow-auto">
        <table className="w-full border-collapse text-[13.5px] min-w-[480px]">
          <thead><tr className="bg-subtle text-muted text-[12px]"><th className="text-left px-3 py-2 font-medium" /><th className="text-left px-3 py-2 font-medium">In the backup</th><th className="text-left px-3 py-2 font-medium">Live now</th></tr></thead>
          <tbody>{rows.map(([k, x, y]) => <tr key={k} className="border-t border-row"><td className="px-3 py-2 text-muted">{k}</td><td className="px-3 py-2 tnum font-medium">{x}</td><td className="px-3 py-2 tnum">{y}</td></tr>)}</tbody>
        </table>
      </div>
      <button className="self-start text-[12.5px] text-teal cursor-pointer" onClick={() => setShowTables((x) => !x)}>{showTables ? "Hide" : "Show"} every table</button>
      {showTables ? (
        <div className="grid gap-x-4 gap-y-1 grid-cols-[repeat(auto-fill,minmax(220px,1fr))] text-[12.5px]">
          {s.tables.map((t) => <div key={t.name} className="flex justify-between gap-2 border-b border-row py-1"><span className="text-muted">{t.name}</span><span className="tnum">{t.backup} <span className="text-fainter">/ {t.live} live</span></span></div>)}
        </div>
      ) : null}
      {s.notes.length ? <ul className="m-0 pl-4 text-[12.5px] text-muted">{s.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
      {s.problems.length ? (
        <div className="text-[13px] text-bad bg-bad-bg rounded-lg p-3">This backup can’t be restored: {s.problems.join(" ")}</div>
      ) : (
        <>
          <div className="flex gap-2.5 items-start bg-[#FDF2E1] rounded-lg p-3 text-[13px] text-[#6B4A0E]">
            <TriangleAlert size={16} className="mt-0.5 flex-none" />
            <div className="flex flex-col gap-1">
              <span><strong>Everything recorded after {when(s.backupAt)} will be removed</strong>{lost ? `, including ${lost} invoice${lost > 1 ? "s" : ""}` : ""}. Invoices that were already given to customers will no longer be in your records.</span>
              <span>A safety backup of current data is taken first, so this can be undone. Everyone, including you, is signed out and signs in again. Stored files (invoice scans) in the backup are written back. WhatsApp, Google Drive, the backup key and backup history stay as they are.</span>
            </div>
          </div>
          <label className="flex flex-col gap-1 text-[13px] text-muted"><span>Type the pharmacy code <strong className="font-mono text-ink">{code}</strong> to confirm</span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} className="border border-input rounded-lg px-3 py-2 text-[14px] font-mono uppercase outline-none focus:border-teal max-w-[260px]" aria-label="Pharmacy code" autoComplete="off" />
          </label>
        </>
      )}
      <div className="flex gap-2 flex-wrap">
        {!s.problems.length ? <Button variant="danger" disabled={busy || typed.trim().toUpperCase() !== code.toUpperCase()} onClick={apply}>{busy ? "Taking safety backup and restoring…" : "Restore this backup"}</Button> : null}
        <Button disabled={busy} onClick={() => start(async () => { const r = await discardRestoreAction(p.runId); toast(r.ok ? r.message ?? "Discarded." : r.error, r.ok ? "green" : "red"); })}>Discard test copy</Button>
      </div>
    </section>
  );
}

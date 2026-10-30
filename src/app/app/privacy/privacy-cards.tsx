"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import type { Grievance } from "@/domain/system/privacy";
import type { RetentionCounts } from "@/domain/system/retention";
import { grievanceAction, retentionPreviewAction, retentionRunAction } from "./actions";

const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-3";

export function GrievanceCard({ initial, pharmacyPhone }: { initial: Grievance; pharmacyPhone: string | null }) {
  const toast = useToast();
  const [g, setG] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <div className={card}>
      <div className="font-semibold text-[15px]">Grievance officer</div>
      <div className="text-[12.5px] text-muted">Printed at the foot of every invoice and receipt, so customers know whom to contact about their data.{pharmacyPhone ? ` If left empty, the pharmacy phone (${pharmacyPhone}) is printed.` : ""}</div>
      <div className="grid gap-2.5 grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
        <Field label="Name"><Input value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} placeholder="e.g. Anita Kulkarni" /></Field>
        <Field label="Email"><Input type="email" value={g.email} onChange={(e) => setG({ ...g, email: e.target.value })} /></Field>
        <Field label="Phone"><Input value={g.phone} onChange={(e) => setG({ ...g, phone: e.target.value })} inputMode="tel" /></Field>
      </div>
      <Button className="self-start" disabled={pending} onClick={() => start(async () => { const r = await grievanceAction(g); if (!r.ok) return toast(r.error, "red"); setG(r.data); toast(r.message!, "green"); })}>Save grievance contact</Button>
    </div>
  );
}

type Rule = { key: keyof RetentionCounts; label: string; action: string };

export function RetentionCard({ rules, initial, years, cutoff, canRun }: { rules: readonly Rule[]; initial: RetentionCounts; years: number; cutoff: string; canRun: boolean }) {
  const toast = useToast();
  const [counts, setCounts] = useState(initial);
  const [pending, start] = useTransition();
  const total = rules.reduce((a, r) => a + counts[r.key], 0);
  const refresh = () => start(async () => { const r = await retentionPreviewAction(); if (r.ok) setCounts(r.data.counts); else toast(r.error, "red"); });
  return (
    <div className={card}>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="font-semibold text-[15px] flex-1">Retention clean-up</div>
        <Button size="sm" disabled={pending} onClick={refresh}>Refresh preview</Button>
        {canRun ? <Button size="sm" variant="danger-outline" disabled={pending || !total} onClick={() => { if (confirm(`Remove or anonymise ${total} item(s) now? This can’t be undone.`)) start(async () => { const r = await retentionRunAction(); if (!r.ok) return toast(r.error, "red"); toast("Retention clean-up done. It’s in the audit trail.", "green"); setCounts(Object.fromEntries(Object.keys(r.data).map((k) => [k, 0])) as RetentionCounts); }); }}>Run now</Button> : null}
      </div>
      <div className="text-[12.5px] text-muted">Runs automatically every day. This preview shows what the next run would change. Customers count as inactive with no purchase since {cutoff} ({years} years).</div>
      <div className="flex flex-col">
        {rules.map((r) => (
          <div key={r.key} className="grid grid-cols-[minmax(0,1fr)_70px] gap-3 py-1.5 border-b border-row last:border-0 text-[13px]">
            <span>{r.label}<span className="block text-[12px] text-faint">{r.action}</span></span>
            <span className="text-right tnum font-semibold" style={{ color: counts[r.key] ? "#94570A" : "#8A929A" }}>{counts[r.key]}</span>
          </div>
        ))}
      </div>
      <div className="text-[12px] text-faint">Never removed: invoices, payments, credit notes, vouchers and ledgers, purchases and GRNs, stock movements, the audit trail and consent records. They are append-only and kept for at least 8 years (GST, income-tax and drug-rule record keeping).</div>
    </div>
  );
}

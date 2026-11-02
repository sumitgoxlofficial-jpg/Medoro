"use client";
import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, Check, Link2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { useActionToast } from "@/components/ui/toast";
import { inr } from "@/lib/money";
import { CHANNEL_LABEL, type Channel } from "@/domain/finance/narration";
import type { billMatching } from "@/domain/finance/bills";
import { approveBillAction, manualBillAction, rejectBillAction, undoBillAction } from "./actions";

type Data = Awaited<ReturnType<typeof billMatching>>;
type Credit = Data["unmatched"][number];
const wrap = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-3";
const input = "border border-line rounded-lg px-3 h-9 text-sm w-full bg-white";

/** Self-hosted bill matching: statement credits with no book entry, matched to credit bills (each match posts a receipt). */
export function BillsView({ data, canAct }: { data: Data; canAct: boolean }) {
  const toast = useActionToast();
  const [pending, start] = useTransition();
  const [manual, setManual] = useState<Credit | null>(null);
  const act = (fn: () => Promise<Parameters<typeof toast>[0]>) => start(async () => { toast(await fn()); });
  const head = (c: Credit) => (
    <div className="flex justify-between gap-2 flex-wrap">
      <span><span className="tabular-nums text-ok font-medium">+{inr(c.leftPaise)}</span>{c.leftPaise !== c.amountPaise && <span className="text-muted"> left of {inr(c.amountPaise)}</span>} <span className="text-muted">{c.date} · {CHANNEL_LABEL[c.channel as Channel]}{c.utr ? ` · ${c.utr}` : ""}{c.payer ? ` · ${c.payer}` : ""}</span>
        <span className="block text-[12.5px] text-muted max-w-[640px] truncate" title={c.description}>{c.description}</span></span>
      {canAct && <Button size="sm" onClick={() => setManual(c)} disabled={pending} aria-label={`Match ${c.description} by hand`}><Link2 size={14} /> Match to a bill…</Button>}
    </div>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className={wrap}>
        <div className="font-semibold">Bank credits to match to credit bills <span className="text-muted font-normal">({data.suggested.length + data.unmatched.length})</span></div>
        <div className="text-[12.5px] text-muted">Statement credits with no entry in your books. Matching one posts a receipt from the customer, dated on the statement date. Amount alone is never matched automatically.</div>
        {data.suggested.map((c) => (
          <div key={c.id} className="border border-line rounded-lg p-3 flex flex-col gap-2">
            {head(c)}
            {c.suggestions.some((p) => p.bookWarning) && <div className="text-[12.5px] text-[#94570A] flex items-center gap-1"><AlertTriangle size={14} /> A receipt of this amount is already in your books and not yet on a statement. If this is that payment, match it on the Bank reconciliation screen instead.</div>}
            <ul className="flex flex-col gap-1">
              {c.suggestions.map((p) => (
                <li key={p.targetId} className="flex justify-between items-center gap-2 flex-wrap bg-chip rounded-lg px-2 py-1.5 text-sm">
                  <span>{p.label} · {inr(p.amountPaise)}<span className="block text-[12px] text-muted">{p.reason}</span></span>
                  {canAct && <span className="flex gap-1">
                    <Button size="sm" variant="primary" disabled={pending} onClick={() => act(() => approveBillAction(c.id, p.targetId))} aria-label={`Approve ${p.label}`}><Check size={14} /> Approve</Button>
                    <Button size="sm" disabled={pending} onClick={() => act(() => rejectBillAction(c.id, p.targetId))} aria-label={`Reject ${p.label}`}><X size={14} /></Button>
                  </span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {data.unmatched.map((c) => <div key={c.id} className="border border-line rounded-lg p-3">{head(c)}</div>)}
        {!data.suggested.length && !data.unmatched.length && <div className="text-sm text-muted">Nothing to match. Upload a statement on the Bank reconciliation screen.</div>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={wrap}>
          <div className="font-semibold">Part-paid bills <span className="text-muted font-normal">({data.partBills.length})</span></div>
          <ul className="text-sm divide-y divide-line">{data.partBills.map((b) => <li key={b.saleId} className="py-1.5 flex justify-between gap-2"><span>{b.invoiceNo} · {b.customerName}</span><span className="tabular-nums">paid {inr(b.paidPaise)} of {inr(b.creditPaise)} · <span className="text-bad">{inr(b.balancePaise)} due</span></span></li>)}
            {!data.partBills.length && <li className="py-1.5 text-muted">None.</li>}</ul>
        </div>
        <div className={wrap}>
          <div className="font-semibold">Matched to bills (latest)</div>
          <ul className="text-sm divide-y divide-line">
            {data.recent.map((r) => (
              <li key={r.id} className="py-1.5 flex justify-between items-center gap-2 flex-wrap">
                <span>{r.invoiceNo} · {r.customer} · {inr(r.amountPaise)} <span className="text-muted">{r.date} · {r.voucherNo} · {r.kind === "auto" ? `automatic, rule ${r.rule}` : r.kind}</span></span>
                {r.undone ? <Badge tone="gray">Undone</Badge> : canAct && <Button size="sm" disabled={pending} onClick={() => act(() => undoBillAction(r.id))} aria-label={`Undo ${r.invoiceNo}`}><Undo2 size={14} /> Undo</Button>}
              </li>
            ))}
            {!data.recent.length && <li className="py-1.5 text-muted">None yet.</li>}
          </ul>
        </div>
      </div>

      <div className={wrap}>
        <div className="font-semibold">Open credit bills <span className="text-muted font-normal">({data.openBills.length})</span></div>
        <div className="text-[12.5px] text-muted">Ask customers to write the reference in the UPI or NEFT payment note: the bill’s reference pays that bill, the customer’s pays their oldest bills first. Medoro then matches the payment by itself.</div>
        <div className="overflow-x-auto"><table className="w-full text-sm [&_th]:text-left [&_th]:font-medium [&_th]:text-muted [&_th]:py-1.5 [&_th]:pr-3 [&_td]:py-1.5 [&_td]:pr-3 [&_tr]:border-b [&_tr]:border-line">
          <thead><tr><th>Bill</th><th>Customer</th><th>Date</th><th>Due</th><th>Bill reference</th><th>Customer reference</th></tr></thead>
          <tbody>{data.openBills.slice(0, 300).map((b) => <tr key={b.saleId}><td>{b.invoiceNo}</td><td>{b.customerName}</td><td>{b.date}</td><td className="tabular-nums text-bad">{inr(b.balancePaise)}</td><td className="font-mono text-[12px]">{b.medoroRef}</td><td className="font-mono text-[12px]">{b.customerRef}</td></tr>)}</tbody>
        </table></div>
      </div>
      {manual && <ManualMatch c={manual} bills={data.openBills} onClose={() => setManual(null)} onSave={(saleId, amountPaise) => start(async () => { if (toast(await manualBillAction(manual.id, saleId, amountPaise))) setManual(null); })} pending={pending} />}
    </div>
  );
}

function ManualMatch({ c, bills, onClose, onSave, pending }: { c: Credit; bills: Data["openBills"]; onClose: () => void; onSave: (saleId: string, amountPaise: number) => void; pending: boolean }) {
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<Data["openBills"][number] | null>(null);
  const [amount, setAmount] = useState("");
  const list = useMemo(() => { const s = q.trim().toLowerCase(); return bills.filter((b) => !s || `${b.invoiceNo} ${b.customerName}`.toLowerCase().includes(s) || String(b.balancePaise / 100).startsWith(s)).slice(0, 50); }, [bills, q]);
  const paise = Math.round(Number(amount.replace(/[^\d.]/g, "")) * 100) || 0;
  return (
    <Modal open onClose={onClose} width={560} title="Match to a credit bill" sub={`${inr(c.leftPaise)} of this credit is left to match. A receipt is posted for the amount you match.`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!pick || !paise || pending} onClick={() => pick && onSave(pick.saleId, paise)}>Match</Button></>}>
      <div className="flex flex-col gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search bill, customer or amount" className={input} aria-label="Search bills" autoFocus />
        <ul className="max-h-[300px] overflow-y-auto text-sm divide-y divide-line">
          {list.map((b) => <li key={b.saleId}><button className={`w-full text-left py-1.5 px-1 cursor-pointer flex justify-between ${pick?.saleId === b.saleId ? "bg-chip" : ""}`} onClick={() => { setPick(b); setAmount((Math.min(b.balancePaise, c.leftPaise) / 100).toFixed(2)); }}><span>{b.invoiceNo} · {b.customerName} · {b.date}</span><span className="tabular-nums">{inr(b.balancePaise)}</span></button></li>)}
          {!list.length && <li className="py-2 text-muted">No open credit bill matches.</li>}
        </ul>
        {pick && <label className="flex flex-col gap-1 text-[13px] text-muted">Amount to match (₹)<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={input} aria-label="Amount to match" /></label>}
      </div>
    </Modal>
  );
}

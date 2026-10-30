"use client";
import { useState, useTransition } from "react";
import { ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/badge";
import { Empty } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useActionToast } from "@/components/ui/toast";
import { inr, inr0 } from "@/lib/money";
import { dayMonth, monthYear } from "@/lib/dates";
import { CLAIM_REASONS, CLAIM_STATUS, type ClaimReason } from "@/domain/inventory/claim-types";
import type { listClaims, nearExpiryClaims } from "@/domain/inventory/claims";
import { acknowledgeClaimAction, creditClaimAction, raiseClaimAction } from "./claims-actions";

type Claims = Awaited<ReturnType<typeof listClaims>>;
type Claim = Claims["rows"][number];
type Near = Awaited<ReturnType<typeof nearExpiryClaims>>;
const TONE: Record<Claim["status"], Tone> = { raised: "amber", acknowledged: "blue", credited: "green", rejected: "red" };
const th = "text-left text-[12px] font-medium text-muted px-3 py-2.5 border-b border-[#E3E6E9] whitespace-nowrap";
const td = "px-3 py-2 border-b border-row";
const wrap = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)]";

export function ClaimsPanel({ claims, nearExpiry }: { claims: Claims; nearExpiry: Near }) {
  const toastR = useActionToast();
  const [pending, start] = useTransition();
  const [credit, setCredit] = useState<{ c: Claim; close: boolean } | null>(null);
  const [raise, setRaise] = useState<{ batchId: string; item: string; qty: number; days: number; supplier: string } | null>(null);
  return (
    <div className="flex flex-col gap-3.5">
      <div className={wrap + " overflow-auto"}>
        <div className="px-4 pt-3 pb-1 font-semibold text-[14.5px]">Pending claims by supplier</div>
        {claims.aging.length ? (
          <table className="w-full border-collapse text-[13.5px] min-w-[720px]">
            <thead><tr className="bg-subtle"><th className={th}>Supplier</th><th className={th + " text-right"}>Open claims</th><th className={th + " text-right"}>0–30 d</th><th className={th + " text-right"}>31–60 d</th><th className={th + " text-right"}>61–90 d</th><th className={th + " text-right"}>Over 90 d</th><th className={th + " text-right"}>Total due</th></tr></thead>
            <tbody>{claims.aging.map((a) => (
              <tr key={a.supplierId}><td className={td}>{a.supplier}</td><td className={td + " text-right tnum"}>{a.count}</td>{a.buckets.map((b, i) => <td key={i} className={td + " text-right tnum"} style={{ color: i === 3 && b ? "#B3261E" : undefined }}>{b ? inr0(b) : "—"}</td>)}<td className={td + " text-right tnum font-semibold"}>{inr(a.open)}</td></tr>
            ))}</tbody>
          </table>
        ) : <div className="px-4 pb-3 text-[13px] text-fainter">No pending claims.</div>}
      </div>

      <div className={wrap + " overflow-auto"}>
        <div className="px-4 pt-3 pb-1 font-semibold text-[14.5px]">Claims</div>
        {claims.rows.length ? (
          <table className="w-full border-collapse text-[13px] min-w-[1050px]">
            <thead><tr className="bg-subtle"><th className={th}>Claim</th><th className={th}>Supplier</th><th className={th}>Item</th><th className={th}>Reason</th><th className={th + " text-right"}>Claimed</th><th className={th + " text-right"}>Credited</th><th className={th + " text-right"}>Open</th><th className={th}>Status</th><th className={th} /></tr></thead>
            <tbody>{claims.rows.map((c) => {
              const open = c.status === "raised" || c.status === "acknowledged";
              return (
                <tr key={c.id}>
                  <td className={td}><span className="font-mono text-[12px]">{c.no}</span><div className="text-faint text-[11.5px]">{dayMonth(new Date(c.raisedAt), true)} · {c.age} d</div></td>
                  <td className={td}>{c.supplier}</td>
                  <td className={td}>{c.item} × {c.qty}<div className="text-faint text-[11.5px]">exp {c.expiry ? monthYear(c.expiry) : "—"}</div></td>
                  <td className={td}>{CLAIM_REASONS[c.reason]}</td>
                  <td className={td + " text-right tnum"}>{inr(c.claim)}</td>
                  <td className={td + " text-right tnum"}>{c.credit ? inr(c.credit) : "—"}{c.credits.length ? <div className="text-faint text-[11.5px]">{c.credits.map((x) => x.ref).join(", ")}</div> : null}</td>
                  <td className={td + " text-right tnum"}>{open ? inr(c.open) : c.writeOff ? <span className="text-faint" title={c.writeOffReason ?? ""}>written off {inr(c.writeOff)}</span> : "—"}</td>
                  <td className={td}><Badge tone={TONE[c.status]}>{CLAIM_STATUS[c.status]}</Badge></td>
                  <td className={td + " text-right whitespace-nowrap"}>
                    {open ? <div className="flex gap-1.5 justify-end">
                      {c.status === "raised" ? <Button size="sm" disabled={pending} onClick={() => start(async () => { toastR(await acknowledgeClaimAction(c.id)); })}>Acknowledged</Button> : null}
                      <Button size="sm" variant="primary" onClick={() => setCredit({ c, close: false })}>Credit note</Button>
                      <Button size="sm" variant="danger-outline" onClick={() => setCredit({ c, close: true })}>Close</Button>
                    </div> : null}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        ) : <Empty icon={ClipboardList} title="No claims yet" body="Raise an expiry or breakage claim from a suggestion below, or from a batch under Stock → batch actions." />}
      </div>

      <div className={wrap + " px-4 py-3 flex flex-col gap-2"}>
        <div className="font-semibold text-[14.5px]">Claim before it’s too late <span className="text-[12px] font-normal text-faint">stock inside each supplier’s expiry return window</span></div>
        {nearExpiry.length ? nearExpiry.map((g) => (
          <div key={g.supplierId} className="border-t border-row pt-2">
            <div className="flex justify-between text-[13.5px]"><strong>{g.supplier}</strong><span className="text-muted">window {g.window} d · {inr0(g.value)} at cost</span></div>
            {g.items.map((x) => (
              <div key={x.batchId} className="grid grid-cols-[minmax(0,1fr)_120px_90px_100px_auto] gap-3 items-center py-1 text-[13px]">
                <span className="truncate">{x.item} <span className="font-mono text-[12px] text-muted">{x.batchNo}</span></span>
                <span style={{ color: x.days <= 0 ? "#B3261E" : x.days <= 30 ? "#94570A" : undefined }}>{x.days <= 0 ? "expired" : `${x.days} d left`} · {monthYear(x.expiry)}</span>
                <span className="tnum text-right">{x.qty} units</span><span className="tnum text-right">{inr0(x.value)}</span>
                <Button size="sm" onClick={() => setRaise({ batchId: x.batchId, item: `${x.item} · ${x.batchNo}`, qty: x.qty, days: x.days, supplier: g.supplier })}>Raise claim</Button>
              </div>
            ))}
          </div>
        )) : <div className="text-[13px] text-fainter">Nothing is inside a supplier’s return window. Set each supplier’s window under Suppliers & customers.</div>}
      </div>

      <CreditModal state={credit} onClose={() => setCredit(null)} />
      <RaiseClaimModal batch={raise} onClose={() => setRaise(null)} />
    </div>
  );
}

function CreditModal({ state, onClose }: { state: { c: Claim; close: boolean } | null; onClose: () => void }) {
  const toastR = useActionToast();
  const [f, setF] = useState({ ref: "", amount: "", close: false, reason: "" });
  const [key, setKey] = useState("");
  const [pending, start] = useTransition();
  if (!state) return null;
  const k = state.c.id + state.close;
  if (k !== key) { setKey(k); setF({ ref: "", amount: state.close ? "" : (state.c.open / 100).toFixed(2), close: state.close, reason: "" }); }
  const amt = Math.round((parseFloat(f.amount) || 0) * 100), left = Math.max(0, state.c.open - amt);
  const save = () => start(async () => { if (toastR(await creditClaimAction(state.c.id, f))) onClose(); });
  return (
    <Modal open onClose={onClose} title={state.close ? `Close ${state.c.no}` : `Credit note for ${state.c.no}`} sub={<>{state.c.supplier} · open {inr(state.c.open)}</>} width={460}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={pending}>{f.close && left && !amt ? "Close as rejected" : "Record"}</Button></>}>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Supplier credit note no."><Input value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} placeholder={state.close ? "If any" : ""} autoFocus /></Field>
        <Field label="Amount credited ₹"><Input value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" placeholder="0" /></Field>
      </div>
      <Checkbox checked={f.close} onChange={(e) => setF({ ...f, close: e.target.checked })} label={`Close the claim and write off what isn’t credited${left ? ` (${inr(left)})` : ""}`} />
      {f.close && left ? <Field label="Why the rest is written off"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. supplier credits expiry at 80% of PTR" /></Field> : null}
      <div className="text-[12px] text-faint">The credit note reduces what you owe {state.c.supplier} and settles their oldest bills. A shortfall you write off goes to Claim write-off; anything credited above the claim is a recovery on the same account. Leave the box unticked to keep the rest open for a later credit note.</div>
    </Modal>
  );
}

export function RaiseClaimModal({ batch, onClose }: { batch: { batchId: string; item: string; qty: number; days: number; supplier: string } | null; onClose: () => void }) {
  const toastR = useActionToast();
  const [f, setF] = useState({ qty: "", reason: "near_expiry" as ClaimReason, note: "" });
  const [key, setKey] = useState("");
  const [pending, start] = useTransition();
  if (!batch) return null;
  if (key !== batch.batchId) { setKey(batch.batchId); setF({ qty: String(batch.qty), reason: batch.days <= 0 ? "expiry" : "near_expiry", note: "" }); }
  const save = () => start(async () => {
    const r = await raiseClaimAction(batch.batchId, parseInt(f.qty) || 0, f.reason, f.note);
    if (toastR(r.ok ? { ...r, message: `${r.data} raised on ${batch.supplier}. Stock is out; the payable drops when their credit note arrives.` } : r)) onClose();
  });
  return (
    <Modal open onClose={onClose} title="Raise claim on supplier" sub={<>{batch.item} · {batch.qty} in stock · {batch.supplier}</>} width={460}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={pending}>Raise claim</Button></>}>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Reason"><Select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value as ClaimReason })}>{Object.entries(CLAIM_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Units"><Input value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value.replace(/\D/g, "") })} inputMode="numeric" /></Field>
      </div>
      <Field label="Note"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. handed to salesman with claim form" /></Field>
      <div className="text-[12px] text-faint">The units leave stock now and their cost (and input GST) moves to Supplier claims receivable until the supplier’s credit note is recorded.</div>
    </Modal>
  );
}

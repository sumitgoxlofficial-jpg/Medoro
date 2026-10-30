"use client";
import { useState, useTransition } from "react";
import { Banknote } from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/badge";
import { Empty } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useActionToast } from "@/components/ui/toast";
import { inr } from "@/lib/money";
import { dayMonth } from "@/lib/dates";
import { CHEQUE_STATUS } from "@/domain/parties/cheque-types";
import type { listCheques } from "@/domain/parties/cheques";
import { bounceChequeAction, clearChequeAction, depositChequeAction } from "./actions";

type Cheque = Awaited<ReturnType<typeof listCheques>>[number];
const TONE: Record<Cheque["status"], Tone> = { pending: "amber", deposited: "blue", cleared: "green", bounced: "red" };
const th = "text-left text-[12px] font-medium text-muted px-3 py-2.5 border-b border-[#E3E6E9] whitespace-nowrap";
const td = "px-3 py-2.5 border-b border-row";

export function ChequesView({ cheques, canAct, today }: { cheques: Cheque[]; canAct: boolean; today: string }) {
  const [tab, setTab] = useState<"open" | "received" | "issued" | "all">("open");
  const rows = cheques.filter((c) => (tab === "open" ? c.status === "pending" || c.status === "deposited" : tab === "all" ? true : c.direction === tab));
  const sum = (d: Cheque["direction"]) => cheques.filter((c) => c.direction === d && (c.status === "pending" || c.status === "deposited")).reduce((a, c) => a + c.amount, 0);
  return (
    <div className="flex flex-col gap-3.5 max-w-[1400px]">
      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
        <Stat label="Cheques in hand (not cleared)" value={inr(sum("received"))} />
        <Stat label="Issued, not yet cleared" value={inr(sum("issued"))} />
        <Stat label="Due within 3 days" value={String(cheques.filter((c) => (c.status === "pending" || c.status === "deposited") && c.days <= 3).length)} />
      </div>
      <Segmented value={tab} onChange={setTab} className="self-start bg-[#EEF0F2]" options={[{ value: "open", label: "Open" }, { value: "received", label: "Received" }, { value: "issued", label: "Issued" }, { value: "all", label: "All (180 days)" }]} />
      <ChequeTable rows={rows} canAct={canAct} today={today} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="bg-white border border-line rounded-xl px-4 py-3"><div className="text-[12.5px] text-muted">{label}</div><div className="text-[20px] font-semibold tnum">{value}</div></div>;
}

export function ChequeTable({ rows, canAct, today, compact = false }: { rows: Cheque[]; canAct: boolean; today: string; compact?: boolean }) {
  const toastR = useActionToast();
  const [pending, start] = useTransition();
  const [bounce, setBounce] = useState<Cheque | null>(null);
  const clear = (c: Cheque) => {
    const on = prompt(`Cheque ${c.no} cleared on (yyyy-mm-dd):`, today);
    if (on === null) return;
    start(async () => { toastR(await clearChequeAction(c.id, on.trim())); });
  };
  if (!rows.length) return <div className="bg-white border border-line rounded-xl"><Empty icon={Banknote} title="No cheques here" body="Record a cheque when you receive a customer payment or pay a supplier under Suppliers & customers (method: Cheque)." /></div>;
  return (
    <div className="bg-white border border-line rounded-xl overflow-auto">
      <table className="w-full border-collapse text-[13.5px] min-w-[860px]">
        <thead><tr className="bg-subtle"><th className={th}>Cheque date</th><th className={th}>Party</th><th className={th}>Cheque</th><th className={th + " text-right"}>Amount</th><th className={th}>Status</th>{canAct ? <th className={th} /> : null}</tr></thead>
        <tbody>{rows.map((c) => (
          <tr key={c.id}>
            <td className={td}>{dayMonth(new Date(c.date + "T00:00:00+05:30"), true)}<div className="text-[11.5px]" style={{ color: c.days > 0 ? "#2459C9" : c.status === "pending" && c.direction === "received" ? "#94570A" : "#8A929A" }}>{c.days > 0 ? `post-dated · in ${c.days} d` : c.days === 0 ? "today" : `${-c.days} d ago`}</div></td>
            <td className={td}>{c.party}<div className="text-[11.5px] text-faint">{c.direction === "received" ? "from customer" : "to supplier"}</div></td>
            <td className={td}><span className="font-mono text-[12.5px]">{c.no}</span> · {c.bank}{c.note ? <div className="text-[11.5px] text-faint">{c.note}</div> : null}</td>
            <td className={td + " text-right tnum font-semibold"} style={{ color: c.direction === "issued" ? "#B3261E" : undefined }}>{c.direction === "issued" ? "−" : ""}{inr(c.amount)}</td>
            <td className={td}><Badge tone={TONE[c.status]}>{CHEQUE_STATUS[c.status]}</Badge>{c.bounceReason ? <div className="text-[11.5px] text-faint">{c.bounceReason}{c.charge ? ` · charge ${inr(c.charge)}` : ""}</div> : null}</td>
            {canAct ? <td className={td + " text-right whitespace-nowrap"}>
              <div className="flex gap-1.5 justify-end">
                {c.direction === "received" && c.status === "pending" ? <Button size="sm" variant="primary" disabled={pending || c.days > 0} title={c.days > 0 ? "Post-dated: deposit on or after the cheque date" : ""} onClick={() => start(async () => { toastR(await depositChequeAction(c.id)); })}>Deposit</Button> : null}
                {(c.direction === "received" && c.status === "deposited") || (c.direction === "issued" && c.status === "pending") ? <Button size="sm" variant="primary" disabled={pending} onClick={() => clear(c)}>Cleared</Button> : null}
                {(c.status === "pending" || c.status === "deposited") && !compact ? <Button size="sm" variant="danger-outline" disabled={pending} onClick={() => setBounce(c)}>Bounced</Button> : null}
              </div>
            </td> : null}
          </tr>
        ))}</tbody>
      </table>
      <BounceModal c={bounce} today={today} onClose={() => setBounce(null)} />
    </div>
  );
}

function BounceModal({ c, today, onClose }: { c: Cheque | null; today: string; onClose: () => void }) {
  const toastR = useActionToast();
  const [f, setF] = useState({ reason: "", charge: "", bankCharge: "", on: today });
  const [key, setKey] = useState("");
  const [pending, start] = useTransition();
  if (!c) return null;
  if (key !== c.id) { setKey(c.id); setF({ reason: "", charge: "", bankCharge: "", on: today }); }
  const save = () => start(async () => { if (toastR(await bounceChequeAction(c.id, f))) onClose(); });
  const recv = c.direction === "received";
  return (
    <Modal open onClose={onClose} title={`Cheque ${c.no} bounced`} sub={<>{c.party} · {inr(c.amount)} · {c.bank}</>} width={480}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" onClick={save} disabled={pending}>Record bounce</Button></>}>
      <Field label="Bank’s return reason"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. funds insufficient, signature differs" autoFocus /></Field>
      <div className="grid grid-cols-3 gap-2.5">
        <Field label={recv ? "Charge to customer ₹" : "Supplier’s penalty ₹"}><Input value={f.charge} onChange={(e) => setF({ ...f, charge: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" placeholder="0" /></Field>
        <Field label="Our bank’s charge ₹"><Input value={f.bankCharge} onChange={(e) => setF({ ...f, bankCharge: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" placeholder="0" /></Field>
        <Field label="Returned on"><Input type="date" max={today} value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} /></Field>
      </div>
      <div className="text-[12px] text-faint">{recv ? "The customer owes the amount again (plus any charge you recover from them)." : "You owe the supplier again; bills this cheque paid are reopened. A penalty they levy is added to what you owe."} Your bank’s charge is booked to Bank charges. Nothing is edited: a new journal is posted.</div>
    </Modal>
  );
}

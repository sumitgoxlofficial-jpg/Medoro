"use client";
import { useState, useTransition } from "react";
import { Banknote, CheckCircle2, MapPin, Navigation, Phone, PackageCheck, PackageX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, Empty } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Segmented } from "@/components/ui/segmented";
import { useActionToast } from "@/components/ui/toast";
import { inr } from "@/lib/money";
import { dayMonth, todayISO } from "@/lib/dates";
import { mapsLink, PAY_LABEL } from "@/domain/orders/contracts";
import type { OrderView } from "@/domain/orders/service";
import { deliveredAction, failedAction } from "./actions";

export function DeliveriesView({ open, done, cashInHand }: { open: OrderView[]; done: OrderView[]; cashInHand: number }) {
  return (
    <div className="flex flex-col gap-3 max-w-[560px]">
      {cashInHand ? (
        <Card className="p-3.5 flex items-center gap-3 bg-[#FDF2E1] border-[#F3D9AE]">
          <Banknote size={20} className="text-[#94570A]" />
          <div className="flex-1 text-[13.5px]"><b>{inr(cashInHand)}</b> cash with you. Hand it over at the counter; they count it and give you a receipt number.</div>
        </Card>
      ) : null}
      {open.length ? open.map((o) => <Stop key={o.id} o={o} />) : <Card><Empty icon={PackageCheck} title="Nothing to deliver right now" body="Orders the store sends out with you appear here, with the address, phone and amount to collect." /></Card>}
      {done.length ? (
        <Card className="p-4 flex flex-col gap-2">
          <div className="font-semibold text-[14px]">Today</div>
          {done.map((o) => (
            <div key={o.id} className="flex items-center gap-2 text-[13px]">
              {o.status === "delivered" ? <CheckCircle2 size={15} className="text-ok" /> : <PackageX size={15} className="text-bad" />}
              <span className="flex-1 truncate">{o.no} · {o.name}</span>
              <span className="tnum">{o.collected ? `${inr(o.collected)} ${o.collectedMode?.toUpperCase()}` : PAY_LABEL[o.payMode]}</span>
            </div>
          ))}
        </Card>
      ) : null}
    </div>
  );
}

function Stop({ o }: { o: OrderView }) {
  const act = useActionToast();
  const [pending, start] = useTransition();
  const [ask, setAsk] = useState<null | "done" | "fail">(null);
  const [otp, setOtp] = useState(""), [noCode, setNoCode] = useState(false), [recv, setRecv] = useState("");
  const [mode, setMode] = useState<"cash" | "upi">("cash"), [amount, setAmount] = useState(((o.total ?? 0) / 100).toFixed(2));
  const [reason, setReason] = useState("");
  const cod = o.payMode === "cod";
  const big = "h-11 flex-1 text-[14px]";
  const submit = () => start(async () => {
    const r = await deliveredAction(o.id, noCode ? { receivedBy: recv, collected: cod ? amount : 0, collectedMode: mode } : { otp, receivedBy: recv || undefined, collected: cod ? amount : 0, collectedMode: mode });
    if (act(r)) setAsk(null);
  });

  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold text-[15px] text-ink-strong">{o.name}</span>{o.slotDate ? <Badge tone="blue">{o.slotDate === todayISO() ? "Today" : dayMonth(new Date(o.slotDate + "T00:00:00+05:30"))}{o.slot ? " · " + o.slot : ""}</Badge> : null}</div>
          <div className="text-[13px] text-muted flex gap-1 mt-1"><MapPin size={14} className="mt-0.5 flex-none" />{o.address}</div>
          {o.notes ? <div className="text-[12.5px] text-[#94570A] mt-1">{o.notes}</div> : null}
        </div>
        <div className="text-right flex-none">
          <div className={"font-semibold tnum text-[16px] " + (cod ? "text-ink-strong" : "text-ok")}>{cod ? inr(o.total ?? 0) : "Paid"}</div>
          <div className="text-[11.5px] text-faint">{cod ? "collect" : PAY_LABEL[o.payMode]}</div>
        </div>
      </div>
      <div className="text-[12.5px] text-muted">{o.no} · {o.invoiceNo} · {o.items.map((i) => `${i.name} × ${i.qty}`).join(", ")}</div>
      {o.reason ? <div className="text-[12.5px] text-bad">Last attempt: {o.reason}</div> : null}
      <div className="flex gap-2">
        <a href={`tel:+91${o.phone}`} className={"inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white font-medium no-underline text-ink " + big}><Phone size={16} />Call</a>
        <a href={mapsLink(o.address)} target="_blank" rel="noreferrer" className={"inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white font-medium no-underline text-ink " + big}><Navigation size={16} />Navigate</a>
      </div>
      <div className="flex gap-2">
        <Button variant="primary" className={big} onClick={() => { setOtp(""); setRecv(""); setNoCode(false); setAsk("done"); }}><CheckCircle2 size={16} />Delivered</Button>
        <Button variant="danger-outline" className={big} onClick={() => setAsk("fail")}>Couldn’t deliver</Button>
      </div>

      <Modal open={ask === "done"} onClose={() => setAsk(null)} title={`Deliver ${o.no}`} sub={noCode ? "Write the name of the person who took the parcel." : "Ask the customer for the 4-digit code we sent them."}
        footer={<><Button onClick={() => setAsk(null)}>Back</Button><Button variant="primary" size="lg" disabled={pending || (noCode ? recv.trim().length < 2 : otp.length !== 4)} onClick={submit}>Confirm delivery</Button></>}>
        {noCode ? (
          <Field label="Received by"><Input value={recv} onChange={(e) => setRecv(e.target.value)} placeholder="Name" autoFocus /></Field>
        ) : (
          <Field label="Delivery code"><Input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" autoComplete="one-time-code" className="text-[22px] tracking-[.4em] text-center h-12" autoFocus /></Field>
        )}
        <button className="text-teal text-[13px] text-left cursor-pointer" onClick={() => setNoCode((x) => !x)}>{noCode ? "Customer has the code" : "No code? Record who received it"}</button>
        {cod ? (
          <>
            <Field label="Collected"><Segmented value={mode} onChange={setMode} options={[{ value: "cash", label: "Cash" }, { value: "upi", label: "UPI to shop" }]} /></Field>
            <Field label="Amount (₹)" hint={`Invoice total ${inr(o.total ?? 0)}`}><Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></Field>
          </>
        ) : null}
      </Modal>
      <Modal open={ask === "fail"} onClose={() => setAsk(null)} title="Couldn’t deliver" sub="The store sees this right away. Bring the parcel back if they ask."
        footer={<><Button onClick={() => setAsk(null)}>Back</Button><Button variant="danger" disabled={pending || reason.trim().length < 3} onClick={() => start(async () => { const r = await failedAction(o.id, reason); if (act(r)) { setAsk(null); setReason(""); } })}>Report</Button></>}>
        <div className="flex gap-1.5 flex-wrap">{["Not at home", "Phone not answered", "Wrong address", "Refused"].map((x) => <Button key={x} size="sm" onClick={() => setReason(x)}>{x}</Button>)}</div>
        <Field label="What happened"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Modal>
    </Card>
  );
}

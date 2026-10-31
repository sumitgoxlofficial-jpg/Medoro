"use client";
import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bike, FileImage, MapPin, MessageCircle, Plus, Printer, Trash2, Upload, Banknote, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/badge";
import { Card, Empty } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Segmented } from "@/components/ui/segmented";
import { useActionToast, useToast } from "@/components/ui/toast";
import { inr } from "@/lib/money";
import { dayMonth, hhmm, todayISO } from "@/lib/dates";
import { isH1 } from "@/lib/rx";
import { isMasked } from "@/lib/mask";
import { mapsLink, ORDER_PAY, ORDER_SOURCES, PAY_LABEL, SOURCE_LABEL, STATUS_LABEL, type OrderPay, type OrderStatus } from "@/domain/orders/contracts";
import type { OrderView, recentSettlements, riderCash, riders } from "@/domain/orders/service";
import type { NotifyEvent } from "@/domain/orders/notify";
import {
  cancelAction, confirmAction, createOrderAction, deliverAction, dispatchAction, packAction, reassignAction, returnAction, saveTemplatesAction, searchMedsAction, settleAction, uploadRxAction,
} from "./actions";

type Rider = Awaited<ReturnType<typeof riders>>[number];
type Cash = Awaited<ReturnType<typeof riderCash>>;
type Settlement = Awaited<ReturnType<typeof recentSettlements>>[number];
type Cust = { id: string; name: string; phone: string | null; optIn: boolean; limit: number };
type Med = Awaited<ReturnType<typeof searchMedsAction>>[number];

export const STATUS_TONE: Record<OrderStatus, Tone> = { new: "amber", confirmed: "blue", packed: "teal", out_for_delivery: "purple", delivered: "green", cancelled: "gray", returned: "red" };
const SLOTS = ["09:00–12:00", "12:00–15:00", "15:00–18:00", "18:00–21:00"];
const when = (iso: string) => `${dayMonth(new Date(iso))} ${hhmm(new Date(iso))}`;

export function OrdersView({ tab, q, orders, counts, riders, cash, settlements, customers, canRefund, canCredit, templates }: {
  tab: "open" | "done" | "cash"; q: string; orders: OrderView[]; counts: Partial<Record<OrderStatus, number>>; riders: Rider[]; cash: Cash; settlements: Settlement[];
  customers: Cust[]; canRefund: boolean; canCredit: boolean; templates: Record<NotifyEvent, string> | null;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [term, setTerm] = useState(q);
  const open = Object.values(counts).reduce((a, n) => a + (n ?? 0), 0);
  const cashTotal = cash.reduce((a, r) => a + r.total, 0);
  const go = (t: string, query = term) => router.push(`/app/orders?tab=${t}${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ""}`);
  const groups: OrderStatus[] = tab === "open" ? ["new", "confirmed", "packed", "out_for_delivery"] : ["delivered", "returned", "cancelled"];

  return (
    <div className="flex flex-col gap-4 max-w-[1400px]">
      <div className="flex gap-2 items-center flex-wrap">
        <Segmented value={tab} onChange={(v) => go(v)} options={[
          { value: "open", label: `Open${open ? ` (${open})` : ""}` }, { value: "done", label: "Done (30 days)" }, { value: "cash", label: `Rider cash${cashTotal ? ` · ${inr(cashTotal)}` : ""}` },
        ]} />
        {tab !== "cash" ? (
          <form className="relative flex-1 min-w-[200px] max-w-[320px]" onSubmit={(e) => { e.preventDefault(); go(tab); }}>
            <Search size={15} className="absolute left-2.5 top-[11px] text-fainter" />
            <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Order no., name, phone, invoice" className="pl-8" aria-label="Search orders" />
          </form>
        ) : <div className="flex-1" />}
        {templates ? <Button onClick={() => setEditing(true)} title="WhatsApp templates for order updates"><MessageCircle size={15} />Templates</Button> : null}
        <Button variant="primary" onClick={() => setCreating(true)}><Plus size={15} />New order</Button>
      </div>

      {tab === "cash" ? <CashTab cash={cash} settlements={settlements} /> : orders.length ? (
        groups.map((g) => {
          const list = orders.filter((o) => o.status === g);
          if (!list.length) return null;
          return (
            <section key={g} className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-muted"><Badge tone={STATUS_TONE[g]}>{STATUS_LABEL[g]}</Badge>{list.length}</div>
              <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(340px,1fr))] max-[420px]:grid-cols-1">
                {list.map((o) => <OrderCard key={o.id} o={o} riders={riders} canRefund={canRefund} />)}
              </div>
            </section>
          );
        })
      ) : (
        <Card><Empty icon={Bike} title={q ? "No orders match" : tab === "open" ? "No open orders" : "Nothing delivered, returned or cancelled in 30 days"} body={q ? "Try another order number, name or phone." : tab === "open" ? "Click New order to take a phone or WhatsApp order. It's billed when packed and tracked to the door." : "Delivered, returned and cancelled orders from the last 30 days appear here."} /></Card>
      )}
      <NewOrder open={creating} onClose={() => setCreating(false)} customers={customers} canCredit={canCredit} />
      {templates ? <Templates open={editing} onClose={() => setEditing(false)} initial={templates} /> : null}
    </div>
  );
}

function Templates({ open, onClose, initial }: { open: boolean; onClose: () => void; initial: Record<NotifyEvent, string> }) {
  const act = useActionToast();
  const [t, setT] = useState(initial);
  const [pending, start] = useTransition();
  const rows: [NotifyEvent, string, string][] = [
    ["confirmed", "Order confirmed", "{{1}} first name, {{2}} order no., {{3}} amount"],
    ["out_for_delivery", "Out for delivery", "{{1}} name, {{2}} order no., {{3}} delivery code, {{4}} rider, {{5}} amount"],
    ["delivered", "Delivered", "{{1}} name, {{2}} order no."],
  ];
  return (
    <Modal open={open} onClose={onClose} title="Order update templates" sub="Approved WhatsApp templates used for customers who agreed to WhatsApp. Others get an SMS when a gateway is set up." width={560}
      footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" disabled={pending} onClick={() => start(async () => { if (act(await saveTemplatesAction(t))) onClose(); })}>Save</Button></>}>
      {rows.map(([k, label, hint]) => <Field key={k} label={label} hint={hint}><Input value={t[k]} onChange={(e) => setT((x) => ({ ...x, [k]: e.target.value }))} /></Field>)}
    </Modal>
  );
}

function OrderCard({ o, riders, canRefund }: { o: OrderView; riders: Rider[]; canRefund: boolean }) {
  const act = useActionToast();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [rider, setRider] = useState(o.rider?.id ?? riders[0]?.id ?? "");
  const [ask, setAsk] = useState<null | "cancel" | "return" | "deliver" | "history">(null);
  const [reason, setReason] = useState("");
  const [recv, setRecv] = useState(""), [mode, setMode] = useState<"cash" | "upi">("cash");
  const short = o.items.filter((i) => i.available < i.qty);
  const amount = o.total ?? o.estimate;
  const run = (p: Promise<{ ok: true; data?: unknown; message?: string } | { ok: false; error: string }>, msg?: (d: unknown) => string) => start(async () => {
    const r = await p;
    if (r.ok && msg) toast(msg(r.data), "green"); else act(r);
    if (r.ok) { setAsk(null); setReason(""); }
  });
  const upload = (f: File | undefined) => { if (!f) return; const fd = new FormData(); fd.append("file", f); run(uploadRxAction(o.id, fd)); };

  return (
    <Card className="p-4 flex flex-col gap-2.5">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold text-ink-strong">{o.no}</span><Badge tone="gray">{SOURCE_LABEL[o.source as keyof typeof SOURCE_LABEL] ?? o.source}</Badge>{o.slotDate ? <Badge tone="blue">{o.slotDate === todayISO() ? "Today" : dayMonth(new Date(o.slotDate + "T00:00:00+05:30"))}{o.slot ? " · " + o.slot : ""}</Badge> : null}</div>
          <div className="text-[13.5px] mt-1">{o.name} · <a href={`tel:+91${o.phone}`} className="text-teal">{o.phone}</a></div>
          <a href={mapsLink(o.address)} target="_blank" rel="noreferrer" className="text-[12.5px] text-muted flex gap-1 items-start mt-0.5"><MapPin size={13} className="mt-0.5 flex-none" />{o.address}</a>
        </div>
        <div className="text-right flex-none">
          <div className="font-semibold tnum">{inr(amount)}</div>
          <div className="text-[11.5px] text-faint">{o.total == null ? "estimate" : o.invoiceNo}</div>
          <div className="text-[11.5px] text-faint">{PAY_LABEL[o.payMode]}</div>
        </div>
      </div>
      <ul className="text-[13px] flex flex-col gap-0.5 border-t border-line-soft pt-2">
        {o.items.map((i) => (
          <li key={i.medicineId} className="flex gap-2"><span className="flex-1 truncate">{i.name}{i.schedule ? <span className="ml-1 text-[11px] text-bad font-semibold">Rx {i.schedule}</span> : null}</span><span className="tnum">× {i.qty}</span>
            {["new", "confirmed"].includes(o.status) ? <span className={"tnum text-[12px] w-[70px] text-right " + (i.available < i.qty ? "text-bad font-semibold" : "text-faint")}>{i.available} in stock</span> : null}
          </li>
        ))}
      </ul>
      {o.notes ? <div className="text-[12.5px] text-muted bg-page rounded-md px-2 py-1">{o.notes}</div> : null}
      <div className="flex gap-2 flex-wrap items-center text-[12px] text-faint">
        {o.prescriber ? <span>Dr {o.prescriber}</span> : null}
        {o.hasRx ? <a href={`/api/orders/${o.id}/rx`} target="_blank" rel="noreferrer" className="text-teal flex items-center gap-1"><FileImage size={13} />Prescription</a> : null}
        {["new", "confirmed", "packed"].includes(o.status) ? (
          <label className="text-teal flex items-center gap-1 cursor-pointer"><Upload size={13} />{o.hasRx ? "Replace Rx" : "Attach Rx"}<input type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={(e) => upload(e.target.files?.[0])} /></label>
        ) : null}
        {o.saleId ? <Link href={`/print/invoice/${o.saleId}`} target="_blank" className="text-teal flex items-center gap-1"><Printer size={13} />Invoice</Link> : null}
        {o.rider ? <span className="flex items-center gap-1"><Bike size={13} />{o.rider.name}</span> : null}
        {o.reason ? <span className="text-[#94570A]">{o.reason}</span> : null}
        <button onClick={() => setAsk("history")} className="text-teal cursor-pointer ml-auto">History ({o.events.length})</button>
      </div>
      {o.status === "delivered" ? <div className="text-[12.5px] text-ok">Delivered {o.deliveredAt ? when(o.deliveredAt) : ""} · {o.proof === "otp" ? "delivery code" : `received by ${o.receivedBy}`}{o.collected ? ` · ${inr(o.collected)} ${o.collectedMode?.toUpperCase()}${o.collectedMode === "cash" ? (o.settled ? " handed over" : " with rider") : ""}` : ""}</div> : null}

      <div className="flex gap-2 flex-wrap">
        {o.status === "new" ? <Button size="sm" variant="primary" disabled={pending} onClick={() => run(confirmAction(o.id), (d) => (d as { text: string }).text)}>Confirm</Button> : null}
        {o.status === "confirmed" ? <Button size="sm" variant="primary" disabled={pending || short.length > 0} title={short.length ? "Not enough stock for every item" : "Bills the order (FEFO batches) and prints the invoice"} onClick={() => run(packAction(o.id), (d) => `Packed and billed: ${(d as { invoiceNo: string }).invoiceNo}.`)}>Pack & bill</Button> : null}
        {o.status === "packed" || o.status === "out_for_delivery" ? (
          riders.length ? (
            <div className="flex gap-1.5">
              <Select value={rider} onChange={(e) => setRider(e.target.value)} className="h-7 text-[12.5px] w-[150px]" aria-label="Delivery person">{riders.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
              {o.status === "packed"
                ? <Button size="sm" variant="primary" disabled={pending || !rider} onClick={() => run(dispatchAction(o.id, rider), (d) => d as string)}>Send out</Button>
                : <Button size="sm" disabled={pending || rider === o.rider?.id} onClick={() => run(reassignAction(o.id, rider))}>Change rider</Button>}
            </div>
          ) : <span className="text-[12px] text-bad">Add a user with the Delivery role under Users & branches.</span>
        ) : null}
        {o.status === "out_for_delivery" && canRefund ? <Button size="sm" onClick={() => { setRecv(""); setAsk("deliver"); }}>Mark delivered</Button> : null}
        {o.status === "out_for_delivery" && canRefund ? <Button size="sm" variant="danger-outline" onClick={() => setAsk("return")}>Returned</Button> : null}
        {["new", "confirmed"].includes(o.status) || (o.status === "packed" && canRefund) ? <Button size="sm" variant="ghost" onClick={() => setAsk("cancel")}>Cancel</Button> : null}
      </div>

      <Modal open={ask === "cancel" || ask === "return"} onClose={() => setAsk(null)} title={ask === "cancel" ? `Cancel ${o.no}?` : `${o.no} came back`}
        sub={o.saleId ? `Invoice ${o.invoiceNo} is reversed (a void today, otherwise a credit note) and the stock goes back on the shelf.` : "Nothing was billed yet."}
        footer={<><Button onClick={() => setAsk(null)}>Keep</Button><Button variant="danger" disabled={pending || reason.trim().length < 3} onClick={() => run(ask === "cancel" ? cancelAction(o.id, reason) : returnAction(o.id, reason), () => ask === "cancel" ? "Order cancelled." : "Order returned and restocked.")}>{ask === "cancel" ? "Cancel order" : "Return to stock"}</Button></>}>
        <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ask === "cancel" ? "Customer cancelled" : "Customer not at home"} autoFocus /></Field>
      </Modal>
      <Modal open={ask === "deliver"} onClose={() => setAsk(null)} title={`Mark ${o.no} delivered`} sub="For when the rider can’t, e.g. the customer collected it. Record who received it."
        footer={<><Button onClick={() => setAsk(null)}>Close</Button><Button variant="primary" disabled={pending || recv.trim().length < 2} onClick={() => run(deliverAction(o.id, { receivedBy: recv, collected: o.payMode === "cod" ? (o.total ?? 0) / 100 : 0, collectedMode: mode }))}>Mark delivered</Button></>}>
        <Field label="Received by"><Input value={recv} onChange={(e) => setRecv(e.target.value)} autoFocus /></Field>
        {o.payMode === "cod" ? <Field label={`Collected ${inr(o.total ?? 0)} by`}><Segmented value={mode} onChange={setMode} options={[{ value: "cash", label: "Cash" }, { value: "upi", label: "UPI" }]} /></Field> : null}
      </Modal>
      <Modal open={ask === "history"} onClose={() => setAsk(null)} title={`${o.no} history`} width={520}>
        <ol className="flex flex-col gap-2 text-[13px]">
          {o.events.map((e) => <li key={e.id} className="flex gap-2"><span className="text-faint tnum w-[92px] flex-none">{when(e.at)}</span><span className="flex-1"><b className="font-semibold">{STATUS_LABEL[e.kind as OrderStatus] ?? e.kind.replace(/_/g, " ")}</b>{e.note ? ` · ${e.note}` : ""}<span className="text-faint"> · {e.by}</span></span></li>)}
        </ol>
      </Modal>
    </Card>
  );
}

function NewOrder({ open, onClose, customers, canCredit }: { open: boolean; onClose: () => void; customers: Cust[]; canCredit: boolean }) {
  const act = useActionToast();
  const toast = useToast();
  const [pending, start] = useTransition();
  const blank = { source: "phone" as (typeof ORDER_SOURCES)[number], customerId: null as string | null, name: "", phone: "", address: "", slotDate: todayISO(), slot: SLOTS[1], notes: "", payMode: "cod" as OrderPay, payRef: "", discountPct: "0", prescriber: "", prescriberReg: "", waConsent: false };
  const [f, setF] = useState(blank);
  const [items, setItems] = useState<{ med: Med; qty: number }[]>([]);
  const [q, setQ] = useState(""), [hits, setHits] = useState<Med[]>([]);
  const [rx, setRx] = useState<File | null>(null);
  const [cq, setCq] = useState("");
  useEffect(() => { if (!q.trim()) { setHits([]); return; } const h = setTimeout(() => searchMedsAction(q).then(setHits), 250); return () => clearTimeout(h); }, [q]);
  const custHits = useMemo(() => {
    const t = cq.trim().toLowerCase();
    return t.length < 2 ? [] : customers.filter((c) => c.name.toLowerCase().includes(t) || (isMasked(c.phone) ? t.replace(/\D/g, "").length >= 4 && t.replace(/\D/g, "").endsWith(c.phone!.replace(/\D/g, "")) : (c.phone ?? "").includes(t))).slice(0, 6);
  }, [cq, customers]);
  const needRx = items.some((i) => i.med.schedule);
  const needH1 = items.some((i) => isH1(i.med.schedule));
  const est = items.reduce((a, i) => a + i.med.mrp * i.qty, 0) * (1 - (parseFloat(f.discountPct) || 0) / 100);
  const close = () => { setF(blank); setItems([]); setQ(""); setRx(null); setCq(""); onClose(); };
  const set = <K extends keyof typeof blank>(k: K, v: (typeof blank)[K]) => setF((x) => ({ ...x, [k]: v }));

  const submit = () => start(async () => {
    const r = await createOrderAction({ ...f, discountPct: parseFloat(f.discountPct) || 0, slotDate: f.slotDate || null, items: items.map((i) => ({ medicineId: i.med.id, qty: i.qty })) });
    if (!act(r) || !r.ok) return;
    if (rx) { const fd = new FormData(); fd.append("file", rx); const u = await uploadRxAction(r.data.id, fd); if (!u.ok) toast(`Order ${r.data.no} saved, but the prescription didn’t upload: ${u.error}`, "amber"); }
    toast(`Order ${r.data.no} saved. Confirm it to tell the customer.`, "green");
    close();
  });

  return (
    <Modal open={open} onClose={close} title="New order" sub="Billed when packed. Stock is checked again then." width={720}
      footer={<><span className="mr-auto self-center text-[13px] text-muted">About <b className="text-ink">{inr(Math.round(est))}</b></span><Button onClick={close}>Close</Button><Button variant="primary" disabled={pending || !items.length} onClick={submit}>Save order</Button></>}>
      <Segmented value={f.source} onChange={(v) => set("source", v)} options={ORDER_SOURCES.map((s) => ({ value: s, label: SOURCE_LABEL[s] }))} />
      <div className="relative">
        <Field label="Existing customer (optional)"><Input value={cq} onChange={(e) => setCq(e.target.value)} placeholder="Search name or mobile" /></Field>
        {custHits.length ? (
          <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-line rounded-lg shadow-pop">
            {custHits.map((c) => <button key={c.id} className="block w-full text-left px-3 py-2 text-[13px] hover:bg-hover cursor-pointer" onClick={() => { setF((x) => ({ ...x, customerId: c.id, name: c.name, phone: c.phone ?? "", waConsent: x.waConsent || c.optIn })); setCq(""); }}>{c.name} · {c.phone ?? "no mobile"}{c.optIn ? " · WhatsApp ✓" : ""}</button>)}
          </div>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3 max-[560px]:grid-cols-1">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value, customerId: null }))} /></Field>
        <Field label="Mobile"><Input value={f.phone} inputMode="tel" onChange={(e) => setF((x) => ({ ...x, phone: e.target.value, customerId: null }))} /></Field>
      </div>
      <Field label="Delivery address"><Textarea value={f.address} onChange={(e) => set("address", e.target.value)} placeholder="House, street, landmark, area, PIN" /></Field>
      <div className="grid grid-cols-3 gap-3 max-[560px]:grid-cols-1">
        <Field label="Delivery date"><Input type="date" value={f.slotDate} min={todayISO()} onChange={(e) => set("slotDate", e.target.value)} /></Field>
        <Field label="Slot"><Select value={f.slot} onChange={(e) => set("slot", e.target.value)}>{SLOTS.map((s) => <option key={s}>{s}</option>)}<option value="">Any time</option></Select></Field>
        <Field label="Payment"><Select value={f.payMode} onChange={(e) => set("payMode", e.target.value as OrderPay)}>{ORDER_PAY.filter((p) => p !== "credit" || canCredit).map((p) => <option key={p} value={p}>{PAY_LABEL[p]}</option>)}</Select></Field>
      </div>
      {f.payMode === "prepaid" ? <Field label="UPI reference"><Input value={f.payRef} onChange={(e) => set("payRef", e.target.value)} placeholder="UTR / transaction id" /></Field> : null}

      <div className="relative">
        <Field label="Add medicine"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or generic" /></Field>
        {hits.length ? (
          <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-line rounded-lg shadow-pop max-h-[260px] overflow-auto">
            {hits.map((m) => (
              <button key={m.id} className="flex w-full text-left px-3 py-2 text-[13px] hover:bg-hover cursor-pointer gap-2" onClick={() => { setItems((x) => x.some((i) => i.med.id === m.id) ? x : [...x, { med: m, qty: 1 }]); setQ(""); }}>
                <span className="flex-1">{m.name} {m.strength} <span className="text-faint">· {m.pack}</span>{m.schedule ? <span className="ml-1 text-bad text-[11px] font-semibold">Rx {m.schedule}</span> : null}</span>
                <span className={"tnum " + (m.available ? "text-ok" : "text-bad")}>{m.available} in stock</span><span className="tnum w-[70px] text-right">{inr(m.mrp)}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {items.length ? (
        <ul className="flex flex-col gap-1.5">
          {items.map((i) => (
            <li key={i.med.id} className="flex items-center gap-2 text-[13px]">
              <span className="flex-1 truncate">{i.med.name} {i.med.strength}</span>
              <span className={"text-[12px] tnum " + (i.med.available < i.qty ? "text-bad font-semibold" : "text-faint")}>{i.med.available} in stock</span>
              <Input type="number" min={1} value={i.qty} onChange={(e) => setItems((x) => x.map((y) => y.med.id === i.med.id ? { ...y, qty: Math.max(1, parseInt(e.target.value) || 1) } : y))} className="w-[72px] h-8" aria-label="Quantity" />
              <button onClick={() => setItems((x) => x.filter((y) => y.med.id !== i.med.id))} aria-label="Remove" className="text-faint hover:text-bad cursor-pointer"><Trash2 size={15} /></button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="grid grid-cols-2 gap-3 max-[560px]:grid-cols-1">
        <Field label={needRx ? "Prescriber (required for Rx items)" : "Prescriber"}><Input value={f.prescriber} onChange={(e) => set("prescriber", e.target.value)} /></Field>
        <Field label="Prescription photo or PDF"><input type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => setRx(e.target.files?.[0] ?? null)} className="text-[13px]" /></Field>
        {needH1 ? <Field label="Prescriber reg. no. (H1 register)"><Input value={f.prescriberReg} onChange={(e) => set("prescriberReg", e.target.value)} /></Field> : null}
      </div>
      <div className="grid grid-cols-2 gap-3 max-[560px]:grid-cols-1">
        <Field label="Discount %"><Input type="number" min={0} value={f.discountPct} onChange={(e) => set("discountPct", e.target.value)} /></Field>
        <Field label="Notes"><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Gate code, call before coming…" /></Field>
      </div>
      <Checkbox checked={f.waConsent} onChange={(e) => set("waConsent", e.target.checked)} label="Customer agreed to order updates on WhatsApp (otherwise SMS, if set up)" />
    </Modal>
  );
}

function CashTab({ cash, settlements }: { cash: Cash; settlements: Settlement[] }) {
  return (
    <div className="grid gap-4 grid-cols-[minmax(0,1.2fr)_minmax(300px,1fr)] max-[980px]:grid-cols-1 items-start">
      <div className="flex flex-col gap-3">
        {cash.length ? cash.map((r) => <RiderCash key={r.riderId} r={r} />) : <Card><Empty icon={Banknote} title="No cash with delivery staff" body="Cash collected on delivery shows here until it is handed over at the counter." /></Card>}
      </div>
      <Card className="p-4 flex flex-col gap-2">
        <div className="font-semibold">Handovers, last 14 days</div>
        {settlements.length ? (
          <table className="text-[13px] w-full">
            <thead><tr className="text-faint text-left"><th className="font-medium">No.</th><th className="font-medium">Rider</th><th className="font-medium text-right">Expected</th><th className="font-medium text-right">Counted</th></tr></thead>
            <tbody>{settlements.map((s) => <tr key={s.id} className="border-t border-line-soft" title={`${when(s.at)} · received by ${s.by}${s.note ? " · " + s.note : ""}`}><td className="py-1.5">{s.no}</td><td>{s.rider}</td><td className="text-right tnum">{inr(s.expected)}</td><td className={"text-right tnum " + (s.counted !== s.expected ? "text-bad" : "")}>{inr(s.counted)}</td></tr>)}</tbody>
          </table>
        ) : <div className="text-[13px] text-faint">None yet.</div>}
      </Card>
    </div>
  );
}

function RiderCash({ r }: { r: Cash[number] }) {
  const toast = useToast();
  const [counted, setCounted] = useState((r.total / 100).toFixed(2)), [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const diff = Math.round((parseFloat(counted) || 0) * 100) - r.total;
  return (
    <Card className="p-4 flex flex-col gap-2.5">
      <div className="flex items-center gap-2"><Bike size={16} className="text-teal" /><span className="font-semibold flex-1">{r.name}</span><span className="font-semibold tnum">{inr(r.total)}</span></div>
      <ul className="text-[12.5px] text-muted flex flex-col gap-0.5">{r.orders.map((o) => <li key={o.id} className="flex gap-2"><span className="flex-1">{o.no} · {o.name} · {o.invoiceNo}</span><span className="tnum">{inr(o.amount)}</span></li>)}</ul>
      <div className="flex gap-2 items-end flex-wrap">
        <Field label="Cash counted (₹)" className="w-[150px]"><Input inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} /></Field>
        {diff ? <Field label={`${diff < 0 ? "Short" : "Over"} ${inr(Math.abs(diff))}: note`} className="flex-1 min-w-[160px]"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field> : null}
        <Button variant="primary" disabled={pending} onClick={() => start(async () => {
          const x = await settleAction(r.riderId, counted, note);
          toast(x.ok ? `${x.data.no}: ${inr(x.data.counted)} into this counter’s drawer.${x.data.diff ? ` Difference ${inr(x.data.diff)} posted to Cash short/excess.` : ""}` : x.error, x.ok ? "green" : "red");
        })}>Receive cash</Button>
      </div>
    </Card>
  );
}

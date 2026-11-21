"use client";
import { useCallback, useEffect, useState } from "react";
import { FileText, Truck, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { deviceDb } from "@/drivedb/device";
import { inr } from "@/lib/money";
import { useT } from "@/lib/i18n-client";
import { card, input, label, errText, toPaise, type Cfg, type Who } from "../ui";
import { ChemistPicker, InvoiceModal, type Chemist } from "./common";

type Inv = { id: string; no: string; date: string; dueDate: string; chemist: string; totalPaise: number; igst: boolean; cancelled: boolean };

/** Wholesale invoices: view and print, cancel today's, and credit notes. */
export function DistInvoices({ who }: { who: Who }) {
  const toast = useToast();
  const t = useT();
  const dev = deviceDb();
  const [rows, setRows] = useState<Inv[]>([]);
  const [rets, setRets] = useState<{ id: string; no: string; customer: string; invoiceNo: string; totalPaise: number; reason: string; packs: number; toClaims: number }[]>([]);
  const [shown, setShown] = useState<string | null>(null);
  const [crediting, setCrediting] = useState<Inv | null>(null);
  const load = useCallback(() => { dev.call("distInvoices", {}).then(setRows, () => setRows([])); dev.call("distReturns").then(setRets, () => setRets([])); }, [dev]);
  useEffect(() => { load(); }, [load]);
  const cancel = async (i: Inv) => {
    const reason = prompt(t("Why is invoice {no} cancelled?", { no: i.no }));
    if (!reason) return;
    try { await dev.call("distCancelInvoice", { invoiceId: i.id, reason, userId: who.userId }); toast(t("Invoice cancelled; stock restored."), "green"); load(); } catch (e) { toast(errText(e), "red"); }
  };
  return (
    <div className="flex flex-col gap-4">
      <div className={card}>
        <div className="font-semibold">{t("Invoices")}</div>
        <ul className="text-sm divide-y divide-line">
          {rows.map((i) => (
            <li key={i.id} className="py-2 flex justify-between gap-2 flex-wrap items-center">
              <span><b>{i.no}</b> · {i.chemist} · {i.date}{i.cancelled ? <span className="text-bad"> · {t("Cancelled")}</span> : ""}</span>
              <span className="flex gap-1.5 items-center"><span className="text-muted">{inr(i.totalPaise)}</span>
                <Button size="sm" onClick={() => setShown(i.id)}><FileText size={14} /> {t("View")}</Button>
                {!i.cancelled && <Button size="sm" onClick={() => setCrediting(i)}><Undo2 size={14} /> {t("Credit note")}</Button>}
                {!i.cancelled && who.owner && <Button size="sm" variant="danger-outline" onClick={() => cancel(i)}><X size={14} /> {t("Cancel")}</Button>}</span>
            </li>
          ))}
          {!rows.length && <li className="py-3 text-muted">{t("No invoices yet.")}</li>}
        </ul>
      </div>
      <div className={card}>
        <div className="font-semibold">{t("Credit notes")}</div>
        <ul className="text-sm divide-y divide-line">{rets.map((r) => <li key={r.id} className="py-2 flex justify-between gap-2"><span><b>{r.no}</b> · {r.customer} · {t("against {no}", { no: r.invoiceNo })} · {r.reason}</span><span className="text-muted">{inr(r.totalPaise)}{r.toClaims ? ` · ${t("{n} packs to claim", { n: r.toClaims })}` : ""}</span></li>)}
          {!rets.length && <li className="py-3 text-muted">{t("No credit notes yet.")}</li>}</ul>
      </div>
      <InvoiceModal id={shown} onClose={() => setShown(null)} />
      <CreditNote inv={crediting} who={who} onClose={() => { setCrediting(null); load(); }} />
    </div>
  );
}

function CreditNote({ inv, who, onClose }: { inv: Inv | null; who: Who; onClose: () => void }) {
  const toast = useToast();
  const t = useT();
  const dev = deviceDb();
  const [lines, setLines] = useState<{ id: string; name: string; batchNo: string; billed: number; qty: string; condition: "saleable" | "expired" | "damaged"; pct: string }[]>([]);
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (!inv) return;
    dev.call("distInvoiceView", inv.id).then((v) => {
      const ls = ((v as { lines?: { id: string; name: string; batchNo: string; qty: number; freeQty: number }[] } | null)?.lines ?? []);
      setLines(ls.map((l) => ({ id: l.id, name: l.name, batchNo: l.batchNo, billed: Number(l.qty) + Number(l.freeQty), qty: "", condition: "saleable", pct: "100" })));
    }, () => setLines([]));
  }, [dev, inv]);
  const save = async () => {
    if (!inv) return;
    try {
      const r = await dev.call("distCreateReturn", { invoiceId: inv.id, userId: who.userId, reason, lines: lines.filter((l) => Number(l.qty) > 0).map((l) => ({ invoiceLineId: l.id, qty: Number(l.qty), condition: l.condition, creditPct: Number(l.pct) || 0 })) });
      toast(t("Credit note {no} issued: {total}.", { no: r.no, total: inr(r.total) }), "green"); setReason(""); onClose();
    } catch (e) { toast(errText(e), "red"); }
  };
  return (
    <Modal open={!!inv} onClose={onClose} width={720} title={inv ? t("Credit note against {no}", { no: inv.no }) : ""} footer={<Button variant="primary" onClick={save}>{t("Issue credit note")}</Button>}>
      <div className="flex flex-col gap-2 text-sm">
        {lines.map((l, i) => (
          <div key={l.id} className="grid grid-cols-[1fr_80px_130px_80px] gap-2 items-center">
            <span>{l.name} · {l.batchNo} <span className="text-muted">({t("billed {n}", { n: l.billed })})</span></span>
            <input className={input} placeholder={t("Packs")} value={l.qty} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, qty: e.target.value.replace(/\D/g, "") } : x)))} aria-label={t("Packs back of {name}", { name: l.name })} />
            <select className={input} value={l.condition} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, condition: e.target.value as "saleable" } : x)))} aria-label={t("Condition")}>
              <option value="saleable">{t("Saleable")}</option><option value="expired">{t("Expired")}</option><option value="damaged">{t("Damaged")}</option>
            </select>
            <input className={input} value={l.pct} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, pct: e.target.value.replace(/[^\d.]/g, "") } : x)))} aria-label={t("Credit %")} />
          </div>
        ))}
        <label className={label}>{t("Reason")}<input className={input} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <div className="text-muted text-[13px]">{t("Saleable goods go back to stock. Expired and damaged goods wait to be claimed on the company (Expiry & claims).")}</div>
      </div>
    </Modal>
  );
}

type Board = { pending: { id: string; no: string; customer: string; totalPaise: number; address: string | null }[]; trips: { id: string; no: string; status: "planned" | "out" | "closed"; deliveries: { id: string; no: string; customer: string; totalPaise: number; delivery: { status: string; receiverName: string | null; failReason: string | null } }[] }[] };

/** Van trips: plan from waiting invoices, send out, record each delivery (and money collected at the door). */
export function Dispatch({ cfg, who }: { cfg: Cfg; who: Who }) {
  const toast = useToast();
  const t = useT();
  const dev = deviceDb();
  const [b, setB] = useState<Board | null>(null);
  const [pick, setPick] = useState<string[]>([]);
  const [vehicle, setVehicle] = useState(""); const [driver, setDriver] = useState(""); const [route, setRoute] = useState("");
  const [del, setDel] = useState<{ id: string; no: string } | null>(null);
  const load = useCallback(() => dev.call("distDispatchBoard", cfg.branchId).then((r) => setB(r as Board), () => setB(null)), [dev, cfg.branchId]);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok, "green"); void load(); } catch (e) { toast(errText(e), "red"); } };
  if (!b) return null;
  return (
    <div className="flex flex-col gap-4">
      <div className={card}>
        <div className="font-semibold">{t("Waiting to go out")}</div>
        <ul className="text-sm divide-y divide-line">{b.pending.map((i) => (
          <li key={i.id} className="py-1.5"><label className="flex gap-2 items-center"><input type="checkbox" checked={pick.includes(i.id)} onChange={(e) => setPick(e.target.checked ? [...pick, i.id] : pick.filter((x) => x !== i.id))} /> <b>{i.no}</b> · {i.customer} · {inr(i.totalPaise)}{i.address ? ` · ${i.address}` : ""}</label></li>
        ))}{!b.pending.length && <li className="py-2 text-muted">{t("Nothing waiting.")}</li>}</ul>
        <div className="grid grid-cols-3 gap-2">
          <input className={input} placeholder={t("Vehicle no.")} value={vehicle} onChange={(e) => setVehicle(e.target.value)} />
          <input className={input} placeholder={t("Driver")} value={driver} onChange={(e) => setDriver(e.target.value)} />
          <input className={input} placeholder={t("Route")} value={route} onChange={(e) => setRoute(e.target.value)} />
        </div>
        <Button variant="primary" className="self-start" disabled={!pick.length} onClick={() => act(async () => { await dev.call("distCreateDispatch", { branchId: cfg.branchId, userId: who.userId, vehicleNo: vehicle, driverName: driver, route, invoiceIds: pick }); setPick([]); }, t("Trip planned."))}><Truck size={14} /> {t("Plan trip")}</Button>
      </div>
      {b.trips.map((tr) => (
        <div key={tr.id} className={card}>
          <div className="flex justify-between items-center"><span className="font-semibold">{tr.no}</span><span className="text-muted text-sm">{t(tr.status === "planned" ? "Planned" : tr.status === "out" ? "Out" : "Closed")}</span></div>
          <ul className="text-sm divide-y divide-line">{tr.deliveries.map((d) => (
            <li key={d.id} className="py-1.5 flex justify-between gap-2 items-center"><span><b>{d.no}</b> · {d.customer} · {inr(d.totalPaise)}</span>
              <span className="text-muted">{d.delivery.status === "delivered" ? t("Delivered to {name}", { name: d.delivery.receiverName ?? "" }) : d.delivery.status === "pending" ? t("Back at the desk: {why}", { why: d.delivery.failReason ?? "" }) : t(d.delivery.status === "out" ? "Out" : "Planned")}
                {d.delivery.status === "out" && <Button size="sm" className="ml-2" onClick={() => setDel({ id: d.id, no: d.no })}>{t("Record")}</Button>}</span></li>
          ))}</ul>
          {tr.status === "planned" && <Button size="sm" variant="primary" className="self-start" onClick={() => act(() => dev.call("distStartDispatch", { dispatchId: tr.id, userId: who.userId }), t("The van has left."))}>{t("Van left")}</Button>}
        </div>
      ))}
      <DeliveryModal inv={del} who={who} onClose={() => { setDel(null); void load(); }} />
    </div>
  );
}

function DeliveryModal({ inv, who, onClose }: { inv: { id: string; no: string } | null; who: Who; onClose: () => void }) {
  const toast = useToast();
  const t = useT();
  const dev = deviceDb();
  const [receiver, setReceiver] = useState(""); const [amount, setAmount] = useState(""); const [mode, setMode] = useState<"cash" | "upi" | "cheque">("cash");
  const [chq, setChq] = useState(""); const [bank, setBank] = useState(""); const [note, setNote] = useState("");
  const send = async (outcome: "delivered" | "failed") => {
    if (!inv) return;
    try {
      await dev.call("distRecordDelivery", { invoiceId: inv.id, userId: who.userId, outcome, receiverName: receiver, note, collectedPaise: toPaise(amount), mode, chequeNo: chq, bank });
      toast(t(outcome === "delivered" ? "Delivery recorded." : "Sent back to the dispatch desk."), "green"); setReceiver(""); setAmount(""); setNote(""); onClose();
    } catch (e) { toast(errText(e), "red"); }
  };
  return (
    <Modal open={!!inv} onClose={onClose} title={inv ? t("Delivery of {no}", { no: inv.no }) : ""}
      footer={<div className="flex gap-2"><Button variant="danger-outline" onClick={() => send("failed")}>{t("Couldn’t deliver")}</Button><Button variant="primary" onClick={() => send("delivered")}>{t("Delivered")}</Button></div>}>
      <div className="flex flex-col gap-2">
        <label className={label}>{t("Received by")}<input className={input} value={receiver} onChange={(e) => setReceiver(e.target.value)} /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className={label}>{t("Money collected (₹)")}<input className={input} value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <label className={label}>{t("How")}<select className={input} value={mode} onChange={(e) => setMode(e.target.value as "cash")}><option value="cash">{t("Cash")}</option><option value="upi">UPI</option><option value="cheque">{t("Cheque")}</option></select></label>
        </div>
        {mode === "cheque" && <div className="grid grid-cols-2 gap-2"><input className={input} placeholder={t("Cheque no. (6 digits)")} value={chq} onChange={(e) => setChq(e.target.value.replace(/\D/g, ""))} /><input className={input} placeholder={t("Bank")} value={bank} onChange={(e) => setBank(e.target.value)} /></div>}
        <label className={label}>{t("Note (needed if it couldn’t be delivered)")}<input className={input} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
    </Modal>
  );
}

type Rec = { customerId: string; name: string; phone: string | null; balance: number; overdue: number; oldestDays: number; buckets: Record<string, number>; risk: { level: string; score: number } };

/** What chemists owe: ageing, collecting a payment, and a chemist's statement. */
export function Receivables({ who }: { who: Who }) {
  const toast = useToast();
  const t = useT();
  const dev = deviceDb();
  const [rows, setRows] = useState<Rec[]>([]);
  const [chem, setChem] = useState<Chemist | null>(null);
  const [amount, setAmount] = useState(""); const [mode, setMode] = useState<"cash" | "upi" | "card" | "cheque">("cash"); const [chq, setChq] = useState(""); const [bank, setBank] = useState("");
  const [stmt, setStmt] = useState<{ name: string; rows: { date: string; no: string; narration: string; dr: number; cr: number; balance: number }[] } | null>(null);
  const load = useCallback(() => dev.call("distReceivables").then((r) => setRows(r as Rec[]), () => setRows([])), [dev]);
  useEffect(() => { void load(); }, [load]);
  const collect = async () => {
    if (!chem) return;
    try { const r = await dev.call("distCollect", { customerId: chem.id, userId: who.userId, amountPaise: toPaise(amount), mode, chequeNo: chq, bank }); toast(t("Payment recorded. {name} now owes {due}.", { name: chem.name, due: inr(r.balancePaise) }), "green"); setChem(null); setAmount(""); void load(); }
    catch (e) { toast(errText(e), "red"); }
  };
  const statement = async (r: Rec) => { try { const s = await dev.call("distStatement", r.customerId); setStmt({ name: r.name, rows: s.rows }); } catch (e) { toast(errText(e), "red"); } };
  return (
    <div className="flex flex-col gap-4">
      <div className={`${card} max-w-2xl`}>
        <div className="font-semibold">{t("Collect a payment")}</div>
        <ChemistPicker value={chem} onChange={setChem} />
        <div className="grid grid-cols-2 gap-2">
          <input className={input} placeholder={t("Amount (₹)")} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <select className={input} value={mode} onChange={(e) => setMode(e.target.value as "cash")} aria-label={t("How")}><option value="cash">{t("Cash")}</option><option value="upi">UPI</option><option value="card">{t("Card")}</option><option value="cheque">{t("Cheque")}</option></select>
        </div>
        {mode === "cheque" && <div className="grid grid-cols-2 gap-2"><input className={input} placeholder={t("Cheque no. (6 digits)")} value={chq} onChange={(e) => setChq(e.target.value.replace(/\D/g, ""))} /><input className={input} placeholder={t("Bank")} value={bank} onChange={(e) => setBank(e.target.value)} /></div>}
        <Button variant="primary" className="self-start" disabled={!chem || !toPaise(amount)} onClick={collect}>{t("Record payment")}</Button>
      </div>
      <div className={card}>
        <div className="font-semibold">{t("Receivables")}</div>
        <table className="w-full text-sm"><thead><tr className="text-left text-muted"><th>{t("Chemist")}</th><th className="text-right">{t("Owes")}</th><th className="text-right">{t("Overdue")}</th><th className="text-right">{t("Oldest (days)")}</th><th>{t("Risk")}</th><th /></tr></thead>
          <tbody>{rows.filter((r) => r.balance !== 0).map((r) => (
            <tr key={r.customerId} className="border-t border-line"><td>{r.name}</td><td className="text-right">{inr(r.balance)}</td><td className="text-right">{inr(r.overdue)}</td><td className="text-right">{r.oldestDays}</td><td>{t(r.risk.level === "high" ? "High" : r.risk.level === "medium" ? "Medium" : "Low")}</td>
              <td className="text-right"><Button size="sm" onClick={() => statement(r)}>{t("Statement")}</Button></td></tr>
          ))}</tbody></table>
      </div>
      <Modal open={!!stmt} onClose={() => setStmt(null)} width={720} title={stmt ? t("Statement · {name}", { name: stmt.name }) : ""} footer={<Button onClick={() => window.print()}>{t("Print")}</Button>}>
        <table className="w-full text-sm"><thead><tr className="text-left text-muted"><th>{t("Date")}</th><th>{t("Document")}</th><th /><th className="text-right">{t("Debit")}</th><th className="text-right">{t("Credit")}</th><th className="text-right">{t("Balance")}</th></tr></thead>
          <tbody>{stmt?.rows.map((r, i) => <tr key={i} className="border-t border-line"><td>{r.date}</td><td>{r.no}</td><td>{r.narration}</td><td className="text-right">{r.dr ? inr(r.dr) : ""}</td><td className="text-right">{r.cr ? inr(r.cr) : ""}</td><td className="text-right">{inr(r.balance)}</td></tr>)}</tbody></table>
      </Modal>
    </div>
  );
}

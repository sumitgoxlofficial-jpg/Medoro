"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Printer, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { deviceDb } from "@/drivedb/device";
import type { DayReport, SaleDetail } from "@/drivedb/reports";
import { inr } from "@/lib/money";
import { hhmm, todayISO } from "@/lib/dates";
import { ReceiptModal, printReceipt } from "./receipt";
import { card, input, errText, type Cfg, type Who } from "./ui";

type Bill = { id: string; invoiceNo: string; totalPaise: number; payMode: string; at: string; customer: string | null; items: number; returned: number };

/** Bills of a day with the day-end summary; open a bill to reprint it or take a return. */
export function Bills({ cfg, who, refresh }: { cfg: Cfg; who: Who; refresh: number }) {
  const toast = useToast();
  const dev = useRef(deviceDb()).current;
  const [day, setDay] = useState(todayISO());
  const [q, setQ] = useState("");
  const [bills, setBills] = useState<Bill[]>([]);
  const [rep, setRep] = useState<DayReport | null>(null);
  const [open, setOpen] = useState<SaleDetail | null>(null);
  const [ret, setRet] = useState<SaleDetail | null>(null);
  const [printDay, setPrintDay] = useState(false);

  const load = useCallback(async () => {
    const [b, r] = await Promise.all([dev.call("listBills", day, q), dev.call("dayReport", cfg.branchId, day)]);
    setBills(b); setRep(r);
  }, [dev, day, q, cfg.branchId]);
  useEffect(() => { const t = setTimeout(load, 120); return () => clearTimeout(t); }, [load, refresh]);

  const show = async (id: string, then: "print" | "return") => {
    try { const d = await dev.call("saleDetail", id); if (then === "print") setOpen(d); else setRet(d); } catch (e) { toast(errText(e), "red"); }
  };

  return (
    <div className="flex flex-col gap-4">
      {rep && (
        <div className={card}>
          <div className="flex justify-between items-center flex-wrap gap-2">
            <div className="font-semibold">Day-end · {day === todayISO() ? "today" : day}</div>
            <div className="flex gap-2 items-center">
              <input type="date" value={day} max={todayISO()} onChange={(e) => setDay(e.target.value || todayISO())} className="border border-line rounded-lg px-2 h-8 text-sm" aria-label="Day" />
              <Button size="sm" onClick={() => { setPrintDay(true); setTimeout(() => { printReceipt(); setTimeout(() => setPrintDay(false), 500); }, 50); }}><Printer size={14} /> Print day-end</Button>
            </div>
          </div>
          <DayEnd rep={rep} cfg={cfg} />
        </div>
      )}
      <div className={card}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a bill: invoice no., customer name or mobile" aria-label="Find a bill" className={input} />
        <ul className="text-sm divide-y divide-line">
          {bills.map((b) => (
            <li key={b.id} className="py-2 flex justify-between gap-2 items-center flex-wrap">
              <span><b>{b.invoiceNo}</b> · {b.customer ?? "Walk-in"} · {b.items} item{b.items === 1 ? "" : "s"} · {hhmm(new Date(b.at))}{b.returned ? <span className="text-bad"> · returned {inr(b.returned)}</span> : null}</span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums">{inr(b.totalPaise)} · {b.payMode}</span>
                <Button size="sm" onClick={() => show(b.id, "print")} aria-label={`Open ${b.invoiceNo}`}><Printer size={14} /> Bill</Button>
                <Button size="sm" onClick={() => show(b.id, "return")} aria-label={`Return from ${b.invoiceNo}`}><Undo2 size={14} /> Return</Button>
              </span>
            </li>
          ))}
          {!bills.length && <li className="py-2 text-muted">No bills{q ? " match" : " on this day"}.</li>}
        </ul>
      </div>
      <ReceiptModal d={open} pharmacy={cfg.pharmacy} onClose={() => setOpen(null)} who={who} />
      <ReturnModal d={ret} cfg={cfg} who={who} onClose={() => setRet(null)} onDone={() => { setRet(null); void load(); }} />
      {printDay && rep ? <div className="hidden print:block"><div className="receipt-print font-mono text-[12px]"><div className="text-center font-bold">{cfg.pharmacy?.name ?? ""}</div><div className="text-center">Day-end {rep.date} · {cfg.branchName} · {cfg.series}</div><DayEnd rep={rep} cfg={cfg} /></div></div> : null}
    </div>
  );
}

function DayEnd({ rep }: { rep: DayReport; cfg: Cfg }) {
  const row = (k: string, v: number, strong = false) => <div className={`flex justify-between ${strong ? "font-semibold" : ""}`}><span>{k}</span><span className="tabular-nums">{inr(v)}</span></div>;
  return (
    <div className="grid gap-x-8 gap-y-1 text-sm md:grid-cols-2">
      <div className="flex flex-col gap-1">
        <div className="flex justify-between"><span>Bills</span><span>{rep.bills}</span></div>
        {row("Sales (incl. GST)", rep.totalPaise, true)}
        {row("Cash", rep.byMode.cash)}{row("UPI", rep.byMode.upi)}{row("Card", rep.byMode.card)}{row("Credit (to collect)", rep.byMode.credit)}
        {row("GST in sales", rep.taxPaise)}{rep.discountPaise ? row("Discounts given", rep.discountPaise) : null}
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex justify-between"><span>Returns</span><span>{rep.returns.count}</span></div>
        {row("Refunded in cash", rep.returns.cash)}{row("Refunded by UPI", rep.returns.upi)}{row("Credited to accounts", rep.returns.credit)}
        {row("Received from credit customers (cash)", rep.receipts.cash)}{rep.receipts.upi ? row("Received from credit customers (UPI)", rep.receipts.upi) : null}
        {rep.paidOut.suppliers ? row("Paid to suppliers (cash)", rep.paidOut.suppliers) : null}{rep.paidOut.expenses ? row("Expenses (cash)", rep.paidOut.expenses) : null}
        {row("Cash in drawer from today", rep.cashInHandPaise, true)}
        {rep.purchases.count ? row(`Purchases entered (${rep.purchases.count})`, rep.purchases.totalPaise) : null}
      </div>
    </div>
  );
}

function ReturnModal({ d, cfg, who, onClose, onDone }: { d: SaleDetail | null; cfg: Cfg; who: Who; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const dev = deviceDb();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [condition, setCondition] = useState<"sealed" | "opened" | "damaged">("sealed");
  const [mode, setMode] = useState<"cash" | "upi" | "credit">("cash");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setQty({}); setReason(""); setCondition("sealed"); setMode("cash"); }, [d]);
  if (!d) return null;
  const lines = Object.entries(qty).filter(([, n]) => n > 0).map(([saleItemId, n]) => ({ saleItemId, qty: n }));
  const go = async () => {
    setBusy(true);
    try {
      const r = await dev.call("createReturn", { saleId: String(d.sale.id), series: cfg.series, userId: who.userId, reason, condition, refundMode: mode, lines });
      toast(`Credit note ${r.creditNoteNo}: refund ${inr(r.amountPaise)}${r.restocked ? `, ${r.restocked} line(s) back in stock` : ""}.`, "green");
      onDone();
    } catch (e) { toast(errText(e), "red"); }
    setBusy(false);
  };
  return (
    <Modal open onClose={onClose} title={`Return from ${String(d.sale.invoiceNo)}`} width={520}
      footer={<div className="flex gap-2 justify-end"><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !lines.length || !reason.trim()} onClick={go}>{busy ? "Saving…" : "Issue credit note"}</Button></div>}>
      <div className="flex flex-col gap-3 text-sm">
        {d.lines.map((l) => {
          const left = l.qty - l.returned;
          return (
            <div key={l.id} className="flex items-center justify-between gap-2">
              <span>{l.name} <span className="text-muted">· B {l.batchNo} · sold {l.qty} {l.loose ? l.looseUnit : l.packUnit}{l.returned ? `, ${l.returned} returned` : ""}</span></span>
              <input type="number" min={0} max={left} disabled={!left} value={qty[l.id] ?? 0} onChange={(e) => setQty({ ...qty, [l.id]: Math.max(0, Math.min(left, Number(e.target.value) || 0)) })} className="border border-line rounded-lg px-2 h-8 w-20 text-right" aria-label={`Return quantity ${l.name}`} />
            </div>
          );
        })}
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (e.g. wrong medicine, not needed)" className={input} aria-label="Reason" />
        <div className="flex gap-4 flex-wrap">
          <label className="flex items-center gap-1.5">Condition
            <select value={condition} onChange={(e) => setCondition(e.target.value as typeof condition)} className="border border-line rounded-md h-8 px-1">
              <option value="sealed">Sealed (back to stock)</option><option value="opened">Opened</option><option value="damaged">Damaged</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5">Refund
            <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className="border border-line rounded-md h-8 px-1">
              <option value="cash">Cash</option><option value="upi">UPI</option>{d.sale.customerId ? <option value="credit">To customer’s account</option> : null}
            </select>
          </label>
        </div>
      </div>
    </Modal>
  );
}

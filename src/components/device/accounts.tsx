"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { IndianRupee, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { deviceDb } from "@/drivedb/device";
import { EXPENSE_CATEGORIES } from "@/drivedb/books";
import { inr } from "@/lib/money";
import { dayMonth, hhmm, todayISO } from "@/lib/dates";
import { card, input, label, errText, toPaise, type Cfg, type Who } from "./ui";

type Due = { id: string; name: string; gstin: string | null; billed: number; paid: number; duePaise: number };
type Mode = "cash" | "upi" | "bank" | "cheque";

/** Money: what suppliers are owed (and paying them), expenses, and the day's cash book. */
export function Accounts({ cfg, who, refresh }: { cfg: Cfg; who: Who; refresh: number }) {
  const toast = useToast();
  const dev = useRef(deviceDb()).current;
  const [dues, setDues] = useState<Due[]>([]);
  const [pay, setPay] = useState<Due | null>(null);
  const [ledger, setLedger] = useState<{ d: Due; rows: { at: string; kind: string; ref: string; amount: number; balancePaise: number }[] } | null>(null);
  const [day, setDay] = useState(todayISO());
  const [book, setBook] = useState<{ rows: { at: string; what: string; amount: number }[]; inPaise: number; outPaise: number; netPaise: number } | null>(null);
  const [exp, setExp] = useState({ category: "Electricity" as (typeof EXPENSE_CATEGORIES)[number], amount: "", mode: "cash" as Mode, note: "" });
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    const [d, b] = await Promise.all([dev.call("supplierDues"), dev.call("cashBook", cfg.branchId, day)]);
    setDues(d); setBook(b);
  }, [dev, cfg.branchId, day]);
  useEffect(() => { void load(); }, [load, refresh, tick]);

  const addExp = async () => {
    try {
      await dev.call("addExpense", { branchId: cfg.branchId, category: exp.category, amountPaise: toPaise(exp.amount), mode: exp.mode, note: exp.note || undefined, userId: who.userId, date: day });
      toast(`${exp.category} ${inr(toPaise(exp.amount))} recorded.`, "green"); setExp({ ...exp, amount: "", note: "" }); setTick((t) => t + 1);
    } catch (e) { toast(errText(e), "red"); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className={card}>
        <div className="font-semibold">Suppliers to pay</div>
        <ul className="text-sm divide-y divide-line">
          {dues.map((d) => (
            <li key={d.id} className="py-2 flex justify-between items-center gap-2 flex-wrap">
              <button className="text-left cursor-pointer hover:text-teal" onClick={async () => setLedger({ d, rows: await dev.call("supplierLedger", d.id) })}>{d.name}<span className="text-muted text-xs block">bills {inr(d.billed)} · paid {inr(d.paid)}</span></button>
              <span className="flex items-center gap-2">
                <span className={d.duePaise > 0 ? "text-bad tabular-nums" : "text-muted"}>{d.duePaise > 0 ? `owed ${inr(d.duePaise)}` : "settled"}</span>
                {d.duePaise > 0 && <Button size="sm" onClick={() => setPay(d)} aria-label={`Pay ${d.name}`}><IndianRupee size={14} /> Pay</Button>}
              </span>
            </li>
          ))}
          {!dues.length && <li className="py-2 text-muted">No suppliers yet. They appear when you enter a purchase bill.</li>}
        </ul>
      </div>

      <div className={card}>
        <div className="flex justify-between items-center gap-2 flex-wrap">
          <div className="font-semibold">Cash book</div>
          <input type="date" value={day} max={todayISO()} onChange={(e) => setDay(e.target.value || todayISO())} className="border border-line rounded-lg px-2 h-8 text-sm" aria-label="Cash book day" />
        </div>
        <ul className="text-sm divide-y divide-line max-h-72 overflow-auto">
          {book?.rows.map((r, i) => <li key={i} className="py-1.5 flex justify-between gap-2"><span>{hhmm(new Date(r.at))} · {r.what}</span><span className={`tabular-nums ${r.amount < 0 ? "text-bad" : ""}`}>{r.amount < 0 ? "−" : "+"}{inr(Math.abs(r.amount))}</span></li>)}
          {!book?.rows.length && <li className="py-1.5 text-muted">No cash moved on this day.</li>}
        </ul>
        {book && <div className="text-sm flex justify-between border-t border-line pt-2"><span>In {inr(book.inPaise)} · Out {inr(book.outPaise)}</span><b className="tabular-nums">Net {inr(book.netPaise)}</b></div>}
        <div className="border-t border-line pt-3 grid grid-cols-2 gap-2">
          <label className={label}>Expense
            <select value={exp.category} onChange={(e) => setExp({ ...exp, category: e.target.value as typeof exp.category })} className={input} aria-label="Expense category">{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          </label>
          <label className={label}>Amount (₹)<input value={exp.amount} onChange={(e) => setExp({ ...exp, amount: e.target.value })} inputMode="decimal" className={input} aria-label="Expense amount" /></label>
          <label className={label}>Paid by
            <select value={exp.mode} onChange={(e) => setExp({ ...exp, mode: e.target.value as Mode })} className={input} aria-label="Expense paid by"><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank">Bank</option><option value="cheque">Cheque</option></select>
          </label>
          <label className={label}>Note<input value={exp.note} onChange={(e) => setExp({ ...exp, note: e.target.value })} className={input} aria-label="Expense note" /></label>
          <Button className="col-span-2 justify-self-start" onClick={addExp} disabled={!toPaise(exp.amount)}><Plus size={16} /> Add expense for {day === todayISO() ? "today" : day}</Button>
        </div>
      </div>

      {pay && <PaySupplier d={pay} who={who} onClose={() => setPay(null)} onDone={(left) => { toast(`Paid. ${pay.name} is now owed ${inr(left)}.`, "green"); setPay(null); setTick((t) => t + 1); }} />}
      {ledger && (
        <Modal open onClose={() => setLedger(null)} title={ledger.d.name} sub="Bills and payments" width={520}>
          <ul className="text-sm divide-y divide-line">
            {ledger.rows.map((r, i) => <li key={i} className="py-1.5 flex justify-between gap-2"><span>{dayMonth(new Date(r.at), true)} · {r.kind === "bill" ? `Bill ${r.ref}` : `Paid (${r.ref})`}</span><span className="tabular-nums">{r.amount > 0 ? "+" : "−"}{inr(Math.abs(r.amount))} · bal {inr(r.balancePaise)}</span></li>)}
          </ul>
        </Modal>
      )}
    </div>
  );
}

function PaySupplier({ d, who, onClose, onDone }: { d: Due; who: Who; onClose: () => void; onDone: (left: number) => void }) {
  const toast = useToast();
  const dev = deviceDb();
  const [amt, setAmt] = useState((d.duePaise / 100).toFixed(2));
  const [mode, setMode] = useState<Mode>("bank");
  const [ref, setRef] = useState("");
  const save = async () => {
    try { const r = await dev.call("paySupplier", { supplierId: d.id, amountPaise: toPaise(amt), mode, ref: ref || undefined, userId: who.userId }); onDone(r.duePaise); }
    catch (e) { toast(errText(e), "red"); }
  };
  return (
    <Modal open onClose={onClose} title={`Pay ${d.name}`} sub={`Owed ${inr(d.duePaise)}`} width={400} footer={<div className="flex gap-2 justify-end"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save payment</Button></div>}>
      <div className="flex flex-col gap-3">
        <label className={label}>Amount (₹)<input value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" className={input} aria-label="Payment amount" /></label>
        <label className={label}>Mode<select value={mode} onChange={(e) => setMode(e.target.value as Mode)} className={input} aria-label="Payment mode"><option value="bank">Bank transfer</option><option value="upi">UPI</option><option value="cheque">Cheque</option><option value="cash">Cash</option></select></label>
        <label className={label}>UTR / cheque no. (optional)<input value={ref} onChange={(e) => setRef(e.target.value)} className={input} aria-label="Reference" /></label>
      </div>
    </Modal>
  );
}

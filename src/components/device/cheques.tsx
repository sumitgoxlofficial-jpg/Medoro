"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Banknote, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n-client";
import { deviceDb } from "@/drivedb/device";
import type { Cheque, ChequeStatus } from "@/drivedb/cheques";
import { inr } from "@/lib/money";
import { addDays, dayMonth, todayISO } from "@/lib/dates";
import { card, input, label, errText, toPaise, type Cfg, type Who } from "./ui";

const TONE: Record<ChequeStatus, Tone> = { pending: "amber", deposited: "blue", cleared: "green", bounced: "red", cancelled: "gray" };
const STATUS: Record<ChequeStatus, string> = { pending: "Pending", deposited: "Deposited", cleared: "Cleared", bounced: "Bounced", cancelled: "Cancelled" };
const open = (c: Cheque) => c.status === "pending" || c.status === "deposited";
const dateOf = (iso: string) => dayMonth(new Date(iso + "T00:00:00+05:30"), true);
type Tab = "open" | "received" | "issued" | "all";

/**
 * Cheques from customers and to suppliers, post-dated ones included. Recording one takes it off the party's
 * balance; deposit and clear are steps; a bounce or cancel (owner) puts it back with new entries.
 */
export function Cheques({ cfg, who, refresh }: { cfg: Cfg; who: Who; refresh: number }) {
  const t = useT();
  const toast = useToast();
  const dev = useRef(deviceDb()).current;
  const [rows, setRows] = useState<Cheque[]>([]);
  const [tab, setTab] = useState<Tab>("open");
  const [adding, setAdding] = useState(false);
  const [clearing, setClearing] = useState<Cheque | null>(null);
  const [bouncing, setBouncing] = useState<Cheque | null>(null);
  const [cancelling, setCancelling] = useState<Cheque | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => dev.call("listCheques").then(setRows).catch((e) => toast(errText(e), "red")), [dev, toast]);
  useEffect(() => { void load(); }, [load, refresh, tick]);
  const done = (msg: string) => { toast(msg, "green"); setTick((x) => x + 1); };
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try { await fn(); done(msg); } catch (e) { toast(errText(e), "red"); } finally { setBusy(false); }
  };

  const list = rows.filter((c) => (tab === "open" ? open(c) : tab === "all" ? true : c.direction === tab));
  const sum = (d: Cheque["direction"]) => rows.filter((c) => c.direction === d && open(c)).reduce((a, c) => a + c.amountPaise, 0);
  const dueSoon = rows.filter((c) => open(c) && c.days <= 3).length;
  const when = (c: Cheque) => (c.days > 0 ? t("post-dated · in {n} days", { n: c.days }) : c.days === 0 ? t("today") : t("{n} days ago", { n: -c.days }));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
        <Stat label={t("Cheques in hand (not cleared)")} value={inr(sum("received"))} />
        <Stat label={t("Issued, not yet cleared")} value={inr(sum("issued"))} />
        <Stat label={t("Due within 3 days")} value={String(dueSoon)} className="col-span-2 lg:col-span-1" />
      </div>

      <div className={card}>
        <div className="flex justify-between items-center gap-2 flex-wrap">
          <Segmented value={tab} onChange={setTab} options={[{ value: "open", label: "Open" }, { value: "received", label: "Received" }, { value: "issued", label: "Issued" }, { value: "all", label: "All (180 days)" }]} />
          <Button variant="primary" onClick={() => setAdding(true)}><Plus size={16} /> {t("Record cheque")}</Button>
        </div>
        <ul className="text-sm divide-y divide-line">
          {list.map((c) => (
            <li key={c.id} className="py-2.5 flex flex-col gap-1.5">
              <div className="flex justify-between gap-2 flex-wrap">
                <span>
                  <b>{c.party}</b> <span className="text-muted">· {c.direction === "received" ? t("from customer") : t("to supplier")}</span>
                  <span className="block text-muted text-xs"><span className="font-mono">{c.chequeNo}</span> · {c.bank} · {dateOf(c.chequeDate)} · <span className={c.days > 0 ? "text-[#2459C9]" : ""}>{when(c)}</span>{c.note ? ` · ${c.note}` : ""}</span>
                </span>
                <span className="text-right">
                  <b className={`tabular-nums ${c.direction === "issued" ? "text-bad" : ""}`}>{c.direction === "issued" ? "−" : ""}{inr(c.amountPaise)}</b>
                  <span className="block"><Badge tone={TONE[c.status]}>{t(STATUS[c.status])}</Badge></span>
                </span>
              </div>
              {(c.reason || c.conflict) && (
                <div className="text-xs text-muted">
                  {c.reason}{c.chargePaise ? ` · ${t("charge")} ${inr(c.chargePaise)}` : ""}{c.bankChargePaise ? ` · ${t("bank charge")} ${inr(c.bankChargePaise)}` : ""}
                  {c.conflict && <span className="block text-bad">{t("Marked cleared on one counter and bounced on another. The bounce stands; check with the bank.")}</span>}
                </div>
              )}
              {open(c) && (
                <div className="flex gap-1.5 flex-wrap">
                  {c.direction === "received" && c.status === "pending" && (
                    <Button size="sm" variant="primary" disabled={busy || c.days > 0} title={c.days > 0 ? t("Post-dated: deposit on or after the cheque date") : undefined}
                      onClick={() => act(() => dev.call("depositCheque", c.id, who.userId), t("Cheque {no} deposited. Mark it cleared when it shows in the bank.", { no: c.chequeNo }))}>{t("Deposit")}</Button>
                  )}
                  {((c.direction === "received" && c.status === "deposited") || (c.direction === "issued" && c.status === "pending")) && (
                    <Button size="sm" variant="primary" disabled={busy} onClick={() => setClearing(c)}>{t("Cleared")}</Button>
                  )}
                  {who.owner && <Button size="sm" variant="danger-outline" disabled={busy} onClick={() => setBouncing(c)}>{t("Bounced")}</Button>}
                  {who.owner && c.status === "pending" && <Button size="sm" disabled={busy} onClick={() => setCancelling(c)}>{t("Cancel cheque")}</Button>}
                </div>
              )}
            </li>
          ))}
          {!list.length && (
            <li className="py-6 flex flex-col items-center gap-1 text-center text-muted">
              <Banknote size={22} />
              <span className="font-medium text-ink">{t("No cheques here")}</span>
              <span>{t("Record a cheque you took from a customer or gave to a supplier.")}</span>
            </li>
          )}
        </ul>
        {!who.owner && rows.some(open) && <div className="text-xs text-muted">{t("Only the owner can mark a cheque bounced or cancel it.")}</div>}
      </div>

      {adding && <RecordCheque who={who} onClose={() => setAdding(false)} onDone={(m) => { setAdding(false); done(m); }} />}
      {clearing && <ClearCheque c={clearing} who={who} onClose={() => setClearing(null)} onDone={(m) => { setClearing(null); done(m); }} />}
      {bouncing && <BounceCheque c={bouncing} cfg={cfg} who={who} onClose={() => setBouncing(null)} onDone={(m) => { setBouncing(null); done(m); }} />}
      {cancelling && <CancelCheque c={cancelling} who={who} onClose={() => setCancelling(null)} onDone={(m) => { setCancelling(null); done(m); }} />}
    </div>
  );
}

function Stat({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return <div className={"bg-white border border-line rounded-xl px-4 py-3 max-sm:px-3 " + className}><div className="text-[12.5px] text-muted">{label}</div><div className="text-[20px] font-semibold tabular-nums">{value}</div></div>;
}

type Party = { id: string; name: string; duePaise: number };

function RecordCheque({ who, onClose, onDone }: { who: Who; onClose: () => void; onDone: (msg: string) => void }) {
  const t = useT();
  const toast = useToast();
  const dev = deviceDb();
  const [direction, setDirection] = useState<"received" | "issued">("received");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Party[]>([]);
  const [suppliers, setSuppliers] = useState<Party[]>([]);
  const [party, setParty] = useState<Party | null>(null);
  const [f, setF] = useState({ chequeNo: "", bank: "", chequeDate: todayISO(), amount: "", note: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => { void dev.call("supplierDues").then((d) => setSuppliers(d.filter((s) => s.duePaise > 0).map((s) => ({ id: s.id, name: s.name, duePaise: s.duePaise })))); }, [dev]);
  useEffect(() => {
    if (direction !== "received" || q.trim().length < 2) { setFound([]); return; }
    let live = true;
    void dev.call("findCustomers", q).then((r) => { if (live) setFound(r.filter((c) => c.balancePaise > 0).map((c) => ({ id: c.id, name: c.phone ? `${c.name} · ${c.phone}` : c.name, duePaise: c.balancePaise }))); });
    return () => { live = false; };
  }, [dev, q, direction]);
  const switchTo = (d: "received" | "issued") => { setDirection(d); setParty(null); setQ(""); };

  const save = async () => {
    if (!party) { toast(direction === "received" ? t("Pick the customer.") : t("Pick the supplier."), "red"); return; }
    setBusy(true);
    try {
      await dev.call("recordCheque", { direction, partyId: party.id, chequeNo: f.chequeNo, bank: f.bank, chequeDate: f.chequeDate, amountPaise: toPaise(f.amount), note: f.note || undefined, userId: who.userId });
      onDone(t("Cheque {no} recorded.", { no: f.chequeNo }));
    } catch (e) { toast(errText(e), "red"); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={t("Record cheque")} sub={t("Post-dated cheques are fine. The amount comes off the balance now; a bounce puts it back.")} width={460}
      footer={<><Button onClick={onClose}>{t("Cancel")}</Button><Button variant="primary" onClick={save} disabled={busy || !party || !toPaise(f.amount)}>{t("Save cheque")}</Button></>}>
      <Segmented value={direction} onChange={switchTo} options={[{ value: "received", label: "From a customer" }, { value: "issued", label: "To a supplier" }]} />
      {direction === "received" ? (
        party ? (
          <div className="flex justify-between items-center gap-2 text-sm border border-line rounded-lg px-3 py-2">
            <span>{party.name}<span className="block text-xs text-muted">{t("owes {amount}", { amount: inr(party.duePaise) })}</span></span>
            <Button size="sm" onClick={() => setParty(null)}>{t("Change")}</Button>
          </div>
        ) : (
          <label className={label}>{t("Customer")}
            <input value={q} onChange={(e) => setQ(e.target.value)} className={input} placeholder={t("Mobile number or name")} aria-label={t("Customer")} autoFocus />
            {found.length > 0 && (
              <ul className="border border-line rounded-lg divide-y divide-line max-h-48 overflow-auto">
                {found.map((c) => <li key={c.id}><button className="w-full text-left px-3 py-2 text-sm text-ink hover:bg-chip cursor-pointer" onClick={() => { setParty(c); setF({ ...f, amount: (c.duePaise / 100).toFixed(2) }); }}>{c.name} <span className="text-muted">· {t("owes {amount}", { amount: inr(c.duePaise) })}</span></button></li>)}
              </ul>
            )}
            {q.trim().length >= 2 && !found.length && <span className="text-xs">{t("No customer with dues matches.")}</span>}
          </label>
        )
      ) : (
        <label className={label}>{t("Supplier")}
          <select value={party?.id ?? ""} onChange={(e) => { const s = suppliers.find((x) => x.id === e.target.value) ?? null; setParty(s); if (s) setF({ ...f, amount: (s.duePaise / 100).toFixed(2) }); }} className={input} aria-label={t("Supplier")}>
            <option value="">{t("Pick the supplier")}</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} · {t("owed {amount}", { amount: inr(s.duePaise) })}</option>)}
          </select>
          {!suppliers.length && <span className="text-xs">{t("No supplier is owed anything.")}</span>}
        </label>
      )}
      <div className="grid grid-cols-2 gap-2.5">
        <label className={label}>{t("Cheque number")}<input value={f.chequeNo} onChange={(e) => setF({ ...f, chequeNo: e.target.value.replace(/\D/g, "").slice(0, 6) })} inputMode="numeric" className={input + " font-mono"} placeholder="000123" aria-label={t("Cheque number")} /></label>
        <label className={label}>{t("Bank")}<input value={f.bank} onChange={(e) => setF({ ...f, bank: e.target.value })} className={input} placeholder="SBI" aria-label={t("Bank")} /></label>
        <label className={label}>{t("Cheque date")}<input type="date" value={f.chequeDate} min={addDays(todayISO(), -90)} onChange={(e) => setF({ ...f, chequeDate: e.target.value })} className={input} aria-label={t("Cheque date")} /></label>
        <label className={label}>{t("Amount (₹)")}<input value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" className={input} aria-label={t("Amount (₹)")} /></label>
      </div>
      <label className={label}>{t("Note (optional)")}<input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={60} className={input} aria-label={t("Note (optional)")} /></label>
    </Modal>
  );
}

function ClearCheque({ c, who, onClose, onDone }: { c: Cheque; who: Who; onClose: () => void; onDone: (msg: string) => void }) {
  const t = useT();
  const toast = useToast();
  const dev = deviceDb();
  const today = todayISO();
  const [on, setOn] = useState(today < c.chequeDate ? c.chequeDate : today);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await dev.call("clearCheque", c.id, on, who.userId); onDone(t("Cheque {no} cleared.", { no: c.chequeNo })); }
    catch (e) { toast(errText(e), "red"); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={t("Cheque {no} cleared", { no: c.chequeNo })} sub={`${c.party} · ${inr(c.amountPaise)} · ${c.bank}`} width={380}
      footer={<><Button onClick={onClose}>{t("Cancel")}</Button><Button variant="primary" onClick={save} disabled={busy}>{t("Mark cleared")}</Button></>}>
      <label className={label}>{t("Cleared on")}<input type="date" value={on} min={c.chequeDate} max={today} onChange={(e) => setOn(e.target.value)} className={input} aria-label={t("Cleared on")} /></label>
      <div className="text-xs text-muted">{t("The date it shows on the bank statement. The party’s balance already took this cheque when it was recorded.")}</div>
    </Modal>
  );
}

function BounceCheque({ c, cfg, who, onClose, onDone }: { c: Cheque; cfg: Cfg; who: Who; onClose: () => void; onDone: (msg: string) => void }) {
  const t = useT();
  const toast = useToast();
  const dev = deviceDb();
  const today = todayISO();
  const [f, setF] = useState({ reason: "", charge: "", bankCharge: "", on: today });
  const [busy, setBusy] = useState(false);
  const recv = c.direction === "received";
  const save = async () => {
    setBusy(true);
    try {
      const r = await dev.call("bounceCheque", { chequeId: c.id, reason: f.reason, chargePaise: toPaise(f.charge), bankChargePaise: toPaise(f.bankCharge), on: f.on, branchId: cfg.branchId, userId: who.userId });
      onDone(recv ? t("Cheque {no} bounced. {party} owes {amount} again.", { no: c.chequeNo, party: c.party, amount: inr(r.owedPaise) }) : t("Cheque {no} bounced. You owe {party} {amount} again.", { no: c.chequeNo, party: c.party, amount: inr(r.owedPaise) }));
    } catch (e) { toast(errText(e), "red"); } finally { setBusy(false); }
  };
  const money = (k: "charge" | "bankCharge") => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value.replace(/[^\d.]/g, "") });
  return (
    <Modal open onClose={onClose} title={t("Cheque {no} bounced", { no: c.chequeNo })} sub={`${c.party} · ${inr(c.amountPaise)} · ${c.bank}`} width={480}
      footer={<><Button onClick={onClose}>{t("Cancel")}</Button><Button variant="danger" onClick={save} disabled={busy}>{t("Record bounce")}</Button></>}>
      <label className={label}>{t("Bank’s return reason")}<input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} className={input} placeholder={t("e.g. funds insufficient, signature differs")} aria-label={t("Bank’s return reason")} autoFocus /></label>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        <label className={label}>{recv ? t("Charge to customer ₹") : t("Supplier’s penalty ₹")}<input value={f.charge} onChange={money("charge")} inputMode="decimal" placeholder="0" className={input} aria-label={recv ? t("Charge to customer ₹") : t("Supplier’s penalty ₹")} /></label>
        <label className={label}>{t("Our bank’s charge ₹")}<input value={f.bankCharge} onChange={money("bankCharge")} inputMode="decimal" placeholder="0" className={input} aria-label={t("Our bank’s charge ₹")} /></label>
        <label className={label + " col-span-2 sm:col-span-1"}>{t("Returned on")}<input type="date" max={today} value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} className={input} aria-label={t("Returned on")} /></label>
      </div>
      <div className="text-xs text-muted">
        {recv ? t("The customer owes the amount again (plus any charge you recover from them).") : t("You owe the supplier again. A penalty they levy is added to what you owe.")}{" "}
        {t("Your bank’s charge is added to expenses as Bank charges. Nothing is edited: new entries are added.")}
      </div>
    </Modal>
  );
}

function CancelCheque({ c, who, onClose, onDone }: { c: Cheque; who: Who; onClose: () => void; onDone: (msg: string) => void }) {
  const t = useT();
  const toast = useToast();
  const dev = deviceDb();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await dev.call("cancelCheque", { chequeId: c.id, reason, userId: who.userId }); onDone(t("Cheque {no} cancelled. The balance is back as it was.", { no: c.chequeNo })); }
    catch (e) { toast(errText(e), "red"); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={t("Cancel cheque {no}", { no: c.chequeNo })} sub={`${c.party} · ${inr(c.amountPaise)} · ${c.bank}`} width={420}
      footer={<><Button onClick={onClose}>{t("Keep it")}</Button><Button variant="danger" onClick={save} disabled={busy}>{t("Cancel cheque")}</Button></>}>
      <label className={label}>{t("Why?")}<input value={reason} onChange={(e) => setReason(e.target.value)} className={input} placeholder={t("e.g. returned to customer, paid in cash instead")} aria-label={t("Why?")} autoFocus /></label>
      <div className="text-xs text-muted">{c.direction === "received" ? t("For a cheque handed back before it went to the bank. The customer owes the amount again.") : t("For a cheque stopped or taken back before the supplier presented it. You owe the supplier again.")}</div>
    </Modal>
  );
}

"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CloudOff, Cloud, Printer, RefreshCw, Search, Trash2, Check, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { cartTotals, inr, toPaise } from "@/lib/money";
import { daysTo, monthYear, todayISO } from "@/lib/dates";
import type { OfflineSnapshot } from "@/domain/sales/offline-types";
import { getDevice, getQueue, getSnapshot, nextReceipt, randomId, remaining, saveQueue, syncNow, type Device, type QueuedBill } from "@/lib/offline/store";
import { baseQty, fmtQty, fmtSold, unitPrice, type SaleUnit } from "@/lib/units";
import { isH1 } from "@/lib/rx";
import { searchTokens } from "@/domain/inventory/salts";

type Line = { key: string; medicineId: string; batchId: string; qty: number; unit?: SaleUnit };
type Pay = "cash" | "upi" | "card";
const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)]";
const inp = "border border-input rounded-lg px-[11px] py-[9px] text-[14px] outline-none bg-white focus:border-teal w-full";
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function useOnline() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const f = () => setOn(navigator.onLine);
    f(); window.addEventListener("online", f); window.addEventListener("offline", f);
    return () => { window.removeEventListener("online", f); window.removeEventListener("offline", f); };
  }, []);
  return on;
}

/** Billing that works with no network, from this device's snapshot. Bills post when it reconnects. */
export function OfflinePos() {
  const online = useOnline();
  const [ready, setReady] = useState(false);
  const [dev, setDev] = useState<Device | null>(null);
  const [snap, setSnap] = useState<OfflineSnapshot | null>(null);
  const [queue, setQueue] = useState<QueuedBill[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [q, setQ] = useState("");
  const [disc, setDisc] = useState("0");
  const [pay, setPay] = useState<Pay>("cash");
  const [tender, setTender] = useState("");
  const [ref, setRef] = useState("");
  const [doctor, setDoctor] = useState("");
  const [rxno, setRxno] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [docreg, setDocreg] = useState("");
  const [patient, setPatient] = useState("");
  const [msg, setMsg] = useState<{ text: string; tone: "red" | "green" | "amber" } | null>(null);
  const [receipt, setReceipt] = useState<QueuedBill | null>(null);
  const [syncing, setSyncing] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const completing = useRef(false);

  const load = useCallback(async () => {
    const [d, s, qu] = await Promise.all([getDevice(), getSnapshot(), getQueue()]);
    setDev(d ?? null); setSnap(s ?? null); setQueue(qu); setReady(true);
  }, []);
  useEffect(() => { load().catch(() => setReady(true)); }, [load]);

  const say = (text: string, tone: "red" | "green" | "amber" = "red") => setMsg({ text, tone });
  const left = useMemo(() => (snap ? remaining(snap, queue) : {}), [snap, queue]);
  const medById = useMemo(() => new Map(snap?.medicines.map((m) => [m.id, m]) ?? []), [snap]);
  const batchById = useMemo(() => new Map(snap?.batches.map((b) => [b.id, b]) ?? []), [snap]);
  const today = todayISO();
  // Allowances and batch use are in stock units; a whole pack needs packSize of them from one batch.
  const psOf = (medicineId: string) => medById.get(medicineId)?.packSize ?? 1;
  const usedIn = (ls: Line[], batchId: string) => ls.filter((l) => l.batchId === batchId).reduce((a, l) => a + baseQty(l.qty, l.unit, psOf(l.medicineId)), 0);
  const fefo = (medicineId: string, ls: Line[], unit?: SaleUnit) => (snap?.batches ?? [])
    .filter((b) => b.medicineId === medicineId && daysTo(b.expiry, today) > 0 && (left[b.id] ?? 0) - usedIn(ls, b.id) >= baseQty(1, unit, psOf(medicineId)))
    .sort((a, b) => (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : a.id < b.id ? -1 : 1))[0];

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t || !snap) return [];
    const tokens = searchTokens(t);
    return snap.medicines.filter((m) => m.barcode === q.trim() || tokens.every((k) => [m.name, m.generic, m.composition ?? ""].some((f) => f.toLowerCase().includes(k)))).slice(0, 8);
  }, [q, snap]);

  const add = (medicineId: string, unit?: SaleUnit) => {
    setLines((ls) => {
      const b = fefo(medicineId, ls, unit);
      if (!b) { say(`${medById.get(medicineId)?.name}: this device’s offline allowance is used up${unit !== "loose" && medById.get(medicineId)?.allowLoose ? " for a whole pack; try loose" : ""}. Bill it when back online.`, "amber"); return ls; }
      const ex = ls.find((l) => l.batchId === b.id && l.unit === unit);
      return ex ? ls.map((l) => (l === ex ? { ...l, qty: l.qty + 1 } : l)) : [...ls, { key: randomId("l"), medicineId, batchId: b.id, qty: 1, ...(unit === "loose" ? { unit } : {}) }];
    });
    setQ(""); setMsg(null); searchRef.current?.focus();
  };
  const inc = (key: string) => {
    const l = lines.find((x) => x.key === key)!;
    if ((left[l.batchId] ?? 0) - usedIn(lines, l.batchId) >= baseQty(1, l.unit, psOf(l.medicineId))) setLines(lines.map((x) => (x.key === key ? { ...x, qty: x.qty + 1 } : x)));
    else add(l.medicineId, l.unit);
  };
  const dec = (key: string) => setLines(lines.map((x) => (x.key === key ? { ...x, qty: x.qty - 1 } : x)).filter((x) => x.qty > 0));

  const d = parseFloat(disc) || 0;
  const priceOf = useCallback((l: Line) => unitPrice(batchById.get(l.batchId)?.mrpPaise ?? 0, l.unit, medById.get(l.medicineId)?.packSize ?? 1), [batchById, medById]);
  const totals = useMemo(() => cartTotals(lines.map((l) => ({ mrpPaise: priceOf(l), qty: l.qty, gstRate: medById.get(l.medicineId)?.gstRate ?? 0 })), d), [lines, d, priceOf, medById]);
  const packDef = (medicineId: string) => { const m = medById.get(medicineId); return { packSize: m?.packSize ?? 1, packUnit: m?.packUnit ?? "pack", looseUnit: m?.looseUnit ?? "unit" }; };
  const needsRx = lines.some((l) => medById.get(l.medicineId)?.schedule);
  const needsH1 = lines.some((l) => isH1(medById.get(l.medicineId)?.schedule));
  const pickedReg = snap?.doctors?.find((x) => x.id === doctorId)?.regNo ?? "";
  const stale = snap ? Date.now() - new Date(snap.takenAt).getTime() > snap.validDays * 86_400_000 : false;
  const pending = queue.filter((b) => b.state === "pending");
  const conflicts = queue.filter((b) => b.state === "conflict");

  const complete = async () => {
    if (!snap || !dev || completing.current) return;
    if (!lines.length) return say("Cart is empty.");
    if (stale) return say(`This device’s price list is more than ${snap.validDays} days old. Reconnect to refresh it before billing.`);
    if (d < 0 || d > snap.discCap) return say(`Discount above ${snap.discCap}% needs a manager, online.`);
    if (needsRx && !doctor.trim() && !doctorId) return say("Enter the prescriber’s name for Schedule H/H1 items.");
    if (needsH1 && !patient.trim()) return say("Enter the patient’s name for Schedule H1, X and NDPS items.");
    if (needsH1 && !docreg.trim() && !pickedReg) return say("Enter the prescriber’s registration no. for Schedule H1, X and NDPS items.");
    if (pay === "cash" && tender && toPaise(tender) < totals.total) return say("Cash tendered is less than the total.");
    if (totals.total <= 0) return say("The bill total must be more than zero.");
    completing.current = true;
    try {
      const bill: QueuedBill = {
        id: randomId("off_"), createdAt: new Date().toISOString(), baseVersion: Math.max(0, ...lines.map((l) => batchById.get(l.batchId)?.version ?? 0)),
        receipt: await nextReceipt(dev.deviceId), state: "pending", cashierId: snap.cashierId, cashier: snap.cashier,
        sale: { lines: lines.map(({ medicineId, batchId, qty, unit }) => ({ medicineId, batchId, qty, ...(unit === "loose" ? { unit } : {}) })), discountPct: d, pay: { mode: pay, tenderedPaise: pay === "cash" && tender ? toPaise(tender) : undefined, ref: pay !== "cash" && ref ? ref : undefined }, prescriber: doctorId ? undefined : doctor.trim() || undefined, rxNo: rxno.trim() || undefined, ...(doctorId ? { doctorId } : {}), ...(needsH1 ? { prescriberReg: docreg.trim() || undefined, patientName: patient.trim() || undefined } : {}), totalPaise: totals.total },
        view: lines.map((l) => ({ name: medById.get(l.medicineId)?.name ?? "", batchNo: batchById.get(l.batchId)?.batchNo ?? "", qty: l.qty, mrpPaise: priceOf(l), unit: fmtSold(l.qty, l.unit, packDef(l.medicineId)) })),
      };
      const next = [...(await getQueue()), bill];
      await saveQueue(next);
      setQueue(next); setReceipt(bill);
      setLines([]); setDisc("0"); setTender(""); setRef(""); setDoctor(""); setDoctorId(""); setRxno(""); setDocreg(""); setPatient(""); setMsg(null);
    } finally { completing.current = false; }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await syncNow();
      await load();
      if (r.error) say(r.error === "Sign in again to sync offline bills." ? "Sign in again, then come back here to send the bills." : r.error);
      else say(r.sent ? `Sent ${r.sent} bill${r.sent > 1 ? "s" : ""}: ${r.posted} posted${r.conflicts ? `, ${r.conflicts} need a manager’s review in Sync & offline` : ""}. Price list refreshed.` : "Price list and stock allowance refreshed.", r.conflicts ? "amber" : "green");
    } catch { say("Couldn’t reach the server. Bills stay safely on this device."); }
    setSyncing(false);
  };
  // Send automatically when the connection comes back.
  useEffect(() => {
    if (online && ready && dev && pending.length && !syncing) sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, ready, dev]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === "F9") { e.preventDefault(); if (!receipt) complete(); }
      else if (e.key === "Escape" && receipt) setReceipt(null);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  if (!ready) return <div className="p-8 text-muted">Loading…</div>;

  const header = (
    <header className="print:hidden flex items-center gap-3 flex-wrap px-4 py-3 bg-white border-b border-line">
      {/* eslint-disable-next-line @next/next/no-img-element -- must load from the offline cache, not the image optimiser */}
      <img src="/medoro-mark.png" alt="" width={28} height={28} />
      <div className="flex flex-col leading-tight">
        <strong className="text-[15px]">Offline billing</strong>
        <span className="text-[12.5px] text-muted">{snap ? `${snap.pharmacy.name} · ${snap.pharmacy.branch} · ${snap.deviceName}` : "Medoro"}</span>
      </div>
      <Badge tone={online ? "green" : "amber"} className="ml-auto">{online ? <><Cloud size={13} />Online</> : <><CloudOff size={13} />No internet</>}</Badge>
      {dev ? <Button disabled={!online || syncing} onClick={sync}><RefreshCw size={14} className={syncing ? "animate-spin" : ""} />{pending.length ? `Send ${pending.length} bill${pending.length > 1 ? "s" : ""}` : "Refresh"}</Button> : null}
      <a href="/app" className="text-[13px] text-teal font-medium">Open Medoro</a>
    </header>
  );

  if (!dev || !snap) {
    return (
      <div className="min-h-screen bg-page">{header}
        <div className={cn(card, "max-w-[560px] mx-auto mt-10 p-6 flex flex-col gap-3")}>
          <div className="flex items-center gap-2 font-semibold text-[17px]"><CloudOff size={20} className="text-muted" />{online ? "Offline billing isn’t set up here" : "You’re offline"}</div>
          <p className="m-0 text-[14px] text-ink-2">{dev ? "This device hasn’t downloaded its price list yet. Connect to the internet and press Refresh." : "Medoro needs the connection to your pharmacy’s server. If billing must keep going when the internet drops, a manager can turn on offline billing for this counter in Sync & offline."}</p>
          <p className="m-0 text-[13px] text-muted">Your work is safe: completed bills are already on the server, and a cart you were building is kept on this device.</p>
          <div><a href="/app" className="inline-flex"><Button variant="primary">Try again</Button></a></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-page">
      {header}
      <div className="print:hidden bg-[#FDF2E1] text-[#6B4A0E] text-[13px] px-4 py-2">
        Bills made here are provisional until they reach the server, which rechecks stock and prices and then gives each one its invoice number. Price list from {when(snap.takenAt)}.
      </div>
      {msg ? <div role="status" className={cn("print:hidden mx-4 mt-3 px-3 py-2 rounded-lg text-[13.5px] flex gap-2 items-center", msg.tone === "red" ? "bg-bad-bg text-bad" : msg.tone === "green" ? "bg-[#E6F4EC] text-[#1E7F4F]" : "bg-[#FDF2E1] text-[#94570A]")}><CircleAlert size={15} />{msg.text}</div> : null}
      {stale ? <div className="print:hidden mx-4 mt-3 px-3 py-2 rounded-lg text-[13.5px] bg-bad-bg text-bad">The price list is more than {snap.validDays} days old, so offline billing is paused. Reconnect and press Refresh.</div> : null}

      <main className="print:hidden grid gap-4 p-4 grid-cols-1 lg:grid-cols-[1fr_380px] max-w-[1300px]">
        <section className="flex flex-col gap-3 min-w-0">
          <div className={cn(card, "p-3 relative")}>
            <label className="flex items-center gap-2"><Search size={16} className="text-muted" />
              <input ref={searchRef} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search medicine or scan barcode (F2)" aria-label="Search medicine" className="flex-1 outline-none text-[15px] py-1.5 bg-transparent"
                onKeyDown={(e) => { if (e.key === "Enter" && results[0]) { e.preventDefault(); add(results[0].id); } }} />
            </label>
            {results.length ? (
              <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-white border border-line rounded-xl shadow-lg overflow-hidden">
                {results.map((m) => {
                  const avail = (snap.batches.filter((b) => b.medicineId === m.id && daysTo(b.expiry, today) > 0)).reduce((a, b) => a + Math.max(0, (left[b.id] ?? 0) - usedIn(lines, b.id)), 0);
                  return (
                    <div key={m.id} className="w-full px-3 py-2 hover:bg-page flex gap-3 items-center border-b border-row last:border-0">
                      <button type="button" onClick={() => add(m.id)} className="flex-1 min-w-0 text-left"><span className="font-medium">{m.name}</span> <span className="text-muted text-[12.5px]">{m.composition ?? `${m.generic} ${m.strength}`}{m.rack ? ` · rack ${m.rack}` : ""}</span></button>
                      {m.schedule ? <Badge tone="purple">Sch {m.schedule}</Badge> : null}
                      {m.allowLoose ? <button type="button" onClick={() => add(m.id, "loose")} className="text-[12px] border border-line rounded px-1.5 py-0.5">+ loose {m.looseUnit}</button> : null}
                      <span className="text-[12.5px] text-muted">{fmtQty(avail, packDef(m.id))} offline</span>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>

          <div className={card}>
            {lines.length ? lines.map((l) => {
              const m = medById.get(l.medicineId), b = batchById.get(l.batchId);
              return (
                <div key={l.key} className="flex items-center gap-3 px-3 py-2.5 border-b border-row last:border-0 text-[14px] flex-wrap">
                  <span className="flex-1 min-w-[160px]"><span className="font-medium">{m?.name}</span><br /><span className="text-[12px] text-muted">Batch {b?.batchNo} · exp {b ? monthYear(b.expiry) : ""}</span></span>
                  <span className="inline-flex items-center border border-line rounded-lg">
                    <button type="button" aria-label="Less" onClick={() => dec(l.key)} className="w-8 h-8">−</button>
                    <span className="min-w-8 px-1 text-center font-mono">{fmtSold(l.qty, l.unit, packDef(l.medicineId))}</span>
                    <button type="button" aria-label="More" onClick={() => inc(l.key)} className="w-8 h-8">+</button>
                  </span>
                  <span className="w-[90px] text-right font-mono">{inr(priceOf(l) * l.qty)}</span>
                  <button type="button" aria-label="Remove" onClick={() => setLines(lines.filter((x) => x.key !== l.key))} className="text-muted hover:text-bad"><Trash2 size={15} /></button>
                </div>
              );
            }) : <div className="p-8 text-center text-muted text-[14px]">Search for a medicine to start the bill.</div>}
          </div>
        </section>

        <aside className="flex flex-col gap-3">
          <div className={cn(card, "p-4 flex flex-col gap-3")}>
            <div className="flex gap-1.5">
              {(["cash", "upi", "card"] as Pay[]).map((p) => <button key={p} type="button" onClick={() => setPay(p)} className={cn("flex-1 h-9 rounded-lg border text-[13.5px] font-medium", pay === p ? "bg-teal text-white border-teal" : "bg-white border-line")}>{p === "upi" ? "UPI" : p[0].toUpperCase() + p.slice(1)}</button>)}
            </div>
            <span className="text-[12px] text-muted -mt-1">Credit and split payments need the server, so they’re not available offline.</span>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-[12.5px] text-muted">Discount % (max {snap.discCap})<input className={inp} inputMode="decimal" value={disc} onChange={(e) => setDisc(e.target.value)} /></label>
              {pay === "cash" ? <label className="flex flex-col gap-1 text-[12.5px] text-muted">Cash received ₹<input className={inp} inputMode="decimal" value={tender} onChange={(e) => setTender(e.target.value)} /></label>
                : <label className="flex flex-col gap-1 text-[12.5px] text-muted">Reference<input className={inp} value={ref} onChange={(e) => setRef(e.target.value)} /></label>}
            </div>
            {needsRx ? (
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-[12.5px] text-muted">Prescriber
                  {snap.doctors?.length ? (
                    <select className={inp} value={doctorId} onChange={(e) => { setDoctorId(e.target.value); setDoctor(""); }} aria-label="Doctor">
                      <option value="">Type a name below</option>
                      {snap.doctors.map((x) => <option key={x.id} value={x.id}>Dr {x.name}{x.regNo ? ` · ${x.regNo}` : ""}</option>)}
                    </select>
                  ) : null}
                  {!doctorId ? <input className={inp} value={doctor} onChange={(e) => setDoctor(e.target.value)} placeholder="Prescriber name" /> : null}
                </label>
                <label className="flex flex-col gap-1 text-[12.5px] text-muted">Rx no.<input className={inp} value={rxno} onChange={(e) => setRxno(e.target.value)} /></label>
                {needsH1 ? <>
                  {!pickedReg ? <label className="flex flex-col gap-1 text-[12.5px] text-muted">Prescriber reg. no.<input className={inp} value={docreg} onChange={(e) => setDocreg(e.target.value)} aria-label="Prescriber registration number" /></label> : null}
                  <label className="flex flex-col gap-1 text-[12.5px] text-muted">Patient name<input className={inp} value={patient} onChange={(e) => setPatient(e.target.value)} aria-label="Patient name" /></label>
                </> : null}
              </div>
            ) : null}
            <div className="flex flex-col gap-1 text-[13.5px] border-t border-row pt-3">
              <div className="flex justify-between"><span className="text-muted">MRP total</span><span className="font-mono">{inr(totals.mrpTotal)}</span></div>
              {totals.discount ? <div className="flex justify-between"><span className="text-muted">Discount</span><span className="font-mono">−{inr(totals.discount)}</span></div> : null}
              <div className="flex justify-between"><span className="text-muted">GST included</span><span className="font-mono">{inr(totals.tax)}</span></div>
              <div className="flex justify-between text-[18px] font-semibold mt-1"><span>Total</span><span className="font-mono">{inr(totals.total)}</span></div>
              {pay === "cash" && tender && toPaise(tender) >= totals.total ? <div className="flex justify-between text-teal"><span>Change</span><span className="font-mono">{inr(toPaise(tender) - totals.total)}</span></div> : null}
            </div>
            <Button variant="primary" size="lg" disabled={!lines.length || stale} onClick={complete}><Check size={16} />Complete offline bill (F9)</Button>
          </div>

          <div className={cn(card, "p-4 flex flex-col gap-2")}>
            <div className="flex items-center gap-2 font-semibold text-[14px]">Bills on this device
              {pending.length ? <Badge tone="amber">{pending.length} waiting</Badge> : <Badge tone="green">All sent</Badge>}
              {conflicts.length ? <Badge tone="red">{conflicts.length} need review</Badge> : null}
            </div>
            {queue.length ? [...queue].reverse().slice(0, 12).map((b) => (
              <button key={b.id} type="button" onClick={() => setReceipt(b)} className="flex gap-2 items-center text-left text-[13px] py-1.5 border-t border-row">
                <span className="font-mono text-[12px] w-[120px] truncate">{b.invoiceNo ?? b.receipt}</span>
                <span className="text-muted flex-1">{when(b.createdAt)}</span>
                <span className="font-mono">{inr(b.sale.totalPaise)}</span>
                <Badge tone={b.state === "posted" ? "green" : b.state === "conflict" ? "red" : "amber"}>{b.state === "posted" ? "Posted" : b.state === "conflict" ? "Review" : "Waiting"}</Badge>
              </button>
            )) : <span className="text-[13px] text-muted">No offline bills yet.</span>}
          </div>
        </aside>
      </main>

      {receipt ? (
        <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50 print:static print:bg-white print:p-0" role="dialog" aria-label="Offline receipt">
          <div className="bg-white rounded-xl p-5 w-full max-w-[420px] flex flex-col gap-2 print:shadow-none print:max-w-none">
            <div className="text-center"><strong className="text-[16px]">{snap.pharmacy.name}</strong><br /><span className="text-[12px] text-muted">{snap.pharmacy.branch}{snap.pharmacy.address ? ` · ${snap.pharmacy.address}` : ""}{snap.pharmacy.gstin ? ` · GSTIN ${snap.pharmacy.gstin}` : ""}{snap.pharmacy.dlNo ? ` · DL ${snap.pharmacy.dlNo}` : ""}</span></div>
            <div className="text-center text-[13px] font-semibold">{receipt.invoiceNo ? `Tax invoice ${receipt.invoiceNo}` : `Provisional receipt ${receipt.receipt}`}</div>
            <div className="text-[12px] text-muted text-center">{when(receipt.createdAt)} · {receipt.cashier ?? snap.cashier} · {receipt.sale.pay.mode.toUpperCase()}</div>
            <div className="border-t border-b border-row py-2 flex flex-col gap-1 text-[13px]">
              {receipt.view.map((v, i) => <div key={i} className="flex gap-2"><span className="flex-1">{v.name} <span className="text-muted text-[11.5px]">({v.batchNo})</span></span><span className="font-mono">{v.unit ?? v.qty} × {inr(v.mrpPaise)}</span></div>)}
            </div>
            {receipt.sale.discountPct ? <div className="flex justify-between text-[13px]"><span>Discount</span><span>{receipt.sale.discountPct}%</span></div> : null}
            <div className="flex justify-between text-[16px] font-semibold"><span>Total</span><span className="font-mono">{inr(receipt.sale.totalPaise)}</span></div>
            {receipt.state === "conflict" ? <div className="text-[12.5px] text-bad">Not posted: {receipt.message}. A manager settles it in Sync & offline.</div> : null}
            {!receipt.invoiceNo ? <div className="text-[11.5px] text-muted">Made while offline. The GST invoice number is issued when this bill reaches the server; ask at the counter for a copy.</div> : null}
            <div className="flex gap-2 justify-end mt-2 print:hidden">
              <Button onClick={() => setReceipt(null)}>Close (Esc)</Button>
              <Button variant="primary" onClick={() => window.print()}><Printer size={14} />Print</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

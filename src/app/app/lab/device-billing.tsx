"use client";
import { useEffect, useState } from "react";
import { Receipt, RotateCcw, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { deviceDb, deviceId } from "@/drivedb/device";
import { inr } from "@/lib/money";
import { todayISO } from "@/lib/dates";
import { useT } from "@/lib/i18n-client";

const BRANCH = "demo-branch", SERIES = "DEMO1", USER = "demo-user";
const SAMPLE = [
  { name: "Dolo 650", generic: "Paracetamol", gstRate: 12 as const, mrpPaise: 3200, packSize: 15, packUnit: "strip", looseUnit: "tab", allowLoose: true },
  { name: "Pan 40", generic: "Pantoprazole", gstRate: 12 as const, mrpPaise: 15500, packSize: 15, packUnit: "strip", looseUnit: "tab", allowLoose: true },
  { name: "Azithral 500", generic: "Azithromycin", gstRate: 12 as const, mrpPaise: 11900, schedule: "H", packSize: 5, packUnit: "strip", looseUnit: "tab" },
  { name: "Benadryl Cough Syrup", generic: "Diphenhydramine", gstRate: 12 as const, mrpPaise: 12000 },
];
type Med = { id: string; name: string; mrpPaise: number; packSize: number; packUnit: string; schedule: string | null; stock: number };
const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-3";

/** Phase 1 preview: billing that runs entirely on this device's own database. */
export function DeviceBilling() {
  const toast = useToast();
  const t = useT();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [meds, setMeds] = useState<Med[]>([]);
  const [cart, setCart] = useState<{ med: Med; qty: number }[]>([]);
  const [info, setInfo] = useState<{ medicines: number; bills: number; pendingChanges: number; today: number } | null>(null);
  const [last, setLast] = useState<{ invoiceNo: string; ms: number; total: number } | null>(null);
  const dev = deviceDb();

  const refresh = async (text = q) => {
    const [found, c, d] = await Promise.all([dev.call("search", text, BRANCH), dev.call("counts"), dev.call("dayTotals", BRANCH, todayISO())]);
    setMeds(found as Med[]);
    setInfo({ ...c, today: d.totalPaise });
  };

  const openDb = async () => {
    setBusy(true);
    try {
      await dev.call("open", deviceId(), "demo");
      if ((await dev.call("counts")).medicines === 0) {
        for (const m of SAMPLE) {
          const med = await dev.call("addMedicine", m);
          await dev.call("receiveStock", { branchId: BRANCH, medicineId: med.id, batchNo: "B" + med.name.slice(0, 3).toUpperCase(), expiryDate: "2028-03-31", qty: (m.packSize ?? 1) * 20, costPaise: Math.round(m.mrpPaise * 0.7), mrpPaise: m.mrpPaise, type: "opening", userId: USER });
        }
      }
      setReady(true);
      await refresh("");
    } catch (e) { toast(e instanceof Error ? e.message : "Couldn’t open the device database.", "red"); }
    setBusy(false);
  };

  useEffect(() => { if (ready) { const tm = setTimeout(() => refresh(q), 150); return () => clearTimeout(tm); } }, [q, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = (med: Med) => setCart((c) => { const i = c.findIndex((x) => x.med.id === med.id); return i < 0 ? [...c, { med, qty: 1 }] : c.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x)); });

  const bill = async () => {
    setBusy(true);
    const t0 = performance.now();
    try {
      const rx = cart.some((c) => c.med.schedule);
      const r = await dev.call("createSale", { branchId: BRANCH, series: SERIES, userId: USER, lines: cart.map((c) => ({ medicineId: c.med.id, qty: c.qty })), pay: { mode: "cash" }, prescriber: rx ? "Dr Demo" : undefined });
      setLast({ invoiceNo: r.invoiceNo, total: r.totalPaise, ms: Math.round(performance.now() - t0) });
      setCart([]);
      await refresh();
    } catch (e) { toast(e instanceof Error ? e.message : "Bill failed.", "red"); }
    setBusy(false);
  };

  const reset = async () => {
    if (!confirm(t("Delete this device’s demo database?"))) return;
    await dev.call("wipe"); setReady(false); setCart([]); setMeds([]); setInfo(null); setLast(null);
  };

  return (
    <div className={card}>
      <div className="flex items-center gap-2 font-semibold text-[15px]"><Database size={18} className="text-teal" />{t("Try billing on this device")}</div>
      <div className="text-sm text-muted">
        {t("A preview of the next step: medicines, stock and bills kept in a database inside this browser, with no server involved. It uses sample medicines, separate from your real stock and bills. Each change is queued for your Google Drive (sync comes in a later phase).")}
      </div>
      {!ready ? (
        <Button variant="primary" className="self-start" onClick={openDb} disabled={busy}>{busy ? t("Opening…") : t("Open device database")}</Button>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search medicine…")} className="border border-line rounded-lg px-3 h-9 text-sm" />
              <ul className="flex flex-col divide-y divide-line text-sm border border-line rounded-lg">
                {meds.map((m) => (
                  <li key={m.id}>
                    <button className="w-full text-left px-3 py-2 hover:bg-page flex justify-between gap-2 cursor-pointer" onClick={() => add(m)} disabled={m.stock < m.packSize}>
                      <span>{m.name}{m.schedule ? <span className="text-muted"> · {t("Sch {s}", { s: m.schedule })}</span> : null}</span>
                      <span className="text-muted whitespace-nowrap">{inr(m.mrpPaise)} · {Math.floor(m.stock / m.packSize)} {m.packUnit}s</span>
                    </button>
                  </li>
                ))}
                {!meds.length && <li className="px-3 py-2 text-muted">{t("No match.")}</li>}
              </ul>
            </div>
            <div className="flex flex-col gap-2 text-sm">
              <div className="font-medium">{t("Cart")}</div>
              {cart.length ? cart.map((c) => <div key={c.med.id} className="flex justify-between"><span>{c.qty} × {c.med.name}</span><span>{inr(c.qty * c.med.mrpPaise)}</span></div>) : <div className="text-muted">{t("Tap a medicine to add it.")}</div>}
              <Button variant="primary" className="self-start" onClick={bill} disabled={busy || !cart.length}><Receipt size={16} /> {t("Make bill")}</Button>
              {last && <div className="text-teal">{t("Bill {no} saved on this device in {ms} ms", { no: last.invoiceNo, ms: last.ms })} · {inr(last.total)}</div>}
            </div>
          </div>
          {info && (
            <div className="text-[13px] text-muted flex flex-wrap gap-x-4 gap-y-1">
              <span>{t("Medicines: {n}", { n: info.medicines })}</span><span>{t("Bills: {n}", { n: info.bills })}</span><span>{t("Today: {amount}", { amount: inr(info.today) })}</span><span>{t("Changes waiting for Drive: {n}", { n: info.pendingChanges })}</span>
            </div>
          )}
          <Button className="self-start" onClick={reset} disabled={busy}><RotateCcw size={16} /> {t("Reset demo")}</Button>
        </>
      )}
    </div>
  );
}

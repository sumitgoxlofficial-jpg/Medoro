"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { deviceDb, deviceId } from "@/drivedb/device";
import { Billing } from "./billing";
import { Bills } from "./bills";
import { Stock } from "./stock";
import { Purchases } from "./purchases";
import { Customers } from "./customers";
import { Accounts } from "./accounts";
import { ReportsGst } from "./reports-gst";
import { Orders } from "./orders";
import { ReceiptModal } from "./receipt";
import type { SaleDetail } from "@/drivedb/reports";
import { card, input, errText, type Cfg, type Who } from "./ui";

const TABS = [["bill", "Billing"], ["bills", "Bills & day-end"], ["stock", "Stock"], ["purchases", "Purchases"], ["orders", "Orders"], ["customers", "Customers"], ["accounts", "Accounts"], ["reports", "Reports & GST"], ["settings", "Counter"]] as const;
type Tab = (typeof TABS)[number][0];
/** Set once this browser has a pharmacy loaded, so the offline page can offer the device screen. */
export const READY_KEY = "medoro-drivedb-ready";

/**
 * The whole Drive mode counter, on the device's own database. Online (signed in) it gets `who` from the
 * server; offline (/device) it uses the device's saved user and asks for the counter PIN.
 */
export function DeviceApp({ who: online, empty, side, settingsExtra }: {
  who?: Who;
  /** Shown when this device has no pharmacy yet (online only: load catalogue / restore from Drive). */
  empty?: (ready: (cfg: Cfg) => void) => React.ReactNode;
  side?: React.ReactNode;
  /** Extra owner settings under Counter (e.g. Drive mode devices). */
  settingsExtra?: React.ReactNode;
}) {
  const toast = useToast();
  const dev = useRef(deviceDb()).current;
  const [state, setState] = useState<"opening" | "empty" | "locked" | "ready" | "error">("opening");
  const [err, setErr] = useState("");
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [tab, setTab] = useState<Tab>("bill");
  const [tick, setTick] = useState(0);
  const [pin, setPin] = useState("");
  const [receipt, setReceipt] = useState<SaleDetail | null>(null);

  const ready = useCallback((c: Cfg) => {
    setCfg(c);
    try { localStorage.setItem(READY_KEY, "1"); } catch { /* private window */ }
    setState(online || sessionStorage.getItem("medoro-device-unlocked") === "1" ? "ready" : "locked");
  }, [online]);

  useEffect(() => {
    (async () => {
      try {
        await dev.call("open", deviceId());
        const c = await dev.call("config");
        if (!c) { setState("empty"); return; }
        ready(c);
      } catch (e) { setErr(errText(e)); setState("error"); }
    })();
  }, [dev, ready]);

  if (state === "opening") return <div className={card}>Opening this device’s database…</div>;
  if (state === "error") return <div className={card}><div className="text-bad text-sm">This browser can’t run the device database: {err}</div><div className="text-sm text-muted">Use a current Chrome or Edge.</div></div>;
  if (state === "empty") return empty ? <>{empty(ready)}</> : <div className={card}>This device has no pharmacy data yet. Connect to the internet and sign in to Medoro to set it up.</div>;
  if (!cfg) return null;

  const who: Who = online ?? { userId: cfg.userId ?? "device", userName: cfg.userName || "Counter", owner: false, canCredit: true, discCap: cfg.maxDiscountPct };

  if (state === "locked") {
    const unlock = async () => {
      try {
        if (await dev.call("checkPin", pin)) { sessionStorage.setItem("medoro-device-unlocked", "1"); setState("ready"); }
        else toast("Wrong PIN.", "red");
      } catch (e) { toast(errText(e), "red"); }
      setPin("");
    };
    return (
      <div className={`${card} max-w-sm`}>
        <div className="flex items-center gap-2 font-semibold"><Lock size={18} className="text-teal" />{cfg.pharmacy?.tradeName ?? "Pharmacy"} · counter {cfg.series}</div>
        {cfg.pinSet ? (
          <>
            <div className="text-sm text-muted">Enter the counter PIN to bill on this device.</div>
            <input type="password" inputMode="numeric" autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => { if (e.key === "Enter") void unlock(); }} aria-label="Counter PIN" className={input} />
            <Button variant="primary" onClick={unlock} disabled={pin.length < 4}>Unlock</Button>
          </>
        ) : <div className="text-sm text-muted">No counter PIN is set on this device yet. Sign in to Medoro once and set it under Counter.</div>}
      </div>
    );
  }

  const bump = () => setTick((t) => t + 1);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 flex-wrap border-b border-line" role="tablist">
        {TABS.filter(([k]) => k !== "settings" || online?.owner).map(([k, name]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`px-3 h-9 text-sm -mb-px border-b-2 cursor-pointer ${tab === k ? "border-teal text-teal font-medium" : "border-transparent text-muted hover:text-ink"}`}>{name}</button>
        ))}
        {!online && <button onClick={() => { sessionStorage.removeItem("medoro-device-unlocked"); setState("locked"); }} className="ml-auto px-3 h-9 text-sm text-muted cursor-pointer">Lock</button>}
      </div>
      {tab === "bill" && <Billing cfg={cfg} who={who} side={side} onBill={async (id) => { bump(); try { setReceipt(await dev.call("saleDetail", id)); } catch { /* bill saved; preview optional */ } }} />}
      {tab === "bills" && <Bills cfg={cfg} who={who} refresh={tick} />}
      {tab === "stock" && <Stock cfg={cfg} owner={who.owner} userId={who.userId} refresh={tick} />}
      {tab === "purchases" && <Purchases cfg={cfg} who={who} onSaved={bump} />}
      {tab === "orders" && <Orders cfg={cfg} who={who} onBilled={bump} />}
      {tab === "customers" && <Customers who={who} refresh={tick} />}
      {tab === "accounts" && <Accounts cfg={cfg} who={who} refresh={tick} />}
      {tab === "reports" && <ReportsGst cfg={cfg} />}
      {tab === "settings" && online?.owner && <div className="flex flex-col gap-4"><CounterSettings cfg={cfg} onChange={async () => { const c = await dev.call("config"); if (c) setCfg(c); }} />{settingsExtra}</div>}
      <ReceiptModal d={receipt} pharmacy={cfg.pharmacy} onClose={() => setReceipt(null)} />
    </div>
  );
}

function CounterSettings({ cfg, onChange }: { cfg: Cfg; onChange: () => void }) {
  const toast = useToast();
  const dev = deviceDb();
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const save = async () => {
    if (pin !== again) return toast("The two PINs don’t match.", "red");
    try { await dev.call("setPin", pin); setPin(""); setAgain(""); toast("Counter PIN saved on this device.", "green"); onChange(); } catch (e) { toast(errText(e), "red"); }
  };
  return (
    <div className={`${card} max-w-lg`}>
      <div className="font-semibold">Counter PIN</div>
      <div className="text-sm text-muted">
        With a PIN, this counter keeps billing when the internet is down: open <b>medoro.in/device</b> (or any Medoro page while offline) and enter the PIN.
        The PIN is stored only on this device. {cfg.pinSet ? "A PIN is set; saving replaces it." : "No PIN is set yet."}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input type="password" inputMode="numeric" placeholder="New PIN (4–8 digits)" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} aria-label="New PIN" className={input} />
        <input type="password" inputMode="numeric" placeholder="Same PIN again" value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, ""))} aria-label="Repeat PIN" className={input} />
      </div>
      <Button variant="primary" className="self-start" onClick={save} disabled={pin.length < 4}>Save PIN</Button>
      <div className="text-[13px] text-muted">Counter series: <b>{cfg.series}</b> · Branch: {cfg.branchName} · Saved user for offline bills: {cfg.userName}</div>
    </div>
  );
}

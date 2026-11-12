"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n-client";
import { deviceDb, deviceId } from "@/drivedb/device";
import { DEVICE_CHANGED_EVENT } from "@/drivedb/live-events";
import { Billing } from "./billing";
import { Bills } from "./bills";
import { Stock } from "./stock";
import { Purchases } from "./purchases";
import { Customers } from "./customers";
import { Accounts } from "./accounts";
import { Money } from "./money";
import { ReportsGst } from "./reports-gst";
import { Orders } from "./orders";
import { Activity } from "./activity";
import { Assistant } from "./assistant";
import { Dashboard } from "./dashboard";
import { Doctors } from "./doctors";
import { Recalls } from "./recalls";
import { Cheques } from "./cheques";
import { PurchaseTools } from "./purchase-tools";
import { Insights } from "./insights";
import { ReceiptModal } from "./receipt";
import type { SaleDetail } from "@/drivedb/reports";
import { card, input, errText, type Cfg, type Who } from "./ui";

import { HIDDEN_TABS, TABS, type Tab } from "./tabs";
export type { Tab };
/** Set once this browser has a pharmacy loaded, so the offline page can offer the device screen. */
export const READY_KEY = "medoro-drivedb-ready";

/**
 * The whole Drive mode counter, on the device's own database. Online (signed in) it gets `who` from the
 * server; offline (/device) it uses the device's saved user and asks for the counter PIN.
 */
export function DeviceApp({ who: online, empty, side, settingsExtra, initialTab = "bill" }: {
  who?: Who;
  /** The tab to open on, e.g. "dash" when the sidebar's Dashboard is clicked. */
  initialTab?: Tab;
  /** Shown when this device has no pharmacy yet (online only: load catalogue / restore from Drive). */
  empty?: (ready: (cfg: Cfg) => void) => React.ReactNode;
  side?: React.ReactNode;
  /** Extra owner settings under Counter (e.g. Drive mode devices). */
  settingsExtra?: React.ReactNode;
}) {
  const toast = useToast();
  const t = useT();
  const dev = useRef(deviceDb()).current;
  const [state, setState] = useState<"opening" | "empty" | "locked" | "ready" | "error">("opening");
  const [err, setErr] = useState("");
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [tab, setTabState] = useState<Tab>(initialTab);
  // The sidebar opens a tab with ?tab=…; switching tabs here updates the address so the sidebar follows.
  useEffect(() => { setTabState(initialTab); }, [initialTab]);
  const setTab = useCallback((k: Tab) => {
    setTabState(k);
    if (online) { try { const u = new URL(window.location.href); u.searchParams.set("tab", k); window.history.replaceState(null, "", u); } catch { /* not in a browser */ } }
  }, [online]);
  const [tick, setTick] = useState(0);
  // Bills, stock and payments from other counters arrived: reload the open screen (bursts batched into one).
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const on = () => { if (t) clearTimeout(t); t = setTimeout(() => setTick((n) => n + 1), 300); };
    window.addEventListener(DEVICE_CHANGED_EVENT, on);
    return () => { window.removeEventListener(DEVICE_CHANGED_EVENT, on); if (t) clearTimeout(t); };
  }, []);
  const [pin, setPin] = useState("");
  // Batches below zero after two counters sold the same stock: a red count on the Stock tab until counted.
  const [negative, setNegative] = useState(0);
  useEffect(() => {
    if (state !== "ready" || !cfg) return;
    dev.call("negativeStock", cfg.branchId).then((r) => setNegative(r.length), () => setNegative(0));
  }, [dev, state, cfg, tick, tab]);
  const [receipt, setReceipt] = useState<SaleDetail | null>(null);
  const [receiptWa, setReceiptWa] = useState(false);

  // Kept in a ref so a page refresh (a new `who` object) doesn't re-run the first-open check below.
  const signedIn = useRef(!!online);
  signedIn.current = !!online;
  const ready = useCallback((c: Cfg) => {
    setCfg(c);
    try { localStorage.setItem(READY_KEY, "1"); } catch { /* private window */ }
    setState(signedIn.current || sessionStorage.getItem("medoro-device-unlocked") === "1" ? "ready" : "locked");
  }, []);

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

  if (state === "opening") return <div className={card}>{t("Opening this device’s database…")}</div>;
  if (state === "error") return <div className={card}><div className="text-bad text-sm">{t("This browser can’t run the device database: {err}", { err })}</div><div className="text-sm text-muted">{t("Use a current Chrome or Edge.")}</div></div>;
  if (state === "empty") return empty ? <>{empty(ready)}</> : <div className={card}>{t("This device has no pharmacy data yet. Connect to the internet and sign in to Medoro to set it up.")}</div>;
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
        <div className="flex items-center gap-2 font-semibold"><Lock size={18} className="text-teal" />{t("{name} · counter {series}", { name: cfg.pharmacy?.tradeName ?? t("Pharmacy"), series: cfg.series })}</div>
        {cfg.pinSet ? (
          <>
            <div className="text-sm text-muted">{t("Enter the counter PIN to bill on this device.")}</div>
            <input type="password" inputMode="numeric" autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => { if (e.key === "Enter") void unlock(); }} aria-label={t("Counter PIN")} className={input} />
            <Button variant="primary" onClick={unlock} disabled={pin.length < 4}>Unlock</Button>
          </>
        ) : <div className="text-sm text-muted">{t("No counter PIN is set on this device yet. Sign in to Medoro once and set it under Counter.")}</div>}
      </div>
    );
  }

  const bump = () => setTick((t) => t + 1);
  return (
    <div className="flex flex-col gap-4">
      {/* Signed in, the sidebar opens each screen, so the Dashboard and Billing show without the counter's tab row: Billing
          is only the bill. Unlocked by PIN without signing in there is no sidebar, so the row stays. */}
      {!(online && (tab === "dash" || tab === "bill")) && <div className="flex gap-1 flex-wrap border-b border-line" role="tablist">
        {TABS.filter(([k]) => !HIDDEN_TABS.includes(k)).filter(([k]) => (k !== "settings" && k !== "activity" && k !== "insights") || online?.owner).map(([k, name]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`px-3 h-9 text-sm -mb-px border-b-2 cursor-pointer ${tab === k ? "border-teal text-teal font-medium" : "border-transparent text-muted hover:text-ink"}`}>{t(name)}{k === "stock" && negative > 0 && <span className="ml-1.5 inline-grid place-items-center min-w-[18px] h-[18px] px-1 rounded-full bg-bad text-white text-[11px] font-semibold" title={t(negative === 1 ? "{n} batch below zero" : "{n} batches below zero", { n: negative })}>{negative}</span>}</button>
        ))}
        {!online && <button onClick={() => { sessionStorage.removeItem("medoro-device-unlocked"); setState("locked"); }} className="ml-auto px-3 h-9 text-sm text-muted cursor-pointer">{t("Lock")}</button>}
      </div>}
      {tab === "dash" && <Dashboard cfg={cfg} owner={who.owner} refresh={tick} go={setTab} />}
      {tab === "bill" && <Billing cfg={cfg} who={who} side={side} onBill={async (id, o) => { bump(); try { setReceiptWa(!!o?.whatsapp); setReceipt(await dev.call("saleDetail", id)); } catch { /* bill saved; preview optional */ } }} />}
      {tab === "bills" && <Bills cfg={cfg} who={who} refresh={tick} />}
      {tab === "stock" && <Stock cfg={cfg} owner={who.owner} userId={who.userId} refresh={tick} />}
      {tab === "purchases" && <Purchases cfg={cfg} who={who} onSaved={bump} />}
      {tab === "supplier" && <PurchaseTools cfg={cfg} who={who} refresh={tick} />}
      {tab === "recalls" && <Recalls cfg={cfg} who={who} refresh={tick} />}
      {tab === "doctors" && <Doctors cfg={cfg} who={who} refresh={tick} />}
      {tab === "cheques" && <Cheques cfg={cfg} who={who} refresh={tick} />}
      {tab === "orders" && <Orders cfg={cfg} who={who} onBilled={bump} />}
      {tab === "customers" && <Customers who={who} refresh={tick} pharmacy={cfg.pharmacy} />}
      {tab === "activity" && online?.owner && <Activity refresh={tick} />}
      {tab === "accounts" && <Accounts cfg={cfg} who={who} refresh={tick} />}
      {tab === "money" && <Money cfg={cfg} who={who} refresh={tick} />}
      {tab === "reports" && <ReportsGst cfg={cfg} />}
      {tab === "insights" && online?.owner && <Insights cfg={cfg} who={who} refresh={tick} />}
      {tab === "ask" && <Assistant cfg={cfg} who={who} />}
      {tab === "settings" && online?.owner && <div className="flex flex-col gap-4"><CounterSettings cfg={cfg} onChange={async () => { const c = await dev.call("config"); if (c) setCfg(c); }} />{settingsExtra}</div>}
      <ReceiptModal d={receipt} pharmacy={cfg.pharmacy} onClose={() => { setReceipt(null); setReceiptWa(false); }} who={who} sendWhatsApp={receiptWa} />
    </div>
  );
}

function CounterSettings({ cfg, onChange }: { cfg: Cfg; onChange: () => void }) {
  const toast = useToast();
  const t = useT();
  // The address stays bold in both languages; the Hindi line keeps {url} where it goes.
  const [before, after] = t("With a PIN, this counter keeps billing when the internet is down: open {url} (or any Medoro page while offline) and enter the PIN.").split("{url}");
  const dev = deviceDb();
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const save = async () => {
    if (pin !== again) return toast("The two PINs don’t match.", "red");
    try { await dev.call("setPin", pin); setPin(""); setAgain(""); toast("Counter PIN saved on this device.", "green"); onChange(); } catch (e) { toast(errText(e), "red"); }
  };
  return (
    <div className={`${card} max-w-lg`}>
      <div className="font-semibold">{t("Counter PIN")}</div>
      <div className="text-sm text-muted">
        {before}<b>medoro.in/device</b>{after}{" "}
        {t("The PIN is stored only on this device.")} {t(cfg.pinSet ? "A PIN is set; saving replaces it." : "No PIN is set yet.")}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input type="password" inputMode="numeric" placeholder={t("New PIN (4–8 digits)")} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} aria-label={t("New PIN")} className={input} />
        <input type="password" inputMode="numeric" placeholder={t("Same PIN again")} value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, ""))} aria-label={t("Repeat PIN")} className={input} />
      </div>
      <Button variant="primary" className="self-start" onClick={save} disabled={pin.length < 4}>Save PIN</Button>
      <div className="text-[13px] text-muted">{t("Counter series:")} <b>{cfg.series}</b> · {t("Branch:")} {cfg.branchName} · {t("Saved user for offline bills:")} {cfg.userName}</div>
    </div>
  );
}

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Banknote, CreditCard, MessageCircle, Minus, NotebookPen, Plus, QrCode, Receipt, Search, ShoppingCart, Stethoscope, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { deviceDb } from "@/drivedb/device";
import { inr } from "@/lib/money";
import { useLang, useT } from "@/lib/i18n-client";
import type { Lang, TFn } from "@/lib/tr";
import { card, input, errText, unitsOf, type Cfg, type Who } from "./ui";
import { DoctorPicker } from "./doctors";

type Med = { id: string; name: string; generic: string; mrpPaise: number; packSize: number; packUnit: string; looseUnit: string; allowLoose: number; schedule: string | null; stock: number };
type Line = { med: Med; qty: number; unit: "pack" | "loose" };
type Cust = { id: string; name: string; phone: string | null; balancePaise: number; creditLimitPaise: number; points: number };
const H1 = ["H1", "X", "NDPS"];
const price = (l: Line) => (l.unit === "loose" && l.med.packSize > 1 ? Math.floor(l.med.mrpPaise / l.med.packSize) : l.med.mrpPaise);
const MOBILE = /^[6-9]\d{9}$/;
const PAY = { cash: [Banknote, "Cash"], upi: [QrCode, "UPI"], card: [CreditCard, "Card"], credit: [NotebookPen, "Credit"] } as const;

/** A titled block of the cart panel (Customer, Prescription, Payment). */
function Section({ icon, title, aside, children }: { icon: React.ReactNode; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[.06em] text-muted">{icon}{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

const stockText = (m: Med, lang: Lang, t: TFn) => (m.packSize > 1 ? `${unitsOf(lang, t, Math.floor(m.stock / m.packSize), m.packUnit)}${m.stock % m.packSize ? ` + ${m.stock % m.packSize}` : ""}` : `${m.stock}`);

/**
 * The counter: search, cart, customer, payment, complete. Calls onBill with the new bill's id, and whether to send it
 * on WhatsApp. A new customer typed in (mobile and name) is saved with the bill, so it carries their number.
 */
export function Billing({ cfg, who, onBill, side }: { cfg: Cfg; who: Who; onBill: (saleId: string, o?: { whatsapp: boolean }) => void; side?: React.ReactNode }) {
  const toast = useToast();
  const t = useT();
  const lang = useLang();
  const dev = useRef(deviceDb()).current;
  const [q, setQ] = useState("");
  const [meds, setMeds] = useState<Med[]>([]);
  const [cart, setCart] = useState<Line[]>([]);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [waSend, setWaSend] = useState(true);
  const custQ = phone.length >= 3 ? phone : name.trim();
  const [custs, setCusts] = useState<Cust[]>([]);
  const [cust, setCust] = useState<Cust | null>(null);
  const [disc, setDisc] = useState(0);
  const [mode, setMode] = useState<"cash" | "upi" | "card" | "credit">("cash");
  const [rx, setRx] = useState({ prescriber: "", prescriberReg: "", patientName: "" });
  const [redeem, setRedeem] = useState(0);
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const cap = Math.min(who.discCap, cfg.maxDiscountPct);

  const search = useCallback((text: string) => dev.call("search", text, cfg.branchId).then((r) => setMeds(r as Med[])), [dev, cfg.branchId]);
  useEffect(() => { const t = setTimeout(() => search(q), 120); return () => clearTimeout(t); }, [q, search]);
  useEffect(() => {
    if (custQ.trim().length < 2) { setCusts([]); return; }
    const t = setTimeout(() => dev.call("findCustomers", custQ).then((r) => {
      const found = r as Cust[], exact = MOBILE.test(phone) ? found.find((c) => c.phone === phone) : undefined;
      if (exact) pick(exact); else setCusts(found);
    }), 150);
    return () => clearTimeout(t);
  }, [custQ, dev]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (c: Cust) => { setCust(c); setCusts([]); setPhone(""); setName(""); };
  const clearCust = () => { setCust(null); setRedeem(0); if (mode === "credit") setMode("cash"); };

  const add = (m: Med) => {
    setCart((c) => {
      const i = c.findIndex((l) => l.med.id === m.id && l.unit === "pack");
      return i < 0 ? [...c, { med: m, qty: 1, unit: "pack" }] : c.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l));
    });
    setQ(""); searchRef.current?.focus();
  };
  const setLine = (i: number, patch: Partial<Line>) => setCart((c) => c.map((l, j) => (j === i ? { ...l, ...patch } : l)).filter((l) => l.qty > 0));
  const subtotal = cart.reduce((n, l) => n + price(l) * l.qty, 0);
  const estTotal = Math.round((subtotal - Math.round((subtotal * disc) / 100)) / 100) * 100;
  const loyalty = cfg.loyalty;
  const redeemValue = loyalty.enabled && cust ? Math.min(redeem, cust.points) * loyalty.pointValuePaise : 0;
  const needRx = cart.some((l) => l.med.schedule), needH1 = cart.some((l) => H1.includes(l.med.schedule ?? ""));
  const discPaise = Math.round((subtotal * disc) / 100), roundOff = estTotal - (subtotal - discPaise);
  const toPay = Math.max(0, estTotal - redeemValue);
  // The number the bill goes to on WhatsApp: the chosen customer's, or a complete one typed in.
  const waPhone = cust ? cust.phone : MOBILE.test(phone) ? phone : null;

  const complete = useCallback(async () => {
    if (!cart.length || busy) return;
    // A customer typed in rather than picked: check it, then find or save them so the bill carries their number.
    const typedName = name.trim();
    if (!cust && phone && !MOBILE.test(phone)) { toast("Enter a 10-digit mobile number, or clear it.", "red"); return; }
    if (!cust && phone && !typedName) { toast("Enter the customer’s name to save them with this bill.", "red"); nameRef.current?.focus(); return; }
    setBusy(true);
    const t0 = performance.now();
    try {
      let customerId = cust?.id ?? null;
      if (!cust && (phone || typedName)) {
        const found = (await dev.call("findCustomers", phone || typedName)) as Cust[];
        const same = phone ? found.find((c) => c.phone === phone) : found.find((c) => c.name.toLowerCase() === typedName.toLowerCase());
        customerId = same ? same.id : (await dev.call("addCustomer", { name: typedName, phone: phone || null })).id;
      }
      const r = await dev.call("createSale", {
        branchId: cfg.branchId, series: cfg.series, userId: who.userId, customerId, discountPct: disc, maxDiscountPct: cap,
        lines: cart.map((l) => ({ medicineId: l.med.id, qty: l.qty, unit: l.unit })), pay: { mode },
        prescriber: rx.prescriber || undefined, prescriberReg: rx.prescriberReg || undefined, patientName: rx.patientName || undefined,
        redeemPoints: redeemValue ? Math.min(redeem, cust?.points ?? 0) : undefined,
      });
      toast(`Bill ${r.invoiceNo} · ${inr(r.totalPaise)} saved on this device (${Math.round(performance.now() - t0)} ms)${r.pointsEarned ? ` · ${r.pointsEarned} points earned` : ""}.`, "green");
      const sendWa = waSend && !!waPhone;
      setCart([]); setCust(null); setPhone(""); setName(""); setWaSend(true); setDisc(0); setMode("cash"); setRx({ prescriber: "", prescriberReg: "", patientName: "" }); setRedeem(0);
      void search("");
      onBill(r.saleId, { whatsapp: sendWa });
      searchRef.current?.focus();
    } catch (e) { toast(errText(e) || "The bill wasn’t saved.", "red"); }
    setBusy(false);
  }, [cart, busy, dev, cfg, who.userId, cust, phone, name, waSend, waPhone, disc, cap, mode, rx, redeem, redeemValue, toast, search, onBill]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "F9") { e.preventDefault(); void complete(); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [complete]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <div className={card}>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-2.5 text-muted" />
          <input ref={searchRef} autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && meds[0]) add(meds[0]); }}
            placeholder={t("Search medicine or scan barcode (F2)")} aria-label={t("Search medicine")} className={`${input} pl-9`} />
        </div>
        <ul className="flex flex-col divide-y divide-line text-sm border border-line rounded-lg max-h-[480px] overflow-auto">
          {meds.map((m) => (
            <li key={m.id}>
              <button className="w-full text-left px-3 py-2 hover:bg-page flex justify-between gap-2 cursor-pointer disabled:opacity-50" onClick={() => add(m)} disabled={m.stock <= 0} aria-label={m.name}>
                <span>{m.name}{m.schedule ? <span className="text-bad"> · {t("Sch")} {m.schedule}</span> : null}{m.generic ? <span className="text-muted"> · {m.generic}</span> : null}</span>
                <span className="text-muted whitespace-nowrap">{inr(m.mrpPaise)} · {m.stock > 0 ? stockText(m, lang, t) : t("out of stock")}</span>
              </button>
            </li>
          ))}
          {!meds.length && <li className="px-3 py-2 text-muted">{t("No match.")}</li>}
        </ul>
      </div>

      <div className="flex flex-col gap-4">
        <div className={`${card} gap-4`}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="m-0 flex items-center gap-2 text-[15px] font-semibold"><ShoppingCart size={17} className="text-teal" aria-hidden />{t("Cart")}
              {cart.length > 0 && <span className="text-[13px] font-normal text-muted">{t(cart.length === 1 ? "1 item" : "{n} items", { n: cart.length })}</span>}</h2>
            <span className="text-muted text-xs whitespace-nowrap">{cfg.branchName} · {t("series {s}", { s: cfg.series })}</span>
          </div>

          {cart.length ? (
            <div className="flex flex-col -mt-1">
              {cart.map((l, i) => (
                <div key={`${l.med.id}-${l.unit}`} className="app-line flex items-center gap-2 py-2.5 border-b border-line last:border-b-0 text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{l.med.name}</div>
                    <div className="text-muted text-xs">{t("{price} per {unit}", { price: inr(price(l)), unit: t(l.unit === "loose" ? l.med.looseUnit : l.med.packUnit) })}{l.med.schedule ? <span className="text-bad"> · {t("Sch")} {l.med.schedule}</span> : null}</div>
                  </div>
                  {l.med.allowLoose && l.med.packSize > 1 ? (
                    <select value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value as Line["unit"] })} className="border border-line rounded-lg h-8 text-xs px-1 bg-white" aria-label={t("Unit")}>
                      <option value="pack">{t(l.med.packUnit)}</option><option value="loose">{t(l.med.looseUnit)}</option>
                    </select>
                  ) : null}
                  <div className="flex items-center h-8 rounded-lg border border-line bg-white">
                    <button onClick={() => setLine(i, { qty: l.qty - 1 })} aria-label={t("Less")} className="w-7 h-full grid place-items-center rounded-l-lg hover:bg-page cursor-pointer"><Minus size={13} /></button>
                    <span className="w-7 text-center tabular-nums font-medium">{l.qty}</span>
                    <button onClick={() => setLine(i, { qty: l.qty + 1 })} aria-label={t("More")} className="w-7 h-full grid place-items-center rounded-r-lg hover:bg-page cursor-pointer"><Plus size={13} /></button>
                  </div>
                  <span className="w-[76px] text-right tabular-nums font-medium">{inr(price(l) * l.qty)}</span>
                  <button onClick={() => setLine(i, { qty: 0 })} aria-label={t("Remove")} className="p-1 text-muted hover:text-bad cursor-pointer"><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-line px-4 py-5 text-center text-sm text-muted">{t("Search and tap a medicine, or press Enter to add the first match.")}</div>
          )}

          <div className="border-t border-line" />
          <Section icon={<UserRound size={13} aria-hidden />} title={t("Customer")} aside={cust ? <button className="text-teal text-[13px] font-medium cursor-pointer" onClick={clearCust}>{t("Change")}</button> : <span className="text-xs text-faint">{t("Optional")}</span>}>
            {cust ? (
              <div className="flex items-center gap-3 rounded-lg border border-teal-line bg-teal-soft px-3 py-2.5">
                <span aria-hidden className="size-9 shrink-0 rounded-full bg-white border border-teal-line grid place-items-center text-[13px] font-semibold text-teal">{cust.name.trim().slice(0, 1).toUpperCase()}</span>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-semibold truncate">{cust.name}</div>
                  <div className="text-xs text-muted flex flex-wrap gap-x-2">
                    <span>{cust.phone ? `+91 ${cust.phone}` : t("No mobile number")}</span>
                    {cust.balancePaise ? <span className="text-bad">{t("owes {amount}", { amount: inr(cust.balancePaise) })}</span> : null}
                    {loyalty.enabled ? <span>{cust.points} {t("pts")}</span> : null}
                  </div>
                </div>
              </div>
            ) : (
              <div className="relative flex flex-col gap-2">
                <div className="flex">
                  <span className="inline-flex items-center px-3 h-9 border border-r-0 border-line rounded-l-lg bg-page text-sm text-muted">+91</span>
                  <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" autoComplete="off"
                    placeholder={t("Mobile number (WhatsApp)")} aria-label={t("Customer mobile")} className={`${input} rounded-l-none`} />
                </div>
                <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" placeholder={t("Customer name")} aria-label={t("Customer name")} className={input} />
                {custs.length > 0 && (
                  <ul className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-line rounded-lg shadow-lg divide-y divide-line max-h-56 overflow-auto">
                    {custs.map((c) => <li key={c.id}><button className="w-full text-left px-3 py-2 hover:bg-page cursor-pointer text-sm flex justify-between gap-2" onClick={() => pick(c)}><span className="font-medium truncate">{c.name}</span><span className="text-muted tabular-nums">{c.phone ?? ""}</span></button></li>)}
                  </ul>
                )}
                {phone.length > 0 && phone.length < 10 ? <div className="text-xs text-muted">{t("{n} of 10 digits", { n: phone.length })}</div>
                  : MOBILE.test(phone) && !custs.length ? <div className="text-xs text-muted">{t("New customer: saved with this bill.")}</div> : null}
              </div>
            )}
            {waPhone ? (
              <label className="flex items-center gap-2.5 rounded-lg border border-[#BFE3D0] bg-ok-bg px-3 py-2 cursor-pointer">
                <MessageCircle size={17} className="text-ok shrink-0" aria-hidden />
                <span className="flex-1 min-w-0 text-[13px] leading-tight">
                  <span className="block font-medium">{t("Send bill on WhatsApp")}</span>
                  <span className="block text-xs text-muted">{who.whatsapp ? t("The PDF goes to +91 {phone} when the bill is saved.", { phone: waPhone }) : t("Share it to +91 {phone} from the receipt.", { phone: waPhone })}</span>
                </span>
                <input type="checkbox" role="switch" checked={waSend} onChange={(e) => setWaSend(e.target.checked)} aria-label={t("Send bill on WhatsApp")} className="size-4 accent-[#1E7F4F] cursor-pointer" />
              </label>
            ) : null}
            {loyalty.enabled && cust && cust.points > 0 && (
              <label className="flex items-center justify-between gap-2 text-sm">{t("Use points")} <span className="text-muted text-xs">{t("({n} available, 1 = {value}, min {min})", { n: cust.points, value: inr(loyalty.pointValuePaise), min: loyalty.minRedeem })}</span>
                <input type="number" min={0} max={cust.points} value={redeem} onChange={(e) => setRedeem(Math.max(0, Math.min(cust.points, Number(e.target.value) || 0)))} className="border border-line rounded-lg px-2 h-8 w-20 text-right" aria-label={t("Points to use")} />
              </label>
            )}
          </Section>

          {needRx && (
            <Section icon={<Stethoscope size={13} aria-hidden />} title={t("Prescription")} aside={<span className="text-[11.5px] font-semibold text-bad">{t("Required for Schedule H")}</span>}>
              <DoctorPicker value={{ name: rx.prescriber, reg: rx.prescriberReg }} onChange={(v) => setRx({ ...rx, prescriber: v.name, prescriberReg: v.reg })} stacked />
              {needH1 && <input value={rx.patientName} onChange={(e) => setRx({ ...rx, patientName: e.target.value })} placeholder={t("Patient name")} className={input} aria-label={t("Patient name")} />}
            </Section>
          )}

          <Section icon={<Banknote size={13} aria-hidden />} title={t("Payment")}>
            {(() => {
              const modes = (["cash", "upi", "card", "credit"] as const).filter((m) => m !== "credit" || (who.canCredit && cust));
              return (
                <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${modes.length}, minmax(0, 1fr))` }} role="radiogroup" aria-label={t("Payment")}>
                  {modes.map((m) => {
                    const [Icon, label] = PAY[m];
                    return (
                      <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                        className={`h-12 rounded-lg border flex flex-col items-center justify-center gap-0.5 text-[12.5px] font-medium cursor-pointer transition-colors ${mode === m ? "border-teal bg-teal-soft text-teal ring-1 ring-teal" : "border-line bg-white text-ink hover:border-teal-line"}`}>
                        <Icon size={16} aria-hidden />{t(label)}
                      </button>
                    );
                  })}
                </div>
              );
            })()}
            <label className="flex items-center justify-between gap-2 text-sm">
              <span>{t("Discount")} <span className="text-muted text-xs">{t("(up to {cap}%)", { cap })}</span></span>
              <span className="flex items-center rounded-lg border border-line bg-white h-8">
                <input type="number" min={0} max={cap} value={disc} onChange={(e) => setDisc(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} className="w-14 h-full px-2 text-right bg-transparent rounded-l-lg" aria-label={t("Discount percent")} />
                <span className="px-2 text-muted text-xs border-l border-line h-full grid place-items-center">%</span>
              </span>
            </label>
          </Section>

          <div className="rounded-lg bg-page px-3 py-3 flex flex-col gap-1.5 text-sm tabular-nums">
            <div className="flex justify-between text-muted"><span>{t("MRP total")}</span><span>{inr(subtotal)}</span></div>
            {discPaise > 0 && <div className="flex justify-between text-muted"><span>{t("Discount ({pct}%)", { pct: disc })}</span><span>−{inr(discPaise)}</span></div>}
            {roundOff !== 0 && cart.length > 0 && <div className="flex justify-between text-muted"><span>{t("Round off")}</span><span>{roundOff > 0 ? "+" : "−"}{inr(Math.abs(roundOff))}</span></div>}
            {redeemValue > 0 && <div className="flex justify-between text-muted"><span>{t("Paid with points")}</span><span>−{inr(redeemValue)}</span></div>}
            <div className="flex items-baseline justify-between border-t border-line pt-2 mt-0.5"><span className="font-semibold">{t("To pay")}</span><span key={toPay} className="app-bump text-[24px] font-bold leading-none">{inr(toPay)}</span></div>
          </div>

          <Button variant="primary" size="lg" onClick={complete} disabled={busy || !cart.length} className="app-cta relative overflow-hidden">
            <Receipt size={18} /> {busy ? t("Saving…") : t("Complete bill")}
            {!busy && <kbd className="ml-1 rounded border border-white/40 px-1.5 text-[11px] font-medium">F9</kbd>}
          </Button>
        </div>
        {side}
      </div>
    </div>
  );
}

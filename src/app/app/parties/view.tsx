"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Truck, Users, Upload, FileText } from "lucide-react";
import { ImportDialog } from "@/components/import-dialog";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { inr, inr0 } from "@/lib/money";
import { dayMonth } from "@/lib/dates";
import { PAY_METHODS } from "@/domain/parties/contracts";
import { GST_STATES } from "@/domain/accounting/gst";
import type { listCustomers, listSuppliers } from "@/domain/parties/service";
import { METHODS, METHOD_LABEL, PURPOSE_LABEL, type Method } from "@/domain/parties/consent-labels";
import type { consentHistory } from "@/domain/parties/consent";
import { useT } from "@/lib/i18n-client";
import type { TFn } from "@/lib/tr";
import { consentsAction, paySupplierAction, pointsAction, receiveAction, remindAction, saveCustomerAction, saveSupplierAction } from "./actions";

type Sup = Awaited<ReturnType<typeof listSuppliers>>[number];
type Cus = Awaited<ReturnType<typeof listCustomers>>[number];
type ConsentRow = Awaited<ReturnType<typeof consentHistory>>[number];
const th = "text-left text-[12px] font-medium text-muted px-3.5 py-2.5 border-b border-[#E3E6E9] whitespace-nowrap";
const td = "px-3.5 py-2.5 border-b border-row";
const tableWrap = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] overflow-auto tbl-scroll";
const days = (t: TFn, n: number) => t(n === 1 ? "{n} day" : "{n} days", { n });
const hideSm = " max-sm:hidden";

export function PartiesView({ tab, suppliers, customers, canPay, canCredit, canEditSup, canMessage }: { tab: "sup" | "cus"; suppliers: Sup[]; customers: Cus[]; canPay: boolean; canCredit: boolean; canEditSup: boolean; canMessage: boolean }) {
  const router = useRouter();
  const [supEdit, setSupEdit] = useState<Sup | null | "new">(null);
  const [cusEdit, setCusEdit] = useState<Cus | null | "new">(null);
  const [pay, setPay] = useState<{ kind: "sup" | "cus"; id: string; name: string; bal: number } | null>(null);
  const [q, setQ] = useState("");
  const [importing, setImporting] = useState(false);
  const [points, setPoints] = useState<Cus | null>(null);
  const [reminding, startRemind] = useTransition();
  const t = useT();
  const toast = useToast();
  const remind = (c: Cus) => startRemind(async () => {
    const r = await remindAction(c.id);
    if (!r.ok) return toast(r.error, "red");
    toast(r.data.sent ? t("Payment reminder sent to {name}.", { name: c.name }) : r.data.failed ? t("The reminder failed; see the WhatsApp delivery log.") : t("{name} has no WhatsApp or SMS consent, or was reminded today.", { name: c.name }), r.data.sent ? "green" : "amber");
  });
  const match = (s: string | null | undefined) => !q || (s ?? "").toLowerCase().includes(q.toLowerCase());

  return (
    <div className="flex flex-col gap-3.5 max-w-[1400px]">
      <div className="flex gap-2.5 items-center flex-wrap">
        <Segmented value={tab} onChange={(v) => router.replace(v === "cus" ? "/app/parties?tab=cus" : "/app/parties")} className="bg-[#EEF0F2]"
          options={[{ value: "sup", label: t("Suppliers ({n})", { n: suppliers.length }) }, { value: "cus", label: t("Customers ({n})", { n: customers.length }) }]} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search name or phone")} aria-label={t("Search parties")} className="border border-input rounded-lg px-3 py-[7px] text-[13.5px] bg-white outline-none focus:border-teal w-[240px] max-sm:w-full" />
        <div className="ml-auto flex gap-2 max-sm:ml-0 max-sm:w-full">
          {tab === "cus" || canEditSup ? <Button className="max-sm:flex-1" onClick={() => setImporting(true)}><Upload size={15} />{t("Import")}</Button> : null}
          {tab === "sup" ? (canEditSup ? <Button variant="primary" className="max-sm:flex-1" onClick={() => setSupEdit("new")}><Plus size={16} />{t("Add supplier")}</Button> : null)
            : <Button variant="primary" className="max-sm:flex-1" onClick={() => setCusEdit("new")}><Plus size={16} />{t("Add customer")}</Button>}
        </div>
      </div>

      {tab === "sup" ? (
        <div className={tableWrap}>
          {suppliers.length ? (
            <table className="w-full border-collapse min-w-[900px] max-sm:min-w-[600px] text-[14px]">
              <thead><tr className="bg-subtle"><th className={th}>{t("Supplier")}</th><th className={th + hideSm}>{t("Credit terms")}</th><th className={th + hideSm}>{t("Lead time")}</th><th className={th + hideSm}>{t("Delivery accuracy")}</th><th className={th + " text-right"}>{t("Payable")}</th><th className={th}>{t("Next due")}</th><th className={th} /></tr></thead>
              <tbody>
                {suppliers.filter((s) => match(s.name) || match(s.phone)).map((s) => {
                  const d = s.nextDue?.days;
                  return (
                    <tr key={s.id}>
                      <td className={td}><div className="font-semibold">{s.name}</div><div className="text-[12px] text-muted font-mono">{s.gstin ?? t("No GSTIN")}{s.phone ? ` · ${s.phone}` : ""}</div></td>
                      <td className={td + hideSm}>{days(t, s.creditDays)}</td>
                      <td className={td + hideSm}>{days(t, s.leadDays)}</td>
                      <td className={td + hideSm}>{s.accuracy == null ? <span className="text-faint" title={t("Computed from placed purchase orders and their GRNs")}>{t("No PO history")}</span>
                        : <div className="flex flex-col"><span className="font-semibold" style={{ color: s.accuracy >= 95 ? "#1E7F4F" : s.accuracy >= 90 ? "#94570A" : "#B3261E" }}>{t("{pct}% filled", { pct: s.accuracy })}</span><span className="text-[12px] text-muted">{t(s.orders === 1 ? "{pct}% on time · {n} PO" : "{pct}% on time · {n} POs", { pct: s.onTime, n: s.orders })}</span></div>}</td>
                      <td className={td + " text-right font-semibold tnum"}>{inr0(s.balance)}</td>
                      <td className={td}>{s.nextDue ? <Badge tone={d! <= 3 ? "red" : d! <= 7 ? "amber" : "gray"}>{dayMonth(new Date(s.nextDue.date + "T00:00:00Z"))} ({d! < 0 ? t("{days} overdue", { days: days(t, -d!) }) : d === 0 ? t("today") : t("in {days}", { days: days(t, d!) })})</Badge> : <span className="text-faint">—</span>}</td>
                      <td className={td + " text-right whitespace-nowrap"}>
                        <div className="flex gap-1.5 justify-end">
                          <Button size="sm" variant="ghost" onClick={() => router.push(`/app/parties/statement/supplier/${s.id}`)}><FileText size={13} />{t("Statement")}</Button>
                          {canPay && s.balance > 0 ? <Button size="sm" onClick={() => setPay({ kind: "sup", id: s.id, name: s.name, bal: s.balance })}>Record payment</Button> : null}
                          {canEditSup ? <Button size="sm" variant="ghost" aria-label={t("Edit {name}", { name: s.name })} onClick={() => setSupEdit(s)}><Pencil size={13} /></Button> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <Empty icon={Truck} title="No suppliers yet" body="Add the distributors you buy from with their credit terms and lead time. They’re used for GRNs, payables and reorder planning." action={canEditSup ? <Button variant="primary" onClick={() => setSupEdit("new")}><Plus size={16} />{t("Add supplier")}</Button> : null} />}
        </div>
      ) : (
        <>
          <div className={tableWrap}>
            {customers.length ? (
              <table className="w-full border-collapse min-w-[820px] max-sm:min-w-[560px] text-[14px]">
                <thead><tr className="bg-subtle"><th className={th}>{t("Customer")}</th><th className={th + hideSm}>{t("Consent")}</th><th className={th + " text-right" + hideSm}>{t("Points")}</th><th className={th + " text-right" + hideSm}>{t("Credit limit")}</th><th className={th + " text-right"}>{t("Outstanding")}</th><th className={th + hideSm}>{t("Last visit")}</th><th className={th} /></tr></thead>
                <tbody>
                  {customers.filter((c) => match(c.name) || match(c.phone) || match(c.gstin)).map((c) => (
                    <tr key={c.id}>
                      <td className={td}><div className="font-semibold">{c.name}{c.gstin ? <> <Badge tone="gray">B2B</Badge></> : null}</div><div className="text-[12px] text-muted tnum">{c.phone ? `${c.phone.slice(0, 5)} ${c.phone.slice(5)}` : t("No phone")}{c.gstin ? <span className="font-mono"> · {c.gstin}</span> : null}</div></td>
                      <td className={td + hideSm}><div className="flex gap-1 flex-wrap">{c.optIn || c.smsOptIn ? <Badge tone="green">{t("Invoices")}{c.optIn ? " · WA" : ""}{c.smsOptIn ? " · SMS" : ""}</Badge> : <Badge tone="gray">No messages</Badge>}{c.waInvalid ? <Badge tone="red" title={c.waInvalid}>Not on WhatsApp</Badge> : null}{c.marketingWa || c.marketingSms ? <Badge tone="blue">{t("Offers")}{c.marketingWa ? " · WA" : ""}{c.marketingSms ? " · SMS" : ""}</Badge> : null}</div></td>
                      <td className={td + " text-right tnum" + hideSm}><button onClick={() => setPoints(c)} className={c.points ? "text-teal font-semibold cursor-pointer" : "text-fainter cursor-pointer"} aria-label={t("Points of {name}", { name: c.name })}>{c.points}</button></td>
                      <td className={td + " text-right tnum" + hideSm}>{c.limit ? inr0(c.limit) : t("No credit")}</td>
                      <td className={td + " text-right font-semibold tnum"} style={{ color: c.due > 0 ? "#B3261E" : "#5B636B" }}>{inr0(c.due)}</td>
                      <td className={td + " text-muted" + hideSm}>{c.lastVisit ? dayMonth(new Date(c.lastVisit)) : "—"}</td>
                      <td className={td + " text-right whitespace-nowrap"}>
                        <div className="flex gap-1.5 justify-end">
                          {canPay ? <Button size="sm" variant="ghost" onClick={() => router.push(`/app/parties/statement/customer/${c.id}`)}><FileText size={13} />{t("Statement")}</Button> : null}
                          {canMessage && c.due > 0 && (c.optIn || c.smsOptIn) ? <Button size="sm" variant="ghost" disabled={reminding} onClick={() => remind(c)}>Remind</Button> : null}
                          {canPay && c.due > 0 ? <Button size="sm" onClick={() => setPay({ kind: "cus", id: c.id, name: c.name, bal: c.due })}>Receive payment</Button> : null}
                          <Button size="sm" variant="ghost" aria-label={t("Edit {name}", { name: c.name })} onClick={() => setCusEdit(c)}><Pencil size={13} /></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <Empty icon={Users} title="No customers yet" body="Customers are optional. Add regulars who buy on credit or want invoices on WhatsApp." action={<Button variant="primary" onClick={() => setCusEdit("new")}><Plus size={16} />{t("Add customer")}</Button>} />}
          </div>
          <div className="text-[12.5px] text-muted">{t("Profiles are optional. Only name and phone are stored, plus GSTIN and billing address for business customers. No diagnosis or prescription details are kept on the customer record.")}</div>
        </>
      )}

      <SupplierModal edit={supEdit} canPay={canPay} onClose={() => setSupEdit(null)} />
      <CustomerModal edit={cusEdit} canCredit={canCredit} canPay={canPay} onClose={() => setCusEdit(null)} />
      <PayModal pay={pay} onClose={() => setPay(null)} />
      <PointsModal customer={points} onClose={() => setPoints(null)} />
      <ImportDialog key={tab} kind={tab === "sup" ? "suppliers" : "customers"} open={importing} onClose={() => setImporting(false)} />
    </div>
  );
}

function SupplierModal({ edit, canPay, onClose }: { edit: Sup | null | "new"; canPay: boolean; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const isNew = edit === "new";
  const [f, setF] = useState({ name: "", gstin: "", phone: "", creditDays: "30", leadDays: "1", acceptsReturns: true, stateCode: "", returnWindowDays: "90", opening: "" });
  const [err, setErr] = useState(""), [pending, start] = useTransition();
  useEffect(() => {
    setErr("");
    if (edit && edit !== "new") setF({ name: edit.name, gstin: edit.gstin ?? "", phone: edit.phone ?? "", creditDays: String(edit.creditDays), leadDays: String(edit.leadDays), acceptsReturns: edit.acceptsReturns, stateCode: edit.stateCode, returnWindowDays: String(edit.returnWindowDays), opening: "" });
    else setF({ name: "", gstin: "", phone: "", creditDays: "30", leadDays: "1", acceptsReturns: true, stateCode: "", returnWindowDays: "90", opening: "" });
  }, [edit]);
  const save = () => start(async () => {
    const r = await saveSupplierAction(isNew ? null : (edit as Sup).id, f, isNew ? undefined : (edit as Sup).version);
    if (!r.ok) return setErr(t(r.error));
    toast(r.message!, "green"); onClose();
  });
  return (
    <Modal open={!!edit} onClose={onClose} title={isNew ? "Add supplier" : "Edit supplier"} width={520}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={pending}>Save supplier</Button></>}>
      <div className="grid grid-cols-2 gap-2.5 max-sm:grid-cols-1">
        <Field label="Name *" className="col-span-full"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="GSTIN"><Input value={f.gstin} onChange={(e) => { const g = e.target.value.toUpperCase(); setF({ ...f, gstin: g, stateCode: GST_STATES.some(([c]) => c === g.slice(0, 2)) ? g.slice(0, 2) : f.stateCode }); }} className="font-mono" maxLength={15} /></Field>
        <Field label="State" hint="Out-of-state suppliers are billed IGST."><Select value={f.stateCode} onChange={(e) => setF({ ...f, stateCode: e.target.value })}><option value="">{t("From GSTIN / not set")}</option>{GST_STATES.map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}</Select></Field>
        <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" /></Field>
        <Field label="Credit terms (days)"><Input value={f.creditDays} onChange={(e) => setF({ ...f, creditDays: e.target.value.replace(/\D/g, "") })} inputMode="numeric" /></Field>
        <Field label="Lead time (days)" hint="Order to delivery. Used for reorder points."><Input value={f.leadDays} onChange={(e) => setF({ ...f, leadDays: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" /></Field>
        {isNew && canPay ? <Field label="Opening balance you owe ₹" hint="From your old books, if any."><Input value={f.opening} onChange={(e) => setF({ ...f, opening: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" placeholder="0" /></Field> : null}
      </div>
      <Checkbox checked={f.acceptsReturns} onChange={(e) => setF({ ...f, acceptsReturns: e.target.checked })} label="Accepts returns of near-expiry stock" />
      {f.acceptsReturns ? <Field label="Expiry return window (days)" hint="Stock expiring within this many days is suggested for an expiry claim to this supplier."><Input value={f.returnWindowDays} onChange={(e) => setF({ ...f, returnWindowDays: e.target.value.replace(/\D/g, "") })} inputMode="numeric" className="max-w-[140px]" /></Field> : null}
      {err ? <div role="alert" className="text-[13px] text-bad">{err}</div> : null}
    </Modal>
  );
}

const BLANK_CUS = { name: "", phone: "", waOptIn: false, smsOptIn: false, marketingWa: false, marketingSms: false, consentMethod: "counter" as Method, creditLimit: "", opening: "", gstin: "", stateCode: "", address: "", pincode: "" };

function CustomerModal({ edit, canCredit, canPay, onClose }: { edit: Cus | null | "new"; canCredit: boolean; canPay: boolean; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const isNew = edit === "new";
  const [f, setF] = useState(BLANK_CUS);
  const [history, setHistory] = useState<ConsentRow[] | null>(null);
  const [err, setErr] = useState(""), [pending, start] = useTransition();
  useEffect(() => {
    setErr(""); setHistory(null);
    if (edit && edit !== "new") {
      setF({ ...BLANK_CUS, name: edit.name, phone: edit.phone ?? "", waOptIn: edit.optIn, smsOptIn: edit.smsOptIn, marketingWa: edit.marketingWa, marketingSms: edit.marketingSms, creditLimit: edit.limit ? (edit.limit / 100).toFixed(0) : "", gstin: edit.gstin ?? "", stateCode: edit.stateCode, address: edit.address, pincode: edit.pincode });
      void consentsAction(edit.id).then((r) => setHistory(r.ok ? r.data : []));
    } else setF(BLANK_CUS);
  }, [edit]);
  const save = () => start(async () => {
    const r = await saveCustomerAction(isNew ? null : (edit as Cus).id, f, isNew ? undefined : (edit as Cus).version);
    if (!r.ok) return setErr(t(r.error));
    toast(r.message!, "green"); onClose();
  });
  const box = (k: "waOptIn" | "smsOptIn" | "marketingWa" | "marketingSms", label: string) => <Checkbox checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} label={label} />;
  return (
    <Modal open={!!edit} onClose={onClose} title={isNew ? "Add customer" : "Edit customer"} width={520}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={pending}>Save customer</Button></>}>
      <Field label="Name *"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
      <Field label="Mobile" hint={f.phone.includes("•") ? "Masked in strict mode. Leave it as it is to keep the number." : undefined}><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" /></Field>
      <Field label="Credit limit ₹" hint={canCredit ? "0 means cash only." : "Only managers can change credit limits."}><Input value={f.creditLimit} disabled={!canCredit} onChange={(e) => setF({ ...f, creditLimit: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" placeholder="0" /></Field>
      {isNew && canPay ? <Field label="Opening balance they owe ₹" hint="From your old books, if any."><Input value={f.opening} onChange={(e) => setF({ ...f, opening: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" placeholder="0" /></Field> : null}
      <details open={!!f.gstin}>
        <summary className="cursor-pointer text-[13.5px] font-medium">{t("Business customer (GSTIN, tax invoice)")}</summary>
        <div className="grid grid-cols-2 gap-2.5 mt-2 max-sm:grid-cols-1">
          <Field label="GSTIN" hint="B2B invoices show it and go to GSTR-1 B2B."><Input value={f.gstin} onChange={(e) => { const g = e.target.value.toUpperCase(); setF({ ...f, gstin: g, stateCode: GST_STATES.some(([c]) => c === g.slice(0, 2)) ? g.slice(0, 2) : f.stateCode }); }} className="font-mono" maxLength={15} /></Field>
          <Field label="Place of supply" hint="Another state means IGST."><Select value={f.stateCode} onChange={(e) => setF({ ...f, stateCode: e.target.value })}><option value="">{t("Your state / from GSTIN")}</option>{GST_STATES.map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}</Select></Field>
          <Field label="Billing address" className="col-span-full"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder={t("Street, area, city")} /></Field>
          <Field label="PIN code"><Input value={f.pincode} onChange={(e) => setF({ ...f, pincode: e.target.value.replace(/\D/g, "").slice(0, 6) })} inputMode="numeric" /></Field>
        </div>
      </details>
      <div className="flex flex-col gap-1.5 border-t border-row pt-2.5">
        <span className="text-[12.5px] font-semibold text-muted">{t("Consent")} · {t(PURPOSE_LABEL.transactional)}</span>
        {box("waOptIn", "Invoices and refill reminders on WhatsApp")}
        {box("smsOptIn", "Invoices and refill reminders by SMS")}
        <span className="text-[12.5px] font-semibold text-muted pt-1">{t("Consent")} · {t(PURPOSE_LABEL.marketing)} {t("(separate, optional)")}</span>
        {box("marketingWa", "Offers and health camps on WhatsApp")}
        {box("marketingSms", "Offers and health camps by SMS")}
        <Field label="How was it given?"><Select value={f.consentMethod} onChange={(e) => setF({ ...f, consentMethod: e.target.value as Method })}>{METHODS.filter((m) => m !== "import").map((m) => <option key={m} value={m}>{t(METHOD_LABEL[m])}</option>)}</Select></Field>
        <span className="text-[12px] text-faint">{t("Each change is recorded with purpose, channel, method, your name and the time. Withdrawal takes effect immediately.")}</span>
      </div>
      {history?.length ? (
        <div className="flex flex-col gap-0.5 text-[12.5px] max-h-[150px] overflow-auto border-t border-row pt-2">
          <span className="font-semibold text-muted">{t("Consent history")}</span>
          {history.map((h, i) => (
            <span key={i}><Badge tone={h.granted ? "green" : "gray"}>{h.granted ? "Given" : "Withdrawn"}</Badge> {t(PURPOSE_LABEL[h.purpose])} · {h.channel === "sms" ? "SMS" : "WhatsApp"} · {t(METHOD_LABEL[h.method as Method] ?? h.method)} · {h.by ?? t("System")} · {dayMonth(new Date(h.at), true)}</span>
          ))}
        </div>
      ) : null}
      {edit && edit !== "new" && edit.waInvalid ? <div className="text-[12.5px] text-bad">{t("WhatsApp reported: {reason}. Correct the number (or record WhatsApp consent again) to try WhatsApp again.", { reason: edit.waInvalid })}</div> : null}
      {err ? <div role="alert" className="text-[13px] text-bad">{err}</div> : null}
    </Modal>
  );
}

function PayModal({ pay, onClose }: { pay: { kind: "sup" | "cus"; id: string; name: string; bal: number } | null; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const [amount, setAmount] = useState(""), [method, setMethod] = useState<(typeof PAY_METHODS)[number]>("Cash"), [ref, setRef] = useState("");
  const [chq, setChq] = useState({ chequeNo: "", bank: "", chequeDate: "" });
  const [err, setErr] = useState(""), [pending, start] = useTransition();
  useEffect(() => { setAmount(""); setRef(""); setErr(""); setChq({ chequeNo: "", bank: "", chequeDate: new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10) }); setMethod(pay?.kind === "sup" ? "Bank transfer (NEFT)" : "Cash"); }, [pay]);
  if (!pay) return null;
  const submit = () => start(async () => {
    const input = { partyId: pay.id, amount, method, ref, ...(method === "Cheque" ? chq : {}) };
    const r = pay.kind === "sup" ? await paySupplierAction(input) : await receiveAction(input);
    if (!r.ok) return setErr(t(r.error));
    toast(t("{no} posted for {amount}.", { no: r.data, amount: inr(Math.round(parseFloat(amount) * 100)) }), "green"); onClose();
  });
  return (
    <Modal open onClose={onClose} title={pay.kind === "sup" ? "Record supplier payment" : "Receive customer payment"} sub={<>{pay.name} · {t("outstanding")} <strong>{inr(pay.bal)}</strong></>} width={440}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit} disabled={pending}>Post voucher</Button></>}>
      <div className="flex gap-2">
        <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder={t("Amount ₹")} aria-label={t("Amount")} inputMode="decimal" className="text-[15px]" autoFocus />
        <Button onClick={() => setAmount((pay.bal / 100).toFixed(2))} className="h-[38px]">Full</Button>
      </div>
      <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)} aria-label={t("Method")}>{PAY_METHODS.map((m) => <option key={m} value={m}>{t(m)}</option>)}</Select>
      {method === "Cheque" ? (
        <div className="grid grid-cols-[110px_minmax(0,1fr)_150px] gap-2">
          <Input value={chq.chequeNo} onChange={(e) => setChq({ ...chq, chequeNo: e.target.value.replace(/\D/g, "").slice(0, 6) })} placeholder={t("Cheque no.")} aria-label={t("Cheque number")} inputMode="numeric" className="font-mono" />
          <Input value={chq.bank} onChange={(e) => setChq({ ...chq, bank: e.target.value })} placeholder={t(pay.kind === "sup" ? "Your bank" : "Drawn on (bank)")} aria-label={t("Bank")} />
          <Input type="date" value={chq.chequeDate} onChange={(e) => setChq({ ...chq, chequeDate: e.target.value })} aria-label={t("Cheque date")} />
        </div>
      ) : null}
      {method !== "Cash" ? <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder={t(method === "Cheque" ? "Note (optional)" : "UTR / reference (optional)")} /> : null}
      <div className="text-[12px] text-faint">{method === "Cheque" ? t(pay.kind === "sup" ? "Posts a payment voucher to Cheques issued; the bank moves when you mark the cheque cleared under Cheques. Post-dated cheques are fine." : "Posts a receipt voucher to Cheques in hand; the bank moves when you mark the cheque cleared under Cheques. Post-dated cheques are fine.") : t(pay.kind === "sup" ? "Posts a payment voucher (PV). Posted vouchers can only be reversed, not edited." : "Posts a receipt voucher (RV). Posted vouchers can only be reversed, not edited.")}</div>
      {err ? <div role="alert" className="text-[13px] text-bad">{err}</div> : null}
    </Modal>
  );
}

const KIND: Record<string, string> = { earn: "Earned", redeem: "Redeemed", reverse: "Taken back (return)", restore: "Given back (return)", expire: "Expired" };

function PointsModal({ customer, onClose }: { customer: Cus | null; onClose: () => void }) {
  const t = useT();
  const [data, setData] = useState<Awaited<ReturnType<typeof pointsAction>> | null>(null);
  useEffect(() => { setData(null); if (customer) pointsAction(customer.id).then(setData, () => setData(null)); }, [customer]);
  if (!customer) return null;
  return (
    <Modal open onClose={onClose} title={t("Loyalty points · {name}", { name: customer.name })} sub={data ? <>{t("Balance")} <strong>{data.balance}</strong> {t("points (worth {amount})", { amount: inr(data.value) })}</> : "Loading…"} width={560}
      footer={<Button onClick={onClose}>Close</Button>}>
      {data?.rows.length ? (
        <table className="w-full border-collapse text-[13.5px]">
          <thead><tr className="bg-subtle"><th className={th}>{t("Date")}</th><th className={th}>{t("Entry")}</th><th className={th}>{t("Bill / note")}</th><th className={th + " text-right"}>{t("Points")}</th></tr></thead>
          <tbody>{data.rows.map((r) => (
            <tr key={r.id}>
              <td className={td}>{dayMonth(new Date(r.at))}</td>
              <td className={td}>{t(KIND[r.kind] ?? r.kind)}{r.expiresAt && r.points > 0 ? <div className="text-[11.5px] text-faint">{t("expires {date}", { date: dayMonth(new Date(r.expiresAt), true) })}</div> : null}</td>
              <td className={td + " font-mono text-[12px]"}>{r.note ?? "—"}{r.value ? <span className="text-faint"> · {inr(r.value)}</span> : null}</td>
              <td className={td + " text-right tnum font-semibold"} style={{ color: r.points < 0 ? "#B3261E" : "#1E7F4F" }}>{r.points > 0 ? "+" : ""}{r.points}</td>
            </tr>
          ))}</tbody>
        </table>
      ) : <div className="text-[13px] text-fainter">{data ? t("No points yet. Points are earned on bills when loyalty is turned on under Customer messaging.") : ""}</div>}
    </Modal>
  );
}
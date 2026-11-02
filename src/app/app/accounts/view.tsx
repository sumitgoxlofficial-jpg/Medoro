"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n-client";
import { Plus, Download, BookOpen } from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { inr, inr0 } from "@/lib/money";
import { voucherLabel } from "./ledger";
import { dayMonth } from "@/lib/dates";
import type { accountsOverview, dayBook } from "@/domain/accounting/service";
import { dayBookAction, expenseAction, reverseAction } from "./actions";

const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] px-[18px] py-4 flex flex-col gap-2";
const th = "text-left text-[12px] font-medium text-muted px-3.5 py-2.5 border-b border-[#E3E6E9] whitespace-nowrap";
const td = "px-3.5 py-2.5 border-b border-row align-top";

export function PeriodPicker({ value }: { value: string }) {
  const router = useRouter();
  return <Segmented value={["month", "last", "fy"].includes(value) ? value : "month"} onChange={(v) => router.replace(v === "month" ? "/app/accounts" : `/app/accounts?period=${v}`)} className="bg-white border border-line"
    options={[{ value: "month", label: "This month" }, { value: "last", label: "Last month" }, { value: "fy", label: "This FY" }]} />;
}

type Entry = Awaited<ReturnType<typeof dayBook>>[number];

export function AccountsView({ ov, book: firstPage, pageSize, reports, branchName, expenseAccounts, canPay, periodKey }: {
  ov: Awaited<ReturnType<typeof accountsOverview>>; book: Entry[]; pageSize: number; reports: { id: string; name: string; desc: string; pharmacy: boolean }[]; branchName: string | null;
  expenseAccounts: string[]; canPay: boolean; periodKey: string;
}) {
  const toast = useToast(), t = useT();
  const [exp, setExp] = useState(false);
  const [scope, setScope] = useState<"branch" | "all">("branch");
  const [book, setBook] = useState(firstPage), [more, setMore] = useState(firstPage.length >= pageSize), [loading, startLoad] = useTransition();
  useEffect(() => { setBook(firstPage); setMore(firstPage.length >= pageSize); }, [firstPage, pageSize]);
  const loadMore = () => startLoad(async () => {
    const r = await dayBookAction(periodKey, book[book.length - 1].id);
    if (!r.ok) return toast(r.error, "red");
    setBook((b) => [...b, ...r.data.filter((x) => !b.some((y) => y.id === x.id))]);
    setMore(r.data.length >= pageSize);
  });
  const [, start] = useTransition();
  /** Account names joined by ", " (day book columns), each in the chosen language. */
  const accounts = (names: string) => names.split(", ").map((n) => t(n)).join(", ");
  const pl = ov.pl;
  const Row = ({ l, v, b, neg }: { l: string; v: number; b?: boolean; neg?: boolean }) => (
    <div className={"flex justify-between gap-3 text-[13.5px] " + (b ? "font-semibold border-t border-line-soft pt-2" : "")}><span className={"min-w-0 " + (b ? "" : "text-ink-2")}>{l}</span><span className="tnum whitespace-nowrap shrink-0 text-right" style={{ color: (neg ? -v : v) < 0 ? "#B3261E" : undefined }}>{neg ? inr0(-v) : inr0(v)}</span></div>
  );
  return (
    <div className="flex flex-col gap-4 max-w-[1400px]">
      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))]">
        <div className={card}>
          <div className="flex justify-between items-baseline"><div className="font-semibold text-[15px]">{t("Profit & loss")}</div><span className="text-[12px] text-faint whitespace-nowrap">{ov.period.label}</span></div>
          <Row l={t("Net sales (taxable, after returns)")} v={pl.sales} />
          <Row l={t("Cost of goods sold")} v={pl.cogs} neg />
          <Row l={pl.sales ? t("Gross profit · {pct}%", { pct: ((pl.gross / pl.sales) * 100).toFixed(1) }) : t("Gross profit")} v={pl.gross} b />
          {pl.expenseLines.map((e) => <Row key={e.account} l={t(e.account)} v={e.amount} neg />)}
          {!pl.expenseLines.length ? <Row l={t("Operating expenses")} v={0} neg /> : null}
          <Row l={t("Net profit before tax")} v={pl.net} b />
        </div>
        <div className={card}>
          <div className="font-semibold text-[15px]">{t("Cash & bank")}</div>
          <Row l={t("Cash in hand")} v={ov.cash.cash} /><Row l={t("Bank account (UPI, card, transfers)")} v={ov.cash.bank} />
          <Row l={t("Receivable from customers")} v={ov.cash.receivable} /><Row l={t("Payable to suppliers")} v={ov.cash.payable} />
          {canPay ? <Button className="self-start mt-1" onClick={() => setExp(true)}><Plus size={15} />{t("Record expense")}</Button> : null}
        </div>
        <div className={card}>
          <div className="font-semibold text-[15px]">{t("GST summary")}</div>
          <div className="grid grid-cols-[50px_1fr_1fr_1fr] gap-2 text-[12px] text-muted"><span>{t("Slab")}</span><span className="text-right">{t("Output taxable")}</span><span className="text-right">{t("Output tax")}</span><span className="text-right">{t("Input tax")}</span></div>
          {ov.gst.length ? ov.gst.map((g) => (
            <div key={g.rate} className="grid grid-cols-[50px_1fr_1fr_1fr] gap-2 text-[13px] tnum"><span>{g.rate}%</span><span className="text-right">{inr0(g.outTaxable)}</span><span className="text-right">{inr0(g.outTax)}</span><span className="text-right">{inr0(g.inTax)}</span></div>
          )) : <div className="text-[13px] text-fainter">{t("No taxable sales or purchases in this period.")}</div>}
          <div className="flex justify-between text-[13.5px] font-semibold border-t border-line-soft pt-2"><span>{t("Net output tax after credit notes")}</span><span className="tnum">{inr0(ov.gstTotals.out)}</span></div>
          <div className="flex justify-between text-[13.5px]"><span className="text-ink-2">{t("Input tax credit (purchases, net of debit notes)")}</span><span className="tnum">{inr0(ov.gstTotals.in)}</span></div>
          {ov.gstTotals.inIgst ? <div className="flex justify-between text-[12.5px] text-muted"><span>{t("of which IGST (inter-state suppliers)")}</span><span className="tnum">{inr0(ov.gstTotals.inIgst)}</span></div> : null}
          <div className="text-[12px] text-faint">{t("Have your CA check this before filing. Medoro does not file returns.")}</div>
        </div>
      </div>

      <div className="bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] overflow-auto tbl-scroll">
        <div className="flex items-baseline justify-between px-4 pt-3.5 pb-2 gap-3 flex-wrap"><div className="font-semibold text-[15px]">{t("Day book")}</div><span className="text-[12px] text-faint">{t("Posted entries are immutable. Use Reverse to correct payments, receipts and expenses.")}</span></div>
        {book.length ? (<>
          <table className="w-full border-collapse min-w-[900px] text-[13.5px]">
            <thead><tr className="bg-subtle"><th className={th}>{t("Voucher")}</th><th className={th}>{t("Narration")}</th><th className={th}>{t("Debit", { ctx: "ledger" })}</th><th className={th}>{t("Credit", { ctx: "ledger" })}</th><th className={th + " text-right"}>{t("Amount")}</th><th className={th} /></tr></thead>
            <tbody>
              {book.map((v) => (
                <tr key={v.id} style={{ opacity: v.reversed ? 0.55 : 1 }}>
                  <td className={td + " whitespace-nowrap"}><div className="font-mono text-[12.5px]">{v.no}</div><div className="text-[12px] text-faint">{dayMonth(new Date(v.date))} · {t(voucherLabel(v.type))}</div></td>
                  <td className={td}>{v.narration}</td><td className={td + " text-ink-2"}>{accounts(v.dr)}</td><td className={td + " text-ink-2"}>{accounts(v.cr)}</td>
                  <td className={td + " text-right tnum font-semibold whitespace-nowrap"}>{inr(v.amount)}</td>
                  <td className={td + " text-right whitespace-nowrap"}>
                    {v.reversed ? <Badge tone="gray">Reversed</Badge> : v.isReversal ? <Badge tone="blue">Reversal</Badge> : canPay && v.canReverse ? (
                      <Button size="sm" onClick={() => { const r = prompt(t("Reason for reversing {no}:", { no: v.no })); if (r) start(async () => { const x = await reverseAction(v.id, r); toast(x.ok ? t("{no} reversed by {by}. Original kept for audit.", { no: v.no, by: x.data }) : x.error, x.ok ? "blue" : "red"); }); }}>Reverse</Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {more ? <div className="px-4 py-3"><Button size="sm" disabled={loading} onClick={loadMore}>{loading ? t("Loading…") : t("Load more")}</Button></div> : null}
        </>) : <Empty icon={BookOpen} title="No entries in this period" body="Sales, purchases, payments and expenses post here automatically." />}
      </div>

      <div className={card}>
        <div className="flex items-baseline justify-between gap-3 flex-wrap"><div className="font-semibold text-[15px]">{t("Reports")}</div><span className="text-[12px] text-faint">{t("Generated on your server for the selected period. CSV opens in Excel, Sheets or a Tally import.")}</span>
          {branchName ? <Segmented value={scope} onChange={(v) => setScope(v as "branch" | "all")} className="bg-white border border-line" options={[{ value: "branch", label: branchName }, { value: "all", label: "All branches" }]} /> : null}</div>
        <div className="grid gap-2.5 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
          {reports.map((r) => (
            <div key={r.id} className="flex items-center gap-3 border border-line rounded-[10px] px-3 py-2.5">
              <div className="flex flex-col flex-1 min-w-0"><span className="text-[13.5px] font-semibold">{r.name}</span><span className="text-[12px] text-faint">{r.desc}{r.pharmacy && branchName ? ` · ${t("all branches")}` : ""}</span></div>
              <a href={`/api/reports/${r.id}?period=${periodKey}${scope === "all" && !r.pharmacy ? "&scope=all" : ""}`} className="flex items-center gap-1 border border-input rounded-md px-2 py-1 text-[12.5px] text-ink hover:border-teal no-underline"><Download size={13} />CSV</a>
              {r.id === "customer-dues" ? <button type="button" title={t("In strict mode, mobile numbers need a reason (kept in the audit trail)")} className="text-[12px] text-teal cursor-pointer"
                onClick={() => { const why = prompt(t("Why do you need customer mobile numbers in this export?"), ""); if (why && why.trim().length >= 5) window.location.href = `/api/reports/${r.id}?period=${periodKey}&reason=${encodeURIComponent(why.trim())}`; }}>{t("+ phones")}</button> : null}
              {r.id === "h1-register" ? <a href={`/app/accounts?view=h1&period=${periodKey}`} className="text-[12px] text-teal no-underline">{t("View")}</a> : null}
            </div>
          ))}
        </div>
      </div>
      <ExpenseModal open={exp} onClose={() => setExp(false)} accounts={expenseAccounts} />
    </div>
  );
}

function ExpenseModal({ open, onClose, accounts }: { open: boolean; onClose: () => void; accounts: string[] }) {
  const toast = useToast(), t = useT();
  const [f, setF] = useState({ account: accounts[0], amount: "", method: "Cash" as "Cash" | "Bank" | "UPI", note: "" });
  const [err, setErr] = useState(""), [pending, start] = useTransition();
  const save = () => start(async () => {
    const r = await expenseAction(f as never);
    if (!r.ok) return setErr(r.error);
    toast(t("{no} posted.", { no: r.data }), "green"); setF({ ...f, amount: "", note: "" }); setErr(""); onClose();
  });
  return (
    <Modal open={open} onClose={onClose} title="Record expense" width={420}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={pending}>Post voucher</Button></>}>
      <Field label="Category"><Select value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })}>{accounts.map((a) => <option key={a} value={a}>{t(a)}</option>)}</Select></Field>
      <Field label="Amount ₹"><Input value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" autoFocus /></Field>
      <Field label="Paid by"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as typeof f.method })}><option value="Cash">{t("Cash")}</option><option value="Bank">{t("Bank")}</option><option value="UPI">UPI</option></Select></Field>
      <Field label="Note"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={t("Optional")} /></Field>
      <div className="text-[12px] text-faint">{t("Cash expenses reduce the expected cash at shift close.")}</div>
      {err ? <div role="alert" className="text-[13px] text-bad">{t(err)}</div> : null}
    </Modal>
  );
}

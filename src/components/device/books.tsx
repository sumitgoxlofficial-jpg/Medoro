"use client";
import { useEffect, useMemo, useState } from "react";
import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { deviceDb } from "@/drivedb/device";
import type { DeviceHandlers } from "@/drivedb/device.worker";
import type { customerStatement, h1Register, journal, profitAndLoss, supplierStatement, trialBalance } from "@/drivedb/ledger";
import { inr } from "@/lib/money";
import { todayISO } from "@/lib/dates";
import { useT } from "@/lib/i18n-client";
import { card, input, errText, type Cfg } from "./ui";

type View = "day" | "tb" | "pl" | "cust" | "sup" | "h1" | "tally";
const VIEWS: [View, string][] = [["day", "Day book"], ["tb", "Trial balance"], ["pl", "Profit & loss"], ["cust", "Customer statement"], ["sup", "Supplier statement"], ["h1", "Schedule H1 register"], ["tally", "Tally export"]];
const TYPE: Record<string, string> = { sales: "Sales", credit_note: "Credit note", receipt: "Receipt", purchase: "Purchase", payment: "Payment", debit_note: "Debit note" };
const th = "text-left text-[12px] font-medium text-muted px-3 py-2 border-b border-line whitespace-nowrap";
const td = "px-3 py-1.5 border-b border-row align-top";
const num = " text-right tnum whitespace-nowrap";
const csv = (rows: (string | number)[][]) => rows.map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(",")).join("\n") + "\n";
const rs = (p: number) => (p / 100).toFixed(2);
function save(name: string, body: string, type = "text/csv") {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([body], { type })), download: name });
  a.click(); URL.revokeObjectURL(a.href);
}
const monthStart = () => `${todayISO().slice(0, 7)}-01`;

/**
 * Books and registers from this counter's own records: day book, trial balance, profit & loss, customer and
 * supplier statements, the Schedule H1 register and a Tally Prime export. Read-only; owner only.
 */
export function Books({ cfg }: { cfg: Cfg }) {
  const t = useT();
  const [view, setView] = useState<View>("day");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayISO());
  const [day, setDay] = useState(todayISO());
  const ranged = view !== "day";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="inline-flex flex-wrap gap-px bg-chip p-0.5 rounded-lg" role="tablist" aria-label={t("Books and registers")}>
          {VIEWS.map(([k, name]) => (
            <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
              className={`rounded-md h-8 px-3 text-[13px] font-medium cursor-pointer ${view === k ? "bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,.1)]" : "text-muted hover:text-ink"}`}>{t(name)}</button>
          ))}
        </div>
        <div className="ml-auto flex items-end gap-2">
          {ranged ? (
            <>
              <label className="flex flex-col gap-1 text-[12px] text-muted">{t("From")}<input type="date" className={input} value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label={t("From date")} /></label>
              <label className="flex flex-col gap-1 text-[12px] text-muted">{t("To")}<input type="date" className={input} value={to} min={from} max={todayISO()} onChange={(e) => setTo(e.target.value)} aria-label={t("To date")} /></label>
            </>
          ) : (
            <label className="flex flex-col gap-1 text-[12px] text-muted">{t("Day")}<input type="date" className={input} value={day} max={todayISO()} onChange={(e) => setDay(e.target.value)} aria-label={t("Day book date")} /></label>
          )}
          <Button onClick={() => window.print()}><Printer size={15} /> {t("Print")}</Button>
        </div>
      </div>
      {view === "day" && <DayBook cfg={cfg} day={day} />}
      {view === "tb" && <TrialBalance cfg={cfg} from={from} to={to} />}
      {view === "pl" && <ProfitLoss cfg={cfg} from={from} to={to} />}
      {view === "cust" && <Statement kind="customer" from={from} to={to} />}
      {view === "sup" && <Statement kind="supplier" from={from} to={to} />}
      {view === "h1" && <H1 cfg={cfg} from={from} to={to} />}
      {view === "tally" && <Tally cfg={cfg} from={from} to={to} />}
      <p className="text-[12px] text-faint m-0">{t("Worked out from this counter’s bills, returns, receipts, purchases, payments and expenses. Have your accountant or CA review the books before filing.")}</p>
    </div>
  );
}

/** Runs one read on the device database whenever its arguments change. */
function useData<T>(op: keyof DeviceHandlers, args: unknown[]): T | null {
  const toast = useToast();
  const [data, setData] = useState<T | null>(null);
  const key = JSON.stringify([op, args]);
  useEffect(() => {
    let stop = false;
    const [o, a] = JSON.parse(key) as [keyof DeviceHandlers, unknown[]];
    if (a.some((x) => x === "")) return;
    (deviceDb().call as (op: keyof DeviceHandlers, ...args: unknown[]) => Promise<T>)(o, ...a).then((d) => { if (!stop) setData(d); }, (e) => toast(errText(e), "red"));
    return () => { stop = true; };
  }, [key, toast]);
  return data;
}

function DayBook({ cfg, day }: { cfg: Cfg; day: string }) {
  const t = useT();
  const rows = useData<ReturnType<typeof journal>>("dayBook", [cfg.branchId, day]);
  if (!rows) return <div className={card}>{t("Loading…")}</div>;
  const total = rows.reduce((a, v) => a + v.amountPaise, 0);
  return (
    <div className={card + " overflow-auto"}>
      <div className="flex items-center gap-2"><strong>{t("Day book")}</strong><span className="text-muted text-[13px]">{day} · {t("{n} vouchers", { n: rows.length })} · {inr(total)}</span>
        <Button size="sm" className="ml-auto" onClick={() => save(`day-book-${day}.csv`, csv([["Voucher", "Type", "Narration", "Ledger", "Debit", "Credit"], ...rows.flatMap((v) => v.lines.map((l) => [v.no, TYPE[v.type] ?? v.type, v.narration, l.partyLedger ?? l.account, rs(l.dr), rs(l.cr)]))]))}><Download size={14} /> CSV</Button></div>
      {rows.length ? (
        <table className="w-full border-collapse text-[13px] min-w-[760px]">
          <thead><tr>{["Voucher", "Type", "Narration", "Ledger", "Debit", "Credit"].map((h) => <th key={h} className={th + (h === "Debit" || h === "Credit" ? " text-right" : "")}>{t(h)}</th>)}</tr></thead>
          <tbody>{rows.flatMap((v) => v.lines.map((l, i) => (
            <tr key={v.no + i} className={i === 0 ? "border-t border-line" : ""}>
              <td className={td + " font-mono whitespace-nowrap"}>{i === 0 ? v.no : ""}</td><td className={td}>{i === 0 ? t(TYPE[v.type] ?? v.type) : ""}</td>
              <td className={td + " text-muted"}>{i === 0 ? v.narration : ""}</td><td className={td}>{l.partyLedger ?? t(l.account)}</td>
              <td className={td + num}>{l.dr ? inr(l.dr) : ""}</td><td className={td + num}>{l.cr ? inr(l.cr) : ""}</td>
            </tr>)))}</tbody>
        </table>
      ) : <div className="text-sm text-muted">{t("No entries on this day.")}</div>}
    </div>
  );
}

function TrialBalance({ cfg, from, to }: { cfg: Cfg; from: string; to: string }) {
  const t = useT();
  const tb = useData<ReturnType<typeof trialBalance>>("trialBalance", [cfg.branchId, from, to]);
  if (!tb) return <div className={card}>{t("Loading…")}</div>;
  return (
    <div className={card + " overflow-auto max-w-[900px]"}>
      <div className="flex items-center gap-2"><strong>{t("Trial balance")}</strong><span className="text-muted text-[13px]">{from} → {to}</span>
        <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${tb.drPaise === tb.crPaise ? "bg-ok-bg text-ok" : "bg-bad/10 text-bad"}`}>{tb.drPaise === tb.crPaise ? t("Balanced") : t("Not balanced")}</span>
        <Button size="sm" className="ml-auto" onClick={() => save(`trial-balance-${from}-${to}.csv`, csv([["Ledger", "Debit", "Credit"], ...tb.rows.map((r) => [r.account, rs(r.drPaise), rs(r.crPaise)]), ["Total", rs(tb.drPaise), rs(tb.crPaise)]]))}><Download size={14} /> CSV</Button></div>
      <table className="w-full border-collapse text-[13px]">
        <thead><tr><th className={th}>{t("Ledger")}</th><th className={th + " text-right"}>{t("Debit")}</th><th className={th + " text-right"}>{t("Credit")}</th></tr></thead>
        <tbody>{tb.rows.map((r) => <tr key={r.account}><td className={td}>{t(r.account)}</td><td className={td + num}>{r.drPaise ? inr(r.drPaise) : ""}</td><td className={td + num}>{r.crPaise ? inr(r.crPaise) : ""}</td></tr>)}</tbody>
        <tfoot><tr className="font-semibold"><td className={td}>{t("Total")}</td><td className={td + num}>{inr(tb.drPaise)}</td><td className={td + num}>{inr(tb.crPaise)}</td></tr></tfoot>
      </table>
      <p className="text-[12px] text-faint m-0">{t("Transactions in the period. Opening stock and opening balances from before Medoro aren’t ledger entries here.")}</p>
    </div>
  );
}

function ProfitLoss({ cfg, from, to }: { cfg: Cfg; from: string; to: string }) {
  const t = useT();
  const p = useData<ReturnType<typeof profitAndLoss>>("profitAndLoss", [cfg.branchId, from, to]);
  if (!p) return <div className={card}>{t("Loading…")}</div>;
  const row = (label: string, v: number, strong = false, indent = false) => (
    <tr className={strong ? "font-semibold" : ""}><td className={td + (indent ? " pl-7 text-muted" : "")}>{t(label)}</td><td className={td + num + (v < 0 ? " text-bad" : "")}>{inr(v)}</td></tr>);
  const lines: [string, number][] = [["Sales (before GST)", p.salesPaise], ["Less: sales returns", -p.returnsPaise]];
  return (
    <div className={card + " max-w-[720px]"}>
      <div className="flex items-center gap-2"><strong>{t("Profit & loss")}</strong><span className="text-muted text-[13px]">{from} → {to} · {t("{n} bills", { n: p.bills })}</span>
        <Button size="sm" className="ml-auto" onClick={() => save(`profit-loss-${from}-${to}.csv`, csv([["Line", "Amount"], ...lines.map(([a, b]) => [a, rs(b)]), ["Net sales", rs(p.netSalesPaise)], ["Cost of goods sold", rs(-p.cogsPaise)], ["Gross profit", rs(p.grossPaise)], ...p.expenses.map((e) => [e.category, rs(-e.amountPaise)]), ["Loyalty points redeemed", rs(-p.loyaltyPaise)], ["Round off", rs(p.roundOffPaise)], ["Net profit", rs(p.netPaise)]]))}><Download size={14} /> CSV</Button></div>
      <table className="w-full border-collapse text-[13.5px]">
        <tbody>
          {lines.map(([a, b]) => row(a, b, false, true))}
          {row("Net sales", p.netSalesPaise, true)}
          {row("Less: cost of goods sold", -p.cogsPaise, false, true)}
          <tr className="font-semibold bg-subtle"><td className={td}>{t("Gross profit")} <span className="text-muted font-normal">({p.grossMarginPct}%)</span></td><td className={td + num}>{inr(p.grossPaise)}</td></tr>
          {p.expenses.map((e) => row(`Less: ${e.category}`, -e.amountPaise, false, true))}
          {p.loyaltyPaise ? row("Less: loyalty points redeemed", -p.loyaltyPaise, false, true) : null}
          {p.roundOffPaise ? row("Round off", p.roundOffPaise, false, true) : null}
          <tr className="font-bold text-[15px]"><td className={td}>{t("Net profit")}</td><td className={td + num + (p.netPaise < 0 ? " text-bad" : " text-ok")}>{inr(p.netPaise)}</td></tr>
        </tbody>
      </table>
      <p className="text-[12px] text-faint m-0">{t("Cost of goods sold is each bill’s batch cost, less sealed returns put back in stock. GST collected ({gst}) isn’t income and is left out.", { gst: inr(p.gstCollectedPaise) })}</p>
    </div>
  );
}

function Statement({ kind, from, to }: { kind: "customer" | "supplier"; from: string; to: string }) {
  const t = useT();
  const dev = deviceDb();
  const [parties, setParties] = useState<{ id: string; name: string }[]>([]);
  const [id, setId] = useState("");
  useEffect(() => {
    const load = kind === "customer" ? dev.call("customerList", "") : dev.call("supplierDues");
    void load.then((r) => { const list = (r as { id: string; name: string }[]).map((x) => ({ id: x.id, name: x.name })); setParties(list); setId((cur) => cur || list[0]?.id || ""); });
  }, [dev, kind]);
  const st = useData<ReturnType<typeof customerStatement> | ReturnType<typeof supplierStatement>>(kind === "customer" ? "customerStatement" : "supplierStatement", [id, from, to]);
  const name = parties.find((p) => p.id === id)?.name ?? "";
  const who = st ? ("customer" in st ? st.customer : st.supplier) : null;
  return (
    <div className={card + " overflow-auto max-w-[1000px]"}>
      <div className="flex flex-wrap items-center gap-2">
        <strong>{t(kind === "customer" ? "Customer statement" : "Supplier statement")}</strong>
        <select className={input + " w-auto min-w-[260px]"} value={id} onChange={(e) => setId(e.target.value)} aria-label={t(kind === "customer" ? "Customer" : "Supplier")}>
          {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {st && <Button size="sm" className="ml-auto" onClick={() => save(`${kind}-statement-${name.replace(/\W+/g, "-")}-${from}-${to}.csv`, csv([["Date", "Particulars", "Ref", "Debit", "Credit", "Balance"], ["", "Opening balance", "", "", "", rs(st.openingPaise)], ...st.rows.map((r) => [r.date, r.kind, r.ref, rs(r.debitPaise), rs(r.creditPaise), rs(r.balancePaise)]), ["", "Closing balance", "", "", "", rs(st.closingPaise)]]))}><Download size={14} /> CSV</Button>}
      </div>
      {st && who ? (
        <>
          <div className="text-[13px] text-muted">{who.name}{who.phone ? ` · ${who.phone}` : ""}{who.gstin ? ` · GSTIN ${who.gstin}` : ""} · {from} → {to}</div>
          <table className="w-full border-collapse text-[13px] min-w-[720px]">
            <thead><tr>{["Date", "Particulars", "Ref", "Debit", "Credit", "Balance"].map((h) => <th key={h} className={th + (["Debit", "Credit", "Balance"].includes(h) ? " text-right" : "")}>{t(h)}</th>)}</tr></thead>
            <tbody>
              <tr className="text-muted"><td className={td} /><td className={td}>{t("Opening balance")}</td><td className={td} /><td className={td} /><td className={td} /><td className={td + num}>{inr(st.openingPaise)}</td></tr>
              {st.rows.map((r, i) => <tr key={i}><td className={td + " tnum whitespace-nowrap"}>{r.date}</td><td className={td}>{t(r.kind)}</td><td className={td + " font-mono"}>{r.ref}</td><td className={td + num}>{r.debitPaise ? inr(r.debitPaise) : ""}</td><td className={td + num}>{r.creditPaise ? inr(r.creditPaise) : ""}</td><td className={td + num}>{inr(r.balancePaise)}</td></tr>)}
              <tr className="font-semibold"><td className={td} /><td className={td}>{t(kind === "customer" ? "Closing balance (customer owes)" : "Closing balance (we owe)")}</td><td className={td} /><td className={td} /><td className={td} /><td className={td + num}>{inr(st.closingPaise)}</td></tr>
            </tbody>
          </table>
        </>
      ) : <div className="text-sm text-muted">{parties.length ? t("Loading…") : t(kind === "customer" ? "No customers yet." : "No suppliers yet.")}</div>}
    </div>
  );
}

function H1({ cfg, from, to }: { cfg: Cfg; from: string; to: string }) {
  const t = useT();
  const rows = useData<ReturnType<typeof h1Register>>("h1Register", [cfg.branchId, from, to]);
  const missing = useMemo(() => (rows ?? []).filter((r) => !r.complete).length, [rows]);
  if (!rows) return <div className={card}>{t("Loading…")}</div>;
  const head = ["Date", "Invoice", "Patient", "Prescriber", "Reg. no.", "Medicine", "Sch.", "Batch", "Expiry", "Qty"];
  return (
    <div className={card + " overflow-auto"}>
      <div className="flex items-center gap-2"><strong>{t("Schedule H1 register")}</strong><span className="text-muted text-[13px]">{from} → {to} · {t("{n} lines", { n: rows.length })}</span>
        <Button size="sm" className="ml-auto" onClick={() => save(`schedule-h1-register-${from}-${to}.csv`, csv([head, ...rows.map((r) => [r.date, r.invoiceNo, r.patient ?? "", r.prescriber ?? "", r.reg ?? "", `${r.medicine}${r.strength ? " " + r.strength : ""}`, r.schedule, r.batchNo, r.expiry.slice(0, 7), `${r.qty - r.returned} ${r.unit}`])]))}><Download size={14} /> CSV</Button></div>
      {missing ? <div role="note" className="bg-[#FDF2E1] border border-[#F3D9A8] rounded-lg px-3 py-2 text-[13px] text-[#6B4A0E]">{t("{n} line(s) lack the patient name, prescriber or registration number.", { n: missing })}</div> : null}
      {rows.length ? (
        <table className="w-full border-collapse text-[13px] min-w-[1000px]">
          <thead><tr>{head.map((h) => <th key={h} className={th + (h === "Qty" ? " text-right" : "")}>{t(h)}</th>)}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td className={td + " tnum whitespace-nowrap"}>{r.date}</td><td className={td + " font-mono"}>{r.invoiceNo}</td>
              <td className={td} style={{ color: r.patient ? undefined : "#B3261E" }}>{r.patient || t("Missing")}</td>
              <td className={td} style={{ color: r.prescriber ? undefined : "#B3261E" }}>{r.prescriber || t("Missing")}</td>
              <td className={td + " font-mono"} style={{ color: r.reg ? undefined : "#B3261E" }}>{r.reg || t("Missing")}</td>
              <td className={td}>{r.medicine}{r.strength ? ` ${r.strength}` : ""}</td><td className={td}>{r.schedule}</td><td className={td + " font-mono"}>{r.batchNo}</td>
              <td className={td + " tnum"}>{r.expiry.slice(0, 7)}</td>
              <td className={td + num}>{r.qty} {r.unit}{r.returned ? <span className="text-faint"> (−{r.returned})</span> : null}</td>
            </tr>))}</tbody>
        </table>
      ) : <div className="text-sm text-muted">{t("No Schedule H1, X or NDPS medicines were sold in this period.")}</div>}
    </div>
  );
}

function Tally({ cfg, from, to }: { cfg: Cfg; from: string; to: string }) {
  const t = useT();
  const toast = useToast();
  const [company, setCompany] = useState(cfg.pharmacy?.tradeName ?? "");
  const [busy, setBusy] = useState(false);
  const run = async (what: "vouchers" | "masters") => {
    if (!company.trim()) { toast(t("Enter the company name exactly as it is in Tally."), "red"); return; }
    setBusy(true);
    try {
      const r = await deviceDb().call("tallyExport", cfg.branchId, from, to, company.trim());
      if (what === "vouchers") save(`tally-vouchers-${from}-${to}.xml`, r.vouchersXml, "application/xml"); else save(`tally-masters-${from}-${to}.xml`, r.mastersXml, "application/xml");
      toast(what === "vouchers" ? t("{n} vouchers exported.", { n: r.vouchers }) : t("Ledgers exported."), "green");
    } catch (e) { toast(errText(e), "red"); }
    setBusy(false);
  };
  return (
    <div className={card + " max-w-[760px]"}>
      <strong>{t("Tally export")}</strong>
      <div className="text-[13px] text-muted">{t("Tally Prime XML for {from} → {to}. Import the ledgers first, then the vouchers: Gateway of Tally → Import → Masters, then Transactions.", { from, to })}</div>
      <label className="flex flex-col gap-1 text-[13px] text-muted">{t("Company name in Tally")}<input className={input} value={company} onChange={(e) => setCompany(e.target.value)} aria-label={t("Company name in Tally")} /></label>
      <div className="flex gap-2 flex-wrap">
        <Button onClick={() => run("masters")} disabled={busy}><Download size={15} /> {t("Ledgers (masters) XML")}</Button>
        <Button variant="primary" onClick={() => run("vouchers")} disabled={busy}><Download size={15} /> {t("Vouchers XML")}</Button>
      </div>
      <p className="text-[12px] text-faint m-0">{t("Sales, credit notes, receipts, purchases, payments and expenses as Tally vouchers, with a ledger for each customer and supplier. Check the import with your accountant.")}</p>
    </div>
  );
}
